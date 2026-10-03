import {
  type CommandRun,
  checkRedGreen,
  describeLandPlanProblem,
  describeMissingSections,
  describeRedGreenViolation,
  type ErrorBody,
  err,
  errorBody,
  formatCommand,
  formatQueueId,
  formatRoundLabel,
  formatRoundName,
  type Issue,
  type LandPlanProblem,
  ok,
  parseLandPlan,
  parseQueueId,
  type RedGreenViolationKind,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { eq } from "drizzle-orm";
import { landStepsCopy } from "../../copy/land.ts";
import {
  landChanges,
  landRecords,
  type ReviewDiffSize,
  type ReviewOpinion,
} from "../../store/schema/index.ts";
import type { Json } from "../../store/schema/json.ts";
import { appendEvent } from "../events.ts";
import { fail, requireWritable } from "../projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { mentionsCommand, queueIdsText } from "./plan-items.ts";
import { landRules } from "./rules.ts";
import {
  batchNumbers,
  type ChangeView,
  failAll,
  findChange,
  insertRun,
  isShortPlan,
  landRound,
  type PlanView,
  parseRound,
  planItem,
  planItems,
  planShortIssue,
  type ReviewView,
  type RoundRow,
  type RunInput,
  recordOf,
  runsById,
  shellName,
  type TidyView,
  toChangeView,
  toPlanView,
} from "./shared.ts";
import { buildStatus } from "./status.ts";
import { type ChangedFile, measureDiff, type ReviewThreshold } from "./threshold.ts";

// 落地五步里记下来的四步：计划、重构、先失败后通过、评审。第五步重用场景看验收页上的更改。
// 命令见「04 命令行」第十一节，接口见「05 接口」第四节，表见「03 数据模型」第二节。
// 后端不跑命令，也不碰 git。检查命令由命令行在项目的根目录里跑完，把运行记录交来。
// 提交的先后、改动的规模也由命令行查出来交来。
// 每个用例在一个写事务里做完：前提的检查都在事务里（约定 0002 第 3 条），不通过就什么都不写。
// 上一步的记录不在，不进下一步，这是旧 land.py 的做法，规矩编号是 land.order。

type Failure = ErrorBody<
  "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "RULE_BLOCKED"
>;
type TxFailure = ErrorBody<"NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "RULE_BLOCKED">;

/** 失败的那一次退出码是这两个时，是命令没有跑起来：126 不能执行，127 找不到程序。 */
const notStartedExitCodes: readonly number[] = [126, 127];

/** 完整的提交号：SHA-1 是四十位，SHA-256 的仓库是六十四位。 */
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/**
 * 在一个写事务里，对一个能记落地五步的轮次做 fn：项目要能改数据，这一轮是落地轮、还没收尾。
 * 轮次的写法错了返回 BAD_REQUEST，不开事务。
 */
function inLandRound<T extends Json>(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  fn: (w: WriteScope, round: RoundRow) => Result<T, TxFailure>,
): Result<T, Failure> {
  const label = parseRound(roundText);
  if (!label.ok) return label;
  return writeTx<T, TxFailure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const round = landRound(w.tx, projectId, label.value, { forWrite: true });
    if (!round.ok) return round;
    return fn(w, round.value);
  });
}

/** 上一步的记录不在时的拦截。 */
function orderBlock(message: string, hint: string, where?: string) {
  return fail("RULE_BLOCKED", {
    rule: landRules.order,
    message,
    hint,
    ...(where === undefined ? {} : { where }),
  });
}

/** 这个阶段还没交计划时的拦截。 */
function noPlan(round: RoundRow) {
  const text = landStepsCopy.order.noPlan;
  const name = formatRoundName(round);
  return orderBlock(renderCopy(text.message, { round: name }), renderCopy(text.hint), name);
}

// ── 计划 ──

/** 交计划的结果。 */
export type PlanRecorded = {
  readonly round: string;
  readonly plan: PlanView;
  /** 这一轮以前交过计划，这次换成了新的。重构、功能改动和评审的记录照旧留着。 */
  readonly replaced: boolean;
  /** 警告：「功能改动」里认不出任何一件。 */
  readonly warnings: readonly Issue[];
  readonly next: readonly string[];
};

/**
 * 一次报出好几处问题时，同样的「怎么改」只写在第一处，后面的不再重复。
 * 缺几节的计划，「计划固定七节……」以前每缺一节写一遍。
 */
function dropRepeatedHint(): (issue: Issue) => Issue {
  const seen = new Set<string>();
  return (issue) => {
    if (issue.hint === undefined) return issue;
    if (!seen.has(issue.hint)) {
      seen.add(issue.hint);
      return issue;
    }
    const { hint: _repeated, ...rest } = issue;
    return rest;
  };
}

