import {
  type CopyEntry,
  type Decision,
  destination,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  formatQueueId,
  formatRoundLabel,
  type HandledLine,
  type Issue,
  inlineRuleInfo,
  ok,
  type Params,
  parseQueueId,
  type QueueItem,
  type QueueStatus,
  queueCopy,
  type ReplyHandleEntry,
  type ReplyLine,
  type ReplyLineRef,
  type Result,
  renderCopy,
  replyCopy,
  runRules,
  type Stage,
} from "@product-loop/model";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { repliesCopy } from "../../copy/replies.ts";
import {
  cards,
  mainlineRevisions,
  pages,
  queueItems,
  replyLines,
  roundItems,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import { createDecision } from "../decisions.ts";
import { appendEvent } from "../events.ts";
import { mainlineStatus, projectWritingSpec } from "../mainline.ts";
import { type Reader, requireWritable } from "../projects.ts";
import { moveQueueItem, putQueueItem, restageQueueItem } from "../queue.ts";
import { roundNext } from "../rounds/next.ts";
import { handleRuleList } from "../rules/index.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { linesOfSubmission } from "./read.ts";

// 处理回复：`ploop reply handle`，接口是 POST /submissions/:sid/destinations，见「05 接口」第四节。
// 给一到多行定去处，输入的格式见 model 的 replyHandleInputSchema（约定 0001 第 10 条）。
// 五种去处见「03 数据模型」第二节「页面和回复」：
// - 主线：主线要有给出那一页以后交的新版本，规矩是 reply.mainline.newer。版本不写就指最新的一版。
//   新版本按时间认：给出那一页时最新的一版是基准，要处理的一版要比它新。
// - 决定：当场建出一条决定，决定三项必填，由 decision.fields 查。
// - 队列：写 item 就当场放进一件新的，做写作校验。写 id 就指已有的一件：
//   它是这一页所在的一轮开始时取消的，而这一行来自「这一轮开始时取消的事」或点名了它，
//   就捞回待办，编号不变，见「04 命令行」第三节。还没做完的事直接指向它。
//   已完成的事，和别的时候取消的事，由状态图拦截。
// - 当场做：记在这一页所在的一轮上，写完成证据。
// - 不处理：写原因，必填。
// 带图的行要确认读过图，规矩是 reply.images.read，见 core/rules/replies.ts。
// 已经有去处的行不能再处理，返回 CONFLICT。自动处理过的取消和认可也算处理过。
// 全部在一个写事务里做，任何一行不通过就整批撤回。问题一次报齐：
// 找不到、冲突、请求不对、拦截这四类，只报最先的一类，同一类的全部报出。
// 每处理一行记一条 line.handled，见「05 接口」第五节。

/** 处理回复自己的规矩编号，检查写在这里。reply.images.read 写成了规则对象。 */
export const handleRules = {
  /** 去处是主线时，主线要有给出那一页以后交的新版本，见「04 命令行」第十节。 */
  mainlineNewer: inlineRuleInfo.replyMainlineNewer.id,
} as const;

/** 一行的去处：处理回复的输入里去掉行号的部分。 */
export type LineDestination = ReplyHandleEntry extends infer E
  ? E extends ReplyHandleEntry
    ? Omit<E, "line">
    : never
  : never;

/** 处理的结果。接口层把 warnings 和 next 放进响应外壳，其余是 data。 */
export type HandledLines = {
  readonly submission: number;
  /** 回复的那一页所在的轮次，写成 v1-构思-3。 */
  readonly round: string;
  /** 这次处理的各行，按输入的顺序，带着去处。 */
  readonly lines: readonly ReplyLine[];
  /** 当场建出的决定和队列事项。 */
  readonly decisions: readonly Decision[];
  readonly queued: readonly QueueItem[];
  /** 捞回待办的事。 */
  readonly restored: readonly QueueItem[];
  /** 选中已有的一件，改标了要做它的阶段的事。编号不变。 */
  readonly restaged: readonly QueueItem[];
  /** 这份回复还没处理的行号。 */
  readonly remaining: readonly number[];
  /** 放进队列时写作校验的警告。 */
  readonly warnings: readonly Issue[];
  readonly next: readonly string[];
};

type FailureCode = "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "RULE_BLOCKED";
type Failure = ErrorBody<FailureCode>;

type LineRow = typeof replyLines.$inferSelect;
type PageRow = typeof pages.$inferSelect;

/** 处理一行。等于只有一项的 handleLines。 */
export function handleLine(
  ctx: WriteContext,
  projectId: string,
  submissionId: number,
  line: number,
  to: LineDestination,
): Result<HandledLines, Failure> {
  return handleLines(ctx, projectId, submissionId, [{ ...to, line } as ReplyHandleEntry]);
}

/** 处理一到多行。步骤见文件开头。 */
export function handleLines(
  ctx: WriteContext,
  projectId: string,
  submissionId: number,
  entries: readonly ReplyHandleEntry[],
): Result<HandledLines, Failure> {
  const repeated = duplicateIssues(entries);
  if (repeated !== undefined) return repeated;
  return writeTx<HandledLines, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const found = linesOfSubmission(w.tx, projectId, submissionId);
    if (!found.ok) return found;
    const page = pageOfSubmission(w.tx, submissionId);
    const rows = lineRows(w.tx, submissionId);
    const issues = new Issues();

    // 行号要在这份回复里，还没有去处。
    const targets = entries.flatMap((entry, i) => {
      const row = rows.get(entry.line);
      const params = { line: entry.line };
      if (row === undefined) {
        issues.add("NOT_FOUND", issue(repliesCopy.handle.lineUnknown, `[${i}].line`, params));
        return [];
      }
      if (row.destination !== null) {
        const to = destination.label(row.destination);
        issues.add("CONFLICT", issue(repliesCopy.handle.handled, `[${i}].line`, { ...params, to }));
        return [];
      }
      return [{ entry, row, where: `[${i}]` }];
    });

    // 带图的行要确认读过图。按输入的顺序查，报错的位置就是输入里的第几项。
    const subjects: HandledLine[] = entries.map((entry) => {
      const row = rows.get(entry.line);
      return {
        line: entry.line,
        images: row?.images.length ?? 0,
        imagesRead: row?.imagesRead === true || entry.imagesRead === true,
      };
    });
    for (const blocked of runRules(handleRuleList, subjects, {}).block) {
      issues.add("RULE_BLOCKED", blocked);
    }

    const scope = new HandleScope(w, projectId, page);
    for (const target of targets) scope.handle(target, issues);
    const failed = issues.failure();
    if (failed !== undefined) return failed;

    const handled = linesOfSubmission(w.tx, projectId, submissionId);
    // 回复在这个事务里刚找到过。
    if (!handled.ok) throw new Error(handled.error.message);
    const byLine = new Map(handled.value.map((line) => [line.line, line]));
    const remaining = handled.value.filter((line) => line.handled === undefined);
    return ok({
      submission: submissionId,
      round: formatRoundLabel(page.round),
      lines: targets.flatMap(({ row }) => {
        const line = byLine.get(row.line);
        return line === undefined ? [] : [line];
      }),
      decisions: scope.decisions,
      queued: scope.queued,
      restored: scope.restored,
      restaged: scope.restaged,
      remaining: remaining.map((line) => line.line),
      warnings: scope.warnings,
      next: roundNext(w.tx, projectId, page.round, mainlineStatus(w.tx, projectId)),
    });
  });
}

