import {
  type ErrorBody,
  err,
  errorBody,
  filledPageSchema,
  ok,
  pageCheckReportSchema,
  pageCheckRequestSchema,
  pagePresentRequestSchema,
  pageWithdrawRequestSchema,
  presentedPageSchema,
  type Result,
  renderCopy,
  withdrawnPageSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import { checkPageAndRecord } from "../../core/pages/check.ts";
import { fillProjectPage } from "../../core/pages/fill.ts";
import { presentPage } from "../../core/pages/present.ts";
import { withdrawPage } from "../../core/pages/withdraw.ts";
import { type BlobHash, hasBlob } from "../../store/blobs.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply, respond } from "../respond.ts";
import { jsonBody } from "../validate.ts";

// 页面的接口，见「05 接口」第四节和第十节。按约定 0001 第 4 条挂在 /projects/:pid 下面，
// 轮次写在请求体里。业务规则都在内核里，见 core/pages/。
// 截图要先经附件的接口上传，这里按哈希问附件库有没有完整的一份，见「05 接口」第七节。
// 给出信息时，有一页在等返回 CONFLICT，别的拦截返回 RULE_BLOCKED，警告放进外壳的 warnings。
// 只校验时，有拦截也是成功的响应，拦截和警告都在 data 里，由命令行决定退出码。
// 工作台里这一轮的地址带着中文的轮次，响应里按 URL 的写法编码。

/** 页面的编号：从 1 起的整数。写得不对时返回 BAD_REQUEST，位置写路径里的原文。 */
export function pageIdOf(text: string): Result<number, ErrorBody<"BAD_REQUEST">> {
  const id = /^[1-9]\d*$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(id)) return ok(id);
  const copy = httpCopy.number.page;
  const issue = { message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint) };
  return err(errorBody("BAD_REQUEST", [{ ...issue, where: text }]));
}

export function pageRoutes(deps: AppDeps) {
  const store = { db: deps.db, dir: deps.paths.dirs.blobs };
  const blobDeps = { hasBlob: (hash: BlobHash) => hasBlob(store, hash) };
  return (
    new Hono()
      /** 只校验，不给出，每条命中照样记下。ploop page check 用。 */
      .post("/projects/:pid/pages/check", ...jsonBody(pageCheckRequestSchema), (c) => {
        const { round, ...body } = c.req.valid("json");
        const input = {
          ...body,
          command: "page check" as const,
          run: { mode: "current" as const, round },
        };
        const ctx = writeContext(c, deps);
        const result = checkPageAndRecord(ctx, c.req.param("pid"), input, blobDeps);
        return respond(c, result, 200, pageCheckReportSchema);
      })
      /** 给出信息：校验、填充、存成一页，返回页面的编号和工作台里的地址。ploop page present 用。 */
      .post("/projects/:pid/pages", ...jsonBody(pagePresentRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const result = presentPage(ctx, c.req.param("pid"), c.req.valid("json"), blobDeps);
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, path, ...presented } = result.value;
        const data = { ...presented, path: encodeURI(path) };
        return reply(c, 201, presentedPageSchema, data, { warnings, next });
      })
      /** 填好的一页，带着后端填的部分和原文摘录。工作台里每一轮的页面用。 */
      .get("/projects/:pid/pages/:id", (c) => {
        const id = pageIdOf(c.req.param("id"));
        if (!id.ok) return failure(c, id.error);
        const result = fillProjectPage(deps.db, c.req.param("pid"), id.value);
        return respond(c, result, 200, filledPageSchema);
      })
      /** 撤回在等的一页，可以写原因。ploop page withdraw 用。 */
      .post("/projects/:pid/pages/:id/withdraw", ...jsonBody(pageWithdrawRequestSchema), (c) => {
        const id = pageIdOf(c.req.param("id"));
        if (!id.ok) return failure(c, id.error);
        const ctx = writeContext(c, deps);
        const { reason } = c.req.valid("json");
        const result = withdrawPage(ctx, c.req.param("pid"), id.value, reason);
        if (!result.ok) return failure(c, result.error);
        const { next, ...withdrawn } = result.value;
        return reply(c, 200, withdrawnPageSchema, withdrawn, { next });
      })
  );
}
