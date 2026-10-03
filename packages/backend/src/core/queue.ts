import {
  type CopyEntry,
  canTransition,
  checkQueueContentLength,
  checkWriting,
  type Err,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  formatQueueId,
  formatRoundLabel,
  type Issue,
  ok,
  parseCopy,
  parseQueueId,
  type QueueEvent,
  type QueueItem,
  type QueueItemCreate,
  type QueueItemUpdate,
  type QueueStatus,
  type QueueTransitionContext,
  queueCopy,
  queueStatus,
  queueTransitions,
  type ReplyLineRef,
  type Result,
  renderCopy,
  type Stage,
  stage as stageNames,
  textFieldCopy,
  type WritingOptions,
} from "@product-loop/model";
import { and, asc, count, desc, eq, inArray, max, ne } from "drizzle-orm";
import { queueItemsCopy } from "../copy/queue.ts";
import { cards, pages, queueEvents, queueItems, rounds } from "../store/schema/index.ts";
import type { JsonObject } from "../store/schema/json.ts";
import { appendEvent } from "./events.ts";
import { fail, findProject, iso, type Reader, requireWritable } from "./projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

// 队列的用例：放进、修改、改状态、列出、查看。另有开始一轮时拿出、收尾时退回的两个函数。
// 字段和状态图见「03 数据模型」第二节，接口见「05 接口」第四节，命令见「04 命令行」第二节。
// 接口的路径按约定第 4 条挂在 /projects/:pid 下面。
// 队列的文字在放进和修改时做写作校验，给出信息时不再校验，见「07 校验」第五节第 2 条。
// 旧 queue.py 的查法保留两条：分号挤进内容，和还没做完的事里内容重复。
// 编号在项目内从 Q1 起连续编。事项不删，所以编号不会空出来。
// 每次改动记一条事件，种类按改法分：queue.added、queue.edited、queue.moved。
// 事件流按前缀把它们归到 queue.changed，见「05 接口」第五节和约定 0002 第 9 条。
// 状态的每次变化另记一条队列变动。

/** 队列用例自己的规矩编号。写作校验的编号见 model 的 writingRules。 */
export const queueRules = {
  /** 状态只能按状态图变化，见「03 数据模型」第二节。 */
  statusGraph: "queue.status.graph",
  /** 取消要写原因，见「07 校验」第四节。 */
  dropReason: "queue.drop.reason",
  /** 几件并列的事不用分号挤进内容，照旧 queue.py。 */
  contentSemicolons: "queue.content.semicolons",
  /** 还没做完的事里不放内容相同的第二件，照旧 queue.py。 */
  contentDuplicate: "queue.content.duplicate",
} as const;

/** 还没做完的三种状态。看板上摆的、状态里算件数的都是它们。 */
const liveStatuses: readonly QueueStatus[] = ["todo", "doing", "waiting"];

type ItemRow = typeof queueItems.$inferSelect;
type EventRow = typeof queueEvents.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

/** 放进和修改的结果：事项，和写作校验的警告。接口层把警告放进响应外壳的 warnings。 */
export type QueueWrite = { readonly item: QueueItem; readonly warnings: readonly Issue[] };

/** 一件事的全部字段和状态变化，接口 GET /projects/:pid/queue/:qid 用。 */
/** 一件事出现在哪一页的哪张卡上。 */
type QueueAppearance = {
  readonly round: string;
  readonly page: number;
  readonly card: string;
  readonly title: string;
};

export type QueueDetail = {
  readonly item: QueueItem;
  readonly events: readonly QueueEvent[];
  /** 出现在哪几轮的哪几张卡上，按给出的先后。队列看板的展示卡片用。 */
  readonly appearances: readonly QueueAppearance[];
};

// ── 读 ──

/** 列出时的筛选。不写或写空的就不按它筛。 */
export type QueueFilter = {
  readonly stages?: readonly Stage[] | undefined;
  readonly statuses?: readonly QueueStatus[] | undefined;
};

/** 队列事项，按编号排，也就是放进队列的先后，见「06 工作台」第五节。 */
export function listQueueItems(
  db: Reader,
  projectId: string,
  filter: QueueFilter = {},
): Result<QueueItem[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const { stages = [], statuses = [] } = filter;
  const rows = db
    .select()
    .from(queueItems)
    .where(
      and(
        eq(queueItems.projectId, projectId),
        stages.length === 0 ? undefined : inArray(queueItems.stage, stages),
        statuses.length === 0 ? undefined : inArray(queueItems.status, statuses),
      ),
    )
    .orderBy(asc(queueItems.number))
    .all();
  const labels = roundLabels(
    db,
    rows.map((row) => row.proposedInRoundId),
  );
  return ok(rows.map((row) => toItemView(row, labels)));
}

/** 一件事的全部字段和状态变化，变化按先后排。 */
export function getQueueItem(
  db: Reader,
  projectId: string,
  qid: string,
): Result<QueueDetail, ErrorBody<"BAD_REQUEST" | "NOT_FOUND">> {
  const number = parseQid(qid);
  if (!number.ok) return number;
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = findItem(db, projectId, number.value);
  if (!row.ok) return row;
  const history = db
    .select()
    .from(queueEvents)
    .where(eq(queueEvents.itemId, row.value.id))
    .orderBy(asc(queueEvents.id))
    .all();
  const labels = roundLabels(db, [
    row.value.proposedInRoundId,
    ...history.map((event) => event.roundId),
  ]);
  return ok({
    item: toItemView(row.value, labels),
    events: history.map((event) => toEventView(row.value.number, event, labels)),
    appearances: appearancesOf(db, projectId, row.value.number),
  });
}

