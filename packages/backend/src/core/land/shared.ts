import {
  type CommandRun,
  type CommandRunPurpose,
  type Err,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  formatQueueId,
  formatRoundName,
  type Issue,
  type LandPlanSection,
  type LandPlanTidy,
  landPlanSection,
  ok,
  parseCopy,
  parseRoundLabel,
  type Result,
  type RoundLabel,
  renderCopy,
  shortPlanSections,
  stageWordOf,
  type VerdictRow,
} from "@product-loop/model";
import { and, asc, eq, inArray } from "drizzle-orm";
import { landStepsCopy } from "../../copy/land.ts";
import {
  commandRuns,
  landChanges,
  landRecords,
  queueItems,
  type ReviewDiffSize,
  type ReviewOpinion,
  roundItems,
  rounds,
} from "../../store/schema/index.ts";
import { fail, iso, type Reader } from "../projects.ts";
import type { WriteScope } from "../tx.ts";
import { normalizeChangeName, type PlanChangeItem, parseChangeItems } from "./plan-items.ts";
import { landRules } from "./rules.ts";

// 落地五步的几个用例共用的：找这一轮、读落地记录、记命令运行、把库里的行换成对外的样子。
// 对外的样子里时间写成 ISO 8601 字符串，队列写成 Q12，写事务的结果要能存成 JSON。

export type RoundRow = typeof rounds.$inferSelect;
export type LandRecordRow = typeof landRecords.$inferSelect;
export type LandChangeRow = typeof landChanges.$inferSelect;
type RunRow = typeof commandRuns.$inferSelect;

/** 命令行交来的一次运行。项目、轮次和用途由路径和用例定，不在这里写。 */
export type RunInput = Omit<CommandRun, "project" | "round" | "purpose">;

/** 失败的结果：错误码加一到多条问题。 */
export function failAll<C extends ErrorCode>(
  code: C,
  issues: readonly Issue[],
): Err<ErrorBody<C>> | undefined {
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody(code, [first, ...rest]));
}

/**
 * 从简的计划：现状、对应哪个场景、裁决三节都是空的。七节的计划这几节一定有正文，
 * 从简的计划只写要做的事、功能改动、用什么锁住现有的行为三节，见 model 的 parseLandPlan。
 */
export function isShortPlan(record: LandRecordRow): boolean {
  const { current, scenes, verdicts } = record.planSections;
  return current === "" && scenes === "" && verdicts === "";
}

/** 计划从简，这一批的改动却超过了评审界线：计划要补全七节。规矩是 land.plan.sections。 */
export function planShortIssue(): Issue & { rule: string } {
  const text = landStepsCopy.review.planShort;
  const names = landPlanSection.keys
    .filter((section) => !shortPlanSections.some((short) => short === section))
    .map((section) => landPlanSection.label(section))
    .join("、");
  return {
    rule: landRules.planSections,
    message: renderCopy(text.message, { names }),
    hint: renderCopy(text.hint),
  };
}

// ── 找这一轮 ──

/** 解析轮次的写法。写错时返回 BAD_REQUEST，报错和 parseRoundLabel 的文案相同。 */
export function parseRound(text: string): Result<RoundLabel, ErrorBody<"BAD_REQUEST">> {
  const parsed = parseRoundLabel(text);
  if (parsed.ok) return parsed;
  const copy = parseCopy.roundLabel[parsed.error];
  const params = { text, old: stageWordOf(text), now: "落地" };
  return fail("BAD_REQUEST", {
    message: renderCopy(copy.message, params),
    hint: renderCopy(copy.hint, params),
    where: text,
  });
}

/**
 * 能记落地五步的一轮：这个项目里有它，是落地轮，还没收尾。
 * 找不到返回 NOT_FOUND，不是落地轮或已收尾返回 CONFLICT。
 */