/** 计划的问题归到哪条规矩：「要不要先重构」的两种归 land.plan.tidy，其余归 land.plan.sections。 */
function planRule(problem: LandPlanProblem): string {
  return problem.kind === "tidyWord" || problem.kind === "tidyReason"
    ? landRules.planTidy
    : landRules.planSections;
}

/**
 * 交计划：`ploop land plan`，接口是 PUT /rounds/:rid/land/plan。
 * 用 model 的 parseLandPlan 查七节，有问题时一次报齐，返回 RULE_BLOCKED。
 * 通过了就存下全文和解析的结果。再交一次时换成新的计划，别的记录照旧，由状态重新判断。
 */
export function recordPlan(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  text: string,
): Result<PlanRecorded, Failure> {
  return inLandRound<PlanRecorded>(ctx, projectId, roundText, (w, round) => {
    const label = formatRoundLabel(round);
    const parsed = parseLandPlan(text);
    if (!parsed.ok) {
      const file = renderCopy(landStepsCopy.planFile, { label });
      const toIssue = (problem: LandPlanProblem): Issue => ({
        rule: planRule(problem),
        ...describeLandPlanProblem(problem, file),
      });
      // 缺两节以上合成一条：缺几节，缺的节名一行一个。
      const missing = parsed.error.flatMap((problem) =>
        problem.kind === "missing" ? [problem.section] : [],
      );
      const others = parsed.error.filter((problem) => problem.kind !== "missing");
      const issues: Issue[] =
        missing.length >= 2
          ? [
              { rule: landRules.planSections, ...describeMissingSections(missing, file) },
              ...others.map(toIssue),
            ]
          : parsed.error.map(toIssue);
      const [first, ...rest] = issues.map(dropRepeatedHint());
      return err(errorBody("RULE_BLOCKED", [first as Issue, ...rest]));
    }
    const plan = parsed.value;
    const fields = {
      planText: text,
      planSections: plan.sections,
      planTidy: plan.tidy,
      verdicts: plan.verdicts,
      plannedAt: w.now,
    };
    const existing = recordOf(w.tx, round.id);
    // 计划写了不要重构（包括从简的计划）：重构自动记为跳过，理由取自计划，不用再敲 land tidy --skip。
    // 已经做过重构、记了检查运行的，照旧留着，见改进 D03。
    const autoSkip =
      !plan.tidy.wanted && (existing === undefined || existing.tidyRunId === null)
        ? { tidySkipReason: plan.tidy.reason, tidyRunId: null, tidiedAt: w.now }
        : {};
    const record =
      existing === undefined
        ? w.tx
            .insert(landRecords)
            .values({ roundId: round.id, ...fields, ...autoSkip })
            .returning()
            .get()
        : w.tx
            .update(landRecords)
            .set({ ...fields, ...autoSkip })
            .where(eq(landRecords.id, existing.id))
            .returning()
            .get();
    const items = planItems(record);
    if (!plan.tidy.wanted && "tidySkipReason" in autoSkip) {
      appendEvent(w, {
        projectId,
        kind: "land.tidied",
        objectType: "landRecord",
        objectId: label,
        detail: { skipped: true, reason: plan.tidy.reason, auto: true },
      });
    }
    appendEvent(w, {
      projectId,
      kind: "land.planned",
      objectType: "landRecord",
      objectId: label,
      detail: {
        replaced: existing !== undefined,
        tidy: plan.tidy.wanted,
        short: plan.short,
        changes: items.map((item) => item.name),
      },
    });
    const warnings: Issue[] = [];
    if (items.length === 0) {
      const none = landStepsCopy.noItems;
      warnings.push({
        rule: landRules.changePlanned,
        message: renderCopy(none.message),
        hint: renderCopy(none.hint),
        where: renderCopy(landStepsCopy.planFile, { label }),
      });
    }
    return ok({
      round: label,
      plan: toPlanView(record),
      replaced: existing !== undefined,
      warnings,
      next: buildStatus(w.tx, round).next,
    });
  });
}

// ── 重构 ──

/** 记重构的请求：跳过，或者重构以后检查命令的那次运行。 */
export type TidyInput = { readonly skip: true } | { readonly run: RunInput };

export type TidyRecorded = {
  readonly round: string;
  readonly tidy: TidyView;
  readonly next: readonly string[];
};