/** 引用了这件事的卡片，按页面给出的先后和卡片在页面上的顺序。 */
function appearancesOf(db: Reader, projectId: string, number: number): QueueAppearance[] {
  const rows = db
    .select({
      page: pages.id,
      roundId: pages.roundId,
      card: cards.cardId,
      title: cards.title,
      queue: cards.queue,
    })
    .from(cards)
    .innerJoin(pages, eq(pages.id, cards.pageId))
    .where(eq(pages.projectId, projectId))
    .orderBy(asc(pages.id), asc(cards.position))
    .all()
    .filter((row) => row.queue.includes(number));
  const labels = roundLabels(
    db,
    rows.map((row) => row.roundId),
  );
  return rows.map((row) => ({
    round: labels.get(row.roundId) ?? "",
    page: row.page,
    card: row.card,
    title: row.title,
  }));
}

/** 每个阶段还没做完的件数：待办、进行中、等待的合计。状态用它，见 status.ts。 */
export function queueCounts(db: Reader, projectId: string): Partial<Record<Stage, number>> {
  const rows = db
    .select({ stage: queueItems.stage, n: count() })
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), inArray(queueItems.status, liveStatuses)))
    .groupBy(queueItems.stage)
    .all();
  const counts: Partial<Record<Stage, number>> = {};
  for (const row of rows) counts[row.stage] = row.n;
  return counts;
}

/** 停了几天算停得久，见「06 工作台」第五节。 */
const staleDays = 7;
const dayMs = 24 * 60 * 60 * 1000;

/** 停得久：待办或等待，最近一次变动在七天以前。进行中的不算。 */
export function isStale(status: QueueStatus, lastMove: Date, now: Date): boolean {
  return status !== "doing" && now.getTime() - lastMove.getTime() >= staleDays * dayMs;
}

/** 每件事最近一次变动的时间，按编号记。 */
export function lastMoved(db: Reader, projectId: string): ReadonlyMap<string, Date> {
  const rows = db
    .select({ number: queueItems.number, at: max(queueEvents.at) })
    .from(queueEvents)
    .innerJoin(queueItems, eq(queueItems.id, queueEvents.itemId))
    .where(eq(queueItems.projectId, projectId))
    .groupBy(queueItems.number)
    .all();
  const moved = new Map<string, Date>();
  for (const row of rows) if (row.at !== null) moved.set(formatQueueId(row.number), row.at);
  return moved;
}

/** 每个阶段还没做完的事里停得久的件数。所有项目的看板用，和队列看板的淡色小卡同一个算法。 */
export function staleCounts(
  db: Reader,
  projectId: string,
  now: Date,
): Partial<Record<Stage, number>> {
  const rows = db
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), inArray(queueItems.status, liveStatuses)))
    .all();
  const moved = lastMoved(db, projectId);
  const counts: Partial<Record<Stage, number>> = {};
  for (const row of rows) {
    const last = moved.get(formatQueueId(row.number)) ?? row.createdAt;
    if (isStale(row.status, last, now)) counts[row.stage] = (counts[row.stage] ?? 0) + 1;
  }
  return counts;
}

// ── 放进一件 ──

export type QueueAddOptions = {
  /** 项目主线「写作规范」一节写的一层。不写时只用 skill 自带的一层。 */
  readonly writing?: WritingOptions | undefined;
  /** 来自哪一行回复。处理回复时写。 */
  readonly fromLine?: ReplyLineRef | undefined;
};

/**
 * 放进一件事：`ploop queue add`，接口是 POST /projects/:pid/queue。
 * 编号在同一个事务里取项目已有的最大编号加一。写作校验有拦截时返回全部拦截，什么都不写。
 */
export function addQueueItem(
  ctx: WriteContext,
  projectId: string,
  input: QueueItemCreate,
  writing?: WritingOptions,
): Result<QueueWrite, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  type Failure = ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<QueueWrite, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    return putQueueItem(w, projectId, input, { writing });
  });
}

/**
 * 在调用者的写事务里放进一件事，状态是待办。处理回复时去处是队列的行，用它放新的一件。
 * 提出时的轮次取项目现在开着的一轮。调用的用例先确认项目能改数据，见 requireWritable。
 */
export function putQueueItem(
  w: WriteScope,
  projectId: string,
  input: QueueItemCreate,
  options: QueueAddOptions = {},
): Result<QueueWrite, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED">> {
  const texts = new Texts();
  const content = texts.required(input.content, "content", queueCopy.field.content);
  const subItems = (input.subItems ?? []).map((text, i) =>
    texts.required(text, `subItems[${i}]`, queueCopy.field.subItem),
  );
  const acceptance = texts.optional(input.acceptance, "acceptance", queueCopy.field.acceptance);
  const dependsOn = texts.optional(input.dependsOn, "dependsOn", queueCopy.field.dependsOn);
  const source = texts.optional(input.source, "source", queueCopy.field.source);
  const note = texts.optional(input.note, "itemNote", queueCopy.field.itemNote);
  const blank = texts.failure();
  if (blank !== undefined) return blank;

  const findings = new Findings(options.writing);
  findings.check(content, "content");
  findings.blockAll(checkQueueContentLength(content));
  findings.checkEach(subItems, "subItems");
  findings.check(acceptance, "acceptance");
  findings.check(dependsOn, "dependsOn");
  findings.block(semicolonIssue(content, subItems, "todo"));
  findings.block(duplicateIssue(w.tx, projectId, content));
  const blocked = findings.failure();
  if (blocked !== undefined) return blocked;

  const number = nextNumber(w.tx, projectId);
  const round = openRound(w.tx, projectId);
  const row = w.tx
    .insert(queueItems)
    .values({
      projectId,
      number,
      content,
      stage: input.stage,
      proposer: input.proposer,
      proposedInRoundId: round?.id ?? null,
      createdAt: w.now,
      status: "todo",
      statusNote: null,
      dependsOn: dependsOn ?? null,
      acceptance: acceptance ?? null,
      evidence: null,
      subItems,
      source: source ?? null,
      note: note ?? null,
      fromSubmissionId: options.fromLine?.submission ?? null,
      fromLine: options.fromLine?.line ?? null,
      editCount: 0,
    })
    .returning()
    .get();
  recordMove(w, row, { from: null, to: "todo", note: null, round: round ?? null });
  const detail = { content, stage: input.stage, proposer: input.proposer };
  changed(w, row, "added", {
    ...detail,
    note: note ?? undefined,
    proposedIn: labelOrUndefined(round),
  });
  return ok({
    item: toItemView(row, roundLabels(w.tx, [round?.id ?? null])),
    warnings: findings.warnings,
  });
}

