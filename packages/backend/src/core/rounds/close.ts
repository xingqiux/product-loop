import {
  type Err,
  type ErrorBody,
  err,
  errorBody,
  formatQueueId,
  formatRoundLabel,
  formatRoundName,
  type Issue,
  issuesOf,
  mainlinePart,
  ok,
  parseCopy,
  parseQueueId,
  parseRoundLabel,
  type QueueItem,
  type Result,
  type RoundItemResult,
  type RoundLabel,
  type RoundLabelError,
  renamedStages,
  renderCopy,
  roundItemResult,
  runRules,
  type Stage,
  stageWordOf,
} from "@product-loop/model";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { queueItemsCopy } from "../../copy/queue.ts";
import { roundsCopy } from "../../copy/rounds.ts";
import {
  cards,
  pages,
  queueItems,
  replyLines,
  roundItems,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import type { JsonObject } from "../../store/schema/json.ts";
import { appendEvent } from "../events.ts";
import { landRules } from "../land/rules.ts";
import { landStepIssues } from "../land/status.ts";
import { mainlineStatus } from "../mainline.ts";
import { waitingPageIn } from "../pages/lookup.ts";
import { fail, type Reader, requireWritable } from "../projects.ts";
import { listQueueItems, moveQueueItem, returnFromRound } from "../queue.ts";
import { unhandledReplies } from "../replies/pending.ts";
import { lineHandled } from "../rules/index.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { type RoundView, toRoundView } from "../versions.ts";
import { closedNext, shownLandPages } from "./next.ts";
import { useLeaveIssues, useLeaveRule } from "./use-leave.ts";

// 收尾：`ploop round close`，接口是 POST /projects/:pid/rounds/:rid/close。
// 收尾的意思见「00 总览」第一节，命令见「04 命令行」第二、三节，接口见「05 接口」第四节。
// 拿出的事和它的结果见「03 数据模型」第二节：做完、退回、开始时取消。
// 拿出的每件事都有结果才能收尾。在这一轮里已经改过状态的事，按它现在的状态记，不用再写：
// 已完成记做完，已取消记开始时取消，回到待办或改成等待的记退回。
// 还在进行中的事要在请求里写明结果。做完写完成证据，退回写原因，退回时可以换到别的阶段。
// 下一轮开始时替上一轮收尾也用这里的 settleRound，见 start.ts 的 closePreviousRound。

/** 收尾自己的规矩编号。写法照约定 0002 第三节。 */
export const roundCloseRules = {
  /** 拿出的每件事都有结果，而且只有一个结果，见「00 总览」第一节。 */
  result: "round.close.result",
  /** 使用轮的离开条件：最近一次运行没有断点，覆盖表没有缺口，见「04 命令行」第十节。 */
  useLeave: useLeaveRule,
  /** 构思轮的离开条件：主线十个部分至少写好一半。 */
  thinkLeave: "think.leave",
} as const;

/**
 * 构思收尾时主线十个部分至少要有几个。「构思的做法」第四节的离开条件第一条是十个都有，
 * 但构思可以做几次，前几次只补一部分是正常的，所以命令只拦缺得太多的：至少一半。
 * 其余三条（待定不卡场景、五条判据、用户确认）是判断，命令查不了，写在收尾的提示里。
 */
export const thinkLeaveMinParts = 5;

/** 请求里能写的两种结果。开始时取消的事在这一轮里用 ploop queue drop 取消，不在这里写。 */
type OutcomeResult = Exclude<RoundItemResult, "droppedAtStart">;

/** 收尾时写明的一件事的结果。 */
type OutcomeInput = {
  /** 队列事项的编号，写成 Q12。 */
  readonly id: string;
  readonly result: OutcomeResult;
  /** 做完的写完成证据，退回的写原因，都要写。 */
  readonly note?: string | undefined;
  /** 退回到哪个阶段，例如定义不对，退回构思。只有退回的事能写，不写就留在原来的阶段。 */
  readonly stage?: Stage | undefined;
};

/** 收尾的请求，对应接口 POST /projects/:pid/rounds/:rid/close 的请求体，枚举已换成英文键。 */
export type RoundCloseInput = {
  /** 还在进行中的事，逐件写明结果。这一轮里已经改过状态的事不用写。 */
  readonly results?: readonly OutcomeInput[] | undefined;
  /** 收尾说明：一句话写这一轮做了什么。 */
  readonly summary?: string | undefined;
  /**
   * 放弃这个阶段：写明原因。拿出的事都退回待办，不查落地的收尾条件，不要求给页。
   * 已经给用户看过更改的页以后不能放弃。不和 results、summary 一起写。
   */
  readonly abort?: string | undefined;
  /**
   * 落地轮收尾时，命令行查到的各个根目录里没提交的文件，见规矩 land.commit.clean。
   * 每个是 git 仓库的根目录一项，没有改动的写空列表。别的阶段不写。
   */
  readonly worktree?: readonly WorktreeState[] | undefined;
};

/** 一个根目录的工作区：git status --porcelain 列出的文件，相对根目录。 */
type WorktreeState = { readonly root: string; readonly files: readonly string[] };

/** 收尾以后拿出的一件事：队列事项现在的样子，和它在这一轮的结果。 */
type ClosedItem = {
  readonly item: QueueItem;
  readonly result: RoundItemResult;
  /** 退回到哪个阶段。只有写了阶段的退回有。 */
  readonly returnedTo: Stage | null;
  /** 做完的写证据，退回的写原因，开始时取消的写取消的原因。回到待办时没写说明的为空。 */
  readonly note: string | null;
};

/** 收尾的结果。接口层把 next 放进响应外壳，其余是 data。 */
export type ClosedRound = {
  /** 收尾的一轮，状态是已收尾。 */
  readonly round: RoundView;
  /** 收尾说明。没写时为空。 */
  readonly summary: string | null;
  /** 拿出的每件事，按编号排。 */
  readonly items: readonly ClosedItem[];
  /** 下一步：一到两条完整的命令。 */
  readonly next: readonly string[];
};

type RoundRow = typeof rounds.$inferSelect;
type ItemRow = typeof queueItems.$inferSelect;

/** 请求里写明的一件事的结果，编号换成数字，说明去掉首尾的空白。 */
type Outcome = {
  readonly number: number;
  readonly result: OutcomeResult;
  readonly note: string;
  readonly stage: Stage | undefined;
};

/** 请求整理以后的样子。 */
type CleanRequest = {
  readonly label: RoundLabel;
  readonly outcomes: readonly Outcome[];
  readonly summary: string | null;
  readonly abort: string | null;
  readonly worktree: readonly WorktreeState[] | undefined;
};

type Failure = ErrorBody<
  "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR" | "RULE_BLOCKED"
>;

/**
 * 给一轮收尾。请求本身的问题先一次报齐，返回 BAD_REQUEST。
 * 其余的在一个写事务里依次做，任何一步不通过就整个撤回，什么都不写：
 * 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
 * 2. 按轮次的写法找这一轮。找不到返回 NOT_FOUND，已经收尾的返回 CONFLICT。
 *    还有一页在等用户点时也返回 CONFLICT，写明是哪一页。先取回回复或撤回那一页，
 *    否则在等那一页的 ploop reply wait 不会结束，见 pages/withdraw.ts。
 * 3. 请求里写的事都要是这一轮拿出来的。队列里没有的、不是这一轮拿出的，一次报齐，返回 NOT_FOUND。
 * 4. 给拿出的每件事记下结果，这一轮改成已收尾，记一条 round.closed，见 settleRound。
 *    没有结果的事、已有结果又写了结果的事、按阶段加的检查，一次报齐，返回 RULE_BLOCKED。
 * 除了在等用户点的一轮，别的状态都能收尾。落地轮也用它，第 50 步另查代码是否全部提交。
 */
export function closeRound(
  ctx: WriteContext,
  projectId: string,
  roundRef: string,
  input: RoundCloseInput,
): Result<ClosedRound, Failure> {
  const cleaned = cleanRequest(roundRef, input);
  if (!cleaned.ok) return cleaned;
  const request = cleaned.value;
  type TxFailure = Exclude<Failure, ErrorBody<"BAD_REQUEST">>;
  return writeTx<ClosedRound, TxFailure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const round = findRound(w.tx, projectId, request.label);
    if (round === undefined) {
      const text = roundsCopy.close.notFound;
      const name = formatRoundName(request.label);
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, round: name }),
        hint: renderCopy(text.hint),
        where: name,
      });
    }
    const name = formatRoundName(round);
    if (round.status === "closed") {
      const text = roundsCopy.close.closed;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { round: name }),
        hint: renderCopy(text.hint),
        where: name,
      });
    }
    const waiting = waitingPageIn(w.tx, round.id);
    if (waiting !== undefined) {
      const text = roundsCopy.close.waiting;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { round: name, page: waiting.seq }),
        hint: renderCopy(text.hint),
        where: name,
      });
    }
    // 回复还有行没处理就收尾，下一次开始阶段才被拦，来回多一趟：收尾时就拦，和开始阶段同一条规矩。
    const pending = runRules([lineHandled], null, {
      unhandledReplies: unhandledReplies(w.tx, projectId),
    });
    const [unhandled, ...moreUnhandled] = pending.block;
    if (unhandled !== undefined) {
      return err(errorBody("RULE_BLOCKED", [unhandled, ...moreUnhandled]));
    }
    if (request.abort !== null) return abortRound(w, round, request.abort);
    const unknown = unknownOutcomes(w.tx, round, request.outcomes);
    if (unknown !== undefined) return unknown;
    const settled = settleRound(w, round, {
      outcomes: request.outcomes,
      summary: request.summary,
      auto: false,
      worktree: request.worktree,
    });
    return settled.ok ? settled : err(errorBody("RULE_BLOCKED", settled.error.blocks));
  });
}

