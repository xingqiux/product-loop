import {
  beijingMinute,
  type Err,
  type ErrorBody,
  err,
  errorBody,
  formatQueueId,
  formatRoundName,
  type Issue,
  issuesOf,
  ok,
  parseCopy,
  parseQueueId,
  type QueueItem,
  type Result,
  renderCopy,
  runRules,
  type Stage,
  stage,
} from "@product-loop/model";
import { and, asc, desc, eq, inArray, max, ne } from "drizzle-orm";
import { projectsCopy } from "../../copy/projects.ts";
import { queueItemsCopy } from "../../copy/queue.ts";
import { roundsCopy } from "../../copy/rounds.ts";
import {
  type BaseCommit,
  projectRoots,
  queueItems,
  roundItems,
  rounds,
} from "../../store/schema/index.ts";
import { appendEvent } from "../events.ts";
import { type MainlineStatus, mainlineStatus } from "../mainline.ts";
import { fail, type Reader, requireWritable } from "../projects.ts";
import { listQueueItems, moveQueueItem, takeOutForRound } from "../queue.ts";
import { unhandledReplies } from "../replies/pending.ts";
import { lineHandled } from "../rules/index.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { latestUseRun } from "../use/runs.ts";
import { listScreens, type ScreenList } from "../use/screens.ts";
import {
  currentVersionRow,
  endVersion,
  type RoundView,
  startNextVersion,
  toRoundView,
  toVersionView,
  type VersionChange,
} from "../versions.ts";
import { settleRound } from "./close.ts";
import { roundNext, shownPages } from "./next.ts";
import { useLeaveIssues } from "./use-leave.ts";

// 开始一轮：`ploop round start <阶段名>`，接口是 POST /projects/:pid/rounds。
// 命令见「04 命令行」第二到五节，接口见「05 接口」第四节，轮次和拿出的事见「03 数据模型」第二节。
// 一个项目同一时间只有一轮开着，由轮次表的唯一索引 rounds_one_open 保证，见「01 架构」第七节。
// 写事务一个接一个地执行。两个请求同时开始一轮，后执行的一个插入轮次时被索引拒绝，返回冲突。
// 所以不在插入以前另查一遍，冲突一律由插入时的索引判定，两个连接各开一个事务时也是这样。
// 开始以前先替已回复的上一轮收尾，见 closePreviousRound。
// 提升轮收尾以后进入下一版，见 versionForRound。

/** 开始一轮自己的规矩编号。写法照约定 0002 第三节，由第 24 步统一。 */
export const roundStartRules = {
  /** 主线十样有缺的，开始任何一轮都警告，见「07 校验」第四节。 */
  mainlineTen: "mainline.ten",
  /** 进入检查时，设计规范十二样有缺的就拦截，见「07 校验」第四节。 */
  specTwelve: "mainline.spec.twelve",
  /** 落地轮这一批只拿落地的事，见「08 版本与迁移」第二节。 */
  takeStage: "round.take.stage",
} as const;

/** 改成等待的一件事，对应 --defer Q9="等构思定下场景 S4"。 */
type DeferInput = {
  /** 队列事项的编号，写成 Q9。 */
  readonly id: string;
  readonly dependsOn: string;
};

/** 开始一轮的请求，对应接口 POST /projects/:pid/rounds 的请求体，枚举已换成英文键。 */
export type RoundStartInput = {
  readonly stage: Stage;
  /**
   * 落地轮这一批的编号，写成 Q12。只能拿落地的待办事项，重复的只拿一次。
   * 不写就拿出这个阶段全部待办的事。别的阶段写了返回 BAD_REQUEST。
   */
  readonly take?: readonly string[] | undefined;
  /** 这一轮不做、改成等待的事，各自写明依赖。哪个阶段的事都可以写。 */
  readonly defer?: readonly DeferInput[] | undefined;
  /**
   * 落地轮开始时，命令行取到的各个根目录的 HEAD，这一批改动从它算起，见约定 0001 第 12 条。
   * 只交是 git 仓库的根目录。别的阶段写了返回 BAD_REQUEST。
   */
  readonly baseCommits?: readonly BaseCommit[] | undefined;
  /** 检查轮列出全部的屏，不只列这一版新出现和变过的。别的阶段不看。 */
  readonly allScreens?: boolean | undefined;
};

