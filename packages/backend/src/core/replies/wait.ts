import { type ErrorBody, formatRoundName, ok, type Result, renderCopy } from "@product-loop/model";
import { and, eq, isNull } from "drizzle-orm";
import { repliesCopy } from "../../copy/replies.ts";
import { rounds, submissions } from "../../store/schema/index.ts";
import { appendEvent, type StoredEvent } from "../events.ts";
import { pageNameOf } from "../pages/lookup.ts";
import { fail } from "../projects.ts";
import { type WriteContext, writeTx } from "../tx.ts";
import { pageInProject, type SubmissionView, toSubmissionView } from "./read.ts";

// 等回复的原语：`ploop reply wait` 的长轮询，接口是 GET /pages/:id/submission?wait=50。
// 行为见「05 接口」第六节和「04 命令行」第八节：
// - 已经有回复，立即返回回复和它的行。
// - 还没有回复，等到提交、撤回或者到时。提交的事务提交以后发出事件，这里随之醒来。
//   到时还没有回复，返回等待中。调用的一方中止时也返回等待中，例如后端正在关闭。
// - 这一页已撤回，或者所在的轮次已经收尾，返回 PAGE_GONE。
// 等的时候不占着事务：先订阅提交以后的事件，再读一次库，醒来以后再读一次。
// 第一次把回复交出去时，记下「回复已被取走」，发出 reply.received，工作台据此显示「AI 已收到」。

/** 等回复用的计时器。测试里换成假的。 */
export type WaitClock = {
  setTimeout(fire: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

export const systemClock: WaitClock = {
  setTimeout: (fire, ms) => setTimeout(fire, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type WaitOptions = {
  /** 最多等多少毫秒。0 表示只看一眼，不等。 */
  readonly timeoutMs: number;
  /** 中止时立即返回等待中。接口层在请求断开或后端关闭时中止。 */
  readonly signal?: AbortSignal | undefined;
  readonly clock?: WaitClock | undefined;
};

/** 等的结果：有了回复，或者还在等。接口上还在等写成 {status: "等待中"}。 */
export type ReplyWait =
  | { readonly status: "submitted"; readonly submission: SubmissionView }
  | { readonly status: "waiting" };

type Failure = ErrorBody<"NOT_FOUND" | "PAGE_GONE">;

/** 让在等的一方醒来的事件：提交、撤回、收尾。醒来以后重新读库，所以不用细分是哪一页。 */
const wakeKinds: ReadonlySet<string> = new Set([
  "submission.created",
  "page.withdrawn",
  "round.closed",
]);

/** 等这一页的回复。步骤见文件开头。 */
export async function waitForReply(
  ctx: WriteContext,
  projectId: string,
  pageId: number,
  options: WaitOptions,
): Promise<Result<ReplyWait, Failure>> {
  const clock = options.clock ?? systemClock;
  const { signal } = options;
  let wake = () => {};
  let woken = false;
  // 先订阅再读库：读库和开始等之间提交的回复，也能叫醒这里。
  const unsubscribe = ctx.notifier.subscribe((event: StoredEvent) => {
    if (event.projectId !== projectId || !wakeKinds.has(event.kind)) return;
    woken = true;
    wake();
  });
  try {
    const first = look(ctx, projectId, pageId);
    if (!first.ok || first.value.status === "submitted") return first;
    if (options.timeoutMs <= 0 || signal?.aborted === true) return first;
    await new Promise<void>((resolve) => {
      const done = () => {
        clock.clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = clock.setTimeout(done, options.timeoutMs);
      signal?.addEventListener("abort", done, { once: true });
      wake = done;
      if (woken) done();
    });
    return look(ctx, projectId, pageId);
  } finally {
    unsubscribe();
  }
}

/** 读一次库：页面没了返回 PAGE_GONE，有回复就取走，否则还在等。 */
function look(ctx: WriteContext, projectId: string, pageId: number): Result<ReplyWait, Failure> {
  const found = pageInProject(ctx.db, projectId, pageId);
  if (!found.ok) return found;
  const page = found.value;
  const row = ctx.db.select().from(submissions).where(eq(submissions.pageId, pageId)).get();
  if (row !== undefined) {
    if (row.takenAt === null) markTaken(ctx, projectId, row.id, pageId);
    const taken = ctx.db.select().from(submissions).where(eq(submissions.id, row.id)).get() ?? row;
    return ok({ status: "submitted", submission: toSubmissionView(ctx.db, taken) });
  }
  const text = repliesCopy.page;
  const name = pageNameOf(ctx.db, page);
  const where = name;
  if (page.status === "withdrawn") {
    return fail("PAGE_GONE", {
      message: renderCopy(text.withdrawn.message, { page: name }),
      hint: renderCopy(text.withdrawn.hint),
      where,
    });
  }
  const round = ctx.db.select().from(rounds).where(eq(rounds.id, page.roundId)).get();
  if (round === undefined || round.status === "closed") {
    const roundName = round === undefined ? "" : formatRoundName(round);
    return fail("PAGE_GONE", {
      message: renderCopy(text.closed.message, { round: roundName, seq: page.seq }),
      hint: renderCopy(text.closed.hint),
      where,
    });
  }
  return ok({ status: "waiting" });
}

/**
 * 记下回复已被取走，发出 reply.received。只记第一次，重复运行 ploop reply wait 不再发。
 * 这是读回复时顺带记的一笔，不带请求编号，也不查项目要不要先体检：要先体检的项目照常能取回复。
 */
function markTaken(ctx: WriteContext, projectId: string, submissionId: number, pageId: number) {
  writeTx({ ...ctx, idempotency: undefined }, (w) => {
    const taken = w.tx
      .update(submissions)
      .set({ takenAt: w.now })
      .where(and(eq(submissions.id, submissionId), isNull(submissions.takenAt)))
      .returning({ id: submissions.id })
      .get();
    if (taken !== undefined) {
      appendEvent(w, {
        projectId,
        kind: "reply.received",
        objectType: "submission",
        objectId: String(submissionId),
        detail: { page: pageId, submission: submissionId },
      });
    }
    return ok(null);
  });
}