// ── 问题 ──

/** 一条问题：两句文案里填上参数，写明位置。拦截另写规矩的编号。 */
function issue<M extends string, H extends string>(
  entry: { readonly message: CopyEntry<M>; readonly hint: CopyEntry<H> },
  where: string,
  params: Params<M> & Params<H>,
  rule?: string,
): Issue {
  return {
    ...(rule === undefined ? {} : { rule }),
    message: renderCopy<string>(entry.message, params),
    hint: renderCopy<string>(entry.hint, params),
    where,
  };
}

/** 四类问题按先后排：找不到、冲突、请求不对、拦截。只报最先的一类。 */
const codeOrder = ["NOT_FOUND", "CONFLICT", "BAD_REQUEST", "RULE_BLOCKED"] as const;
type IssueCode = (typeof codeOrder)[number];

/** 按错误码收集问题。 */
class Issues {
  readonly #byCode = new Map<IssueCode, Issue[]>();

  add(code: IssueCode, found: Issue): void {
    const list = this.#byCode.get(code) ?? [];
    list.push(found);
    this.#byCode.set(code, list);
  }

  /** 一个用例的失败，把其中的问题照原来的错误码收下。 */
  addFailure(error: ErrorBody<ErrorCode>): void {
    const code = codeOrder.find((c) => c === error.code);
    // 放进队列、建决定、改状态只会返回这四类。
    if (code === undefined) throw new Error(`没有想到的错误码：${error.code}`);
    const issues = error.issues ?? [
      {
        ...(error.rule === undefined ? {} : { rule: error.rule }),
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
        ...(error.where === undefined ? {} : { where: error.where }),
      },
    ];
    for (const found of issues) this.add(code, found);
  }