// ── 放弃一个阶段 ──

/**
 * 放弃这个阶段：拿出的事里还在进行中的，都退回待办，原因写「放弃：…」。这一轮收尾，不查按阶段加的条件。
 * 已经给用户看过更改的页，就不能放弃，免得绕过落地的验收：这时用 --done 和 --return 逐件收尾。
 */
function abortRound(
  w: WriteScope,
  round: RoundRow,
  reason: string,
): Result<ClosedRound, ErrorBody<"RULE_BLOCKED">> {
  const text = roundsCopy.close.abort;
  if (shownChangePages(w.tx, round.id) > 0) {
    const name = formatRoundName(round);
    return fail("RULE_BLOCKED", {
      message: renderCopy(text.changes.message, { round: name }),
      hint: renderCopy(text.changes.hint),
      where: name,
    });
  }
  const note = renderCopy(text.summary, { reason });
  const outcomes = takenRows(w.tx, round.id)
    .filter((row) => row.status === "doing")
    .map((row): Outcome => ({ number: row.number, result: "returned", note, stage: undefined }));
  const settled = settleRound(w, round, {
    outcomes,
    summary: note,
    auto: false,
    aborted: true,
  });
  return settled.ok ? settled : err(errorBody("RULE_BLOCKED", settled.error.blocks));
}