/**
 * 记重构：`ploop land tidy -- <检查命令>` 或 `ploop land tidy --skip`，接口是 POST /rounds/:rid/land/tidy。
 * 跳过：计划写的是不要重构才行，理由取自计划。
 * 做了重构：检查要通过、记下了当时的提交、这个提交不是这一轮开始时的提交，
 * 检查命令原样写在计划「用什么锁住现有的行为」里。几处不合时一次报齐。
 * 再记一次时换成新的一次，没通过的运行不记。
 */
export function recordTidy(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  input: TidyInput,
): Result<TidyRecorded, Failure> {
  if ("run" in input) {
    const bad = commitIssues([input.run.commit]);
    if (bad !== undefined) return bad;
  }
  return inLandRound<TidyRecorded>(ctx, projectId, roundText, (w, round) => {
    const label = formatRoundLabel(round);
    const record = recordOf(w.tx, round.id);
    if (record === undefined) return noPlan(round);
    const text = landStepsCopy.tidy;
    if (!("run" in input)) {
      if (record.planTidy.wanted) {
        return fail("RULE_BLOCKED", {
          rule: landRules.tidySkip,
          message: renderCopy(text.skipWanted.message),
          hint: renderCopy(text.skipWanted.hint),
          where: renderCopy(landStepsCopy.planFile, { label }),
        });
      }
      const reason = record.planTidy.reason;
      w.tx
        .update(landRecords)
        .set({ tidySkipReason: reason, tidyRunId: null, tidiedAt: w.now })
        .where(eq(landRecords.id, record.id))
        .run();
      appendEvent(w, {
        projectId,
        kind: "land.tidied",
        objectType: "landRecord",
        objectId: label,
        detail: { skipped: true, reason },
      });
      return tidyResult(w, round);
    }

    const { run } = input;
    const blocks: Issue[] = [];
    if (run.exitCode !== 0) {
      blocks.push({
        rule: landRules.tidyPassed,
        message: renderCopy(text.failed.message, { exitCode: run.exitCode }),
        hint: renderCopy(text.failed.hint),
      });
    }
    if (run.commit === undefined) {
      blocks.push({
        rule: landRules.commitRecorded,
        message: renderCopy(text.commitMissing.message),
        hint: renderCopy(text.commitMissing.hint),
      });
    } else {
      const base = round.baseCommits?.find((b) => b.root === run.cwd)?.commit;
      if (base === run.commit) {
        blocks.push({
          rule: landRules.tidyCommitted,
          message: renderCopy(text.notCommitted.message, { commit: base.slice(0, 7) }),
          hint: renderCopy(text.notCommitted.hint),
        });
      }
    }
    if (!mentionsCommand(record.planSections.guard, run.command)) {
      blocks.push({
        rule: landRules.changePlanned,
        message: renderCopy(text.notPlanned.message, { command: formatCommand(run.command) }),
        hint: renderCopy(text.notPlanned.hint),
        where: renderCopy(landStepsCopy.planFile, { label }),
      });
    }
    const blocked = failAll("RULE_BLOCKED", blocks);
    if (blocked !== undefined) return blocked;

    const row = insertRun(w, round, "tidyCheck", run);
    w.tx
      .update(landRecords)
      .set({ tidySkipReason: null, tidyRunId: row.id, tidiedAt: w.now })
      .where(eq(landRecords.id, record.id))
      .run();
    appendEvent(w, {
      projectId,
      kind: "land.tidied",
      objectType: "landRecord",
      objectId: label,
      detail: { skipped: false, command: [...run.command], commit: run.commit },
    });
    return tidyResult(w, round);
  });
}

function tidyResult(w: WriteScope, round: RoundRow): Result<TidyRecorded, never> {
  const status = buildStatus(w.tx, round);
  return ok({ round: status.round, tidy: status.tidy, next: status.next });
}

// ── 先失败后通过 ──

/** 记失败或通过的结果：这一件功能改动现在的样子。 */
export type ChangeRecorded = {
  readonly round: string;
  readonly change: ChangeView;
  /** 记通过以后，这一批的改动在评审界线以内，评审自动跳过了：写明改动的规模。没有自动跳过时为空。 */
  readonly reviewSkipped: ReviewDiffSize | null;
  /** 警告：失败和通过之间多于一个提交。只有记通过时有。 */
  readonly warnings: readonly Issue[];
  readonly next: readonly string[];
};

/** 名字去掉首尾的空白，是空的返回 BAD_REQUEST。 */
function cleanName(name: string): Result<string, ErrorBody<"BAD_REQUEST">> {
  const trimmed = name.trim();
  if (trimmed !== "") return ok(trimmed);
  const text = landStepsCopy.change.nameBlank;
  return fail("BAD_REQUEST", { message: renderCopy(text.message), hint: renderCopy(text.hint) });
}