/**
 * 开始一轮的结果。接口层把 warnings 和 next 放进响应外壳，其余是 data。
 * 检查轮另要列出这一版变过的屏，由第 53 步加上。
 */
export type StartedRound = {
  /** 开始的一轮，写法是 v2-落地-3。 */
  readonly round: RoundView;
  /**
   * 这次开始进入了新的一版时，结束的一版和新开始的一版，输出里写明。没换版时为空。
   * 见「08 版本与迁移」第二节。
   */
  readonly versionChange: VersionChange | null;
  /** 开始以前替它收尾的上一轮，输出里写明。没有替哪一轮收尾时为空，见 closePreviousRound。 */
  readonly autoClosed: RoundView | null;
  /** 拿进这一轮的事，按编号排。AI 要逐件判断它们还成不成立。 */
  readonly taken: readonly QueueItem[];
  /** 改成等待的事，按请求里的先后。 */
  readonly deferred: readonly QueueItem[];
  /** 这个阶段原来就在等待的事，这次拿不出来，输出里写明，改回待办用 ploop queue reopen。 */
  readonly waiting: readonly QueueItem[];
  /** 落地轮开始时各个根目录的提交。别的阶段和没交提交的落地轮为空。 */
  readonly baseCommits: readonly BaseCommit[] | null;
  /** 主线缺哪几样，输出里「主线：」一行用它。 */
  readonly mainline: MainlineStatus;
  /** 检查轮要看的屏：这一版新出现和变过的，或者全部，按场景分组。别的阶段为空。 */
  readonly screens: ScreenList | null;
  /** 警告：主线十样有缺的。 */
  readonly warnings: readonly Issue[];
  /** 下一步：一到三条完整的命令。 */
  readonly next: readonly string[];
};

type RoundRow = typeof rounds.$inferSelect;

/** 请求整理以后的样子：编号换成数字，依赖去掉首尾的空白。 */
type CleanRequest = {
  readonly stage: Stage;
  readonly take: readonly number[] | undefined;
  readonly defer: readonly { readonly number: number; readonly dependsOn: string }[];
  readonly baseCommits: readonly BaseCommit[] | null;
};

type Failure = ErrorBody<
  "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR" | "RULE_BLOCKED"
>;

/**
 * 开始一轮。请求本身的问题先一次报齐，返回 BAD_REQUEST。
 * 其余的在一个写事务里依次做，任何一步不通过就整个撤回，什么都不写：
 * 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
 *    回复还有行没处理时拦截，规矩是 reply.line.handled，见「07 校验」第四节。
 * 2. 已回复的非落地轮替它收尾。还有进行中的事时返回 CONFLICT，写明是哪几件。
 * 3. 定下这一轮挂在哪一版。当前的一版已经结束，或者提升轮已经收尾时，先开始下一版。
 * 4. 轮号取这一版这个阶段最大的轮号加一，总序号取项目最大的总序号加一，插入这一轮。
 *    已有一轮开着时，索引拒绝插入，返回 CONFLICT，写明是哪一轮、什么时候、哪个会话开的。
 * 5. 核对请求里的编号和根目录，找不到的一次报齐，返回 NOT_FOUND。
 * 6. --defer 的事改成等待，再拿出这个阶段的事，记进拿出的事。变动都记在这一轮上。
 *    这三种拦截一次报齐，返回 RULE_BLOCKED：
 *    进入检查时设计规范十二样有缺的、这一批里有别的阶段的事、状态图不允许的变化。
 * 7. 记一条 round.started 事件。主线十样有缺的，随结果返回警告。
 */