export function landRound(
  tx: Reader,
  projectId: string,
  label: RoundLabel,
  { forWrite }: { readonly forWrite: boolean },
): Result<RoundRow, ErrorBody<"NOT_FOUND" | "CONFLICT">> {
  const round = formatRoundName(label);
  const row = tx
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.projectId, projectId),
        eq(rounds.version, label.version),
        eq(rounds.stage, label.stage),
        eq(rounds.seq, label.seq),
      ),
    )
    .get();
  const text = landStepsCopy.round;
  if (row === undefined) {
    return fail("NOT_FOUND", {
      message: renderCopy(text.notFound.message, { project: projectId, round }),
      hint: renderCopy(text.notFound.hint),
      where: round,
    });
  }
  if (row.stage !== "land") {
    return fail("CONFLICT", {
      message: renderCopy(text.notLand.message, { round }),
      hint: renderCopy(text.notLand.hint),
      where: round,
    });
  }
  if (forWrite && row.status === "closed") {
    return fail("CONFLICT", {
      message: renderCopy(text.closed.message, { round }),
      hint: renderCopy(text.closed.hint),
      where: round,
    });
  }
  return ok(row);
}

// ── 读落地记录 ──

export function recordOf(tx: Reader, roundId: number): LandRecordRow | undefined {
  return tx.select().from(landRecords).where(eq(landRecords.roundId, roundId)).get();
}

/** 这一份落地记录的功能改动，按记下的先后排。 */
export function changesOf(tx: Reader, recordId: number): LandChangeRow[] {
  return tx
    .select()
    .from(landChanges)
    .where(eq(landChanges.landRecordId, recordId))
    .orderBy(asc(landChanges.id))
    .all();
}

export function findChange(tx: Reader, recordId: number, name: string): LandChangeRow | undefined {
  return tx
    .select()
    .from(landChanges)
    .where(and(eq(landChanges.landRecordId, recordId), eq(landChanges.name, name)))
    .get();
}

/** 不用加引号的名字：字母、数字（含汉字）和几个常用的符号。 */
const plainName = /^[\p{L}\p{N}_@%+=:,./-]+$/u;

/** 把功能改动的名字写进给人照抄的命令：有空格或特殊符号时用单引号括起来。 */
export function shellName(name: string): string {
  return plainName.test(name) ? name : `'${name.replaceAll("'", `'"'"'`)}'`;
}

/** 计划「功能改动」里的每一件。 */
export function planItems(record: LandRecordRow): PlanChangeItem[] {
  return parseChangeItems(record.planSections.changes);
}

/** 按名字找计划里的一件，两边都去掉首尾的空白和末尾的标点再比。 */
export function planItem(record: LandRecordRow, name: string): PlanChangeItem | undefined {
  const wanted = normalizeChangeName(name);
  return planItems(record).find((item) => item.name === wanted);
}

/** 这一批：开始这一轮时拿出的事的队列编号，按编号排。 */
export function batchNumbers(tx: Reader, roundId: number): number[] {
  return tx
    .select({ number: queueItems.number })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .where(eq(roundItems.roundId, roundId))
    .orderBy(asc(queueItems.number))
    .all()
    .map((row) => row.number);
}

