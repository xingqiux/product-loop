import {
  type ErrorBody,
  formatCommand,
  formatQueueId,
  formatRoundLabel,
  type Issue,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { landStepsCopy } from "../../copy/land.ts";
import { findProject, iso, type Reader } from "../projects.ts";
import { closeCommand, shownPages } from "../rounds/next.ts";
import { landRules } from "./rules.ts";
import {
  batchNumbers,
  type ChangeView,
  changesOf,
  isShortPlan,
  type LandRecordRow,
  landRound,
  type PlanView,
  parseRound,
  planItem,
  planItems,
  planShortIssue,
  type ReviewView,
  type RoundRow,
  recordOf,
  runsById,
  shellName,
  type TidyView,
  toChangeView,
  toPlanView,
  toRunView,
} from "./shared.ts";

// 落地五步到了哪一步、缺什么：`ploop land status`，接口是 GET /rounds/:rid/land，见「05 接口」第四节。
// 验收页的工程证据也从这里取（第 50 步）。重用场景那一步看验收页上的更改，不在这里查。
// 状态只读不写，所以要先体检的项目、已收尾的落地轮也能查。

/** 落地五步的状态。 */
export type LandStatus = {
  /** 轮次的写法，例如 v2-落地-3。 */
  readonly round: string;
  /** 交上来的计划。还没交时为空。 */
  readonly plan: PlanView | null;
  readonly tidy: TidyView;
  /** 记过的功能改动按记下的先后排，后面是计划里还没开始的几件。 */
  readonly changes: readonly ChangeView[];
  readonly review: ReviewView;
  /** 这一批里没有任何一件功能改动对应的事，写成 Q12。收尾时这些事要写明退回哪里。 */
  readonly uncoveredQueue: readonly string[];
  /** 计划、重构、功能改动、评审四步的记录都齐了。 */
  readonly complete: boolean;
  /** 缺的地方，按五步的先后排，每条写什么还没做、怎么做。齐了时为空。 */
  readonly missing: readonly Issue[];
  /** 下一步：一到两条完整的命令。 */
  readonly next: readonly string[];
};

/** 查一个落地轮的五步。轮次写错返回 BAD_REQUEST，找不到返回 NOT_FOUND，不是落地轮返回 CONFLICT。 */
export function landStatus(
  db: Reader,
  projectId: string,
  roundText: string,
): Result<LandStatus, ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT">> {
  const label = parseRound(roundText);
  if (!label.ok) return label;
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const round = landRound(db, projectId, label.value, { forWrite: false });
  if (!round.ok) return round;
  const built = buildStatus(db, round.value);
  // 已经收尾的落地轮，五步不用再做了，不再说给出验收页，下一步看项目现在的状态。
  if (round.value.status !== "closed") return ok(built);
  return ok({ ...built, next: [renderCopy(landStepsCopy.next.projectStatus)] });
}

/** 落地五步缺的地方，每条写成一条 land.steps 的拦截。给出验收页和收尾时用。 */
export function landStepIssues(db: Reader, round: RoundRow): (Issue & { rule: string })[] {
  return buildStatus(db, round).missing.map((issue) => ({ ...issue, rule: landRules.steps }));
}

