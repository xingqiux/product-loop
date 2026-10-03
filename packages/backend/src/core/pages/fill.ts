import {
  beijingDay,
  type ErrorBody,
  formatQueueId,
  formatRoundLabel,
  formatSceneId,
  ok,
  type PagePurpose,
  type PageSections,
  type PageStatus,
  parseSceneId,
  type QueueItem,
  type QueueStatus,
  type Result,
  type RoundStatus,
  renderCopy,
  type Stage,
  stage,
  type TextDiffRow,
  textDiff,
  type WithCardIds,
} from "@product-loop/model";
import { and, asc, eq, gt } from "drizzle-orm";
import { pagesCopy } from "../../copy/pages.ts";
import {
  excerpts,
  landChanges,
  landRecords,
  type PageImageRef,
  pages,
  projects,
  queueEvents,
  queueItems,
  roundItems,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import { buildStatus, type LandStatus } from "../land/status.ts";
import { listScenes } from "../mainline.ts";
import { fail, iso, type Reader } from "../projects.ts";
import { isStale, lastMoved, listQueueItems, queueCounts } from "../queue.ts";
import { type PreviousReplies, previousRepliesOf } from "../replies/pending.ts";
import { latestUseRun, type UseRunView } from "../use/runs.ts";
import { roundsOf } from "../versions.ts";

// 页面里由后端填的部分，见「06 工作台」第四节和「05 接口」第十节第 3 步：
// 页头、窄带、队列看板、位置的场景名和步骤文字、原文摘录、这一轮开始时取消的事，
// 以及更改的逐行对比。AI 不写这些，页面数据里写了由数据定义拦截。
//
// 给出信息时在写事务里算好，和页面数据一起存下，之后不再改，见 fillParts。
// 所以旧的一页看到的看板和场景名，是给出那一刻的样子。回复按看板上的文字对回队列事项，
// 看板要和用户看到的一致，见 model 的 legacyReplyPage。
// 读一页时，fillPage 取出存下的部分，再加上会变的几样：页面的状态、撤回的情况。
//
// 上一轮的回复去了哪里：这个项目最近的一份回复和每一行的去处，见 replies/pending.ts。
// 给出那一刻还没处理的行不会有，reply.line.handled 拦着。
//
// 后面的步骤在这里接上两块，现在都是空的：
// - 使用：第 53 步从最近一次使用代码的运行生成。
// - 工程证据：第 50 步从落地记录摆出验收页的证据。

type RoundRow = typeof rounds.$inferSelect;
type PageRow = typeof pages.$inferSelect;

/** 页头：系统名、轮次、日期。迁移进来的轮次另写旧编号。 */
type PageHeader = {
  /** 项目的名称。 */
  readonly system: string;
  /** 轮次的写法，例如 v2-检查-1。 */
  readonly round: string;
  readonly legacyId: string | null;
  readonly stage: Stage;
  /** 给出的那一天，北京时间的日期，例如 2026-09-28。 */
  readonly date: string;
};

/** 窄带上的一个阶段：这一版在这个阶段跑过的轮次，和队列里还没做完的件数。 */
type StripStage = {
  readonly stage: Stage;
  readonly rounds: readonly { readonly label: string; readonly status: RoundStatus }[];
  readonly queue: number;
};

/** 页头下面的窄带：五个阶段。当前是哪个阶段、什么状态，页头已经写了，不再另给一句话。 */
type Strip = {
  /** 五个阶段各一项，按阶段的顺序排。 */
  readonly stages: readonly StripStage[];
};

/** 看板上的一件事。停了七天还没轮到的，工作台显示得淡一些，见「06 工作台」第五节。 */
type BoardItem = QueueItem & { readonly stale: boolean };

/** 这一轮做完的一件事，列在看板下面。 */
type DoneItem = {
  readonly id: string;
  readonly content: string;
  readonly evidence: string | null;
};

/**
 * 队列看板，见「06 工作台」第五节。只摆还没做完的事，做完和取消的不上看板。
 * 在等别的事的单独放在上面，其余按阶段分五列，每列按放进队列的先后排。
 */
type LiveBoard = {
  readonly waiting: readonly BoardItem[];
  readonly columns: readonly { readonly stage: Stage; readonly items: readonly BoardItem[] }[];
};

type QueueBoard = LiveBoard & { readonly doneThisRound: readonly DoneItem[] };

/** 这一轮开始时取消的一件事：编号、内容和取消的原因。 */
type DroppedItem = {
  readonly id: string;
  readonly content: string;
  readonly reason: string;
};

/**
 * 页面里写到的一个位置：场景名和这一步的文字，由后端从主线填。
 * 主线里找不到这个场景或这一步时，找不到的几项为空。
 */
type Place = {
  /** 场景编号，写成 S3。 */
  readonly scene: string;
  readonly step: number;
  readonly name: string | null;
  /** 这一步做什么。 */
  readonly do: string | null;
  /** 这一步该看到什么。 */
  readonly expect: string | null;
};

/** 位置图用的场景：编号、名字和步数。 */
type SceneCell = { readonly id: string; readonly name: string; readonly steps: number };

type WhereFill = {
  /** 主线里现在的场景，按编号排，画一排场景格子用。页面里没写位置时是空的。 */
  readonly scenes: readonly SceneCell[];
  /** 页面里写到的位置，去掉重复，按第一次出现的先后。 */
  readonly places: readonly Place[];
};

/** 一条文字更改的逐行对比，按卡片编号对回更改。 */
type ChangeDiff = { readonly card: string; readonly rows: readonly TextDiffRow[] };

/** 给出信息时由后端填好、和页面一起存下的部分。 */
export type PageFill = {
  readonly header: PageHeader;
  readonly strip: Strip;
  readonly queue: QueueBoard;
  readonly where: WhereFill;
  readonly droppedAtStart: readonly DroppedItem[];
  readonly textDiffs: readonly ChangeDiff[];
  /** 上一轮的回复去了哪里。这个项目还没有回复时为空。 */
  readonly previousReplies: PreviousReplies | null;
  /** 使用区块：这一轮最近一次运行，见「06 工作台」第四节。使用轮以外为空。 */
  readonly use: UseRunView | null;
  /** 验收页的工程证据：落地五步的记录，见「06 工作台」第四节。落地轮以外为空。 */
  readonly landEvidence: LandEvidence | null;
};

/** 工程证据：落地五步的状态，不带下一步。 */
type LandEvidence = Omit<LandStatus, "next">;

/** 算填的部分要用的东西。 */
export type FillSource = {
  readonly round: RoundRow;
  /** 给出以后这一轮的状态。 */
  readonly roundStatus: RoundStatus;
  readonly sections: WithCardIds<PageSections>;
  readonly now: Date;
};

/** 在给出信息的写事务里算出后端填的部分。 */
export function fillParts(db: Reader, source: FillSource): PageFill {
  const { round } = source;
  return {
    header: headerOf(db, round, source.now),
    strip: stripOf(db, round, source.roundStatus),
    queue: boardOf(db, round, source.now),
    where: whereOf(db, round.projectId, source.sections),
    droppedAtStart: droppedAtStartOf(db, round.id),
    textDiffs: textDiffsOf(source.sections),
    previousReplies: previousRepliesOf(db, round.projectId),
    use: useOf(db, round),
    landEvidence: landEvidenceOf(db, round),
  };
}

/** 使用轮的使用区块，取给出这一页时这一轮最近一次运行。还没有运行时为空。 */
function useOf(db: Reader, round: RoundRow): UseRunView | null {
  if (round.stage !== "use") return null;
  const latest = latestUseRun(db, round.projectId, { round });
  return latest.ok ? latest.value : null;
}

/** 落地轮的工程证据，取给出这一页时落地五步的记录。 */
function landEvidenceOf(db: Reader, round: RoundRow): LandEvidence | null {
  if (round.stage !== "land") return null;
  const { next: _next, ...evidence } = buildStatus(db, round);
  return evidence;
}

function headerOf(db: Reader, round: RoundRow, now: Date): PageHeader {
  const project = db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, round.projectId))
    .get();
  // 轮次挂在登记过的项目上。
  if (project === undefined) throw new Error(`项目 ${round.projectId} 不存在，数据不一致。`);
  return {
    system: project.name,
    round: formatRoundLabel(round),
    legacyId: round.legacyId,
    stage: round.stage,
    date: beijingDay(now),
  };
}