  failure(): Result<never, Failure> | undefined {
    for (const code of codeOrder) {
      const [first, ...rest] = this.#byCode.get(code) ?? [];
      if (first !== undefined) return err(errorBody(code, [first, ...rest]));
    }
    return undefined;
  }
}

/** 同一行在输入里出现不止一次。只看输入，在事务外面查。 */
function duplicateIssues(entries: readonly ReplyHandleEntry[]): Result<never, Failure> | undefined {
  const seen = new Set<number>();
  const reported = new Set<number>();
  const issues: Issue[] = [];
  entries.forEach((entry, i) => {
    if (seen.has(entry.line) && !reported.has(entry.line)) {
      reported.add(entry.line);
      issues.push(issue(repliesCopy.handle.duplicate, `[${i}].line`, { line: entry.line }));
    }
    seen.add(entry.line);
  });
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody("BAD_REQUEST", [first, ...rest]));
}

// ── 读 ──

/** 回复的那一页，带上它所在的轮次。 */
type ReplyPage = PageRow & { readonly round: typeof rounds.$inferSelect };

function pageOfSubmission(db: Reader, submissionId: number): ReplyPage {
  const row = db
    .select({ page: pages, round: rounds })
    .from(submissions)
    .innerJoin(pages, eq(pages.id, submissions.pageId))
    .innerJoin(rounds, eq(rounds.id, pages.roundId))
    .where(eq(submissions.id, submissionId))
    .get();
  // 回复挂在存在的页面上，页面挂在存在的轮次上，由外键保证。
  if (row === undefined) throw new Error(`回复 ${submissionId} 的页面不存在，数据不一致。`);
  return { ...row.page, round: row.round };
}

/** 这份回复的每一行，按行号记。 */
function lineRows(db: Reader, submissionId: number): ReadonlyMap<number, LineRow> {
  const rows = db.select().from(replyLines).where(eq(replyLines.submissionId, submissionId)).all();
  return new Map(rows.map((row) => [row.line, row]));
}

// ── 逐行处理 ──

type Target = { readonly entry: ReplyHandleEntry; readonly row: LineRow; readonly where: string };

/** 一行定下的去处要写进行里的几列。 */
type Columns = Partial<
  Pick<LineRow, "toQueue" | "toDecision" | "toRevision" | "toPart" | "toRoundId" | "handledNote">
>;

/** 还没做完的三种状态。去处是队列、指向它们的，直接指过去。 */
const liveStatuses: readonly QueueStatus[] = ["todo", "doing", "waiting"];

