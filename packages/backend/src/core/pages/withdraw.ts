import {
  type ErrorBody,
  formatRoundLabel,
  ok,
  type Result,
  type RoundStatus,
  renderCopy,
} from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { pagesCopy } from "../../copy/pages.ts";
import { pages, rounds } from "../../store/schema/index.ts";
import { appendEvent } from "../events.ts";
import { fail, type Reader, requireWritable } from "../projects.ts";
import { withdrawnNext } from "../rounds/next.ts";
import { type WriteContext, writeTx } from "../tx.ts";
import { findPage, pageNotFound } from "./fill.ts";
import { pageNameOf } from "./lookup.ts";
import { type PageSummary, toPageSummary } from "./present.ts";

// 撤回一页：`ploop page withdraw`，接口是 POST /pages/:id/withdraw，见「05 接口」第四节。
// 页面数据给出以后不改，出错只能撤回再给出一页。旧的一页留着，状态是已撤回，见「03 数据模型」第二节。
// 在等这一页的 ploop reply wait 随之以退出码 8 结束，由第 43 步的等待原语返回 PAGE_GONE。
// 只有已给出的页能撤回。用户已经回复的页不能撤回，回复要逐行处理。
// 要用户点的页撤回以后，这一轮不再等用户：用户回复过这一轮别的页时回到已回复，否则回到进行中。

/** 撤回的结果。接口层把 next 放进响应外壳，其余是 data。 */
export type WithdrawnPage = {
  readonly page: PageSummary;
  /** 撤回以后这一轮的状态。 */
  readonly roundStatus: RoundStatus;
  /** 下一步：一条完整的命令。 */
  readonly next: readonly string[];
};

type Failure = ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR">;

/**
 * 撤回一页，写明原因。原因可以不写，写了不能是空白。
 * 在一个写事务里依次做，任何一步不通过就什么都不写：
 * 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
 * 2. 页面要在这个项目里，找不到返回 NOT_FOUND。已经撤回、已经回复的返回 CONFLICT。
 * 3. 页面改成已撤回，记下时间和原因。要用户点的页，这一轮的状态随之改回。
 * 4. 记一条 page.withdrawn。
 */
export function withdrawPage(
  ctx: WriteContext,
  projectId: string,
  pageId: number,
  reason?: string,
): Result<WithdrawnPage, Failure> {
  const note = reason?.trim();
  if (note === "") {
    const text = pagesCopy.withdraw.reasonBlank;
    return fail("BAD_REQUEST", {
      message: renderCopy(text.message),
      hint: renderCopy(text.hint),
      where: "reason",
    });
  }
  return writeTx<WithdrawnPage, Exclude<Failure, ErrorBody<"BAD_REQUEST">>>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const row = findPage(w.tx, pageId);
    if (row === undefined) return pageNotFound(pageId);
    if (row.projectId !== projectId) {
      const text = pagesCopy.page.otherProject;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, page: pageId }),
        hint: renderCopy(text.hint),
        where: String(pageId),
      });
    }
    if (row.status !== "presented") {
      const text =
        row.status === "withdrawn" ? pagesCopy.withdraw.withdrawn : pagesCopy.withdraw.replied;
      const name = pageNameOf(w.tx, row);
      return fail("CONFLICT", {
        message: renderCopy(text.message, { page: name }),
        hint: renderCopy(text.hint),
        where: name,
      });
    }
    const withdrawn = w.tx
      .update(pages)
      .set({ status: "withdrawn", withdrawnAt: w.now, withdrawReason: note ?? null })
      .where(eq(pages.id, row.id))
      .returning()
      .get();
    const round = w.tx.select().from(rounds).where(eq(rounds.id, row.roundId)).get();
    // 页面挂在存在的轮次上，由外键保证。
    if (round === undefined) throw new Error(`阶段 ${row.roundId} 不存在，数据不一致。`);
    let roundStatus = round.status;
    if (row.purpose === "ask" && round.status === "waiting") {
      roundStatus = anyReplied(w.tx, round.id) ? "replied" : "open";
      w.tx.update(rounds).set({ status: roundStatus }).where(eq(rounds.id, round.id)).run();
    }
    const page = toPageSummary(withdrawn, formatRoundLabel(round));
    appendEvent(w, {
      projectId,
      kind: "page.withdrawn",
      objectType: "page",
      objectId: String(row.id),
      detail: { round: page.round, page: row.id, reason: note, roundStatus },
    });
    return ok({ page, roundStatus, next: withdrawnNext() });
  });
}

/** 这一轮有没有用户回复过的页。 */
function anyReplied(db: Reader, roundId: number): boolean {
  const row = db
    .select({ id: pages.id })
    .from(pages)
    .where(and(eq(pages.roundId, roundId), eq(pages.status, "replied")))
    .get();
  return row !== undefined;
}