/** 按库里的记录算出五步的状态。写事务里的用例也用它判断上一步齐了没有。 */
export function buildStatus(tx: Reader, round: RoundRow): LandStatus {
  const label = formatRoundLabel(round);
  const record = recordOf(tx, round.id);
  const text = landStepsCopy;
  if (record === undefined) {
    return {
      round: label,
      plan: null,
      tidy: { state: "missing", reason: null, run: null },
      changes: [],
      review: { state: "missing", opinions: null, reason: null, diff: null, reviewedAt: null },
      uncoveredQueue: batchNumbers(tx, round.id).map(formatQueueId),
      complete: false,
      missing: [
        {
          message: renderCopy(text.missing.plan.message),
          hint: renderCopy(text.missing.plan.hint),
        },
      ],
      next: [renderCopy(text.next.plan)],
    };
  }
  const tidy = tidyView(tx, record);
  const changes = changeViews(tx, record);
  const review = reviewView(record, changes);
  const covered = new Set(changes.flatMap((change) => change.queue));
  const missing = [
    ...tidyMissing(tidy),
    ...changesMissing(changes),
    ...reviewMissing(review, changes),
    // 计划从简，评审量出的改动却超过了界线：计划要补全七节。
    ...(isShortPlan(record) && review.diff !== null && !review.diff.within
      ? [planShortIssue()]
      : []),
  ];
  return {
    round: label,
    plan: toPlanView(record),
    tidy,
    changes,
    review,
    uncoveredQueue: batchNumbers(tx, round.id)
      .map(formatQueueId)
      .filter((id) => !covered.has(id)),
    complete: missing.length === 0,
    missing,
    next: nextSteps(record, tidy, changes, review, shownClose(tx, round)),
  };
}

// ── 各步的状态 ──

function tidyView(tx: Reader, record: LandRecordRow): TidyView {
  if (record.tidySkipReason !== null) {
    const state = record.planTidy.wanted ? "stale" : "skipped";
    return { state, reason: record.tidySkipReason, run: null };
  }
  if (record.tidyRunId === null) return { state: "missing", reason: null, run: null };
  const run = runsById(tx, [record.tidyRunId]).get(record.tidyRunId);
  return { state: "done", reason: null, run: run === undefined ? null : toRunView(run) };
}

/** 记过的功能改动，加上计划里还没开始的几件。 */
function changeViews(tx: Reader, record: LandRecordRow): ChangeView[] {
  const rows = changesOf(tx, record.id);
  const items = planItems(record);
  const names = new Set(items.map((item) => item.name));
  const runs = runsById(
    tx,
    rows.flatMap((row) => [row.redRunId, row.greenRunId]),
  );
  const recorded = rows.map((row) => toChangeView(row, runs, names.has(row.name)));
  const started = new Set(rows.map((row) => row.name));
  const notStarted = items
    .filter((item) => !started.has(item.name))
    .map(
      (item): ChangeView => ({
        name: item.name,
        queue: item.queueNumbers.map(formatQueueId),
        planned: true,
        state: "notStarted",
        red: null,
        green: null,
        commit: null,
        commitsAfterRed: null,
      }),
    );
  return [...recorded, ...notStarted];
}

/** 评审以后又记的失败或通过，让评审不再算数。 */
function changedAfterReview(changes: readonly ChangeView[], reviewedAt: string): string[] {
  return changes
    .filter((change) =>
      [change.red, change.green].some((run) => run !== null && run.recordedAt > reviewedAt),
    )
    .map((change) => change.name);
}

function reviewView(record: LandRecordRow, changes: readonly ChangeView[]): ReviewView {
  if (record.reviewedAt === null) {
    return { state: "missing", opinions: null, reason: null, diff: null, reviewedAt: null };
  }
  const reviewedAt = iso(record.reviewedAt);
  const skipped = record.reviewSkipReason !== null;
  const stale = changedAfterReview(changes, reviewedAt).length > 0;
  return {
    state: stale ? "stale" : skipped ? "skipped" : "done",
    opinions: record.reviewOpinions === null ? null : [...record.reviewOpinions],
    reason: record.reviewSkipReason,
    diff: record.reviewDiff,
    reviewedAt,
  };
}

// ── 缺的地方 ──

function tidyMissing(tidy: TidyView): Issue[] {
  const { order, missing } = landStepsCopy;
  if (tidy.state === "missing") {
    return [{ message: renderCopy(order.noTidy.message), hint: renderCopy(order.noTidy.hint) }];
  }
  if (tidy.state === "stale") {
    const text = missing.tidyStale;
    return [{ message: renderCopy(text.message), hint: renderCopy(text.hint) }];
  }
  return [];
}

