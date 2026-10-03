import {
  type ErrorBody,
  formatQueueId,
  formatRoundLabel,
  ok,
  type ReplyDestination,
  type ReplyLine,
  type Result,
  renderCopy,
  type SubmissionSource,
} from "@product-loop/model";
import { and, asc, desc, eq } from "drizzle-orm";
import { pagesCopy } from "../../copy/pages.ts";
import { repliesCopy } from "../../copy/replies.ts";
import { cards, pages, replyLines, rounds, submissions } from "../../store/schema/index.ts";
import { findPage, pageNotFound } from "../pages/fill.ts";
import { fail, findProject, iso, isoOrNull, type Reader } from "../projects.ts";

// 读回复：一页的回复，和一份回复的每一行，见「05 接口」第四节。
// 每一行带着去处。去处的写法和 model 的 replyLineSchema 解码以后的样子相同，接口层编码成中文。

type PageRow = typeof pages.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;
type LineRow = typeof replyLines.$inferSelect;

/** 一份回复和它的每一行。 */
export type SubmissionView = {
  /** 回复的编号，后端生成的全局整数。 */
  readonly id: number;
  readonly project: string;
  readonly page: number;
  /** 这一页在所在阶段里的第几页。 */
  readonly pageSeq: number;
  /** 这一页所在阶段的标识，写成 v2-检查-1。 */
  readonly round: string;
  readonly source: SubmissionSource;
  readonly submittedAt: string;
  /** 在等的命令第一次取走回复的时间。还没取走的为空。 */
  readonly takenAt: string | null;
  /** 旧格式的回复文字。工作台交来的各行没有。 */
  readonly text: string | null;
  readonly lines: readonly ReplyLine[];
};

/** 一页的回复。页面不在这个项目里时返回 NOT_FOUND，还没回复时是 null。 */
export function submissionOfPage(
  db: Reader,
  projectId: string,
  pageId: number,
): Result<SubmissionView | null, ErrorBody<"NOT_FOUND">> {
  const page = pageInProject(db, projectId, pageId);
  if (!page.ok) return page;
  const row = db.select().from(submissions).where(eq(submissions.pageId, pageId)).get();
  return ok(row === undefined ? null : toSubmissionView(db, row));
}

/** 这个项目最近提交的一份回复。ploop reply show 不写编号时用。还没有回复时是 null。 */
export function latestSubmissionOf(
  db: Reader,
  projectId: string,
): Result<SubmissionView | null, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = db
    .select()
    .from(submissions)
    .where(eq(submissions.projectId, projectId))
    .orderBy(desc(submissions.id))
    .limit(1)
    .get();
  return ok(row === undefined ? null : toSubmissionView(db, row));
}

/** 一份回复，按编号找。回复不在这个项目里时返回 NOT_FOUND。 */
export function submissionById(
  db: Reader,
  projectId: string,
  submissionId: number,
): Result<SubmissionView, ErrorBody<"NOT_FOUND">> {
  const row = db
    .select()
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.projectId, projectId)))
    .get();
  if (row === undefined) return submissionNotFound(projectId, submissionId);
  return ok(toSubmissionView(db, row));
}

/** 按编号找这个项目里的一页。找不到，或者页面在别的项目里，返回 NOT_FOUND。 */
export function pageInProject(
  db: Reader,
  projectId: string,
  pageId: number,
): Result<PageRow, ErrorBody<"NOT_FOUND">> {
  const row = findPage(db, pageId);
  if (row === undefined) return pageNotFound(pageId);
  if (row.projectId === projectId) return ok(row);
  const text = pagesCopy.page.otherProject;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { project: projectId, page: pageId }),
    hint: renderCopy(text.hint),
    where: String(pageId),
  });
}

/** 一份回复的每一行，按行号排。回复不在这个项目里时返回 NOT_FOUND。 */
export function linesOfSubmission(
  db: Reader,
  projectId: string,
  submissionId: number,
): Result<ReplyLine[], ErrorBody<"NOT_FOUND">> {
  const row = db
    .select({ id: submissions.id, pageId: submissions.pageId })
    .from(submissions)
    .where(and(eq(submissions.id, submissionId), eq(submissions.projectId, projectId)))
    .get();
  if (row === undefined) return submissionNotFound(projectId, submissionId);
  return ok(linesOf(db, row.id, row.pageId));
}