// ── 修改 ──

/**
 * 改一件事的内容、验收标准、子项、来源或备注：`ploop queue edit`。
 * 接口是 PATCH /projects/:pid/queue/:qid。
 * ifMatch 是请求里 If-Match 写的修改计数，对不上返回 CONFLICT。
 * 改了的字段重新做写作校验。确有改动时修改计数加一，记一条事件。和原来一样就什么都不写。
 */
export function editQueueItem(
  ctx: WriteContext,
  projectId: string,
  qid: string,
  ifMatch: number,
  patch: QueueItemUpdate,
  writing?: WritingOptions,
): Result<
  QueueWrite,
  ErrorBody<"BAD_REQUEST" | "CONFLICT" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">
> {
  const number = parseQid(qid);
  if (!number.ok) return number;
  const cleaned = cleanPatch(patch);
  if (!cleaned.ok) return cleaned;
  const next = cleaned.value;
  type Failure = ErrorBody<
    "BAD_REQUEST" | "CONFLICT" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR"
  >;
  return writeTx<QueueWrite, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const found = findItem(w.tx, projectId, number.value);
    if (!found.ok) return found;
    const row = found.value;
    if (row.editCount !== ifMatch) {
      const text = queueItemsCopy.editConflict;
      const id = formatQueueId(row.number);
      return fail("CONFLICT", {
        message: renderCopy(text.message, { id, current: row.editCount, expected: ifMatch }),
        hint: renderCopy(text.hint, { id }),
        where: id,
      });
    }

    const findings = new Findings(writing);
    findings.check(next.content, "content");
    if (next.content !== undefined) findings.blockAll(checkQueueContentLength(next.content));
    findings.checkEach(next.subItems, "subItems");
    findings.check(next.acceptance ?? undefined, "acceptance");
    const content = next.content ?? row.content;
    if (next.content !== undefined || next.subItems !== undefined) {
      findings.block(semicolonIssue(content, next.subItems ?? row.subItems, row.status));
    }
    if (next.content !== undefined && next.content !== row.content && isLive(row.status)) {
      findings.block(duplicateIssue(w.tx, projectId, content, row.number));
    }
    const blocked = findings.failure();
    if (blocked !== undefined) return blocked;

    const state = textEdits(row, next);
    if (!state.ok) return state;
    const changes = {
      ...(next.content === undefined || next.content === row.content
        ? {}
        : { content: next.content }),
      ...(next.stage === undefined || next.stage === row.stage ? {} : { stage: next.stage }),
      ...(next.acceptance === undefined || next.acceptance === row.acceptance
        ? {}
        : { acceptance: next.acceptance }),
      ...(next.subItems === undefined || sameList(next.subItems, row.subItems)
        ? {}
        : { subItems: next.subItems }),
      ...(next.source === undefined || next.source === row.source ? {} : { source: next.source }),
      ...(next.note === undefined || next.note === row.note ? {} : { note: next.note }),
      ...state.value,
    };
    const labels = roundLabels(w.tx, [row.proposedInRoundId]);
    if (Object.keys(changes).length === 0) {
      return ok({ item: toItemView(row, labels), warnings: findings.warnings });
    }
    const editCount = row.editCount + 1;
    const updated = w.tx
      .update(queueItems)
      .set({ ...changes, editCount })
      .where(eq(queueItems.id, row.id))
      .returning()
      .get();
    // 状态说明或证据改了字，最近一次改状态的那条队列变动写的是同一句话，跟着改。
    if (changes.statusNote !== undefined && row.statusNote !== null) {
      rewriteLastMoveNote(w, row, changes.statusNote);
    } else if (changes.dependsOn !== undefined && row.dependsOn !== null) {
      // 迁移来的等待没有状态说明，改成等待的那条变动写的是依赖，写的是同一句话才跟着改。
      rewriteLastMoveNote(w, row, changes.dependsOn, row.dependsOn);
    }
    changed(w, updated, "edited", { ...changes, editCount });
    return ok({ item: toItemView(updated, labels), warnings: findings.warnings });
  });
}

/** 修改时交来的几项，文字去掉首尾的空白。null 表示删掉那一项。备注不做写作校验，和来源一样。 */
type CleanPatch = {
  readonly content?: string | undefined;
  readonly stage?: Stage | undefined;
  readonly acceptance?: string | null | undefined;
  readonly subItems?: readonly string[] | undefined;
  readonly source?: string | null | undefined;
  readonly note?: string | null | undefined;
  readonly statusNote?: string | undefined;
  readonly evidence?: string | undefined;
  readonly dependsOn?: string | undefined;
};

function cleanPatch(patch: QueueItemUpdate): Result<CleanPatch, ErrorBody<"BAD_REQUEST">> {
  const provided = Object.values(patch).some((value) => value !== undefined);
  if (!provided) {
    return fail("BAD_REQUEST", {
      message: renderCopy(queueCopy.update.empty),
      hint: renderCopy(queueItemsCopy.emptyPatch.hint),
    });
  }
  const texts = new Texts();
  const nullable = (value: string | null | undefined, where: string, field: CopyEntry) =>
    value === null ? null : texts.optional(value, where, field);
  const cleaned: CleanPatch = {
    content: texts.optional(patch.content, "content", queueCopy.field.content),
    acceptance: nullable(patch.acceptance, "acceptance", queueCopy.field.acceptance),
    subItems: patch.subItems?.map((text, i) =>
      texts.required(text, `subItems[${i}]`, queueCopy.field.subItem),
    ),
    source: nullable(patch.source, "source", queueCopy.field.source),
    note: nullable(patch.note, "itemNote", queueCopy.field.itemNote),
    stage: patch.stage,
    statusNote: texts.optional(patch.statusNote, "statusNote", queueCopy.field.statusNote),
    evidence: texts.optional(patch.evidence, "evidence", queueCopy.field.evidence),
    dependsOn: texts.optional(patch.dependsOn, "dependsOn", queueCopy.field.dependsOn),
  };
  return texts.failure() ?? ok(cleaned);
}