/** 这一轮给用户看过、非撤回的页里，有更改卡的页数。 */
function shownChangePages(tx: Reader, roundId: number): number {
  return tx
    .select({ id: pages.id })
    .from(pages)
    .innerJoin(cards, eq(cards.pageId, pages.id))
    .where(
      and(
        eq(pages.roundId, roundId),
        ne(pages.status, "withdrawn"),
        inArray(pages.purpose, ["ask", "view"]),
        eq(cards.section, "changes"),
      ),
    )
    .groupBy(pages.id)
    .all().length;
}

/**
 * 用户对某条更改点了不认可，对应的事不能记成做完，规矩是 land.change.rejected。
 * 一件事以最后一次的认可或不认可为准：不认可以后改好、用户又认可了，就能做完。
 * 更改卡上引用的队列事项，就是这条更改对应的事。
 */
function rejectedDoneIssues(tx: Reader, round: RoundRow, settled: readonly Settled[]): Issue[] {
  const done = settled.filter((entry) => entry.result === "done");
  if (done.length === 0) return [];
  const verdicts = tx
    .select({
      kind: replyLines.kind,
      title: cards.title,
      queue: cards.queue,
    })
    .from(replyLines)
    .innerJoin(submissions, eq(submissions.id, replyLines.submissionId))
    .innerJoin(pages, eq(pages.id, submissions.pageId))
    .innerJoin(
      cards,
      and(
        eq(cards.pageId, pages.id),
        eq(cards.section, replyLines.section),
        eq(cards.cardId, replyLines.card),
      ),
    )
    .where(
      and(
        eq(pages.roundId, round.id),
        eq(replyLines.section, "changes"),
        inArray(replyLines.kind, ["changeRejected", "changeApproved"]),
      ),
    )
    .orderBy(asc(replyLines.submissionId), asc(replyLines.line))
    .all();
  const last = new Map<number, { rejected: boolean; title: string }>();
  for (const verdict of verdicts) {
    for (const number of verdict.queue) {
      last.set(number, { rejected: verdict.kind === "changeRejected", title: verdict.title });
    }
  }
  const text = roundsCopy.close.land.rejected;
  return done.flatMap(({ row }) => {
    const found = last.get(row.number);
    if (found === undefined || !found.rejected) return [];
    const id = formatQueueId(row.number);
    return [
      {
        rule: landRules.changeRejected,
        message: renderCopy(text.message, { card: found.title, id }),
        hint: renderCopy(text.hint, { id }),
        where: id,
      },
    ];
  });
}

