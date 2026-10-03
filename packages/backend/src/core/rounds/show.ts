import {
  type ErrorBody,
  err,
  errorBody,
  formatQueueId,
  formatRoundName,
  type Issue,
  ok,
  type PagePurpose,
  type PageStatus,
  parseCopy,
  parseRoundRef,
  type QueueItem,
  type Result,
  type RoundItemResult,
  type RoundRef,
  type RoundRefError,
  renderCopy,
  type Stage,
  stage,
} from "@product-loop/model";
import { and, asc, eq } from "drizzle-orm";
import { roundsCopy } from "../../copy/rounds.ts";
import {
  type BaseCommit,
  pages,
  queueItems,
  roundItems,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import { fail, findProject, iso, isoOrNull, type Reader } from "../projects.ts";
import { listQueueItems } from "../queue.ts";
import { type SubmissionView, toSubmissionView } from "../replies/read.ts";
import { currentVersionRow, type RoundView, roundsOf, toRoundView } from "../versions.ts";
import { findRound, roundLabelIssue } from "./close.ts";

// 看一轮：`ploop round show [<轮次>]`，接口是 GET /projects/:pid/rounds/:rid。
// 见「04 命令行」第二节和 S14 第 2 步：这一轮拿出来的事、给出过的页。
// 轮次写新写法或迁移前的旧编号，见「04 命令行」第二节末尾。旧编号可以重名，重名时列出对应的几轮。
// 收到的回复连同每一行的去处也在里面，接手的会话不用另查 reply show。只读，要先体检的项目也能查。

/** 拿出的一件事在这一轮的样子。 */
type RoundItemView = {
  readonly item: QueueItem;
  /** 收尾时记下的结果。还没收尾时为空。 */
  readonly result: RoundItemResult | null;
  readonly returnedTo: Stage | null;
  readonly note: string | null;
};

/** 这一轮给出过的一页。 */
type RoundPageView = {
  readonly id: number;
  readonly seq: number;
  readonly purpose: PagePurpose;
  readonly status: PageStatus;
  readonly presentedAt: string;
  readonly withdrawnAt: string | null;
};

/** 一轮的详情。 */
export type RoundDetail = {
  readonly round: RoundView;
  readonly openedBySession: string | null;
  readonly openedByClient: string | null;
  readonly baseCommits: readonly BaseCommit[] | null;
  /** 收尾说明。 */
  readonly summary: string | null;
  /** 拿出的每件事，按编号排。 */
  readonly items: readonly RoundItemView[];
  /** 给出过的页，按页序号排。 */
  readonly pages: readonly RoundPageView[];
  /** 收到的回复，按页序号排，每一行带着去处。 */
  readonly replies: readonly SubmissionView[];
};

type RoundRow = typeof rounds.$inferSelect;

/**
 * 按轮次的写法或旧编号取一轮的详情。写法不对返回 BAD_REQUEST。
 * 旧编号对上不止一轮时也返回 BAD_REQUEST，逐条列出对应的轮次，改用轮次的写法。
 * 项目或这一轮不存在返回 NOT_FOUND。
 */
export function roundDetail(
  db: Reader,
  projectId: string,
  roundRef: string,
): Result<RoundDetail, ErrorBody<"BAD_REQUEST" | "NOT_FOUND">> {
  const row = findRoundByRef(db, projectId, roundRef);
  if (!row.ok) return row;
  return ok(detailOf(db, row.value));
}

/**
 * 按轮次的写法找这个项目的一轮，旧编号也认。写法不对和旧编号对上几轮时返回 BAD_REQUEST，
 * 找不到返回 NOT_FOUND。ploop round show 用它。
 */
function findRoundByRef(
  db: Reader,
  projectId: string,
  roundRef: string,
): Result<RoundRow, ErrorBody<"BAD_REQUEST" | "NOT_FOUND">> {
  const ref = parseRoundRef(roundRef);
  if (!ref.ok) return err(errorBody("BAD_REQUEST", [refIssue(roundRef, ref.error)]));
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const found = resolveRound(db, projectId, ref.value);
  if (found.length === 0) {
    if (ref.value.kind === "stage") {
      const text = roundsCopy.show.stageNotFound;
      const name = `${stage.label(ref.value.stage)}阶段`;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, stage: name }),
        hint: renderCopy(text.hint),
        where: roundRef,
      });
    }
    if (ref.value.kind === "legacy") {
      const text = roundsCopy.show.legacyNotFound;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, legacy: ref.value.legacy.id }),
        hint: renderCopy(text.hint),
        where: roundRef,
      });
    }
    const text = roundsCopy.close.notFound;
    const name = formatRoundName(ref.value.label);
    return fail("NOT_FOUND", {
      message: renderCopy(text.message, { project: projectId, round: name }),
      hint: renderCopy(text.hint),
      where: name,
    });
  }
  const [row, ...others] = found;
  if (row === undefined || others.length > 0) {
    const text = roundsCopy.show.legacyAmbiguous;
    const labels = found.map((round) => formatRoundName(round)).join("、");
    return fail("BAD_REQUEST", {
      message: renderCopy(text.message, { legacy: roundRef, count: found.length, labels }),
      hint: renderCopy(text.hint),
      where: roundRef,
    });
  }
  return ok(row);
}