/** 窄带：这一版五个阶段各跑过哪几轮，队列里各还有几件。这一轮的状态取给出以后的。 */
function stripOf(db: Reader, round: RoundRow, status: RoundStatus): Strip {
  const counts = queueCounts(db, round.projectId);
  const inVersion = roundsOf(db, round.projectId, round.version).map((row) => ({
    stage: row.stage,
    label: formatRoundLabel(row),
    status: row.id === round.id ? status : row.status,
  }));
  return {
    stages: stage.keys.map((key) => ({
      stage: key,
      rounds: inVersion
        .filter((row) => row.stage === key)
        .map((row) => ({ label: row.label, status: row.status })),
      queue: counts[key] ?? 0,
    })),
  };
}

/** 还没做完的三种状态。 */
const liveStatuses: readonly QueueStatus[] = ["todo", "doing", "waiting"];

/** 一轮的页面里的队列看板，下面列出这一轮做完的事。 */
function boardOf(db: Reader, round: RoundRow, now: Date): QueueBoard {
  const live = queueBoard(db, round.projectId, now);
  // 轮次挂在登记过的项目上。
  if (!live.ok) throw new Error(live.error.message);
  return { ...live.value, doneThisRound: doneIn(db, round.id) };
}

/**
 * 现在的队列看板：GET /projects/:pid/queue/board，工作台的队列页用。
 * 停得久：待办或等待，最近一次变动在七天以前。
 */
