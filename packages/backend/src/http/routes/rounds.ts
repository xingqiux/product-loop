import {
  closedRoundSchema,
  roundCloseSchema,
  roundDetailSchema,
  roundStartSchema,
  startedRoundSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { closeRound } from "../../core/rounds/close.ts";
import { roundDetail } from "../../core/rounds/show.ts";
import { startRound } from "../../core/rounds/start.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply, respond } from "../respond.ts";
import { jsonBody } from "../validate.ts";

// 轮次的接口，见「05 接口」第四节。按约定 0001 第 4 条挂在 /projects/:pid 下面，业务规则都在内核里。
// 开始一轮的请求带 X-Ploop-Session 时，记下是哪个会话开的，冲突的报错写明它，见约定 0002 第 12 条。
// 路径里的轮次写轮次的写法或旧编号，要编码：旧编号里的斜杠写成 %2F。Hono 按编码后的路径分段，
// 取参数时再解码，所以带斜杠的旧编号仍是一段。
// 内核给的下一步和警告放进响应外壳的 next 和 warnings。

export function roundRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 开始一轮：先替已回复的上一轮收尾，再编好轮次，拿出这个阶段的事。ploop round start 用。 */
      .post("/projects/:pid/rounds", ...jsonBody(roundStartSchema), (c) => {
        const input = c.req.valid("json");
        const result = startRound(writeContext(c, deps), c.req.param("pid"), input);
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...started } = result.value;
        return reply(c, 201, startedRoundSchema, started, { warnings, next });
      })
      /** 一轮的状态、拿出来的事和给出过的页。ploop round show 和工作台里这一轮的页面用。 */
      .get("/projects/:pid/rounds/:rid", (c) => {
        const result = roundDetail(deps.db, c.req.param("pid"), c.req.param("rid"));
        return respond(c, result, 200, roundDetailSchema);
      })
      /** 收尾：拿出的每件事都要有结果。ploop round close 用。 */
      .post("/projects/:pid/rounds/:rid/close", ...jsonBody(roundCloseSchema), (c) => {
        const ctx = writeContext(c, deps);
        const input = c.req.valid("json");
        const result = closeRound(ctx, c.req.param("pid"), c.req.param("rid"), input);
        if (!result.ok) return failure(c, result.error);
        const { next, ...closed } = result.value;
        return reply(c, 200, closedRoundSchema, closed, { next });
      })
  );
}