/** 写错的提交号，一次报齐，返回 BAD_REQUEST。没写的不管。 */
function commitIssues(
  commits: readonly (string | undefined)[],
): Result<never, ErrorBody<"BAD_REQUEST">> | undefined {
  const text = landStepsCopy.request.commit;
  return failAll(
    "BAD_REQUEST",
    commits
      .filter((commit) => commit !== undefined && !commitPattern.test(commit))
      .map((commit) => ({
        message: renderCopy(text.message, { commit: commit ?? "" }),
        hint: renderCopy(text.hint),
        where: commit,
      })),
  );
}

/** 这几件事不在这一批里时的拦截。都在时返回 undefined。 */
function batchIssue(
  round: RoundRow,
  name: string,
  numbers: readonly number[],
  w: WriteScope,
): Issue | undefined {
  const batch = new Set(batchNumbers(w.tx, round.id));
  const outside = numbers.filter((n) => !batch.has(n));
  if (outside.length === 0) return undefined;
  const text = landStepsCopy.change.queueNotInBatch;
  return {
    rule: landRules.changePlanned,
    message: renderCopy(text.message, { name, ids: queueIdsText(outside) }),
    hint: renderCopy(text.hint),
    where: name,
  };
}

/**
 * 记改之前失败的一次：`ploop land red <名字> -- <检查命令>`，
 * 接口是 POST /rounds/:rid/land/changes/:name/red。要求如下，不合的一次报齐：
 * - 先有计划和重构的记录（land.order）。
 * - 名字是计划「功能改动」里的一件，检查命令原样写在这一件下面，
 *   这一件写到的队列编号都在这一批里（land.change.planned）。
 * - 检查失败了，并且命令真的跑起来了（land.red.failed），记下了当时的提交。
 * 同一件再记一次失败时，换成新的一次，之前记的通过作废。
 */
export function recordRed(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  name: string,
  run: RunInput,
): Result<ChangeRecorded, Failure> {
  const cleaned = cleanName(name);
  if (!cleaned.ok) return cleaned;
  const bad = commitIssues([run.commit]);
  if (bad !== undefined) return bad;
  return inLandRound<ChangeRecorded>(ctx, projectId, roundText, (w, round) => {
    const label = formatRoundLabel(round);
    const record = recordOf(w.tx, round.id);
    if (record === undefined) return noPlan(round);
    const tidy = buildStatus(w.tx, round).tidy.state;
    if (tidy === "missing" || tidy === "stale") {
      const text = landStepsCopy.order.noTidy;
      return orderBlock(renderCopy(text.message), renderCopy(text.hint));
    }

    const blocks: Issue[] = [];
    const item = planItem(record, cleaned.value);
    const text = landStepsCopy.change;
    const command = formatCommand(run.command);
    if (item === undefined) {
      const names = planItems(record).map((i) => i.name);
      const copy = names.length === 0 ? text.noneListed : text.notInPlan;
      blocks.push({
        rule: landRules.changePlanned,
        message: renderCopy(copy.message, { name: cleaned.value, names: names.join("、") }),
        hint: renderCopy(copy.hint),
        where: cleaned.value,
      });
    } else {
      if (!mentionsCommand(item.text, run.command)) {
        blocks.push({
          rule: landRules.changePlanned,
          message: renderCopy(text.commandNotPlanned.message, { command, name: item.name }),
          hint: renderCopy(text.commandNotPlanned.hint),
          where: item.name,
        });
      }
      const outside = batchIssue(round, item.name, item.queueNumbers, w);
      if (outside !== undefined) blocks.push(outside);
    }
    blocks.push(...redRunIssues(run, command, item?.name ?? cleaned.value));
    const blocked = failAll("RULE_BLOCKED", blocks);
    if (blocked !== undefined) return blocked;
    // 上面已经确认计划里有这一件。
    if (item === undefined) throw new Error("计划里找不到这一件功能改动。");

    const red = insertRun(w, round, "red", run);
    const existing = findChange(w.tx, record.id, item.name);
    const fields = {
      queueNumbers: [...item.queueNumbers],
      redRunId: red.id,
      greenRunId: null,
      commit: null,
      commitsAfterRed: null,
    };
    const row =
      existing === undefined
        ? w.tx
            .insert(landChanges)
            .values({ landRecordId: record.id, name: item.name, ...fields })
            .returning()
            .get()
        : w.tx
            .update(landChanges)
            .set(fields)
            .where(eq(landChanges.id, existing.id))
            .returning()
            .get();
    appendEvent(w, {
      projectId,
      kind: "land.redRecorded",
      objectType: "landChange",
      objectId: `${label}/${item.name}`,
      detail: {
        command: [...run.command],
        exitCode: run.exitCode,
        commit: run.commit,
        queue: item.queueNumbers.map(formatQueueId),
        replaced: existing !== undefined,
      },
    });
    return ok({
      round: label,
      change: toChangeView(row, runsById(w.tx, [row.redRunId]), true),
      reviewSkipped: null,
      warnings: [],
      next: [
        renderCopy(landStepsCopy.next.green, {
          name: shellName(item.name),
          command: formatCommand(run.command),
        }),
      ],
    });
  });
}