/** 写法不对：以 v 加数字开头的按新写法报，其余报两种都不是。 */
function refIssue(text: string, error: RoundRefError): Issue {
  if (error !== "unknown") return roundLabelIssue(text, error);
  const copy = parseCopy.roundRef.unknown;
  return {
    message: renderCopy(copy.message, { text }),
    hint: renderCopy(copy.hint),
    where: text,
  };
}

/** 按新写法找到的一轮，或按旧编号找到的几轮，按开始的先后排。 */
function resolveRound(db: Reader, projectId: string, ref: RoundRef): RoundRow[] {
  if (ref.kind === "label") {
    const row = findRound(db, projectId, ref.label);
    return row === undefined ? [] : [row];
  }
  if (ref.kind === "stage") {
    const latest = roundsOf(db, projectId, currentVersionRow(db, projectId).version)
      .filter((round) => round.stage === ref.stage)
      .at(-1);
    return latest === undefined ? [] : [latest];
  }
  return db
    .select()
    .from(rounds)
    .where(and(eq(rounds.projectId, projectId), eq(rounds.legacyId, ref.legacy.id)))
    .orderBy(asc(rounds.ordinal))
    .all();
}

function detailOf(db: Reader, row: RoundRow): RoundDetail {
  return {
    round: toRoundView(row),
    openedBySession: row.openedBySession,
    openedByClient: row.openedByClient,
    baseCommits: row.baseCommits,
    summary: row.closeNote,
    items: itemsOf(db, row),
    pages: pagesOf(db, row.id),
    replies: repliesOf(db, row.id),
  };
}

/** 这一轮每一页收到的回复，按页序号排。 */
function repliesOf(db: Reader, roundId: number): SubmissionView[] {
  return db
    .select({ submission: submissions })
    .from(submissions)
    .innerJoin(pages, eq(pages.id, submissions.pageId))
    .where(eq(pages.roundId, roundId))
    .orderBy(asc(pages.seq), asc(submissions.id))
    .all()
    .map(({ submission }) => toSubmissionView(db, submission));
}

/** 拿出的每件事，队列事项取现在的样子，按编号排。 */
function itemsOf(db: Reader, row: RoundRow): RoundItemView[] {
  const taken = db
    .select({ number: queueItems.number, entry: roundItems })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .where(eq(roundItems.roundId, row.id))
    .orderBy(asc(queueItems.number))
    .all();
  if (taken.length === 0) return [];
  const listed = listQueueItems(db, row.projectId);
  // 调用的一方已经确认项目存在。
  if (!listed.ok) throw new Error(listed.error.message);
  const byNumber = new Map(listed.value.map((item) => [item.id, item]));
  return taken.map(({ number, entry }) => {
    const item = byNumber.get(formatQueueId(number));
    if (item === undefined) throw new Error(`拿出的事 ${formatQueueId(number)} 不在队列里。`);
    return { item, result: entry.result, returnedTo: entry.returnedTo, note: entry.note };
  });
}

function pagesOf(db: Reader, roundId: number): RoundPageView[] {
  return db
    .select()
    .from(pages)
    .where(eq(pages.roundId, roundId))
    .orderBy(asc(pages.seq))
    .all()
    .map((page) => ({
      id: page.id,
      seq: page.seq,
      purpose: page.purpose,
      status: page.status,
      presentedAt: iso(page.presentedAt),
      withdrawnAt: isoOrNull(page.withdrawnAt),
    }));
}