export function startRound(
  ctx: WriteContext,
  projectId: string,
  input: RoundStartInput,
): Result<StartedRound, Failure> {
  const cleaned = cleanRequest(input);
  if (!cleaned.ok) return cleaned;
  const request = cleaned.value;
  return writeTx<StartedRound, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const pending = runRules([lineHandled], null, {
      unhandledReplies: unhandledReplies(w.tx, projectId),
    });
    const [unhandled, ...moreUnhandled] = pending.block;
    if (unhandled !== undefined)
      return err(errorBody("RULE_BLOCKED", [unhandled, ...moreUnhandled]));
    const closed = closePreviousRound(w, projectId);
    if (!closed.ok) return closed;
    const autoClosed = closed.value;
    const { version, change } = versionForRound(w, projectId);
    const inserted = insertRound(w, projectId, version, request);
    if (!inserted.ok) return inserted;
    const row = inserted.value;
    const mentioned = itemRefs(w.tx, projectId, mentionedNumbers(request));
    const missing = notFoundIssues(w.tx, projectId, request, mentioned);
    if (missing !== undefined) return missing;

    const mainline = mainlineStatus(w.tx, projectId);
    const blocks = [...specIssues(request.stage, mainline), ...takeStageIssues(request, mentioned)];
    const deferred: QueueItem[] = [];
    for (const { number, dependsOn } of request.defer) {
      const wait = { to: "waiting", dependsOn } as const;
      const moved = moveQueueItem(w, projectId, number, wait, { roundId: row.id });
      if (moved.ok) deferred.push(moved.value);
      else if (moved.error.code === "RULE_BLOCKED") blocks.push(...issuesOf(moved.error));
      else return moved;
    }
    const taken = takeOutForRound(w, row.id, request.take);
    if (!taken.ok) {
      if (taken.error.code !== "RULE_BLOCKED") return taken;
      blocks.push(...issuesOf(taken.error));
    }
    const [first, ...rest] = blocks;
    if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
    const items = taken.ok ? taken.value : [];

    recordTaken(w, projectId, row.id, items);
    const round = toRoundView(row);
    appendEvent(w, {
      projectId,
      kind: "round.started",
      objectType: "round",
      objectId: round.label,
      detail: {
        taken: items.map((item) => item.id),
        deferred: deferred.map((item) => item.id),
        baseCommits: row.baseCommits ?? undefined,
      },
    });
    return ok({
      round,
      versionChange: change,
      autoClosed,
      taken: items,
      deferred,
      waiting: stillWaiting(w.tx, projectId, request.stage, deferred),
      baseCommits: row.baseCommits,
      mainline,
      screens: request.stage === "check" ? screensToCheck(w.tx, projectId, input.allScreens) : null,
      warnings: tenWarnings(mainline),
      next: roundNext(w.tx, projectId, row, mainline),
    });
  });
}

// ── 请求本身的问题 ──

/** 提交号：git rev-parse HEAD 打印的完整提交号，SHA-1 是四十位，SHA-256 是六十四位。 */
const commitPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