/** 失败的那一次本身的问题：其实通过了、命令没有跑起来、没有记下提交。 */
function redRunIssues(run: RunInput, command: string, where: string): Issue[] {
  const issues: Issue[] = [];
  if (run.exitCode === 0 || notStartedExitCodes.includes(run.exitCode)) {
    const described =
      run.exitCode === 0
        ? describeRedGreenViolation({ kind: "redPassed" })
        : {
            message: renderCopy(landStepsCopy.red.notStarted.message, {
              command,
              exitCode: run.exitCode,
            }),
            hint: renderCopy(landStepsCopy.red.notStarted.hint),
          };
    issues.push({ rule: landRules.redFailed, ...described, where });
  }
  if (run.commit === undefined) {
    const described = describeRedGreenViolation({ kind: "redCommitMissing" });
    issues.push({ rule: landRules.commitRecorded, ...described, where });
  }
  return issues;
}

/** 记通过的请求。 */
export type GreenInput = {
  readonly run: RunInput;
  /**
   * 失败时的提交以后到通过时的提交为止的提交，通过时的提交在内。
   * 命令行用 `git rev-list --ancestry-path <失败时的提交>..<通过时的提交>` 查出。
   * 空的说明通过时的提交不在失败时的之后。
   */
  readonly commitsAfterRed: readonly string[];
  /**
   * 这几个提交的说明末尾写的队列编号，写成 Q12，见「10 工程规范与流程」第三节。
   * 和计划里这一件写到的一起，记成这件改动对应的队列事项。
   */
  readonly queue?: readonly string[] | undefined;
  /**
   * 这一批改到的文件，从这一轮开始时的提交算起，命令行交来。
   * 写了时，全部功能改动都通过而且改动在评审界线以内，评审自动跳过，见改进 D03。
   */
  readonly changed?: readonly ChangedFile[] | undefined;
};

/** 两次运行对不上的种类归到哪条规矩。 */
const violationRules: Readonly<Record<RedGreenViolationKind, string>> = {
  commandDiffers: landRules.greenSameCommand,
  redPassed: landRules.redFailed,
  greenFailed: landRules.greenPassed,
  redCommitMissing: landRules.commitRecorded,
  greenCommitMissing: landRules.commitRecorded,
  sameCommit: landRules.greenLater,
  commitNotAfter: landRules.greenLater,
};

/**
 * 记改之后通过的一次：`ploop land green <名字> -- <检查命令>`，
 * 接口是 POST /rounds/:rid/land/changes/:name/green。要求如下，不合的一次报齐：
 * - 这一件先有失败的记录（land.order）。只有通过、没有失败的记录进不来。
 * - 用的是失败时的那条命令、检查通过了、通过时的提交在失败时的之后，由 model 的 checkRedGreen 查。
 * - 提交说明里写的队列编号都在这一批里（land.change.planned）。
 * 失败和通过之间多于一个提交时警告（land.oneCommit）。
 */
