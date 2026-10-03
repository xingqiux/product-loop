import type { CommandRunPurpose } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { commandRuns } from "./command-runs.ts";
import { landChanges, landRecords } from "./land.ts";
import { productVersions, projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

const at = new Date("2026-09-28T08:00:00Z");
const commit = "b".repeat(40);

/** 项目 a 开着 v1-落地-1，记了一次失败的运行。返回轮次、运行和落地记录在库里的编号。 */
async function landRound(): Promise<{ db: Db; roundId: number; runId: number; recordId: number }> {
  const { db } = await openTempDatabase(tempHome());
  db.insert(projects).values({ id: "a", name: "a", repoKind: "own", createdAt: at }).run();
  db.insert(productVersions)
    .values({ projectId: "a", version: 1, status: "open", startedAt: at })
    .run();
  const round = db
    .insert(rounds)
    .values({
      projectId: "a",
      version: 1,
      stage: "land",
      seq: 1,
      ordinal: 1,
      status: "open",
      startedAt: at,
    })
    .returning()
    .get();
  const run = db.insert(commandRuns).values(runRow(round.id)).returning().get();
  const record = db.insert(landRecords).values(recordRow(round.id)).returning().get();
  return { db, roundId: round.id, runId: run.id, recordId: record.id };
}

function runRow(roundId: number, purpose: CommandRunPurpose = "red") {
  return {
    projectId: "a",
    roundId,
    purpose,
    command: ["node", "check.js"] as const,
    cwd: "/work/a",
    exitCode: 1,
    outputTail: "FAIL",
    commit,
    startedAt: at,
    durationMs: 10,
    cliVersion: "2.0.0",
    recordedAt: at,
  };
}

function recordRow(roundId: number) {
  return {
    roundId,
    planText: "# 计划",
    planSections: {
      goal: "一件。",
      current: "读过了。",
      tidy: "要。",
      changes: "1. 一件",
      guard: "`pnpm test`",
      scenes: "验收更改。",
      verdicts: "无",
    },
    planTidy: { wanted: true } as const,
    verdicts: [],
    plannedAt: at,
  };
}

const diff = {
  lines: 3,
  files: 1,
  dependencyFiles: [],
  dataFormatFiles: [],
  maxLines: 60,
  maxFiles: 3,
  within: true,
};

describe("命令运行记录表", () => {
  it("命令存成数组，读回来原样", async () => {
    const { db, runId } = await landRound();
    expect(db.select().from(commandRuns).get()).toMatchObject({
      id: runId,
      command: ["node", "check.js"],
      commit,
      startedAt: at,
    });
  });

  it.each([
    ["用途写成中文标签", { purpose: "改前失败" as CommandRunPurpose }, "command_runs_purpose_enum"],
    ["退出码是负数", { exitCode: -1 }, "command_runs_exit_code"],
    ["用时是负数", { durationMs: -1 }, "command_runs_duration_ms"],
  ])("%s时被检查约束拒绝", async (_case, fields, check) => {
    const { db, roundId } = await landRound();
    expect(
      sqliteError(() =>
        db
          .insert(commandRuns)
          .values({ ...runRow(roundId), ...fields })
          .run(),
      ),
    ).toBe(`CHECK constraint failed: ${check}`);
  });
});

describe("落地记录表", () => {
  it("一轮只有一份", async () => {
    const { db, roundId } = await landRound();
    expect(sqliteError(() => db.insert(landRecords).values(recordRow(roundId)).run())).toBe(
      "UNIQUE constraint failed: land_records.round_id",
    );
  });

  it.each([
    [
      "重构既跳过又有运行",
      { tidySkipReason: "只改文案", tidyRunId: 1, tidiedAt: at },
      "land_records_tidy",
    ],
    ["重构记了却没有时间", { tidySkipReason: "只改文案" }, "land_records_tidied_at"],
    [
      "评审既有意见又跳过",
      { reviewOpinions: [], reviewSkipReason: "很小", reviewDiff: diff, reviewedAt: at },
      "land_records_review",
    ],
    ["没记评审却有时间", { reviewedAt: at }, "land_records_reviewed_at"],
    [
      "跳过评审没记改动的规模",
      { reviewSkipReason: "很小", reviewedAt: at },
      "land_records_review_skip_diff",
    ],
  ])("%s时被检查约束拒绝", async (_case, fields, check) => {
    const { db, roundId } = await landRound();
    db.delete(landRecords).run();
    expect(
      sqliteError(() =>
        db
          .insert(landRecords)
          .values({ ...recordRow(roundId), ...fields })
          .run(),
      ),
    ).toBe(`CHECK constraint failed: ${check}`);
  });
});

describe("功能改动表", () => {
  it("同一份落地记录里名字不重复", async () => {
    const { db, recordId, runId } = await landRound();
    const row = { landRecordId: recordId, name: "一件", queueNumbers: [1], redRunId: runId };
    db.insert(landChanges).values(row).run();
    expect(sqliteError(() => db.insert(landChanges).values(row).run())).toBe(
      "UNIQUE constraint failed: land_changes.land_record_id, land_changes.name",
    );
  });

  it.each([
    ["有通过的运行却没有提交", { greenRunId: 1, commitsAfterRed: [commit] }, "land_changes_commit"],
    ["没有通过的运行却有提交", { commit, commitsAfterRed: [commit] }, "land_changes_commit"],
    ["通过了却没记中间的提交", { greenRunId: 1, commit }, "land_changes_commits_after_red"],
  ])("%s时被检查约束拒绝", async (_case, fields, check) => {
    const { db, recordId, runId } = await landRound();
    const row = { landRecordId: recordId, name: "一件", queueNumbers: [], redRunId: runId };
    expect(
      sqliteError(() =>
        db
          .insert(landChanges)
          .values({ ...row, ...fields })
          .run(),
      ),
    ).toBe(`CHECK constraint failed: ${check}`);
  });

  it("失败的运行必须已经存在", async () => {
    const { db, recordId, runId } = await landRound();
    const row = { landRecordId: recordId, name: "一件", queueNumbers: [], redRunId: runId + 9 };
    expect(sqliteError(() => db.insert(landChanges).values(row).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });
});