// ── 请求本身的问题 ──

/** 整理请求，请求本身的问题一次报齐。这些不看库里的数据，所以在写事务外面查。 */
function cleanRequest(
  roundRef: string,
  input: RoundCloseInput,
): Result<CleanRequest, ErrorBody<"BAD_REQUEST">> {
  const issues: Issue[] = [];
  const outcomes: Outcome[] = [];
  const reported = new Set<number>();
  for (const entry of input.results ?? []) {
    const parsed = parseQueueId(entry.id);
    if (!parsed.ok) {
      const copy = parseCopy.queueId[parsed.error];
      issues.push({
        message: renderCopy(copy.message, { text: entry.id }),
        hint: renderCopy(copy.hint),
        where: entry.id,
      });
      continue;
    }
    const number = parsed.value;
    const id = formatQueueId(number);
    const text = roundsCopy.close;
    if (outcomes.some((outcome) => outcome.number === number)) {
      if (!reported.has(number)) {
        reported.add(number);
        issues.push({
          message: renderCopy(text.duplicate.message, { id }),
          hint: renderCopy(text.duplicate.hint),
          where: id,
        });
      }
      continue;
    }
    const note = entry.note?.trim() ?? "";
    if (note === "") {
      issues.push(
        entry.result === "done"
          ? {
              message: renderCopy(text.evidenceBlank.message, { id }),
              hint: renderCopy(queueItemsCopy.doneEvidence.hint),
              where: id,
            }
          : {
              message: renderCopy(text.reasonBlank.message, { id }),
              hint: renderCopy(text.reasonBlank.hint),
              where: id,
            },
      );
    }
    if (entry.result === "done" && entry.stage !== undefined) {
      issues.push({
        message: renderCopy(text.stageNotReturned.message, { id }),
        hint: renderCopy(text.stageNotReturned.hint, { id }),
        where: id,
      });
    }
    const back = entry.result === "returned" ? entry.stage : undefined;
    outcomes.push({ number, result: entry.result, note, stage: back });
  }

  const summary = input.summary?.trim();
  if (summary === "") {
    const text = roundsCopy.close.summaryBlank;
    issues.push({
      message: renderCopy(text.message),
      hint: renderCopy(text.hint),
      where: "summary",
    });
  }
  const abort = input.abort?.trim();
  if (input.abort !== undefined) {
    const text = roundsCopy.close.abort;
    if (abort === "") {
      issues.push({
        message: renderCopy(text.blank.message),
        hint: renderCopy(text.blank.hint),
        where: "abort",
      });
    }
    if ((input.results ?? []).length > 0 || input.summary !== undefined) {
      issues.push({
        message: renderCopy(text.withResults.message),
        hint: renderCopy(text.withResults.hint),
        where: "abort",
      });
    }
  }
  const label = parseRoundLabel(roundRef);
  if (!label.ok) {
    return err(errorBody("BAD_REQUEST", [roundLabelIssue(roundRef, label.error), ...issues]));
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok({
    label: label.value,
    outcomes,
    summary: summary ?? null,
    abort: abort ?? null,
    worktree: input.worktree,
  });
}

/** 轮次的写法不对，报错和 parseRoundLabel 的错误码对应。 */
export function roundLabelIssue(text: string, error: RoundLabelError): Issue {
  const copy = parseCopy.roundLabel;
  if (error === "renamedStage") {
    const old = stageWordOf(text);
    return {
      message: renderCopy(copy.renamedStage.message, { text, old }),
      hint: renderCopy(copy.renamedStage.hint, { old, now: renamedStages.get(old) ?? "" }),
      where: text,
    };
  }
  const entry = copy[error];
  return {
    message: renderCopy(entry.message, { text }),
    hint: renderCopy(entry.hint),
    where: text,
  };
}

// ── 核对这一轮和请求里的事 ──

/** 按轮次的写法找这个项目的一轮。给出信息的校验也用它。 */
export function findRound(tx: Reader, projectId: string, label: RoundLabel): RoundRow | undefined {
  return tx
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
}

/** 这一轮拿出的事，按编号排。 */
function takenRows(tx: Reader, roundId: number): ItemRow[] {
  return tx
    .select({ item: queueItems })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .where(eq(roundItems.roundId, roundId))
    .orderBy(asc(queueItems.number))
    .all()
    .map((row) => row.item);
}

/** 请求里不是这一轮拿出的事：队列里没有的，和不在这一轮里的，按请求里的先后报齐。 */
function unknownOutcomes(
  tx: Reader,
  round: RoundRow,
  outcomes: readonly Outcome[],
): Err<ErrorBody<"NOT_FOUND">> | undefined {
  const taken = new Set(takenRows(tx, round.id).map((row) => row.number));
  const others = outcomes.map((outcome) => outcome.number).filter((n) => !taken.has(n));
  if (others.length === 0) return undefined;
  const existing = new Set(
    tx
      .select({ number: queueItems.number })
      .from(queueItems)
      .where(and(eq(queueItems.projectId, round.projectId), inArray(queueItems.number, others)))
      .all()
      .map((row) => row.number),
  );
  const name = formatRoundName(round);
  const issues = others.map((number): Issue => {
    const id = formatQueueId(number);
    if (!existing.has(number)) {
      const text = queueItemsCopy.notFound;
      return {
        message: renderCopy(text.message, { project: round.projectId, id }),
        hint: renderCopy(text.hint),
        where: id,
      };
    }
    const text = roundsCopy.close.notTaken;
    return {
      message: renderCopy(text.message, { round: name, id }),
      hint: renderCopy(text.hint, { round: name }),
      where: id,
    };
  });
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody("NOT_FOUND", [first, ...rest]));
}