/** 整理请求，请求本身的问题一次报齐。这些不看库里的数据，所以在写事务外面查。 */
function cleanRequest(input: RoundStartInput): Result<CleanRequest, ErrorBody<"BAD_REQUEST">> {
  const issues: Issue[] = [];
  const stageLabel = stage.label(input.stage);
  const numberOf = (text: string): number | undefined => {
    const parsed = parseQueueId(text);
    if (parsed.ok) return parsed.value;
    const copy = parseCopy.queueId[parsed.error];
    issues.push({
      message: renderCopy(copy.message, { text }),
      hint: renderCopy(copy.hint),
      where: text,
    });
    return undefined;
  };

  let take: number[] | undefined;
  if (input.take !== undefined) {
    const text = roundsCopy.take;
    if (input.stage !== "land") {
      issues.push({
        message: renderCopy(text.notLand.message, { stage: stageLabel }),
        hint: renderCopy(text.notLand.hint),
        where: "take",
      });
    } else if (input.take.length === 0) {
      issues.push({
        message: renderCopy(text.empty.message),
        hint: renderCopy(text.empty.hint),
        where: "take",
      });
    } else {
      const numbers = input.take.map(numberOf).filter((n) => n !== undefined);
      take = [...new Set(numbers)];
    }
  }

  const defer: { number: number; dependsOn: string }[] = [];
  const reported = new Set<number>();
  for (const entry of input.defer ?? []) {
    const number = numberOf(entry.id);
    if (number === undefined) continue;
    const id = formatQueueId(number);
    const dependsOn = entry.dependsOn.trim();
    if (dependsOn === "") {
      issues.push({
        message: renderCopy(roundsCopy.defer.dependsOnBlank.message, { id }),
        hint: renderCopy(queueItemsCopy.waitingDependsOn.hint),
        where: id,
      });
    }
    if (defer.some((d) => d.number === number)) {
      if (!reported.has(number)) {
        reported.add(number);
        const text = roundsCopy.defer.duplicate;
        issues.push({
          message: renderCopy(text.message, { id }),
          hint: renderCopy(text.hint),
          where: id,
        });
      }
      continue;
    }
    if (take?.includes(number) === true) {
      const text = roundsCopy.takeAndDefer;
      issues.push({
        message: renderCopy(text.message, { id }),
        hint: renderCopy(text.hint),
        where: id,
      });
    }
    defer.push({ number, dependsOn });
  }

  const baseCommits = cleanBaseCommits(input, issues);
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok({ stage: input.stage, take, defer, baseCommits });
}

/** 落地轮开始时的提交：只有落地轮能交，提交号要写完整，一个根目录只交一个。没交的为空。 */
function cleanBaseCommits(input: RoundStartInput, issues: Issue[]): readonly BaseCommit[] | null {
  const given = input.baseCommits ?? [];
  if (given.length === 0) return null;
  const text = roundsCopy.base;
  if (input.stage !== "land") {
    const params = { stage: stage.label(input.stage) };
    issues.push({
      message: renderCopy(text.notLand.message, params),
      hint: renderCopy(text.notLand.hint, params),
      where: "baseCommits",
    });
    return null;
  }
  const seen = new Set<string>();
  for (const { root, commit } of given) {
    if (!commitPattern.test(commit)) {
      issues.push({
        message: renderCopy(text.commit.message, { root, commit }),
        hint: renderCopy(text.commit.hint),
        where: root,
      });
    }
    if (seen.has(root)) {
      issues.push({
        message: renderCopy(text.duplicate.message, { root }),
        hint: renderCopy(text.duplicate.hint),
        where: root,
      });
    }
    seen.add(root);
  }
  return given.map(({ root, commit }) => ({ root, commit }));
}

// ── 替上一轮收尾，定下挂在哪一版 ──

/**
 * 开始新的一轮以前，替开着的上一轮收尾，见「04 命令行」第三节，收尾的做法见 close.ts。
 * 只替做完了的轮收尾：已回复的非落地轮，用户回复过页，拿出的事也都有了结果；
 * 给用户看过页的使用轮，是否没有断点和缺口在收尾时查。
 * 结果按每件事现在的状态记，不替 AI 定。还有进行中的事时返回冲突，写明是哪几件。
 * 收尾在这个事务里做，返回收尾的那一轮，输出里写明。
 * 落地轮不自动收尾，它要查代码是否全部提交，由 ploop round close 明确完成。
 * 进行中和等用户回复的一轮也不收尾，可能还有会话在做，见「01 架构」第七节。
 * 这两种都留着，插入新的一轮时由索引报冲突，写明是哪一轮、哪个会话开的。
 * 上一轮的回复还有行没处理时，在这之前已经拦下，见 startRound 的第 1 步。
 */