/** 改状态说明、证据、依赖、阶段时算出要写进去的几列。不合状态的返回 BAD_REQUEST，写明怎么办。 */
type TextEdits = {
  readonly statusNote?: string;
  readonly evidence?: string;
  readonly dependsOn?: string;
};

/**
 * 状态说明和证据只改文字，不改状态。已完成的事，证据和状态说明是同一句话，
 * 已等待的事，依赖和状态说明是同一句话，改一处两处一起改，免得读出两个说法。
 * 阶段只在待办和等待时改：进行中的事收尾时用 --return 改，已完成的不改，已取消的先改回待办。
 */
function textEdits(row: ItemRow, next: CleanPatch): Result<TextEdits, ErrorBody<"BAD_REQUEST">> {
  const id = formatQueueId(row.number);
  const status = queueStatus.label(row.status);
  const text = queueItemsCopy.edit;
  if (next.stage !== undefined && next.stage !== row.stage) {
    if (row.status === "doing") {
      return fail("BAD_REQUEST", {
        message: renderCopy(text.stageDoing.message, { id }),
        hint: renderCopy(text.stageDoing.hint, { id, stage: stageNames.label(next.stage) }),
        where: "stage",
      });
    }
    if (row.status === "done" || row.status === "dropped") {
      const hint = row.status === "dropped" ? text.stageEnded.dropped : text.stageEnded.done;
      return fail("BAD_REQUEST", {
        message: renderCopy(text.stageEnded.message, { id, status }),
        hint: renderCopy(hint, { id }),
        where: "stage",
      });
    }
  }
  const asked = (field: "statusNote" | "evidence" | "dependsOn") => next[field] !== undefined;
  if (asked("statusNote") && row.statusNote === null) {
    return fail("BAD_REQUEST", {
      message: renderCopy(text.noStatusNote.message, { id, status }),
      hint: renderCopy(text.noStatusNote.hint),
      where: "statusNote",
    });
  }
  if (asked("evidence") && row.evidence === null) {
    return fail("BAD_REQUEST", {
      message: renderCopy(text.noEvidence.message, { id, status }),
      hint: renderCopy(text.noEvidence.hint),
      where: "evidence",
    });
  }
  if (asked("dependsOn") && row.dependsOn === null) {
    return fail("BAD_REQUEST", {
      message: renderCopy(text.noDependsOn.message, { id, status }),
      hint: renderCopy(text.noDependsOn.hint),
      where: "dependsOn",
    });
  }
  const edits: { statusNote?: string; evidence?: string; dependsOn?: string } = {};
  const oldNote = row.statusNote;
  if (next.statusNote !== undefined && next.statusNote !== oldNote) {
    edits.statusNote = next.statusNote;
    if (row.evidence !== null && row.evidence === oldNote && next.evidence === undefined) {
      edits.evidence = next.statusNote;
    }
    if (row.dependsOn !== null && row.dependsOn === oldNote) edits.dependsOn = next.statusNote;
  }
  if (next.evidence !== undefined && next.evidence !== row.evidence) {
    edits.evidence = next.evidence;
    if (oldNote !== null && oldNote === row.evidence && next.statusNote === undefined) {
      edits.statusNote = next.evidence;
    }
  }
  if (next.dependsOn !== undefined && next.dependsOn !== row.dependsOn) {
    edits.dependsOn = next.dependsOn;
    if (oldNote !== null && oldNote === row.dependsOn && next.statusNote === undefined) {
      edits.statusNote = next.dependsOn;
    }
  }
  return ok(edits);
}

/** 最近一次变到现在这个状态的队列变动，说明改成新的文字。给了 only，原来写的是它才改。 */
function rewriteLastMoveNote(w: WriteScope, row: ItemRow, note: string, only?: string): void {
  const last = w.tx
    .select({ id: queueEvents.id, note: queueEvents.note })
    .from(queueEvents)
    .where(and(eq(queueEvents.itemId, row.id), eq(queueEvents.toStatus, row.status)))
    .orderBy(desc(queueEvents.id))
    .get();
  if (last === undefined || (only !== undefined && last.note !== only)) return;
  w.tx.update(queueEvents).set({ note }).where(eq(queueEvents.id, last.id)).run();
}

// ── 改状态 ──

/**
 * 改状态的请求：改成哪个状态，和这个状态要写的字。
 * 接口是 POST /projects/:pid/queue/:qid/transitions。
 * 等待写依赖，已完成写证据，已取消写原因，回到待办可以写一句说明。
 * 改成进行中只在开始一轮时拿出来，见 takeOutForRound。
 */
export type QueueChange =
  | { readonly to: "waiting"; readonly dependsOn: string }
  | { readonly to: "done"; readonly evidence: string }
  | { readonly to: "dropped"; readonly reason: string }
  | { readonly to: "todo"; readonly note?: string | undefined };

/**
 * 改一件事的状态：`ploop queue wait|done|drop`、退回待办、捞回。只能按状态图改，其余的拦截。
 * 变化记在项目现在开着的一轮上，所以在开着的一轮里取消的记在这一轮上，见「05 接口」第四节。
 * context 只在已取消回到待办时用，由开始一轮和处理回复的用例算出，不取自请求。
 */