export function queueBoard(
  db: Reader,
  projectId: string,
  now: Date,
): Result<LiveBoard, ErrorBody<"NOT_FOUND">> {
  const listed = listQueueItems(db, projectId, { statuses: [...liveStatuses] });
  if (!listed.ok) return listed;
  const moved = lastMoved(db, projectId);
  const board = listed.value.map((item): BoardItem => {
    const last = moved.get(item.id) ?? new Date(item.createdAt);
    return { ...item, stale: isStale(item.status, last, now) };
  });
  return ok({
    waiting: board.filter((item) => item.status === "waiting"),
    columns: stage.keys.map((key) => ({
      stage: key,
      items: board.filter((item) => item.status !== "waiting" && item.stage === key),
    })),
  });
}

/**
 * 这一轮做完的事，按编号排：变动记在这一轮上、改成已完成的。
 * 落地轮的验收页在收尾以前给出，那时这一批还没改成已完成，先失败后通过的改动对应的事也算，
 * 证据写改动的名字和提交。同一件两边都有时，取已完成写的证据。
 */
function doneIn(db: Reader, roundId: number): DoneItem[] {
  const done = new Map<number, DoneItem>();
  const closed = db
    .selectDistinct({
      number: queueItems.number,
      content: queueItems.content,
      evidence: queueItems.evidence,
    })
    .from(queueEvents)
    .innerJoin(queueItems, eq(queueItems.id, queueEvents.itemId))
    .where(and(eq(queueEvents.roundId, roundId), eq(queueEvents.toStatus, "done")))
    .all();
  for (const row of closed) {
    done.set(row.number, {
      id: formatQueueId(row.number),
      content: row.content,
      evidence: row.evidence,
    });
  }
  const round = db.select().from(rounds).where(eq(rounds.id, roundId)).get();
  const landed = db
    .select({ name: landChanges.name, queue: landChanges.queueNumbers, commit: landChanges.commit })
    .from(landChanges)
    .innerJoin(landRecords, eq(landRecords.id, landChanges.landRecordId))
    .where(eq(landRecords.roundId, roundId))
    .all();
  for (const change of landed) {
    if (change.commit === null || round === undefined) continue;
    for (const number of change.queue) {
      if (done.has(number)) continue;
      const item = db
        .select({ content: queueItems.content })
        .from(queueItems)
        .where(and(eq(queueItems.projectId, round.projectId), eq(queueItems.number, number)))
        .get();
      if (item === undefined) continue;
      const evidence = renderCopy(pagesCopy.fill.landed, {
        change: change.name,
        commit: change.commit.slice(0, 7),
      });
      done.set(number, { id: formatQueueId(number), content: item.content, evidence });
    }
  }
  return [...done.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
}

/**
 * 这一轮开始时取消的事：这一轮拿出来、现在是已取消的，按编号排，见「04 命令行」第三节。
 * 收尾时这些事记作开始时取消，见 rounds/close.ts 的 byStatus，两处的认法相同。
 * 捞回待办的事不再是已取消，不列在这里。
 */
function droppedAtStartOf(db: Reader, roundId: number): DroppedItem[] {
  return db
    .select({
      number: queueItems.number,
      content: queueItems.content,
      note: queueItems.statusNote,
    })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .where(and(eq(roundItems.roundId, roundId), eq(queueItems.status, "dropped")))
    .orderBy(asc(queueItems.number))
    .all()
    .map((row) => ({
      id: formatQueueId(row.number),
      content: row.content,
      reason: row.note ?? "",
    }));
}

type WhereRef = { readonly scene: string; readonly step: number };

/** 页面里全部的位置：疑问、发现问题、提升的 where，和元素清单每一屏的 where。 */
function whereRefsOf(sections: WithCardIds<PageSections>): WhereRef[] {
  const cards = [
    ...(sections.asks ?? []),
    ...(sections.findings ?? []),
    ...(sections.improvements ?? []),
  ];
  const refs: WhereRef[] = [];
  for (const item of [...cards, ...(sections.screens ?? [])]) {
    const { where } = item;
    if (where !== undefined && !refs.some((r) => r.scene === where.scene && r.step === where.step))
      refs.push(where);
  }
  return refs;
}

/** 位置：场景名和步骤的文字从主线的场景表取，见「03 数据模型」第二节「主线和场景」。 */
function whereOf(db: Reader, projectId: string, sections: WithCardIds<PageSections>): WhereFill {
  const refs = whereRefsOf(sections);
  if (refs.length === 0) return { scenes: [], places: [] };
  const listed = listScenes(db, projectId, { includeRemoved: true });
  // 轮次挂在登记过的项目上。
  if (!listed.ok) throw new Error(listed.error.message);
  const byId = new Map(listed.value.map((scene) => [scene.id, scene]));
  const places = refs.map(({ scene, step }): Place => {
    const parsed = parseSceneId(scene);
    const found = parsed.ok ? byId.get(formatSceneId(parsed.value)) : undefined;
    const line = found?.steps.find((entry) => entry.step === step);
    return {
      scene,
      step,
      name: found?.name ?? null,
      do: line?.do ?? null,
      expect: line?.expect ?? null,
    };
  });
  const scenes = listed.value
    .filter((scene) => scene.removedInRevision === null)
    .map((scene) => ({ id: scene.id, name: scene.name, steps: scene.steps.length }));
  return { scenes, places };
}

/** 文字的更改：改前改后的逐行对比由后端算，见 model 的 page/change.ts。 */
function textDiffsOf(sections: WithCardIds<PageSections>): ChangeDiff[] {
  return (sections.changes ?? []).flatMap((change) =>
    change.textBefore === undefined || change.textAfter === undefined
      ? []
      : [{ card: change.id, rows: textDiff(change.textBefore, change.textAfter) }],
  );
}

// ── 读一页 ──

/** 一条原文摘录，按来源在页面数据里的位置对回来源。 */
type ExcerptView = {
  /** 来源在页面数据里的位置，例如 asks[0].sources[1]。 */
  readonly where: string;
  readonly file: string;
  /** 行号的写法，例如 12-20。 */
  readonly lines: string;
  readonly start: number;
  readonly end: number;
  readonly mark: readonly number[] | null;
  readonly text: string;
  readonly fileHash: string;
};

/** 撤回的情况：时间、原因，和代替它的那一页，见「06 工作台」第四节「页面的几种状态」。 */
type Withdrawal = {
  readonly at: string;
  readonly reason: string | null;
  /** 同一轮里在它之后给出的第一页。还没有给出新的一页时为空。 */
  readonly replacedBy: number | null;
};

/** 填好的一页：GET /pages/:id 返回它。枚举是英文键，接口按「05 接口」第一节换成中文。 */
export type FilledPage = {
  readonly id: number;
  readonly project: string;
  readonly round: string;
  /** 这一轮的第几页。 */
  readonly seq: number;
  readonly stage: Stage;
  readonly purpose: PagePurpose;
  readonly status: PageStatus;
  readonly formatVersion: number;
  readonly presentedAt: string;
  readonly withdrawal: Withdrawal | null;
  /** AI 写的各个区块，卡片编号已填好。 */
  readonly sections: WithCardIds<PageSections>;
  /** 截图的路径和哈希。工作台按哈希从附件接口取图。 */
  readonly images: readonly PageImageRef[];
  readonly excerpts: readonly ExcerptView[];
  readonly fill: PageFill;
  /** 这一页的回复。工作台据此显示「等 AI 取走」和「AI 已收到」。还没提交的为空。 */
  readonly submission: PageSubmission | null;
  /** 迁移进来的只有网页的一页：旧页面快照的哈希。别的页为空。 */
  readonly snapshot: string | null;
};

/** 一页的回复：编号、提交的时间、AI 第一次取走的时间。 */
type PageSubmission = {
  readonly id: number;
  readonly submittedAt: string;
  readonly takenAt: string | null;
};

/** 按编号取一页。 */
export function findPage(db: Reader, pageId: number): PageRow | undefined {
  return db.select().from(pages).where(eq(pages.id, pageId)).get();
}

/** 按编号找不到页面。 */
export function pageNotFound(pageId: number) {
  const text = pagesCopy.page.notFound;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { page: pageId }),
    hint: renderCopy(text.hint),
    where: String(pageId),
  });
}