/** 在一个写事务里逐行处理，记下建出的东西和警告。 */
class HandleScope {
  readonly decisions: Decision[] = [];
  readonly queued: QueueItem[] = [];
  readonly restored: QueueItem[] = [];
  readonly restaged: QueueItem[] = [];
  readonly warnings: Issue[] = [];
  private readonly w: WriteScope;
  private readonly projectId: string;
  private readonly page: ReplyPage;

  constructor(w: WriteScope, projectId: string, page: ReplyPage) {
    this.w = w;
    this.projectId = projectId;
    this.page = page;
  }

  handle(target: Target, issues: Issues): void {
    const columns = this.columnsOf(target, issues);
    if (columns === undefined) return;
    const { entry, row } = target;
    this.w.tx
      .update(replyLines)
      .set({
        destination: entry.to,
        ...columns,
        imagesRead: row.imagesRead || entry.imagesRead === true,
        handledAt: this.w.now,
        handledBy: this.w.actor.client,
      })
      .where(and(eq(replyLines.submissionId, row.submissionId), eq(replyLines.line, row.line)))
      .run();
    appendEvent(this.w, {
      projectId: this.projectId,
      kind: "line.handled",
      objectType: "replyLine",
      objectId: `${row.submissionId}:${row.line}`,
      detail: {
        submission: row.submissionId,
        line: row.line,
        to: entry.to,
        queue: columns.toQueue == null ? undefined : formatQueueId(columns.toQueue),
        decision: columns.toDecision ?? undefined,
        revision: columns.toRevision ?? undefined,
        part: columns.toPart ?? undefined,
        round: columns.toRoundId == null ? undefined : formatRoundLabel(this.page.round),
        note: columns.handledNote ?? undefined,
        by: this.w.actor.client,
      },
    });
  }

  /** 按去处做好要做的事，返回要写进行里的几列。不通过时记下问题，返回 undefined。 */
  private columnsOf(target: Target, issues: Issues): Columns | undefined {
    const { entry, row, where } = target;
    const fromLine: ReplyLineRef = { submission: row.submissionId, line: row.line };
    switch (entry.to) {
      case "mainline": {
        const part = this.required(entry.part, row, `${where}.part`, replyCopy.field.part, issues);
        const revision = this.newerRevision(entry.revision, row, `${where}.revision`, issues);
        if (part === undefined || revision === undefined) return undefined;
        return { toRevision: revision, toPart: part };
      }
      case "decision": {
        const created = createDecision(this.w, this.projectId, { ...entry, fromLine });
        if (!created.ok) {
          issues.addFailure(withWhere(created.error, where));
          return undefined;
        }
        this.decisions.push(created.value);
        return { toDecision: created.value.id };
      }
      case "queue":
        return entry.item === undefined
          ? this.existingItem(entry.id, entry.stage, target, issues)
          : this.newItem(entry.item, fromLine, where, issues);
      case "doneHere": {
        const field = queueCopy.field.evidence;
        const note = this.required(entry.evidence, row, `${where}.evidence`, field, issues);
        return note === undefined ? undefined : { toRoundId: this.page.roundId, handledNote: note };
      }
      case "noAction": {
        const field = replyCopy.field.reason;
        const note = this.required(entry.reason, row, `${where}.reason`, field, issues);
        return note === undefined ? undefined : { handledNote: note };
      }
    }
  }

  /** 必填的文字去掉首尾的空白。只写了空白时记一条请求不对。 */
  private required(
    value: string,
    row: LineRow,
    where: string,
    field: CopyEntry,
    issues: Issues,
  ): string | undefined {
    const text = value.trim();
    if (text !== "") return text;
    const params = { line: row.line, field: renderCopy(field) };
    issues.add("BAD_REQUEST", issue(repliesCopy.handle.blank, where, params));
    return undefined;
  }