export function transitionQueueItem(
  ctx: WriteContext,
  projectId: string,
  qid: string,
  change: QueueChange,
  context?: QueueTransitionContext,
): Result<QueueItem, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  const number = parseQid(qid);
  if (!number.ok) return number;
  type Failure = ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<QueueItem, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    return moveQueueItem(w, projectId, number.value, change, { context });
  });
}

/**
 * 改回待办：`ploop queue reopen`，接口是 POST /projects/:pid/queue/:qid/transitions 写待办。
 * 等待和已取消的事都能改回，编号不变。已经是待办的什么都不做，重复运行不算错。
 * 已取消的事不必是这个阶段开始时取消的，也不必用户点名：这是明确的要求。已完成的事不能改回。
 */
export function reopenQueueItem(
  ctx: WriteContext,
  projectId: string,
  qid: string,
  note?: string,
): Result<QueueItem, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  const number = parseQid(qid);
  if (!number.ok) return number;
  type Failure = ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<QueueItem, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const found = findItem(w.tx, projectId, number.value);
    if (!found.ok) return found;
    if (found.value.status === "todo") {
      return ok(toItemView(found.value, roundLabels(w.tx, [found.value.proposedInRoundId])));
    }
    const change = { to: "todo", note } as const;
    return moveQueueItem(w, projectId, number.value, change, { context: { reopened: true } });
  });
}

export type MoveOptions = {
  /** 这次变化记在哪一轮。不写就记在项目现在开着的一轮上，没有开着的就不记。 */
  readonly roundId?: number | undefined;
  /** 已取消回到待办时要看的几件事，见 model 的 canTransition。 */
  readonly context?: QueueTransitionContext | undefined;
  /** 改回待办的同时改标要做它的阶段。 */
  readonly stage?: Stage | undefined;
};

/**
 * 在调用者的写事务里改一件事的状态。开始一轮时的 --defer、处理回复时的取消和捞回、
 * 收尾时的做完都用它。调用的用例先确认项目能改数据，见 requireWritable。
 */
export function moveQueueItem(
  w: WriteScope,
  projectId: string,
  number: number,
  change: QueueChange,
  options: MoveOptions = {},
): Result<QueueItem, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND">> {
  const found = findItem(w.tx, projectId, number);
  if (!found.ok) return found;
  const round =
    options.roundId === undefined ? openRound(w.tx, projectId) : roundById(w.tx, options.roundId);
  return move(w, found.value, change, round, options.context, options.stage);
}

/**
 * 处理回复时选中一件已有的事：把要做它的阶段改成 to，编号不变。一个想法从提出到做完始终是同一件事。
 * 待办和等待的只改阶段。进行中的事是这一轮拿出来的，改标以后回到待办，收尾时记成退回到那个阶段。
 * 已完成和已取消的事不在这里改，由调用的用例按状态图处理。阶段没变时什么都不做，返回 null。
 */
export function restageQueueItem(
  w: WriteScope,
  projectId: string,
  number: number,
  to: Stage,
  options: { readonly roundId?: number | undefined } = {},
): Result<QueueItem | null, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND">> {
  const found = findItem(w.tx, projectId, number);
  if (!found.ok) return found;
  const row = found.value;
  if (row.stage === to) return ok(null);
  if (row.status === "doing") {
    const round =
      options.roundId === undefined ? openRound(w.tx, projectId) : roundById(w.tx, options.roundId);
    const note = renderCopy(queueItemsCopy.restage.note, { stage: stageNames.label(to) });
    return move(w, row, { to: "todo", note }, round, undefined, to);
  }
  const updated = w.tx
    .update(queueItems)
    .set({ stage: to, editCount: row.editCount + 1 })
    .where(eq(queueItems.id, row.id))
    .returning()
    .get();
  changed(w, updated, "edited", { stage: to, editCount: updated.editCount });
  return ok(toItemView(updated, roundLabels(w.tx, [updated.proposedInRoundId])));
}

// ── 开始一轮和收尾 ──

/**
 * 开始一轮时拿出事项：待办改成进行中，变动记在这一轮上，见「04 命令行」第四节的 round start。
 * 不写编号就拿出这一轮的阶段里全部待办的事。写了编号就只拿这几件，落地轮的 --take 用它。
 * 写了编号的不查阶段，别的阶段的事收不收，由开始一轮的用例决定。
 * 找不到的一次报齐，返回 NOT_FOUND。改不成进行中的一次报齐，返回拦截。
 * 调用的用例先确认项目能改数据，见 requireWritable。结果按编号排。
 */
export function takeOutForRound(
  w: WriteScope,
  roundId: number,
  numbers?: readonly number[],
): Result<QueueItem[], ErrorBody<"NOT_FOUND" | "RULE_BLOCKED">> {
  const round = roundById(w.tx, roundId);
  const { projectId } = round;
  const which =
    numbers === undefined
      ? and(eq(queueItems.stage, round.stage), eq(queueItems.status, "todo"))
      : inArray(queueItems.number, numbers);
  const rows = w.tx
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), which))
    .orderBy(asc(queueItems.number))
    .all();
  const missing = (numbers ?? []).filter((n) => !rows.some((row) => row.number === n));
  const notFound = failAll(
    "NOT_FOUND",
    missing.map((n) => notFoundIssue(projectId, n)),
  );
  if (notFound !== undefined) return notFound;
  const blocked = failAll(
    "RULE_BLOCKED",
    rows.flatMap((row) => {
      const issue = graphIssue(row, "doing");
      return issue === undefined ? [] : [issue];
    }),
  );
  if (blocked !== undefined) return blocked;
  const taken: QueueItem[] = [];
  for (const row of rows) {
    const moved = move(w, row, { to: "doing" }, round, undefined);
    // 上面已经逐件查过状态图，这里不会失败。
    if (!moved.ok) throw new Error(`拿出 ${formatQueueId(row.number)} 时状态变了。`);
    taken.push(moved.value);
  }
  return ok(taken);
}

