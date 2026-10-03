import {
  decisionAddSchema,
  decisionEditSchema,
  decisionListSchema,
  decisionQuerySchema,
  decisionSchema,
  decisionVoidSchema,
  type ErrorBody,
  err,
  errorBody,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import {
  addDecision,
  editDecision,
  getDecision,
  listDecisions,
  voidDecision,
} from "../../core/decisions.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, respond } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 决定的接口，见「05 接口」第四节。按约定 0001 第 4 条挂在 /projects/:pid 下面，业务规则都在内核里。
// 新增时缺了决定、原因或案例，由内核按规矩 decision.fields 拦截，一次报齐。
// 改文字时只改决定、原因、案例，已作废的也能改，编号和日期不变。
// 作废时写明被哪一条推翻，这一条原地留着。取一条时，已作废的也取得到。
// 列出时默认只列有效的，写 ?includeVoided=true 连已作废的一起列。

/** 决定的编号：从 1 起的整数，不补 0。写得不对时返回 BAD_REQUEST，位置写路径里的原文。 */
function decisionIdOf(text: string): Result<number, ErrorBody<"BAD_REQUEST">> {
  const id = /^[1-9]\d*$/u.test(text) ? Number(text) : Number.NaN;
  if (Number.isSafeInteger(id)) return ok(id);
  const copy = httpCopy.number.decision;
  const issue = { message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint) };
  return err(errorBody("BAD_REQUEST", [{ ...issue, where: text }]));
}

export function decisionRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 一个项目的决定，按编号排。ploop decision list、重写决定.md 和工作台的决定页用。 */
      .get("/projects/:pid/decisions", queryParams(decisionQuerySchema), (c) => {
        const { includeVoided } = c.req.valid("query");
        const result = listDecisions(deps.db, c.req.param("pid"), { includeVoided });
        return respond(c, result, 200, decisionListSchema);
      })
      /** 新增一条，编号和日期由后端填。ploop decision add 用。 */
      .post("/projects/:pid/decisions", ...jsonBody(decisionAddSchema), (c) => {
        const result = addDecision(writeContext(c, deps), c.req.param("pid"), c.req.valid("json"));
        return respond(c, result, 201, decisionSchema);
      })
      /** 一条决定，已作废的也取得到。工作台按下编号时用。 */
      .get("/projects/:pid/decisions/:id", (c) => {
        const id = decisionIdOf(c.req.param("id"));
        if (!id.ok) return failure(c, id.error);
        return respond(c, getDecision(deps.db, c.req.param("pid"), id.value), 200, decisionSchema);
      })
      /** 改一条的文字，编号和日期不变，已作废的也能改。ploop decision edit 用。 */
      .patch("/projects/:pid/decisions/:id", ...jsonBody(decisionEditSchema), (c) => {
        const id = decisionIdOf(c.req.param("id"));
        if (!id.ok) return failure(c, id.error);
        const ctx = writeContext(c, deps);
        const result = editDecision(ctx, c.req.param("pid"), id.value, c.req.valid("json"));
        return respond(c, result, 200, decisionSchema);
      })
      /** 作废一条，写明被哪一条推翻。ploop decision void 用。 */
      .post("/projects/:pid/decisions/:id/void", ...jsonBody(decisionVoidSchema), (c) => {
        const id = decisionIdOf(c.req.param("id"));
        if (!id.ok) return failure(c, id.error);
        const ctx = writeContext(c, deps);
        const result = voidDecision(ctx, c.req.param("pid"), id.value, c.req.valid("json"));
        return respond(c, result, 200, decisionSchema);
      })
  );
}