  /**
   * 去处是主线时的版本：不写就是最新的一版。要比给出那一页时最新的一版新。
   * 写了不存在的版本是找不到。还没有主线、版本不够新，都由 reply.mainline.newer 拦截。
   */
  private newerRevision(
    wanted: number | undefined,
    row: LineRow,
    where: string,
    issues: Issues,
  ): number | undefined {
    const { tx } = this.w;
    const inProject = eq(mainlineRevisions.projectId, this.projectId);
    const latest = tx
      .select({ revision: mainlineRevisions.revision })
      .from(mainlineRevisions)
      .where(inProject)
      .orderBy(desc(mainlineRevisions.revision))
      .get()?.revision;
    const rule = handleRules.mainlineNewer;
    if (latest === undefined) {
      issues.add(
        "RULE_BLOCKED",
        issue(repliesCopy.handle.mainlineMissing, where, { line: row.line }, rule),
      );
      return undefined;
    }
    const revision = wanted ?? latest;
    if (revision > latest) {
      issues.add("NOT_FOUND", issue(repliesCopy.handle.revisionUnknown, where, { revision }));
      return undefined;
    }
    const base =
      tx
        .select({ revision: mainlineRevisions.revision })
        .from(mainlineRevisions)
        .where(and(inProject, lte(mainlineRevisions.createdAt, this.page.presentedAt)))
        .orderBy(desc(mainlineRevisions.revision))
        .get()?.revision ?? 0;
    if (revision > base) return revision;
    issues.add(
      "RULE_BLOCKED",
      issue(repliesCopy.handle.mainlineOld, where, { line: row.line }, rule),
    );
    return undefined;
  }

  /** 放进一件新的事，来自这一行。按项目主线的写作规范做写作校验。 */
  private newItem(
    item: NonNullable<Extract<ReplyHandleEntry, { to: "queue" }>["item"]>,
    fromLine: ReplyLineRef,
    where: string,
    issues: Issues,
  ): Columns | undefined {
    const writing = { project: projectWritingSpec(this.w.tx, this.projectId) };
    const listed = this.itemsOnCard(fromLine);
    const put = putQueueItem(this.w, this.projectId, item, { writing, fromLine });
    if (!put.ok) {
      issues.addFailure(withWhere(put.error, `${where}.item`));
      return undefined;
    }
    this.queued.push(put.value.item);
    this.warnings.push(...put.value.warnings);
    const [first] = listed;
    if (first !== undefined) {
      const params = { line: fromLine.line, ids: listed.join("、"), added: put.value.item.id };
      const text = repliesCopy.handle.cardHasItems;
      this.warnings.push({
        message: renderCopy(text.message, params),
        hint: renderCopy(text.hint, { first, line: fromLine.line }),
        where: `${where}.item`,
      });
    }
    return { toQueue: numberOf(put.value.item.id) };
  }

  /** 这一行所在的卡上列着的、还没做完的事，写成 Q12 的样子。想法框里的行没有卡。 */
  private itemsOnCard(fromLine: ReplyLineRef): string[] {
    const line = this.w.tx
      .select({ section: replyLines.section, card: replyLines.card })
      .from(replyLines)
      .where(
        and(eq(replyLines.submissionId, fromLine.submission), eq(replyLines.line, fromLine.line)),
      )
      .get();
    const section = line?.section;
    if (section == null || section === "queue" || section === "droppedAtStart") return [];
    if (line?.card == null) return [];
    const card = this.w.tx
      .select({ queue: cards.queue })
      .from(cards)
      .where(
        and(
          eq(cards.pageId, this.page.id),
          eq(cards.section, section),
          eq(cards.cardId, line.card),
        ),
      )
      .get();
    if (card === undefined || card.queue.length === 0) return [];
    const live = this.w.tx
      .select({ number: queueItems.number })
      .from(queueItems)
      .where(
        and(
          eq(queueItems.projectId, this.projectId),
          inArray(queueItems.number, [...card.queue]),
          inArray(queueItems.status, [...liveStatuses]),
        ),
      )
      .orderBy(asc(queueItems.number))
      .all();
    return live.map((row) => formatQueueId(row.number));
  }