/** 收尾时退回一件事：写明原因。要回到别的阶段时写 stage，例如定义不对，退回构思。 */
export type ReturnInput = { readonly note: string; readonly stage?: Stage | undefined };

/**
 * 收尾时把这一轮拿出的一件事退回待办，变动记在这一轮上，见「05 接口」第四节的收尾。
 * 调用的用例先确认项目能改数据，见 requireWritable。
 */
export function returnFromRound(
  w: WriteScope,
  roundId: number,
  number: number,
  back: ReturnInput,
): Result<QueueItem, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND">> {
  const round = roundById(w.tx, roundId);
  const found = findItem(w.tx, round.projectId, number);
  if (!found.ok) return found;
  const texts = new Texts();
  const note = texts.required(back.note, "note", queueCopy.field.note);
  const blank = texts.failure();
  if (blank !== undefined) return blank;
  return move(w, found.value, { to: "todo", note }, round, undefined, back.stage);
}

// ── 状态变化的实现 ──

/** 一次状态变化，加上只由开始一轮做的拿出来。 */
type Move = QueueChange | { readonly to: "doing" };

/**
 * 按状态图改一件事的状态，写好这个状态要求的字段，记一条队列变动和一条事件。
 * 状态说明写这一次变化的说明：等待写依赖，已完成写证据，已取消写原因，拿出来时清空。
 */
function move(
  w: WriteScope,
  row: ItemRow,
  change: Move,
  round: RoundRow | undefined,
  context: QueueTransitionContext | undefined,
  stage?: Stage,
): Result<QueueItem, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED">> {
  const texts = new Texts();
  const id = formatQueueId(row.number);
  let note: string | null = null;
  let fields: Partial<Pick<ItemRow, "dependsOn" | "evidence">> = {};
  const blocks: Issue[] = [];
  switch (change.to) {
    case "waiting":
      note = texts.required(change.dependsOn, "dependsOn", queueCopy.field.dependsOn, {
        message: queueCopy.item.waitingNeedsDependsOn,
        hint: queueItemsCopy.waitingDependsOn.hint,
      });
      fields = { dependsOn: note };
      break;
    case "done":
      note = texts.required(change.evidence, "evidence", queueCopy.field.evidence, {
        message: queueCopy.item.doneNeedsEvidence,
        hint: queueItemsCopy.doneEvidence.hint,
      });
      fields = { evidence: note };
      break;
    case "dropped":
      note = change.reason.trim();
      if (note === "") {
        const text = queueItemsCopy.dropReason;
        blocks.push({
          rule: queueRules.dropReason,
          message: renderCopy(text.message, { id }),
          hint: renderCopy(text.hint),
          where: fieldName("reason"),
        });
      }
      break;
    case "todo":
      note = texts.optional(change.note, "note", queueCopy.field.note) ?? null;
      break;
    case "doing":
      break;
  }
  const blank = texts.failure();
  if (blank !== undefined) return blank;
  const graph = graphIssue(row, change.to, context);
  const blocked = failAll("RULE_BLOCKED", graph === undefined ? blocks : [graph, ...blocks]);
  if (blocked !== undefined) return blocked;

  const updated = w.tx
    .update(queueItems)
    .set({
      status: change.to,
      statusNote: note,
      ...fields,
      ...(stage === undefined ? {} : { stage }),
    })
    .where(eq(queueItems.id, row.id))
    .returning()
    .get();
  recordMove(w, updated, { from: row.status, to: change.to, note, round: round ?? null });
  changed(w, updated, "moved", {
    from: row.status,
    to: change.to,
    note: note ?? undefined,
    round: labelOrUndefined(round),
    stage: stage === undefined || stage === row.stage ? undefined : stage,
  });
  return ok(toItemView(updated, roundLabels(w.tx, [updated.proposedInRoundId])));
}

/** 状态图不允许这次变化时的拦截，写明现在是什么、只能改成什么。允许时返回 undefined。 */
function graphIssue(
  row: ItemRow,
  to: QueueStatus,
  context?: QueueTransitionContext,
): Issue | undefined {
  const checked = canTransition(row.status, to, context);
  if (checked.ok) return undefined;
  const id = formatQueueId(row.number);
  const from = queueStatus.label(row.status);
  const text = queueCopy.transition[checked.error];
  const params = { id, from, to: queueStatus.label(to), allowed: allowedLabels(row.status) };
  // 待办的事不能直接做完，说明怎么走通：先由一轮拿出来。
  const route =
    row.status === "todo" && to === "done"
      ? renderCopy(queueItemsCopy.todoToDone, { id, stage: stageNames.label(row.stage) })
      : "";
  // 等待和已取消的事要再做，先改回待办：写成能直接运行的命令。
  const reopen =
    checked.error === "notInGraph" &&
    (row.status === "waiting" || row.status === "dropped") &&
    to !== "todo"
      ? renderCopy(queueItemsCopy.reopenFirst, { id })
      : undefined;
  return {
    rule: queueRules.statusGraph,
    message: renderCopy(text.message, params),
    hint: reopen ?? `${renderCopy(text.hint, params)}${route}`,
    where: id,
  };
}

/** 从这个状态能改到的几个状态，写成「进行中、等待或已取消」。 */
function allowedLabels(from: QueueStatus): string {
  const labels = queueTransitions[from].map((to) => queueStatus.label(to));
  const last = labels.pop();
  if (last === undefined) return "";
  if (labels.length === 0) return last;
  return renderCopy(queueItemsCopy.allowedList, { head: labels.join("、"), last });
}

/** 记一条队列变动。执行者取自写事务。 */
function recordMove(
  w: WriteScope,
  row: ItemRow,
  move: {
    readonly from: QueueStatus | null;
    readonly to: QueueStatus;
    readonly note: string | null;
    readonly round: RoundRow | null;
  },
): void {
  w.tx
    .insert(queueEvents)
    .values({
      itemId: row.id,
      at: w.now,
      fromStatus: move.from,
      toStatus: move.to,
      note: move.note,
      roundId: move.round?.id ?? null,
      actor: w.actor.client,
      session: w.actor.session ?? null,
    })
    .run();
}