function closePreviousRound(
  w: WriteScope,
  projectId: string,
): Result<RoundView | null, ErrorBody<"CONFLICT" | "RULE_BLOCKED">> {
  const open = openRound(w.tx, projectId);
  if (open === undefined) return ok(null);
  if (!closesByItself(w.tx, open)) {
    // 使用阶段跑过使用代码，但有断点或缺口所以没给出页：拦的是 use.leave，不是「别的会话还开着」。
    const [first, ...rest] = useRunBlocks(w.tx, open);
    return first === undefined ? ok(null) : err(errorBody("RULE_BLOCKED", [first, ...rest]));
  }
  const settled = settleRound(w, open, { outcomes: [], summary: null, auto: true });
  if (settled.ok) return ok(settled.value.round);
  const { missing, blocks } = settled.error;
  // 按阶段加的收尾检查有拦截，照原样返回，见 close.ts 的 closeChecks。
  if (missing.length === 0) return err(errorBody("RULE_BLOCKED", blocks));
  const text = roundsCopy.close.auto;
  const round = formatRoundName(open);
  const ids = missing.join("、");
  return fail("CONFLICT", {
    message: renderCopy(text.message, { round, ids }),
    hint: renderCopy(text.hint, { ids, first: missing[0] ?? ids }),
    where: round,
  });
}

/** 使用轮已经运行过使用代码，离开条件没满足：返回 use.leave 的拦截，写明断点和缺口。别的情况为空。 */
function useRunBlocks(tx: Reader, round: RoundRow): Issue[] {
  if (round.stage !== "use") return [];
  const latest = latestUseRun(tx, round.projectId, { round });
  if (!latest.ok || latest.value === null) return [];
  return useLeaveIssues(tx, round);
}

/**
 * 这一轮开始下一轮时能不能自动收尾：用户回复过的非落地轮；
 * 使用轮给用户看过页，没有断点、没有缺口的（收尾时再查，见 use.leave），页由使用代码的运行自动给出。
 * 落地轮要查代码全部提交，不自动收尾。
 */
function closesByItself(tx: Reader, round: RoundRow): boolean {
  if (round.stage === "land") return false;
  if (round.stage === "use") return round.status === "open" && shownPages(tx, round.id).view > 0;
  return round.status === "replied";
}

/**
 * 这一轮挂在哪一版，见「08 版本与迁移」第二节。
 * 当前的一版已经结束时，先开始下一版，例如迁移完成时第 1 版已经结束。
 * 当前的一版里提升轮已经收尾时，先结束这一版并写明原因，再开始下一版。
 * 提升轮可能是刚才在这个事务里自动收尾的。
 */
function versionForRound(
  w: WriteScope,
  projectId: string,
): { readonly version: number; readonly change: VersionChange | null } {
  const current = currentVersionRow(w.tx, projectId);
  let ended = current;
  if (current.status === "open") {
    const improve = closedImprove(w.tx, projectId, current.version);
    if (improve === undefined) return { version: current.version, change: null };
    const round = formatRoundName(improve);
    ended = endVersion(w, current, renderCopy(roundsCopy.version.improveClosed, { round }));
  }
  const started = startNextVersion(w, ended);
  return {
    version: started.version,
    change: { ended: toVersionView(ended), started: toVersionView(started) },
  };
}

/** 这一版里已经收尾的提升轮，取最近的一轮。没有时返回 undefined。 */
function closedImprove(tx: Reader, projectId: string, version: number): RoundRow | undefined {
  return tx
    .select()
    .from(rounds)
    .where(
      and(
        eq(rounds.projectId, projectId),
        eq(rounds.version, version),
        eq(rounds.stage, "improve"),
        eq(rounds.status, "closed"),
      ),
    )
    .orderBy(desc(rounds.ordinal))
    .get();
}

// ── 插入这一轮 ──

/**
 * 编好轮号和总序号，插入这一轮，记下开它的会话和客户端。
 * 已有一轮开着时，唯一索引 rounds_one_open 拒绝插入，这里换成冲突，写明那一轮的情况。
 * 这时事务里已经写了的东西，随失败的结果一起撤回。
 */
