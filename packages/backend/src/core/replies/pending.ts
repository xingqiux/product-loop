import {
  formatRoundLabel,
  type ReplyLine,
  type UnclearTerm,
  type UnhandledReply,
} from "@product-loop/model";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { pages, replyLines, rounds, submissions } from "../../store/schema/index.ts";
import type { Reader } from "../projects.ts";
import { toSubmissionView } from "./read.ts";

// 依赖回复的几样东西，给出信息、开始一轮和页面的填充用：
// - 还有行没处理的回复：规则 reply.line.handled 的上下文，见 core/rules/replies.ts。
// - 上一份回复点了不明白的术语：规则 align.unclear.reworded 的上下文，见 core/rules/align.ts。
// - 上一份回复的每一行和去处：页面顶上的「上一轮的回复去了哪里」，见「06 工作台」第四节。
// 上一份回复指这个项目最近提交的一份，也就是下一页要接着回答的那一份。

/**
 * 这个项目里还有行没处理的回复，按回复的先后排，行号从小到大。
 * 查的是全部回复，不只最近的一份。以前的回复漏了哪一行，也要先处理完。
 */
export function unhandledReplies(db: Reader, projectId: string): UnhandledReply[] {
  const rows = db
    .select({ submission: replyLines.submissionId, line: replyLines.line, round: rounds })
    .from(replyLines)
    .innerJoin(submissions, eq(submissions.id, replyLines.submissionId))
    .innerJoin(pages, eq(pages.id, submissions.pageId))
    .innerJoin(rounds, eq(rounds.id, pages.roundId))
    .where(and(eq(replyLines.projectId, projectId), isNull(replyLines.destination)))
    .orderBy(asc(replyLines.submissionId), asc(replyLines.line))
    .all();
  const replies: { submission: number; round: string; lines: number[] }[] = [];
  for (const row of rows) {
    const last = replies.at(-1);
    if (last?.submission === row.submission) last.lines.push(row.line);
    else {
      const round = formatRoundLabel(row.round);
      replies.push({ submission: row.submission, round, lines: [row.line] });
    }
  }
  return replies;
}

/** 这个项目最近提交的一份回复。还没有回复时为 undefined。 */
function latestSubmission(db: Reader, projectId: string) {
  return db
    .select()
    .from(submissions)
    .where(eq(submissions.projectId, projectId))
    .orderBy(desc(submissions.id))
    .limit(1)
    .get();
}

/**
 * 上一份回复里点了不明白的术语：先对齐区块里种类是不明白的行，按卡片编号在那一页上找到这一项。
 * 取那一页上写的名称、意思和例子，按行号排。卡片编号对不上的行不算。
 */
export function unclearTermsOf(db: Reader, projectId: string): UnclearTerm[] {
  const latest = latestSubmission(db, projectId);
  if (latest === undefined) return [];
  const page = db
    .select({ sections: pages.sections, round: rounds })
    .from(pages)
    .innerJoin(rounds, eq(rounds.id, pages.roundId))
    .where(eq(pages.id, latest.pageId))
    .get();
  // 回复挂在存在的页面上，页面挂在存在的轮次上，由外键保证。
  if (page === undefined) throw new Error(`页面 ${latest.pageId} 不存在，数据不一致。`);
  const cards = db
    .select({ card: replyLines.card })
    .from(replyLines)
    .where(
      and(
        eq(replyLines.submissionId, latest.id),
        eq(replyLines.kind, "notUnderstood"),
        eq(replyLines.section, "align"),
      ),
    )
    .orderBy(asc(replyLines.line))
    .all();
  const round = formatRoundLabel(page.round);
  return cards.flatMap(({ card }) => {
    const term = (page.sections.align ?? []).find((item) => item.id === card);
    if (term === undefined) return [];
    return [{ name: term.name, meaning: term.meaning, example: term.example, round }];
  });
}

/** 上一轮的回复去了哪里：哪一份回复、回复的哪一页和轮次，以及每一行和它的去处。 */
export type PreviousReplies = {
  readonly submission: number;
  readonly page: number;
  /** 回复的那一页所在的轮次，写成 v1-构思-3。 */
  readonly round: string;
  readonly submittedAt: string;
  /** 每一行，按行号排。处理过的带着去处，没处理的没有。 */
  readonly lines: readonly ReplyLine[];
};

/** 上一份回复和每一行的去处。还没有回复时为 null。 */
export function previousRepliesOf(db: Reader, projectId: string): PreviousReplies | null {
  const latest = latestSubmission(db, projectId);
  if (latest === undefined) return null;
  const view = toSubmissionView(db, latest);
  return {
    submission: view.id,
    page: view.page,
    round: view.round,
    submittedAt: view.submittedAt,
    lines: view.lines,
  };
}
