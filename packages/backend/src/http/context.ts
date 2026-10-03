import { clientHeader, idempotencyHeader, sessionHeader } from "@product-loop/model";
import type { Context } from "hono";
import type { WriteContext } from "../core/tx.ts";
import type { AppDeps } from "./deps.ts";

/**
 * 一个写请求的上下文，见「05 接口」第三节和 core/tx.ts。
 * - 执行者：客户端取自 X-Ploop-Client，安全检查已确认写请求都带着它。会话取自 X-Ploop-Session，没带就不写。
 * - 请求编号：取自 Idempotency-Key。命令行每个请求生成一个，只在重发同一个请求时沿用。
 *   操作写方法和路由，例如 POST /api/v1/projects/:pid/versions/next。
 * 要在路由的处理函数里调用，这时 c.req.routePath 才是这个路由。
 */
export function writeContext(c: Context, deps: AppDeps): WriteContext {
  const client = c.req.header(clientHeader);
  if (!client) throw new Error(`写请求没有 ${clientHeader}，安全检查应当已经拦下它。`);
  const key = c.req.header(idempotencyHeader);
  return {
    db: deps.db,
    notifier: deps.notifier,
    now: deps.now,
    actor: { client, session: c.req.header(sessionHeader) || undefined },
    idempotency:
      key === undefined ? undefined : { key, operation: `${c.req.method} ${c.req.routePath}` },
  };
}
