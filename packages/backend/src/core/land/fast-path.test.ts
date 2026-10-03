import { type ErrorBody, issuesOf, type Result, shortPlanTidyReason } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, landRecords } from "../../store/schema/index.ts";
import { addQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore, startAt, type TestCore } from "../testing.ts";
import { landRules } from "./rules.ts";
import type { RunInput } from "./shared.ts";
import { landStatus } from "./status.ts";
import {
  type GreenInput,
  recordGreen,
  recordPlan,
  recordRed,
  recordReview,
  recordTidy,
} from "./steps.ts";
import type { ChangedFile, ReviewThreshold } from "./threshold.ts";

// 落地的小改动走快路（改进 R04、D03，决定 216 之后的几条）：
// 计划可以只写三节；计划写了不要重构，重构自动记为跳过；全部功能改动通过而且改动在评审界线以内，评审自动跳过。
// 改动超过界线时，计划要补全七节，评审照旧要写意见。

const round = "v1-落地-1";
const root = "/work/app";
const baseCommit = "a".repeat(40);
const redCommit = "b".repeat(40);
const greenCommit = "c".repeat(40);

const threshold: ReviewThreshold = { lines: 60, files: 3, dataFormatPaths: [] };
const small: readonly ChangedFile[] = [{ root, path: "src/list.ts", added: 12, deleted: 3 }];
const big: readonly ChangedFile[] = [{ root, path: "src/list.ts", added: 100, deleted: 3 }];

const change = (name: string, command: string) =>
  `1. ${name}\n   对应 Q1。检查 \`${command}\`，查这一件改好了。`;

/** 只写三节的计划。 */
const shortPlan = (changes = change("一件", "node check.js")) =>
  [
    "# 计划",
    "",
    "## 要做的事",
    "一件。",
    "",
    "## 功能改动",
    changes,
    "",
    "## 用什么锁住现有的行为",
    "`pnpm test`。",
  ].join("\n");

/** 七节的计划，「要不要先重构」由参数写。 */
const fullPlan = (tidy: string, changes = change("一件", "node check.js")) =>
  [
    "# 计划",
    "",
    "## 要做的事",
    "一件。",
    "",
    "## 现状",
    "读过了。",
    "",
    "## 要不要先重构",
    tidy,
    "",
    "## 功能改动",
    changes,
    "",
    "## 用什么锁住现有的行为",
    "`pnpm test`。",
    "",
    "## 对应哪个场景",
    "验收更改。",
    "",
    "## 裁决",
    "| 裁决 | 理由 | 错了的代价 |",
    "| --- | --- | --- |",
    "| 先失败后通过由命令行去跑 | 证据要跑出来 | 小 |",
  ].join("\n");

function run(over: Partial<RunInput> = {}): RunInput {
  return {
    command: ["node", "check.js"],
    cwd: root,
    exitCode: 1,
    outputTail: "FAIL 一件",
    commit: redCommit,
    startedAt: startAt.toISOString(),
    durationMs: 120,
    cliVersion: "2.0.0",
    ...over,
  };
}

const green = (changed?: readonly ChangedFile[], over: Partial<RunInput> = {}): GreenInput => ({
  run: run({ exitCode: 0, outputTail: "PASS 一件", commit: greenCommit, ...over }),
  commitsAfterRed: [greenCommit],
  ...(changed === undefined ? {} : { changed }),
});

function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(`${result.error.message}（${result.error.rule ?? ""}）`);
  return result.value;
}

async function landCore(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, root);
  for (const content of ["空列表显示一句提示", "保存按钮不被挡住"]) {
    succeed(addQueueItem(core.ctx, "app", { content, stage: "land", proposer: "ai" }));
  }
  succeed(
    startRound(core.ctx, "app", {
      stage: "land",
      take: ["Q1"],
      baseCommits: [{ root, commit: baseCommit }],
    }),
  );
  return core;
}