// ── 记下结果，改成已收尾 ──

/** 交给 settleRound 的收尾请求。 */
export type SettleRequest = {
  /** 请求里写明的结果，已经核对过都是这一轮拿出的事。开始时自动收尾为空。 */
  readonly outcomes: readonly Outcome[];
  readonly summary: string | null;
  /** 是不是开始新的一轮时自动收尾的，记进事件。 */
  readonly auto: boolean;
  /** 是不是放弃的：拿出的事都退回待办，不查按阶段加的收尾条件。 */
  readonly aborted?: boolean;
  /** 落地轮收尾时各个根目录没提交的文件。自动收尾不收落地轮，所以不写。 */
  readonly worktree?: readonly WorktreeState[] | undefined;
};

/** 收尾不成：还在进行中、没写结果的事，和全部拦截，拦截里也有前者。 */
type Unsettled = {
  readonly missing: readonly string[];
  readonly blocks: readonly [Issue, ...Issue[]];
};

/** 一件事在这一轮的结果，写进拿出的事。 */
type Settled = {
  readonly row: ItemRow;
  readonly result: RoundItemResult;
  readonly returnedTo: Stage | null;
  readonly note: string | null;
};

/**
 * 在调用者的写事务里给一轮收尾：给拿出的每件事记下结果，这一轮改成已收尾，
 * 记下收尾的时间和收尾说明，再记一条 round.closed。调用的用例先确认项目能改数据、这一轮还开着。
 * 已经改过状态的事按现在的状态记。还在进行中的事按请求里写的做完或退回，变动记在这一轮上。
 * 有拦截时返回全部拦截，这时事务里已经改了的状态，随失败的结果一起撤回。
 */