/** 按编号取几次运行。 */
export function runsById(tx: Reader, ids: readonly (number | null)[]): ReadonlyMap<number, RunRow> {
  const wanted = [...new Set(ids.filter((id) => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = tx.select().from(commandRuns).where(inArray(commandRuns.id, wanted)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

// ── 记命令运行 ──

/** 记下一次运行，只加不改。收下的时间是写事务的时间。 */
export function insertRun(
  w: WriteScope,
  round: RoundRow,
  purpose: CommandRunPurpose,
  run: RunInput,
): RunRow {
  return w.tx
    .insert(commandRuns)
    .values({
      projectId: round.projectId,
      roundId: round.id,
      purpose,
      command: run.command,
      cwd: run.cwd,
      exitCode: run.exitCode,
      outputTail: run.outputTail,
      commit: run.commit ?? null,
      startedAt: new Date(run.startedAt),
      durationMs: run.durationMs,
      cliVersion: run.cliVersion,
      recordedAt: w.now,
    })
    .returning()
    .get();
}

// ── 对外的样子 ──

/** 一次命令运行。 */
export type RunView = {
  readonly command: readonly string[];
  readonly cwd: string;
  readonly exitCode: number;
  readonly outputTail: string;
  readonly commit: string | null;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly cliVersion: string;
  /** 后端收下它的时间。 */
  readonly recordedAt: string;
};

export function toRunView(row: RunRow): RunView {
  return {
    command: [...row.command],
    cwd: row.cwd,
    exitCode: row.exitCode,
    outputTail: row.outputTail,
    commit: row.commit,
    startedAt: iso(row.startedAt),
    durationMs: row.durationMs,
    cliVersion: row.cliVersion,
    recordedAt: iso(row.recordedAt),
  };
}

/** 交上来的计划解析以后的样子。 */
export type PlanView = {
  readonly text: string;
  readonly sections: Readonly<Record<LandPlanSection, string>>;
  readonly tidy: LandPlanTidy;
  readonly verdicts: readonly VerdictRow[];
  /** 「功能改动」里的每一件：名字、全文、写到的队列编号。 */
  readonly changes: readonly {
    readonly name: string;
    readonly text: string;
    readonly queue: readonly string[];
  }[];
  readonly plannedAt: string;
};

export function toPlanView(record: LandRecordRow): PlanView {
  return {
    text: record.planText,
    sections: record.planSections,
    tidy: record.planTidy,
    verdicts: record.verdicts,
    changes: planItems(record).map((item) => ({
      name: item.name,
      text: item.text,
      queue: item.queueNumbers.map(formatQueueId),
    })),
    plannedAt: iso(record.plannedAt),
  };
}

/**
 * 一步的状态。
 * - missing：还没记。
 * - skipped：写明理由跳过了。
 * - done：记了。
 * - stale：记过，但后来的记录让它不再算数，要重记。
 */
type StepState = "missing" | "skipped" | "done" | "stale";

/** 重构这一步。 */
export type TidyView = {
  readonly state: StepState;
  /** 跳过的理由，取自计划。 */
  readonly reason: string | null;
  /** 重构以后检查命令的那次运行，它记下的提交就是重构的提交。 */
  readonly run: RunView | null;
};

/** 一件功能改动。 */
export type ChangeView = {
  readonly name: string;
  /** 对应的队列事项，写成 Q12。 */
  readonly queue: readonly string[];
  /** 名字在现在的计划「功能改动」里。 */
  readonly planned: boolean;
  /** notStarted 还没有失败的记录，failed 只有失败的记录，passed 先失败后通过。 */
  readonly state: "notStarted" | "failed" | "passed";
  readonly red: RunView | null;
  readonly green: RunView | null;
  /** 对应的提交，就是通过时的提交。 */
  readonly commit: string | null;
  /** 失败以后到通过为止的提交，通过时的提交在内。 */
  readonly commitsAfterRed: readonly string[] | null;
};

export function toChangeView(
  row: LandChangeRow,
  runs: ReadonlyMap<number, RunRow>,
  planned: boolean,
): ChangeView {
  const red = runs.get(row.redRunId);
  const green = row.greenRunId === null ? undefined : runs.get(row.greenRunId);
  return {
    name: row.name,
    queue: row.queueNumbers.map(formatQueueId),
    planned,
    state: green === undefined ? "failed" : "passed",
    red: red === undefined ? null : toRunView(red),
    green: green === undefined ? null : toRunView(green),
    commit: row.commit,
    commitsAfterRed: row.commitsAfterRed === null ? null : [...row.commitsAfterRed],
  };
}

/** 评审这一步。 */
export type ReviewView = {
  readonly state: StepState;
  /** 评审意见。跳过评审时为空。 */
  readonly opinions: readonly ReviewOpinion[] | null;
  /** 跳过评审的理由。 */
  readonly reason: string | null;
  /** 评审时这一批改动的规模和当时的界线。 */
  readonly diff: ReviewDiffSize | null;
  readonly reviewedAt: string | null;
};