const plan = (core: TestCore, text: string) => recordPlan(core.ctx, "app", round, text);
const red = (core: TestCore, name = "一件", command: RunInput["command"] = ["node", "check.js"]) =>
  recordRed(core.ctx, "app", round, name, run({ command }));
const pass = (core: TestCore, input: GreenInput, name = "一件") =>
  recordGreen(core.ctx, "app", round, name, input, threshold);
const status = (core: TestCore) => succeed(landStatus(core.ctx.db, "app", round));

describe("计划从简：只写要做的事、功能改动、用什么锁住现有的行为三节", () => {
  it("收下，重构自动记为跳过，下一步直接是这一件的失败", async () => {
    const core = await landCore();
    const recorded = succeed(plan(core, shortPlan()));
    expect(recorded.plan.tidy).toEqual({ wanted: false, reason: shortPlanTidyReason });
    expect(recorded.plan.sections).toMatchObject({ current: "", scenes: "", verdicts: "" });
    expect(recorded.next).toEqual(["ploop land red 一件 -- node check.js"]);
    const got = status(core);
    expect(got.tidy).toMatchObject({ state: "skipped", reason: shortPlanTidyReason, run: null });
    const auto = core.ctx.db.select().from(events).where(eq(events.kind, "land.tidied")).all();
    expect(auto.map((event) => event.detail)).toEqual([
      { skipped: true, reason: shortPlanTidyReason, auto: true },
    ]);
  });

  it("写了别的四节里的一节，就按七节查，缺的照样拦截", async () => {
    const core = await landCore();
    const text = `${shortPlan()}\n\n## 现状\n读过了。\n`;
    const result = plan(core, text);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : issuesOf(result.error).map((issue) => issue.rule)).toEqual([
      landRules.planSections,
    ]);
    expect(core.ctx.db.select().from(landRecords).all()).toEqual([]);
  });

  it("三节里缺一节，不是从简的计划，缺的几节都报", async () => {
    const core = await landCore();
    const result = plan(core, "## 要做的事\n一件。\n\n## 功能改动\n1. 一件\n");
    expect(result.ok).toBe(false);
  });
});

describe("计划写了不要重构：重构自动记为跳过", () => {
  it("七节的计划写不要和理由，理由取自计划，不用再敲 land tidy --skip", async () => {
    const core = await landCore();
    const recorded = succeed(plan(core, fullPlan("不要。只改一句文案，不碰结构。")));
    expect(recorded.next).toEqual(["ploop land red 一件 -- node check.js"]);
    expect(status(core).tidy).toMatchObject({
      state: "skipped",
      reason: "只改一句文案，不碰结构。",
    });
  });

  it("写了要重构：不自动跳过，下一步还是重构", async () => {
    const core = await landCore();
    const recorded = succeed(plan(core, fullPlan("要。拆一个函数。")));
    expect(recorded.next).toEqual(["ploop land tidy -- pnpm test"]);
    expect(status(core).tidy.state).toBe("missing");
  });

  it("以前做过重构、记了检查运行的，换成不要的计划也不覆盖", async () => {
    const core = await landCore();
    succeed(plan(core, fullPlan("要。拆一个函数。")));
    succeed(
      recordTidy(core.ctx, "app", round, {
        run: run({ command: ["pnpm", "test"], exitCode: 0, outputTail: "PASS", commit: redCommit }),
      }),
    );
    succeed(plan(core, fullPlan("不要。只改一句文案，不碰结构。")));
    expect(status(core).tidy.state).toBe("done");
  });
});