export function settleRound(
  w: WriteScope,
  round: RoundRow,
  request: SettleRequest,
): Result<ClosedRound, Unsettled> {
  const label = formatRoundLabel(round);
  const name = formatRoundName(round);
  const blocks: Issue[] = [];
  const missing: string[] = [];
  const settled: Settled[] = [];
  for (const row of takenRows(w.tx, round.id)) {
    const id = formatQueueId(row.number);
    const outcome = request.outcomes.find((entry) => entry.number === row.number);
    const already = byStatus(row, round);
    if (already !== undefined) {
      if (outcome === undefined) settled.push({ row, ...already });
      else blocks.push(settledIssue(id, already.result));
    } else if (outcome === undefined) {
      missing.push(id);
      blocks.push(noResultIssue(id, name, round.stage));
    } else {
      const moved = applyOutcome(w, round, outcome);
      if (moved.length > 0) blocks.push(...moved);
      else settled.push({ row, ...fromOutcome(outcome) });
    }
  }
  if (request.aborted !== true) blocks.push(...closeChecks(w, round, request, settled));
  const [first, ...rest] = blocks;
  if (first !== undefined) return err({ missing, blocks: [first, ...rest] });

  for (const { row, result, returnedTo, note } of settled) {
    w.tx
      .update(roundItems)
      .set({ result, returnedTo, note })
      .where(and(eq(roundItems.roundId, round.id), eq(roundItems.queueItemId, row.id)))
      .run();
  }
  const closed = w.tx
    .update(rounds)
    .set({ status: "closed", closedAt: w.now, closeNote: request.summary })
    .where(eq(rounds.id, round.id))
    .returning()
    .get();
  appendEvent(w, {
    projectId: round.projectId,
    kind: "round.closed",
    objectType: "round",
    objectId: label,
    detail: closedDetail(settled, request),
  });
  return ok({
    round: toRoundView(closed),
    summary: closed.closeNote,
    items: closedItems(w, round.projectId, settled),
    next: closedNext(
      w.tx,
      round.projectId,
      round.stage,
      mainlineStatus(w.tx, round.projectId),
      request.aborted === true,
    ),
  });
}

