import {
  clientHeader,
  type ErrorBody,
  err,
  errorBody,
  handledLinesSchema,
  ok,
  type Result,
  renderCopy,
  replyHandleInputSchema,
  replyLinesSchema,
  sessionHeader,
  submissionRequestSchema,
  submissionTextSchema,
  submissionViewSchema,
  submissionWaitQuerySchema,
  submissionWaitSchema,
  submittedReplySchema,
} from "@product-loop/model";
import { type Context, Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import { handleLines } from "../../core/replies/handle.ts";
import { latestSubmissionOf, linesOfSubmission, submissionById } from "../../core/replies/read.ts";
import { type SubmitInput, submitReply } from "../../core/replies/submit.ts";
import { waitForReply } from "../../core/replies/wait.ts";
import type { WriteContext } from "../../core/tx.ts";
import { type BlobHash, hasBlob } from "../../store/blobs.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";
import { pageIdOf } from "./pages.ts";

// 回复的接口：提交、等回复、每一行和去处，见「05 接口」第四节和第六节。业务规则在 core/replies/。
// 等回复是长轮询：?wait=50 最多挂起五十秒，其间提交了立即返回，到时返回 {status: "等待中"}。
// 请求断开或后端开始退出时也返回等待中，命令行再发下一次，见「01 架构」第六节。
// 页面已撤回或所在的轮次已经收尾，返回 PAGE_GONE，状态码 410。

/** 回复的编号：从 1 起的整数。写得不对时返回 BAD_REQUEST。 */
function submissionIdOf(text: string): Result<number, ErrorBody<"BAD_REQUEST">> {
  const id = /^[1-9]\d*$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(id)) return ok(id);
  const copy = httpCopy.number.submission;
  const issue = { message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint) };
  return err(errorBody("BAD_REQUEST", [{ ...issue, where: text }]));
}

/**
 * 等回复的上下文。等回复是读请求，只在第一次取走回复时顺带记一笔，不带请求编号。
 * 读请求可以不带 X-Ploop-Client，没带时执行者写 unknown。
 */
function pollContext(c: Context, deps: AppDeps): WriteContext {
  return {
    db: deps.db,
    notifier: deps.notifier,
    now: deps.now,
    actor: {
      client: c.req.header(clientHeader) || "unknown",
      session: c.req.header(sessionHeader) || undefined,
    },
    idempotency: undefined,
  };
}

export function submissionRoutes(deps: AppDeps) {
  const store = { db: deps.db, dir: deps.paths.dirs.blobs };
  const submitDeps = { hasBlob: (hash: BlobHash) => hasBlob(store, hash) };
  const submit = (c: Context, id: string, input: SubmitInput) => {
    const pageId = pageIdOf(id);
    if (!pageId.ok) return pageId;
    const ctx = writeContext(c, deps);
    return submitReply(ctx, c.req.param("pid") ?? "", pageId.value, input, submitDeps);
  };
  return (
    new Hono()
      /** 提交回复。工作台的提交按钮用，同一页只能提交一次。 */
      .post("/projects/:pid/pages/:id/submission", ...jsonBody(submissionRequestSchema), (c) => {
        const { source, ...body } = c.req.valid("json");
        const result = submit(c, c.req.param("id"), { ...body, source: source ?? "workbench" });
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...submitted } = result.value;
        return reply(c, 201, submittedReplySchema, submitted, { warnings, next });
      })
      /** 收下对话里贴回的文字，按旧格式拆成一行一行。ploop reply ingest 用。 */
      .post("/projects/:pid/pages/:id/submission/text", ...jsonBody(submissionTextSchema), (c) => {
        const result = submit(c, c.req.param("id"), { ...c.req.valid("json"), source: "chat" });
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...submitted } = result.value;
        return reply(c, 201, submittedReplySchema, submitted, { warnings, next });
      })
      /** 取回复，还没提交时最多挂起 wait 秒。ploop reply wait 反复请求它。 */
      .get(
        "/projects/:pid/pages/:id/submission",
        queryParams(submissionWaitQuerySchema),
        async (c) => {
          const pageId = pageIdOf(c.req.param("id"));
          if (!pageId.ok) return failure(c, pageId.error);
          const { wait = 0 } = c.req.valid("query");
          const stop = new AbortController();
          const abort = () => stop.abort();
          const offStopping = deps.process.onStopping(abort);
          const closed = c.req.raw.signal;
          closed.addEventListener("abort", abort, { once: true });
          try {
            const result = await waitForReply(
              pollContext(c, deps),
              c.req.param("pid"),
              pageId.value,
              {
                timeoutMs: wait * 1000,
                signal: stop.signal,
                clock: deps.waitClock,
              },
            );
            if (!result.ok) return failure(c, result.error);
            return reply(c, 200, submissionWaitSchema, result.value);
          } finally {
            offStopping();
            closed.removeEventListener("abort", abort);
          }
        },
      )
      /** 最近提交的一份回复。ploop reply show 不写编号时用。还没有回复时 data 为 null。 */
      .get("/projects/:pid/submissions/latest", (c) => {
        const result = latestSubmissionOf(deps.db, c.req.param("pid"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, submissionViewSchema.nullable(), result.value);
      })
      /** 一份回复和它的每一行。 */
      .get("/projects/:pid/submissions/:sid", (c) => {
        const id = submissionIdOf(c.req.param("sid"));
        if (!id.ok) return failure(c, id.error);
        const result = submissionById(deps.db, c.req.param("pid"), id.value);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, submissionViewSchema, result.value);
      })
      /** 回复的每一行，带着去处和图。ploop reply show 用。 */
      .get("/projects/:pid/submissions/:sid/lines", (c) => {
        const id = submissionIdOf(c.req.param("sid"));
        if (!id.ok) return failure(c, id.error);
        const result = linesOfSubmission(deps.db, c.req.param("pid"), id.value);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, replyLinesSchema, result.value);
      })
      /** 处理一到多行，给出去处。ploop reply handle 用。 */
      .post(
        "/projects/:pid/submissions/:sid/destinations",
        ...jsonBody(replyHandleInputSchema),
        (c) => {
          const id = submissionIdOf(c.req.param("sid"));
          if (!id.ok) return failure(c, id.error);
          const ctx = writeContext(c, deps);
          const result = handleLines(ctx, c.req.param("pid"), id.value, c.req.valid("json"));
          if (!result.ok) return failure(c, result.error);
          const { warnings, next, ...handled } = result.value;
          return reply(c, 200, handledLinesSchema, handled, { warnings, next });
        },
      )
  );
}