export function recordGreen(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  name: string,
  input: GreenInput,
  threshold: ReviewThreshold,
): Result<ChangeRecorded, Failure> {
  const cleaned = cleanName(name);
  if (!cleaned.ok) return cleaned;
  const bad = commitIssues([input.run.commit, ...input.commitsAfterRed]);
  if (bad !== undefined) return bad;
  const badFiles = changedFileIssues(input.changed ?? []);
  if (badFiles !== undefined) return badFiles;
  const queue = cleanQueue(input.queue ?? []);
  if (!queue.ok) return queue;
  return inLandRound<ChangeRecorded>(ctx, projectId, roundText, (w, round) => {
    const label = formatRoundLabel(round);
    const record = recordOf(w.tx, round.id);
    if (record === undefined) return noPlan(round);
    const item = planItem(record, cleaned.value);
    const changeName = item?.name ?? cleaned.value;
    const row = findChange(w.tx, record.id, changeName);
    if (row === undefined) {
      const text = landStepsCopy.order.noRed;
      const params = { name: changeName };
      return orderBlock(
        renderCopy(text.message, params),
        renderCopy(text.hint, params),
        changeName,
      );
    }
    const redRow = runsById(w.tx, [row.redRunId]).get(row.redRunId);
    // 功能改动的一行一定指着失败的那次运行，由外键保证。
    if (redRow === undefined) throw new Error(`「${changeName}」的失败记录不见了。`);
    const asRun = (r: RunInput, purpose: "red" | "green"): CommandRun => ({
      ...r,
      project: projectId,
      round: label,
      purpose,
    });
    const red = asRun(
      {
        command: redRow.command,
        cwd: redRow.cwd,
        exitCode: redRow.exitCode,
        outputTail: redRow.outputTail,
        ...(redRow.commit === null ? {} : { commit: redRow.commit }),
        startedAt: redRow.startedAt.toISOString(),
        durationMs: redRow.durationMs,
        cliVersion: redRow.cliVersion,
      },
      "red",
    );
    const blocks: Issue[] = checkRedGreen(
      red,
      asRun(input.run, "green"),
      input.commitsAfterRed,
    ).map((violation) => ({
      rule: violationRules[violation.kind],
      ...describeRedGreenViolation(violation),
      where: changeName,
    }));
    const outside = batchIssue(round, changeName, queue.value, w);
    if (outside !== undefined) blocks.push(outside);
    const blocked = failAll("RULE_BLOCKED", blocks);
    if (blocked !== undefined) return blocked;

    const green = insertRun(w, round, "green", input.run);
    const numbers = [...new Set([...row.queueNumbers, ...queue.value])].sort((a, b) => a - b);
    const updated = w.tx
      .update(landChanges)
      .set({
        greenRunId: green.id,
        commit: input.run.commit ?? null,
        commitsAfterRed: [...input.commitsAfterRed],
        queueNumbers: numbers,
      })
      .where(eq(landChanges.id, row.id))
      .returning()
      .get();
    const warnings: Issue[] = [];
    const count = input.commitsAfterRed.length;
    if (count > 1) {
      const text = landStepsCopy.green.oneCommit;
      warnings.push({
        rule: landRules.oneCommit,
        message: renderCopy(text.message, { name: changeName, count }),
        hint: renderCopy(text.hint),
        where: changeName,
      });
    }
    appendEvent(w, {
      projectId,
      kind: "land.greenRecorded",
      objectType: "landChange",
      objectId: `${label}/${changeName}`,
      detail: {
        commit: input.run.commit,
        commitsAfterRed: count,
        queue: numbers.map(formatQueueId),
      },
    });
    const runs = runsById(w.tx, [updated.redRunId, updated.greenRunId]);
    const measured = input.changed === undefined ? null : measureDiff(input.changed, threshold);
    const reviewSkipped = autoSkipReview(w, round, measured);
    if (measured !== null && !measured.within && isShortPlan(record)) {
      warnings.push(planShortIssue());
    }
    return ok({
      round: label,
      change: toChangeView(updated, runs, item !== undefined),
      reviewSkipped,
      warnings,
      next: buildStatus(w.tx, round).next,
    });
  });
}

/** 队列编号换成数字，写错的一次报齐，返回 BAD_REQUEST。 */
function cleanQueue(ids: readonly string[]): Result<number[], ErrorBody<"BAD_REQUEST">> {
  const numbers: number[] = [];
  const issues: Issue[] = [];
  const text = landStepsCopy.request.queueId;
  for (const id of ids) {
    const parsed = parseQueueId(id);
    if (parsed.ok) numbers.push(parsed.value);
    else {
      issues.push({
        message: renderCopy(text.message, { text: id }),
        hint: renderCopy(text.hint),
        where: id,
      });
    }
  }
  return failAll("BAD_REQUEST", issues) ?? ok([...new Set(numbers)]);
}

// ── 评审 ──

/**
 * 记评审的请求：评审意见，或者跳过的理由。
 * changed 是这一批改到的文件，命令行从这一轮开始时的提交算起。跳过时必写，评审时可以不写。
 */
export type ReviewInput =
  | {
      readonly opinions: readonly ReviewOpinion[];
      readonly changed?: readonly ChangedFile[] | undefined;
    }
  | { readonly skip: string; readonly changed: readonly ChangedFile[] };

export type ReviewRecorded = {
  readonly round: string;
  readonly review: ReviewView;
  readonly next: readonly string[];
};