/**
 * 在这一轮里已经改过状态的事，结果按现在的状态记。还在进行中的没有结果，返回 undefined。
 * 回到待办的，是收尾以前就退回了，或者开始时取消以后又捞回了。改成等待的，是发现要等别的事。
 * 这两种都回到了队列里，所以记退回，说明取状态说明；阶段改标成别的阶段的，记退回到那个阶段。
 */
function byStatus(row: ItemRow, round: RoundRow): Omit<Settled, "row"> | undefined {
  switch (row.status) {
    case "doing":
      return undefined;
    case "done":
      return { result: "done", returnedTo: null, note: row.evidence };
    case "dropped":
      return { result: "droppedAtStart", returnedTo: null, note: row.statusNote };
    case "todo":
    case "waiting":
      // 处理回复时选中已有的一件、改标了别的阶段，记成退回到那个阶段。
      return {
        result: "returned",
        returnedTo: row.stage === round.stage ? null : row.stage,
        note: row.statusNote,
      };
  }
}

function fromOutcome(outcome: Outcome): Omit<Settled, "row"> {
  return {
    result: outcome.result,
    returnedTo: outcome.stage ?? null,
    note: outcome.note,
  };
}

/** 按请求里写的结果改一件进行中的事：做完改成已完成并写证据，退回改回待办。返回拦截。 */
function applyOutcome(w: WriteScope, round: RoundRow, outcome: Outcome): readonly Issue[] {
  const { number, note } = outcome;
  const done = { to: "done", evidence: note } as const;
  const moved =
    outcome.result === "done"
      ? moveQueueItem(w, round.projectId, number, done, { roundId: round.id })
      : returnFromRound(w, round.id, number, { note, stage: outcome.stage });
  if (moved.ok) return [];
  // 说明已经查过不是空白，事项也核对过是这一轮拿出的，只剩状态图的拦截。
  if (moved.error.code !== "RULE_BLOCKED") throw new Error(moved.error.message);
  return issuesOf(moved.error);
}

function noResultIssue(id: string, round: string, roundStage: Stage): Issue {
  const text = roundsCopy.close.noResult;
  // 落地退回要写退回哪个阶段，提升选中的事改标阶段：第一次就把能运行的写法给出来。
  const hint =
    roundStage === "land" ? text.hintLand : roundStage === "improve" ? text.hintImprove : text.hint;
  return {
    rule: roundCloseRules.result,
    message: renderCopy(text.message, { id, round }),
    hint: renderCopy(hint, { id }),
    where: id,
  };
}

function settledIssue(id: string, result: RoundItemResult): Issue {
  const text = roundsCopy.close.settled;
  return {
    rule: roundCloseRules.result,
    message: renderCopy(text.message, { id, result: roundItemResult.label(result) }),
    hint: renderCopy(text.hint, { id }),
    where: id,
  };
}

/** 规矩 think.leave：主线十个部分写好的不到一半，构思阶段不能收尾。 */
function thinkLeaveIssues(db: Reader, round: RoundRow): Issue[] {
  const status = mainlineStatus(db, round.projectId);
  const total = mainlinePart.keys.length;
  const missing = status.missingParts.length;
  const have = total - missing;
  if (have >= thinkLeaveMinParts) return [];
  const name = formatRoundName(round);
  const text = roundsCopy.close.think;
  const rule = roundCloseRules.thinkLeave;
  const where = renderCopy(roundsCopy.mainline.where);
  if (status.revision === null) {
    return [
      {
        rule,
        message: renderCopy(text.none.message, { round: name }),
        hint: renderCopy(text.none.hint, { least: thinkLeaveMinParts }),
        where,
      },
    ];
  }
  return [
    {
      rule,
      message: renderCopy(text.message, { have, missing, round: name }),
      hint: renderCopy(text.hint, {
        parts: status.missingParts.map((part) => mainlinePart.label(part)).join("、"),
        least: thinkLeaveMinParts,
      }),
      where,
    },
  ];
}