  /**
   * 指向已有的一件。还没做完的直接指过去，写了阶段的同时改标要做它的阶段。
   * 已取消和已完成的要捞回待办，由状态图判断：
   * 只有这一页所在的一轮开始时取消的，并且这一行来自「这一轮开始时取消的事」或点名了它，才能捞回。
   */
  private existingItem(
    id: string | undefined,
    stageKey: Stage | undefined,
    target: Target,
    issues: Issues,
  ): Columns | undefined {
    const { row, where } = target;
    const parsed = parseQueueId(id ?? "");
    if (!parsed.ok) {
      const params = { line: row.line, id: id ?? "" };
      issues.add("BAD_REQUEST", issue(repliesCopy.handle.queueId, `${where}.id`, params));
      return undefined;
    }
    const number = parsed.value;
    const item = this.w.tx
      .select({ id: queueItems.id, status: queueItems.status })
      .from(queueItems)
      .where(and(eq(queueItems.projectId, this.projectId), eq(queueItems.number, number)))
      .get();
    if (item === undefined) {
      const params = { line: row.line, id: formatQueueId(number) };
      issues.add("NOT_FOUND", issue(repliesCopy.handle.queueUnknown, `${where}.id`, params));
      return undefined;
    }
    if (liveStatuses.includes(item.status)) {
      if (stageKey === undefined) return { toQueue: number };
      const moved = restageQueueItem(this.w, this.projectId, number, stageKey, {
        roundId: this.page.roundId,
      });
      if (!moved.ok) {
        issues.addFailure(withWhere(moved.error, `${where}.stage`));
        return undefined;
      }
      if (moved.value !== null) this.restaged.push(moved.value);
      return { toQueue: number };
    }
    const note = renderCopy(repliesCopy.handle.restoreNote);
    const context = {
      droppedAtRoundStart: this.droppedAtStart(item.id),
      namedInReply: row.section === "droppedAtStart" || row.queue === number,
    };
    const moved = moveQueueItem(
      this.w,
      this.projectId,
      number,
      { to: "todo", note },
      { context, stage: stageKey },
    );
    if (!moved.ok) {
      issues.addFailure(withWhere(moved.error, `${where}.id`));
      return undefined;
    }
    this.restored.push(moved.value);
    return { toQueue: number };
  }

  /**
   * 这件事是这一页所在的一轮开始时取消的：这一轮拿出了它，它现在是已取消。
   * 和页面上「这一轮开始时取消的事」的认法相同，见 pages/fill.ts 的 droppedAtStartOf。
   */
  private droppedAtStart(itemId: number): boolean {
    const row = this.w.tx
      .select({ id: roundItems.queueItemId })
      .from(roundItems)
      .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
      .where(
        and(
          eq(roundItems.roundId, this.page.roundId),
          eq(roundItems.queueItemId, itemId),
          eq(queueItems.status, "dropped"),
        ),
      )
      .get();
    return row !== undefined;
  }
}

/** 队列事项的编号 Q12 换成 12。编号由队列的用例生成，一定写得对。 */
function numberOf(id: string): number {
  const parsed = parseQueueId(id);
  if (!parsed.ok) throw new Error(`队列事项的编号写错了：${id}`);
  return parsed.value;
}

/** 用例报的问题没写位置时，写上是输入的哪一项。写了的前面加上这一项。 */
function withWhere<C extends ErrorCode>(error: ErrorBody<C>, where: string): ErrorBody<C> {
  const place = (at: string | undefined) =>
    at === undefined || at === "" ? where : `${where}.${at}`;
  return {
    ...error,
    where: place(error.where),
    ...(error.issues === undefined
      ? {}
      : { issues: error.issues.map((found) => ({ ...found, where: place(found.where) })) }),
  } as ErrorBody<C>;
}