/**
 * 记评审：`ploop land review`，接口是 POST /rounds/:rid/land/review。
 * 先有计划、重构，每件功能改动都通过了，才能评审（land.order）。
 * 评审意见：每条指到文件和行（land.review.located），阻塞的写了处置（land.review.disposed）。
 * 跳过：写明理由。界线由后端按这一批的改动算，超过界线时拦截（land.review.required，决定 173）。
 * 在界线以内也可以评审。再记一次时换成新的一次。
 */
export function recordReview(
  ctx: WriteContext,
  projectId: string,
  roundText: string,
  input: ReviewInput,
  threshold: ReviewThreshold,
): Result<ReviewRecorded, Failure> {
  const invalid = reviewRequestIssues(input);
  if (invalid !== undefined) return invalid;
  return inLandRound<ReviewRecorded>(ctx, projectId, roundText, (w, round) => {
    const label = formatRoundLabel(round);
    const record = recordOf(w.tx, round.id);
    if (record === undefined) return noPlan(round);
    const order = reviewOrderIssue(w, round);
    if (order !== undefined) return order;

    const changed = input.changed;
    const diff = changed === undefined ? null : measureDiff(changed, threshold);
    const blocks = [
      // 计划从简，改动却超过了界线：计划要补全七节，评审才算数。
      ...(diff !== null && !diff.within && isShortPlan(record) ? [planShortIssue()] : []),
      ...("skip" in input ? skipIssues(diff) : opinionIssues(input.opinions)),
    ];
    const blocked = failAll("RULE_BLOCKED", blocks);
    if (blocked !== undefined) return blocked;

    const skipped = "skip" in input;
    const opinions = skipped ? null : input.opinions.map(cleanOpinion);
    w.tx
      .update(landRecords)
      .set({
        reviewOpinions: opinions,
        reviewSkipReason: skipped ? input.skip.trim() : null,
        reviewDiff: diff,
        reviewedAt: w.now,
      })
      .where(eq(landRecords.id, record.id))
      .run();
    appendEvent(w, {
      projectId,
      kind: "land.reviewed",
      objectType: "landRecord",
      objectId: label,
      detail: {
        skipped,
        opinions: opinions?.length,
        blocking: opinions?.filter((o) => o.level === "block").length,
        lines: diff?.lines,
        files: diff?.files,
      },
    });
    const status = buildStatus(w.tx, round);
    return ok({ round: label, review: status.review, next: status.next });
  });
}

/** 请求本身的问题：跳过没写理由、意见没写内容、行数写错。一次报齐，返回 BAD_REQUEST。 */
function reviewRequestIssues(input: ReviewInput) {
  const text = landStepsCopy.request;
  const issues: Issue[] = [];
  if ("skip" in input && input.skip.trim() === "") {
    issues.push({
      message: renderCopy(text.skipReasonBlank.message),
      hint: renderCopy(text.skipReasonBlank.hint),
      where: "skip",
    });
  }
  if ("opinions" in input) {
    for (const [i, opinion] of input.opinions.entries()) {
      if (opinion.text.trim() !== "") continue;
      issues.push({
        message: renderCopy(text.opinionTextBlank.message, { index: i + 1 }),
        hint: renderCopy(text.opinionTextBlank.hint),
        where: `opinions[${i}].text`,
      });
    }
  }
  issues.push(...fileLineIssues(input.changed ?? []));
  return failAll("BAD_REQUEST", issues);
}

/** 改到的文件里，行数写错的逐个报。 */
function fileLineIssues(files: readonly ChangedFile[]): Issue[] {
  const text = landStepsCopy.request;
  return files.flatMap((file): Issue[] => {
    const good = [file.added, file.deleted].every((n) => Number.isSafeInteger(n) && n >= 0);
    if (good) return [];
    return [
      {
        message: renderCopy(text.fileLines.message, { path: file.path }),
        hint: renderCopy(text.fileLines.hint),
        where: file.path,
      },
    ];
  });
}

/** 记通过时交来的改动，行数写错时返回 BAD_REQUEST。 */
function changedFileIssues(
  files: readonly ChangedFile[],
): Result<never, ErrorBody<"BAD_REQUEST">> | undefined {
  return failAll("BAD_REQUEST", fileLineIssues(files));
}

/**
 * 全部功能改动都通过、重构有记录、改动在评审界线以内时，自动跳过评审，理由写明改动的规模，见改进 D03。
 * 评审已经有意见的不动：只有还没评审，或者以前也是跳过的，才自动记。返回记下的规模，没有自动跳过时返回 null。
 */