/** 三种改法各自的事件种类：放进、修改、改状态。 */
const queueEventKinds = {
  added: "queue.added",
  edited: "queue.edited",
  moved: "queue.moved",
} as const;

/** 记一条队列的事件。change 写这次做了什么，决定事件的种类。 */
function changed(
  w: WriteScope,
  row: ItemRow,
  change: keyof typeof queueEventKinds,
  detail: JsonObject,
): void {
  appendEvent(w, {
    projectId: row.projectId,
    kind: queueEventKinds[change],
    objectType: "queueItem",
    objectId: formatQueueId(row.number),
    detail,
  });
}

// ── 两条旧 queue.py 的查法 ──

function isLive(status: QueueStatus): boolean {
  return liveStatuses.includes(status);
}

/**
 * 旧 queue.py 的查法：还没做完的事，内容里全角和半角的分号合计两个以上，又没有子项，就拦截。
 * 做完和取消的只是存档，不上看板，不查这一条。
 */
function semicolonIssue(
  content: string,
  subItems: readonly string[],
  status: QueueStatus,
): Issue | undefined {
  if (!isLive(status) || subItems.length > 0) return undefined;
  const semicolons = [...content].filter((char) => char === "；" || char === ";").length;
  if (semicolons < 2) return undefined;
  const text = queueItemsCopy.semicolons;
  return {
    rule: queueRules.contentSemicolons,
    message: renderCopy(text.message),
    hint: renderCopy(text.hint),
    where: fieldName("content"),
  };
}

/**
 * 旧 queue.py 不让同样内容的事放进两次。编号代替了按内容找，这一条只查还没做完的事：
 * 做完或取消的事要重新做，照「03 数据模型」第二节放进一件新的，内容可以相同。
 */
function duplicateIssue(
  tx: Reader,
  projectId: string,
  content: string,
  self?: number,
): Issue | undefined {
  const other = tx
    .select({ number: queueItems.number })
    .from(queueItems)
    .where(
      and(
        eq(queueItems.projectId, projectId),
        eq(queueItems.content, content),
        inArray(queueItems.status, liveStatuses),
        self === undefined ? undefined : ne(queueItems.number, self),
      ),
    )
    .orderBy(asc(queueItems.number))
    .get();
  if (other === undefined) return undefined;
  const text = queueItemsCopy.duplicate;
  const params = { other: formatQueueId(other.number) };
  return {
    rule: queueRules.contentDuplicate,
    message: renderCopy(text.message, params),
    hint: renderCopy(text.hint, params),
    where: fieldName("content"),
  };
}

// ── 去掉空白和写作校验 ──

/** 该写字的地方没写字时的报错。不写 message 就用「没有写…」。 */
type BlankCopy = { readonly message?: CopyEntry; readonly hint?: CopyEntry };

/** 交来的文字去掉首尾的空白。去掉以后是空的，记一条 BAD_REQUEST 的问题。 */
class Texts {
  readonly #issues: Issue[] = [];

  required(value: string, where: string, field: CopyEntry, copy: BlankCopy = {}): string {
    const trimmed = value.trim();
    if (trimmed === "") {
      const name = renderCopy(field);
      this.#issues.push({
        message:
          copy.message === undefined
            ? renderCopy(textFieldCopy.missing, { field: name })
            : renderCopy(copy.message),
        hint:
          copy.hint === undefined
            ? renderCopy(queueItemsCopy.blank.hint, { field: name })
            : renderCopy(copy.hint),
        where: fieldName(where),
      });
    }
    return trimmed;
  }

  optional(value: string | undefined, where: string, field: CopyEntry): string | undefined {
    return value === undefined ? undefined : this.required(value, where, field);
  }

  failure(): Err<ErrorBody<"BAD_REQUEST">> | undefined {
    return failAll("BAD_REQUEST", this.#issues);
  }
}

/** 写作校验和两条旧查法的结果：拦截的一次报齐，警告随成功的结果返回。 */
class Findings {
  readonly #writing: WritingOptions | undefined;
  readonly #blocks: Issue[] = [];
  readonly warnings: Issue[] = [];

  constructor(writing: WritingOptions | undefined) {
    this.#writing = writing;
  }

  /** 对一段文字跑写作校验。where 是字段的路径，例如 subItems[1]。 */
  check(text: string | undefined, where: string): void {
    if (text === undefined) return;
    const result = checkWriting(text, this.#writing);
    const at = fieldName(where);
    for (const { rule, message, hint } of result.block) {
      // 停用的说法自带怎么改；别的拦截补一句通用的，什么不对由报错自己说明。
      const how = hint ?? renderCopy(queueItemsCopy.writingHint);
      this.#blocks.push({ rule, message, hint: how, where: at });
    }
    for (const { rule, message, hint } of result.warn) {
      this.warnings.push({ rule, message, ...(hint === undefined ? {} : { hint }), where: at });
    }
  }

  /** 对一列文字逐条跑写作校验，位置写成 subItems[1] 这样。 */
  checkEach(texts: readonly string[] | undefined, where: string): void {
    for (const [i, text] of (texts ?? []).entries()) this.check(text, `${where}[${i}]`);
  }

  block(issue: Issue | undefined): void {
    if (issue !== undefined) this.#blocks.push(issue);
  }

  /** 共用定义里的规则查出的拦截：位置是字段名，换成中文。 */
  blockAll(issues: readonly Issue[]): void {
    for (const issue of issues) {
      this.#blocks.push(
        issue.where === undefined ? issue : { ...issue, where: fieldName(issue.where) },
      );
    }
  }