/**
 * 按项目取填好的一页：GET /projects/:pid/pages/:id 用。
 * 页面的编号是全局的，页面不在这个项目里时按找不到处理，写明是哪个项目。
 */
export function fillProjectPage(
  db: Reader,
  projectId: string,
  pageId: number,
): Result<FilledPage, ErrorBody<"NOT_FOUND">> {
  const row = findPage(db, pageId);
  if (row === undefined || row.projectId === projectId) return fillPage(db, pageId);
  const text = pagesCopy.page.otherProject;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { project: projectId, page: pageId }),
    hint: renderCopy(text.hint),
    where: String(pageId),
  });
}

/** 填好的一页：存下的页面数据和填的部分，加上现在的状态和撤回的情况。 */
export function fillPage(db: Reader, pageId: number): Result<FilledPage, ErrorBody<"NOT_FOUND">> {
  const row = findPage(db, pageId);
  if (row === undefined) return pageNotFound(pageId);
  const round = roundOf(db, row);
  return ok({
    id: row.id,
    project: row.projectId,
    round: formatRoundLabel(round),
    seq: row.seq,
    stage: round.stage,
    purpose: row.purpose,
    status: row.status,
    formatVersion: row.formatVersion,
    presentedAt: iso(row.presentedAt),
    withdrawal: withdrawalOf(db, row),
    sections: row.sections,
    images: row.images,
    excerpts: excerptsOf(db, row.id),
    // 存下时就是 fillParts 算出的样子。
    fill: storedFill(row.fill),
    submission: submissionOf(db, row.id),
    snapshot: row.legacySnapshot ?? null,
  });
}