function autoSkipReview(
  w: WriteScope,
  round: RoundRow,
  diff: ReviewDiffSize | null,
): ReviewDiffSize | null {
  if (diff === null || !diff.within) return null;
  const status = buildStatus(w.tx, round);
  if (status.tidy.state === "missing" || status.tidy.state === "stale") return null;
  if (status.changes.length === 0) return null;
  if (status.changes.some((change) => change.state !== "passed" || !change.planned)) return null;
  const { review } = status;
  const skippable =
    review.state === "missing" || (review.state === "stale" && review.reason !== null);
  const record = recordOf(w.tx, round.id);
  if (!skippable || record === undefined) return null;
  const reason = renderCopy(landStepsCopy.review.autoSkip, {
    lines: diff.lines,
    files: diff.files,
  });
  w.tx
    .update(landRecords)
    .set({ reviewOpinions: null, reviewSkipReason: reason, reviewDiff: diff, reviewedAt: w.now })
    .where(eq(landRecords.id, record.id))
    .run();
  appendEvent(w, {
    projectId: round.projectId,
    kind: "land.reviewed",
    objectType: "landRecord",
    objectId: formatRoundLabel(round),
    detail: { skipped: true, auto: true, lines: diff.lines, files: diff.files },
  });
  return diff;
}

/** 评审以前：重构记了，每件功能改动都通过了。 */
function reviewOrderIssue(w: WriteScope, round: RoundRow) {
  const status = buildStatus(w.tx, round);
  const text = landStepsCopy.order;
  if (status.tidy.state === "missing" || status.tidy.state === "stale") {
    return orderBlock(renderCopy(text.noTidy.message), renderCopy(text.noTidy.hint));
  }
  if (status.changes.length === 0) {
    return orderBlock(renderCopy(text.noChanges.message), renderCopy(text.noChanges.hint));
  }
  const open = status.changes.filter((change) => change.state !== "passed").map((c) => c.name);
  if (open.length === 0) return undefined;
  return orderBlock(
    renderCopy(text.notPassed.message, { names: open.join("、") }),
    renderCopy(text.notPassed.hint),
  );
}

/** 评审意见：每条指到文件和行，阻塞的写了处置。按意见的先后报。 */
function opinionIssues(opinions: readonly ReviewOpinion[]): Issue[] {
  const text = landStepsCopy.review;
  return opinions.flatMap((opinion, i): Issue[] => {
    const located =
      opinion.file.trim() !== "" && Number.isSafeInteger(opinion.line) && opinion.line >= 1;
    if (!located) {
      return [
        {
          rule: landRules.reviewLocated,
          message: renderCopy(text.notLocated.message, { index: i + 1 }),
          hint: renderCopy(text.notLocated.hint),
          where: `opinions[${i}]`,
        },
      ];
    }
    if (opinion.level !== "block" || (opinion.disposition ?? "").trim() !== "") return [];
    return [
      {
        rule: landRules.reviewDisposed,
        message: renderCopy(text.notDisposed.message, {
          file: opinion.file.trim(),
          line: opinion.line,
        }),
        hint: renderCopy(text.notDisposed.hint),
        where: `opinions[${i}]`,
      },
    ];
  });
}

/** 跳过评审：改动要在界线以内。超过时写明超在哪里。 */
function skipIssues(diff: ReviewDiffSize | null): Issue[] {
  // 跳过时一定写了改动，由请求的类型保证。
  if (diff === null || diff.within) return [];
  const over = landStepsCopy.review.over;
  const reasons = [
    ...(diff.lines > diff.maxLines
      ? [renderCopy(over.lines, { lines: diff.lines, max: diff.maxLines })]
      : []),
    ...(diff.files > diff.maxFiles
      ? [renderCopy(over.files, { files: diff.files, max: diff.maxFiles })]
      : []),
    ...(diff.dependencyFiles.length > 0
      ? [renderCopy(over.dependency, { files: diff.dependencyFiles.join("、") })]
      : []),
    ...(diff.dataFormatFiles.length > 0
      ? [renderCopy(over.dataFormat, { files: diff.dataFormatFiles.join("、") })]
      : []),
  ];
  const text = landStepsCopy.review.required;
  return [
    {
      rule: landRules.reviewRequired,
      message: renderCopy(text.message, { reasons: reasons.join("，") }),
      hint: renderCopy(text.hint),
    },
  ];
}

/** 存下的意见：文字去掉首尾的空白，没写处置的不带这一项。 */
function cleanOpinion(opinion: ReviewOpinion): ReviewOpinion {
  const disposition = opinion.disposition?.trim() ?? "";
  return {
    file: opinion.file.trim(),
    line: opinion.line,
    level: opinion.level,
    text: opinion.text.trim(),
    ...(disposition === "" ? {} : { disposition }),
  };
}