  failure(): Err<ErrorBody<"RULE_BLOCKED">> | undefined {
    return failAll("RULE_BLOCKED", this.#blocks);
  }
}

/** 位置里的字段名换成中文，例如 content 写「内容」，subItems[1] 写「子项 2」。 */
function fieldName(where: string): string {
  const text = queueCopy.field;
  const labels: Readonly<Record<string, string>> = {
    content: renderCopy(text.content),
    acceptance: renderCopy(text.acceptance),
    dependsOn: renderCopy(text.dependsOn),
    evidence: renderCopy(text.evidence),
    source: renderCopy(text.source),
    itemNote: renderCopy(text.itemNote),
    statusNote: renderCopy(text.statusNote),
    reason: "原因",
  };
  const sub = /^subItems\[(\d+)\]$/u.exec(where);
  if (sub !== null) return `${renderCopy(text.subItem)} ${Number(sub[1]) + 1}`;
  return labels[where] ?? where;
}

/** 有问题时拼出失败的结果：顶层写第一条，issues 写全部。没有问题时返回 undefined。 */
function failAll<C extends ErrorCode>(
  code: C,
  issues: readonly Issue[],
): Err<ErrorBody<C>> | undefined {
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody(code, [first, ...rest]));
}

// ── 查找和编号 ──

/** 解析 Q12 这样的编号，写法不对时返回 BAD_REQUEST，报错和 parseQueueId 相同。 */
function parseQid(text: string): Result<number, ErrorBody<"BAD_REQUEST">> {
  const parsed = parseQueueId(text);
  if (parsed.ok) return parsed;
  const copy = parseCopy.queueId[parsed.error];
  return fail("BAD_REQUEST", {
    message: renderCopy(copy.message, { text }),
    hint: renderCopy(copy.hint),
    where: text,
  });
}

function notFoundIssue(projectId: string, number: number): Issue {
  const text = queueItemsCopy.notFound;
  const id = formatQueueId(number);
  return {
    message: renderCopy(text.message, { project: projectId, id }),
    hint: renderCopy(text.hint),
    where: id,
  };
}

function findItem(
  tx: Reader,
  projectId: string,
  number: number,
): Result<ItemRow, ErrorBody<"NOT_FOUND">> {
  const row = tx
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), eq(queueItems.number, number)))
    .get();
  return row === undefined ? fail("NOT_FOUND", notFoundIssue(projectId, number)) : ok(row);
}

/** 下一个编号：项目已有的最大编号加一。事项不删，所以编号从 Q1 起连续。 */
function nextNumber(tx: Reader, projectId: string): number {
  const row = tx
    .select({ last: max(queueItems.number) })
    .from(queueItems)
    .where(eq(queueItems.projectId, projectId))
    .get();
  return (row?.last ?? 0) + 1;
}

/** 项目现在开着的一轮，也就是还没收尾的那一轮。轮次表的索引保证最多一轮。 */
function openRound(tx: Reader, projectId: string): RoundRow | undefined {
  return tx
    .select()
    .from(rounds)
    .where(and(eq(rounds.projectId, projectId), ne(rounds.status, "closed")))
    .get();
}

/** 按编号取一轮。开始一轮和收尾的用例传来的是它们自己的轮次，一定有。 */
function roundById(tx: Reader, roundId: number): RoundRow {
  const row = tx.select().from(rounds).where(eq(rounds.id, roundId)).get();
  if (row === undefined) throw new Error(`没有编号是 ${roundId} 的阶段，数据不一致。`);
  return row;
}

// ── 对外的样子 ──

/** 轮次表的编号换成轮次的写法，例如 v2-落地-3。 */
function roundLabels(tx: Reader, ids: readonly (number | null)[]): ReadonlyMap<number, string> {
  const wanted = [...new Set(ids.filter((id) => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = tx.select().from(rounds).where(inArray(rounds.id, wanted)).all();
  return new Map(rows.map((row) => [row.id, formatRoundLabel(row)]));
}

function labelOrUndefined(round: RoundRow | undefined | null): string | undefined {
  return round === undefined || round === null ? undefined : formatRoundLabel(round);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((text, i) => text === b[i]);
}

/**
 * 接口和命令行看到的一件事，形状和 model 的 queueItemSchema 相同，枚举是英文键。
 * 接口层用这份定义编码成中文。没有的格不写，不写成 null。
 */
function toItemView(row: ItemRow, labels: ReadonlyMap<number, string>): QueueItem {
  const proposedIn = row.proposedInRoundId === null ? undefined : labels.get(row.proposedInRoundId);
  const fromLine =
    row.fromSubmissionId === null || row.fromLine === null
      ? undefined
      : { submission: row.fromSubmissionId, line: row.fromLine };
  return {
    id: formatQueueId(row.number),
    content: row.content,
    stage: row.stage,
    proposer: row.proposer,
    ...(proposedIn === undefined ? {} : { proposedIn }),
    createdAt: iso(row.createdAt),
    status: row.status,
    ...(row.statusNote === null ? {} : { statusNote: row.statusNote }),
    ...(row.dependsOn === null ? {} : { dependsOn: row.dependsOn }),
    ...(row.acceptance === null ? {} : { acceptance: row.acceptance }),
    ...(row.evidence === null ? {} : { evidence: row.evidence }),
    subItems: [...row.subItems],
    ...(row.source === null ? {} : { source: row.source }),
    ...(row.note === null ? {} : { note: row.note }),
    ...(fromLine === undefined ? {} : { fromLine }),
    editCount: row.editCount,
  };
}

/** 一条队列变动，形状和 model 的 queueEventSchema 相同。 */
function toEventView(
  number: number,
  row: EventRow,
  labels: ReadonlyMap<number, string>,
): QueueEvent {
  const round = row.roundId === null ? undefined : labels.get(row.roundId);
  return {
    item: formatQueueId(number),
    at: iso(row.at),
    ...(row.fromStatus === null ? {} : { from: row.fromStatus }),
    to: row.toStatus,
    ...(row.note === null ? {} : { note: row.note }),
    ...(round === undefined ? {} : { round }),
    actor: row.actor,
  };
}