function insertRound(
  w: WriteScope,
  projectId: string,
  version: number,
  request: CleanRequest,
): Result<RoundRow, ErrorBody<"CONFLICT">> {
  const ofProject = eq(rounds.projectId, projectId);
  const lastSeq = w.tx
    .select({ last: max(rounds.seq) })
    .from(rounds)
    .where(and(ofProject, eq(rounds.version, version), eq(rounds.stage, request.stage)))
    .get()?.last;
  const lastOrdinal = w.tx
    .select({ last: max(rounds.ordinal) })
    .from(rounds)
    .where(ofProject)
    .get()?.last;
  try {
    const row = w.tx
      .insert(rounds)
      .values({
        projectId,
        version,
        stage: request.stage,
        seq: (lastSeq ?? 0) + 1,
        ordinal: (lastOrdinal ?? 0) + 1,
        status: "open",
        startedAt: w.now,
        openedBySession: w.actor.session ?? null,
        openedByClient: w.actor.client,
        baseCommits: request.baseCommits,
      })
      .returning()
      .get();
    return ok(row);
  } catch (error) {
    const open = isUniqueViolation(error) ? openRound(w.tx, projectId) : undefined;
    if (open === undefined) throw error;
    return openConflict(open);
  }
}

/** SQLite 报的唯一约束冲突。drizzle 有的调用把它包在 cause 里。 */
function isUniqueViolation(error: unknown): boolean {
  const code = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value ? value.code : undefined;
  const cause = error instanceof Error ? error.cause : undefined;
  return [code(error), code(cause)].includes("SQLITE_CONSTRAINT_UNIQUE");
}

/** 项目现在开着的一轮，也就是还没收尾的那一轮。 */
function openRound(tx: Reader, projectId: string): RoundRow | undefined {
  return tx
    .select()
    .from(rounds)
    .where(and(eq(rounds.projectId, projectId), ne(rounds.status, "closed")))
    .get();
}

/** 已有一轮开着时的冲突：写明是哪一轮、什么时候、哪个会话开的，见「01 架构」第七节。 */
function openConflict(open: RoundRow): Err<ErrorBody<"CONFLICT">> {
  const text = roundsCopy.open;
  const round = formatRoundName(open);
  const at = beijingMinute(open.startedAt);
  const session = open.openedBySession;
  return fail("CONFLICT", {
    message:
      session === null
        ? renderCopy(text.messageNoSession, { round, at })
        : renderCopy(text.message, { round, session, at }),
    hint: renderCopy(text.hint, { round }),
    where: round,
  });
}

// ── 核对编号和根目录 ──

/** 请求里写到的一件事：库里的编号、队列编号和阶段。 */
type ItemRef = { readonly id: number; readonly number: number; readonly stage: Stage };

/** 按队列编号取事项，按编号排。 */
function itemRefs(tx: Reader, projectId: string, numbers: readonly number[]): ItemRef[] {
  if (numbers.length === 0) return [];
  return tx
    .select({ id: queueItems.id, number: queueItems.number, stage: queueItems.stage })
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), inArray(queueItems.number, [...numbers])))
    .orderBy(asc(queueItems.number))
    .all();
}

/** --take 和 --defer 写到的编号，重复的只留一个。 */
function mentionedNumbers(request: CleanRequest): number[] {
  const numbers = [...(request.take ?? []), ...request.defer.map((entry) => entry.number)];
  return [...new Set(numbers)];
}

/** 找不到的队列事项和没登记的根目录，一次报齐。都找得到时返回 undefined。 */
function notFoundIssues(
  tx: Reader,
  projectId: string,
  request: CleanRequest,
  mentioned: readonly ItemRef[],
): Err<ErrorBody<"NOT_FOUND">> | undefined {
  const issues: Issue[] = [];
  const found = new Set(mentioned.map((item) => item.number));
  for (const number of mentionedNumbers(request)) {
    if (found.has(number)) continue;
    const id = formatQueueId(number);
    const text = queueItemsCopy.notFound;
    issues.push({
      message: renderCopy(text.message, { project: projectId, id }),
      hint: renderCopy(text.hint),
      where: id,
    });
  }
  const roots = new Set(
    tx
      .select({ path: projectRoots.path })
      .from(projectRoots)
      .where(eq(projectRoots.projectId, projectId))
      .all()
      .map((row) => row.path),
  );
  for (const { root } of request.baseCommits ?? []) {
    if (roots.has(root)) continue;
    const text = projectsCopy.root.notInProject;
    issues.push({
      message: renderCopy(text.message, { project: projectId, path: root }),
      hint: renderCopy(text.hint),
      where: root,
    });
  }
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody("NOT_FOUND", [first, ...rest]));
}