/**
 * 存下的填充部分按现在的格式读。早先存下的页面，阶段条里多一句 current，
 * 这一句后来不再给工作台，读的时候去掉。
 */
export function storedFill(raw: unknown): PageFill {
  const fill = raw as PageFill & { readonly strip: { readonly current?: unknown } };
  if (!("current" in fill.strip)) return fill;
  const { current: _, ...strip } = fill.strip;
  return { ...fill, strip };
}

function submissionOf(db: Reader, pageId: number): PageSubmission | null {
  const found = db
    .select({ id: submissions.id, at: submissions.submittedAt, taken: submissions.takenAt })
    .from(submissions)
    .where(eq(submissions.pageId, pageId))
    .get();
  if (found === undefined) return null;
  return {
    id: found.id,
    submittedAt: iso(found.at),
    takenAt: found.taken === null ? null : iso(found.taken),
  };
}

function roundOf(db: Reader, row: PageRow): RoundRow {
  const round = db.select().from(rounds).where(eq(rounds.id, row.roundId)).get();
  // 页面挂在存在的轮次上，由外键保证。
  if (round === undefined) throw new Error(`阶段 ${row.roundId} 不存在，数据不一致。`);
  return round;
}

function withdrawalOf(db: Reader, row: PageRow): Withdrawal | null {
  if (row.status !== "withdrawn" || row.withdrawnAt === null) return null;
  const next = db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.roundId, row.roundId), gt(pages.id, row.id)))
    .orderBy(asc(pages.id))
    .get();
  return {
    at: iso(row.withdrawnAt),
    reason: row.withdrawReason,
    replacedBy: next?.id ?? null,
  };
}

function excerptsOf(db: Reader, pageId: number): ExcerptView[] {
  return db
    .select()
    .from(excerpts)
    .where(eq(excerpts.pageId, pageId))
    .orderBy(asc(excerpts.id))
    .all()
    .map((row) => ({
      where: row.where,
      file: row.file,
      lines:
        row.startLine === row.endLine ? String(row.startLine) : `${row.startLine}-${row.endLine}`,
      start: row.startLine,
      end: row.endLine,
      mark: row.mark,
      text: row.text,
      fileHash: row.fileHash,
    }));
}