function changesMissing(changes: readonly ChangeView[]): Issue[] {
  const text = landStepsCopy.missing;
  if (changes.length === 0) {
    const none = landStepsCopy.order.noChanges;
    return [{ message: renderCopy(none.message), hint: renderCopy(none.hint) }];
  }
  return changes.flatMap((change) => {
    const { name } = change;
    const found: Issue[] = [];
    if (!change.planned) {
      const t = text.unplanned;
      found.push({
        message: renderCopy(t.message, { name }),
        hint: renderCopy(t.hint),
        where: name,
      });
    }
    if (change.state !== "passed") {
      const t = change.state === "notStarted" ? text.notStarted : text.failedOnly;
      found.push({
        message: renderCopy(t.message, { name }),
        hint: renderCopy(t.hint, { name }),
        where: name,
      });
    }
    return found;
  });
}

function reviewMissing(review: ReviewView, changes: readonly ChangeView[]): Issue[] {
  const text = landStepsCopy.missing;
  if (review.state === "missing") {
    return [{ message: renderCopy(text.review.message), hint: renderCopy(text.review.hint) }];
  }
  if (review.state === "stale" && review.reviewedAt !== null) {
    const names = changedAfterReview(changes, review.reviewedAt).join("、");
    const t = text.reviewStale;
    return [{ message: renderCopy(t.message, { names }), hint: renderCopy(t.hint) }];
  }
  return [];
}

/**
 * 一段文字里写的第一条检查命令：反引号括起来的第一段；没有反引号时，取「检查命令：」后面
 * 到逗号、句号或换行之前的一段。没写时返回 undefined。
 */
function commandIn(text: string): string | undefined {
  const quoted = /`([^`\n]+)`/u.exec(text)?.[1]?.trim();
  if (quoted !== undefined && quoted !== "") return quoted;
  const plain = /检查命令[:：]\s*([^，。,\n]+)/u.exec(text)?.[1]?.trim();
  return plain === undefined || plain === "" ? undefined : plain;
}

/** 这一轮已经给用户看过页，五步齐了以后下一步就是收尾，返回收尾的命令；还没看过返回空。 */
function shownClose(tx: Reader, round: RoundRow): string | undefined {
  const shown = shownPages(tx, round.id);
  return shown.ask + shown.view > 0 ? closeCommand() : undefined;
}

/**
 * 下一步：缺的最早的一步要运行的命令，已经知道的值直接填进去：
 * 重构的检查命令、计划里下一件功能改动的名字和检查命令、失败时那一次的命令。
 * 齐了就给出验收页，已经给用户看过页的收尾。
 */
function nextSteps(
  record: LandRecordRow,
  tidy: TidyView,
  changes: readonly ChangeView[],
  review: ReviewView,
  close: string | undefined,
): string[] {
  const text = landStepsCopy.next;
  if (tidy.state === "missing" || tidy.state === "stale") {
    if (!record.planTidy.wanted) return [renderCopy(text.tidySkip)];
    const command = commandIn(record.planSections.guard);
    // 计划里没写检查命令时没有能直接运行的命令，下一步留空，缺什么由「缺的」里的说明写。
    return command === undefined ? [] : [renderCopy(text.tidy, { command })];
  }
  const notStarted = changes.find((change) => change.state === "notStarted");
  if (changes.length === 0 || notStarted !== undefined) {
    // 计划里没有一件功能改动时没有名字可填，先让计划补上，见 land.change.planned。
    if (notStarted === undefined) return [renderCopy(text.plan)];
    const name = shellName(notStarted.name);
    const item = planItem(record, notStarted.name);
    const command = item === undefined ? undefined : commandIn(item.text);
    return command === undefined ? [] : [renderCopy(text.red, { name, command })];
  }
  const failed = changes.find((change) => change.state === "failed");
  if (failed !== undefined) {
    const command = failed.red === null ? undefined : formatCommand(failed.red.command);
    const name = shellName(failed.name);
    if (command !== undefined) return [renderCopy(text.green, { name, command })];
  }
  if (review.state === "missing" || review.state === "stale") {
    return [renderCopy(text.diff), renderCopy(text.review)];
  }
  return [close ?? renderCopy(text.pageExample)];
}