// ── 拦截和警告 ──

/** 进入检查时，设计规范十二样有缺的就拦截，只查这一次，见「04 命令行」第十节。 */
function specIssues(roundStage: Stage, mainline: MainlineStatus): Issue[] {
  if (roundStage !== "check" || mainline.missingDesignSpec.length === 0) return [];
  const text = roundsCopy.mainline.specMissing;
  return [
    {
      rule: roundStartRules.specTwelve,
      message: renderCopy(text.message, { count: mainline.missingDesignSpec.length }),
      hint: renderCopy(text.hint),
      where: renderCopy(roundsCopy.mainline.where),
    },
  ];
}

/** 落地轮这一批只拿落地的事。别的阶段的事留到那个阶段做，按编号排。 */
function takeStageIssues(request: CleanRequest, mentioned: readonly ItemRef[]): Issue[] {
  const { take } = request;
  if (take === undefined) return [];
  const text = roundsCopy.take.stage;
  return mentioned
    .filter((item) => take.includes(item.number) && item.stage !== "land")
    .map((item) => {
      const params = { id: formatQueueId(item.number), stage: stage.label(item.stage) };
      return {
        rule: roundStartRules.takeStage,
        message: renderCopy(text.message, params),
        hint: renderCopy(text.hint, params),
        where: params.id,
      };
    });
}

/** 主线十样有缺的，开始任何一轮都警告，列出缺的几样，见「04 命令行」第十节。 */
function tenWarnings(mainline: MainlineStatus): Issue[] {
  if (mainline.missingParts.length === 0) return [];
  const where = renderCopy(roundsCopy.mainline.where);
  const rule = roundStartRules.mainlineTen;
  if (mainline.revision === null) {
    const text = roundsCopy.mainline.none;
    return [{ rule, message: renderCopy(text.message), hint: renderCopy(text.hint), where }];
  }
  const text = roundsCopy.mainline.partsMissing;
  const count = mainline.missingParts.length;
  return [
    { rule, message: renderCopy(text.message, { count }), hint: renderCopy(text.hint), where },
  ];
}

// ── 拿出的事和下一步 ──

/** 这个阶段还在等待的事，不含这次刚改成等待的。开始时没有拿出它们，要写明，免得当成丢了。 */
function stillWaiting(
  tx: Reader,
  projectId: string,
  roundStage: Stage,
  deferred: readonly QueueItem[],
): QueueItem[] {
  const listed = listQueueItems(tx, projectId, { stages: [roundStage], statuses: ["waiting"] });
  // 项目在事务开头已经确认过。
  if (!listed.ok) throw new Error(listed.error.message);
  const just = new Set(deferred.map((item) => item.id));
  return listed.value.filter((item) => !just.has(item.id));
}

/** 把拿进这一轮的事记进拿出的事。结果收尾时再写。 */
function recordTaken(
  w: WriteScope,
  projectId: string,
  roundId: number,
  taken: readonly QueueItem[],
): void {
  const numbers = taken.map((item) => {
    const parsed = parseQueueId(item.id);
    // 编号由队列的用例生成，一定写得对。
    if (!parsed.ok) throw new Error(`拿出的事编号写错了：${item.id}`);
    return parsed.value;
  });
  const refs = itemRefs(w.tx, projectId, numbers);
  if (refs.length === 0) return;
  w.tx
    .insert(roundItems)
    .values(refs.map((ref) => ({ roundId, queueItemId: ref.id, takenAt: w.now })))
    .run();
}

/** 开始一轮检查时要看的屏，见「04 命令行」第五节的样例。项目在事务开头已经确认过。 */
function screensToCheck(tx: Reader, projectId: string, all: boolean | undefined): ScreenList {
  const listed = listScreens(tx, projectId, { changedOnly: all !== true });
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value;
}