describe("全部功能改动通过而且改动在评审界线以内：评审自动跳过", () => {
  it("记通过时交来改动，理由写明规模，五步齐了，下一步是给出验收页", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    const recorded = succeed(pass(core, green(small)));
    expect(recorded.reviewSkipped).toMatchObject({ lines: 15, files: 1, within: true });
    expect(recorded.next).toEqual(["ploop page example --stage 落地"]);
    const got = status(core);
    expect(got.review).toMatchObject({
      state: "skipped",
      reason: "自动跳过评审：改动 15 行、1 个文件，在界线以内。",
      opinions: null,
    });
    expect(got.complete).toBe(true);
    const reviewed = core.ctx.db
      .select()
      .from(events)
      .where(eq(events.kind, "land.reviewed"))
      .all();
    expect(reviewed.map((event) => event.detail)).toEqual([
      { skipped: true, auto: true, lines: 15, files: 1 },
    ]);
  });

  it("不交改动时不自动跳过，评审照旧要记", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    const recorded = succeed(pass(core, green()));
    expect(recorded.reviewSkipped).toBeNull();
    expect(status(core).review.state).toBe("missing");
    expect(recorded.next).toEqual(["ploop land diff", "ploop land review"]);
  });

  it("计划里还有一件没通过时不自动跳过，最后一件通过时才跳过", async () => {
    const core = await landCore();
    const two = shortPlan(
      `${change("一件", "node check.js")}\n2. 另一件\n   对应 Q1。检查 \`node other.js\`，查另一件。`,
    );
    succeed(plan(core, two));
    succeed(red(core));
    expect(succeed(pass(core, green(small))).reviewSkipped).toBeNull();
    succeed(red(core, "另一件", ["node", "other.js"]));
    const last = succeed(pass(core, green(small, { command: ["node", "other.js"] }), "另一件"));
    expect(last.reviewSkipped).toMatchObject({ within: true });
  });

  it("改动超过界线：不自动跳过，从简的计划警告要补全七节，评审时被拦，补全以后照常评审", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    const recorded = succeed(pass(core, green(big)));
    expect(recorded.reviewSkipped).toBeNull();
    expect(recorded.warnings.map((issue) => [issue.rule, issue.message])).toEqual([
      [
        landRules.planSections,
        "这一批的改动超过了评审界线，计划要写全七节，还缺：现状、要不要先重构、对应哪个场景、裁决。",
      ],
    ]);
    const opinions = [{ file: "a.py", line: 3, level: "suggest" as const, text: "名字" }];
    const blocked = recordReview(core.ctx, "app", round, { opinions, changed: big }, threshold);
    expect(blocked.ok ? [] : issuesOf(blocked.error).map((issue) => issue.rule)).toEqual([
      landRules.planSections,
    ]);
    // 补全七节的计划，评审的意见才收。已经记的失败和通过照旧留着。
    succeed(plan(core, fullPlan("不要。只改一句文案，不碰结构。")));
    succeed(recordReview(core.ctx, "app", round, { opinions, changed: big }, threshold));
    expect(status(core).complete).toBe(true);
  });

  it("超过界线又写 --skip：计划要补全和评审不能跳过，两条一起报", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    succeed(pass(core, green()));
    const blocked = recordReview(
      core.ctx,
      "app",
      round,
      { skip: "改动很小", changed: big },
      threshold,
    );
    expect(blocked.ok ? [] : issuesOf(blocked.error).map((issue) => issue.rule)).toEqual([
      landRules.planSections,
      landRules.reviewRequired,
    ]);
  });

  it("已经写过评审意见的，改动以后再通过也不悄悄改成跳过", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    succeed(pass(core, green()));
    const opinions = [{ file: "a.py", line: 3, level: "suggest" as const, text: "名字" }];
    core.setNow(new Date(startAt.getTime() + 60_000));
    succeed(recordReview(core.ctx, "app", round, { opinions, changed: small }, threshold));
    core.setNow(new Date(startAt.getTime() + 120_000));
    succeed(red(core));
    const again = succeed(pass(core, green(small)));
    expect(again.reviewSkipped).toBeNull();
    expect(status(core).review).toMatchObject({ state: "stale" });
    expect(status(core).review.opinions).toHaveLength(1);
  });

  it("改动的行数写错：BAD_REQUEST，什么都不记", async () => {
    const core = await landCore();
    succeed(plan(core, shortPlan()));
    succeed(red(core));
    const bad = pass(core, green([{ root, path: "src/list.ts", added: -1, deleted: 0 }]));
    expect(bad).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(status(core).changes[0]?.state).toBe("failed");
  });
});