/**
 * 按阶段加的收尾检查，开始时自动收尾也执行。返回拦截，每条带规矩编号。
 * 落地轮查四条，见「07 校验」第四节和决定 206：
 * - land.change.rejected：用户对某条更改点了不认可，对应的事不能记成做完，要用 --return 退回。
 * - land.commit.clean：请求带上命令行查到的各个根目录的状态，有没提交的改动时拦截并列出文件。
 *   退回的事要写明退回哪个阶段。
 * - land.page.shown：这一轮至少给用户看过一页要点的页，或带更改的页，撤回的不算，空的只看页不算。
 *   检查和提升的收尾不查。
 * - land.steps：有做完的事时，计划、重构、先失败后通过和评审都要有记录。全部退回时不查。
 * 第 53 步接上使用轮的 use.leave：最近一次运行有断点，或者覆盖表有缺口时拦截。
 */
function closeChecks(
  w: WriteScope,
  round: RoundRow,
  request: SettleRequest,
  settled: readonly Settled[],
): Issue[] {
  if (round.stage === "use") return useLeaveIssues(w.tx, round);
  if (round.stage === "think") return thinkLeaveIssues(w.tx, round);
  if (round.stage !== "land") return [];
  const name = formatRoundName(round);
  const text = roundsCopy.close.land;
  const blocks: Issue[] = [];
  if (request.worktree === undefined) {
    blocks.push({
      rule: landRules.commitClean,
      message: renderCopy(text.noWorktree.message),
      hint: renderCopy(text.noWorktree.hint),
      where: name,
    });
  }
  for (const { root, files } of request.worktree ?? []) {
    if (files.length === 0) continue;
    blocks.push({
      rule: landRules.commitClean,
      message: renderCopy(text.dirty.message, {
        root,
        count: files.length,
        files: files.join("、"),
      }),
      hint: renderCopy(text.dirty.hint),
      where: root,
    });
  }
  if (shownLandPages(w.tx, round.id) === 0) {
    blocks.push({
      rule: landRules.pageShown,
      message: renderCopy(text.noPage.message, { round: name }),
      hint: renderCopy(text.noPage.hint),
      where: name,
    });
  }
  for (const outcome of request.outcomes) {
    if (outcome.result !== "returned" || outcome.stage !== undefined) continue;
    const id = formatQueueId(outcome.number);
    blocks.push({
      rule: roundCloseRules.result,
      message: renderCopy(text.returnStage.message, { id }),
      hint: renderCopy(text.returnStage.hint, { id }),
      where: id,
    });
  }
  blocks.push(...rejectedDoneIssues(w.tx, round, settled));
  if (settled.some((entry) => entry.result === "done")) blocks.push(...landStepIssues(w.tx, round));
  return blocks;
}

/** round.closed 的内容：每种结果各有哪几件，收尾说明，是不是自动收尾的。 */
function closedDetail(settled: readonly Settled[], request: SettleRequest): JsonObject {
  const ids = (result: RoundItemResult) =>
    settled
      .filter((entry) => entry.result === result)
      .map((entry) => formatQueueId(entry.row.number));
  return {
    done: ids("done"),
    returned: ids("returned"),
    droppedAtStart: ids("droppedAtStart"),
    summary: request.summary ?? undefined,
    auto: request.auto ? true : undefined,
    aborted: request.aborted === true ? true : undefined,
  };
}

/** 收尾以后拿出的每件事，队列事项取改过以后的样子。 */
function closedItems(w: WriteScope, projectId: string, settled: readonly Settled[]): ClosedItem[] {
  const listed = listQueueItems(w.tx, projectId);
  // 调用的用例已经确认项目存在。
  if (!listed.ok) throw new Error(listed.error.message);
  const byId = new Map(listed.value.map((item) => [item.id, item]));
  return settled.map(({ row, result, returnedTo, note }) => {
    const item = byId.get(formatQueueId(row.number));
    if (item === undefined) throw new Error(`拿出的事 ${formatQueueId(row.number)} 不在队列里。`);
    return { item, result, returnedTo, note };
  });
}