function submissionNotFound(projectId: string, submissionId: number) {
  return fail("NOT_FOUND", {
    message: renderCopy(repliesCopy.notFound.message, {
      project: projectId,
      submission: submissionId,
    }),
    hint: renderCopy(repliesCopy.notFound.hint),
    where: String(submissionId),
  });
}

/** 一份回复的样子，带上每一行。 */
export function toSubmissionView(db: Reader, row: SubmissionRow): SubmissionView {
  const found = db
    .select({ round: rounds, seq: pages.seq })
    .from(pages)
    .innerJoin(rounds, eq(rounds.id, pages.roundId))
    .where(eq(pages.id, row.pageId))
    .get();
  // 回复挂在存在的页面上，页面挂在存在的阶段上，由外键保证。
  if (found === undefined) throw new Error(`页面 ${row.pageId} 不存在，数据不一致。`);
  return {
    id: row.id,
    project: row.projectId,
    page: row.pageId,
    pageSeq: found.seq,
    round: formatRoundLabel(found.round),
    source: row.source,
    submittedAt: iso(row.submittedAt),
    takenAt: isoOrNull(row.takenAt),
    text: row.text,
    lines: linesOf(db, row.id, row.pageId),
  };
}

function linesOf(db: Reader, submissionId: number, pageId: number): ReplyLine[] {
  const rows = db
    .select()
    .from(replyLines)
    .where(eq(replyLines.submissionId, submissionId))
    .orderBy(asc(replyLines.line))
    .all();
  const titles = new Map(
    db
      .select({ cardId: cards.cardId, title: cards.title })
      .from(cards)
      .where(eq(cards.pageId, pageId))
      .all()
      .map((card) => [card.cardId, card.title]),
  );
  return rows.map((row) => toLineView(db, row, titles));
}

/**
 * 一行的样子。没有的项不写，和 replyLineSchema 的可选项一致。
 * 卡片的标题从这一页的卡片索引里取；迁移来的旧页面没有索引，就没有标题。
 */
function toLineView(db: Reader, row: LineRow, titles: ReadonlyMap<string, string>): ReplyLine {
  const handled = handledOf(db, row);
  const title = row.card === null ? undefined : titles.get(row.card);
  return {
    submission: row.submissionId,
    line: row.line,
    ...(row.section === null ? {} : { section: row.section }),
    ...(row.card === null ? {} : { card: row.card }),
    ...(title === undefined ? {} : { cardTitle: title }),
    kind: row.kind,
    ...(row.option === null ? {} : { option: row.option }),
    ...(row.queue === null ? {} : { queue: formatQueueId(row.queue) }),
    ...(row.note === null ? {} : { note: row.note }),
    images: [...row.images],
    imagesRead: row.imagesRead,
    ...(handled === undefined ? {} : { handled }),
  };
}

/** 处理过的行：去处、时间和执行者。检查约束保证每种去处要的几列都在。 */
function handledOf(db: Reader, row: LineRow): ReplyLine["handled"] {
  if (row.destination === null || row.handledAt === null || row.handledBy === null) {
    return undefined;
  }
  return {
    destination: destinationOf(db, row, row.destination),
    at: iso(row.handledAt),
    by: row.handledBy,
  };
}

function destinationOf(
  db: Reader,
  row: LineRow,
  to: NonNullable<LineRow["destination"]>,
): ReplyDestination {
  const broken = () =>
    new Error(`回复 ${row.submissionId} 第 ${row.line} 行的去处缺了指向的东西。`);
  switch (to) {
    case "queue":
      if (row.toQueue === null) throw broken();
      return { to, id: formatQueueId(row.toQueue) };
    case "decision":
      if (row.toDecision === null) throw broken();
      return { to, id: row.toDecision };
    case "mainline":
      if (row.toRevision === null || row.toPart === null) throw broken();
      return { to, revision: row.toRevision, part: row.toPart };
    case "doneHere": {
      const round =
        row.toRoundId === null
          ? undefined
          : db.select().from(rounds).where(eq(rounds.id, row.toRoundId)).get();
      if (round === undefined || row.handledNote === null) throw broken();
      return { to, round: formatRoundLabel(round), evidence: row.handledNote };
    }
    case "noAction":
      if (row.handledNote === null) throw broken();
      return { to, reason: row.handledNote };
  }
}
