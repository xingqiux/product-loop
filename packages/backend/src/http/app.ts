import { errorBody, errorCodeCopyOf, renderCopy } from "@product-loop/model";
import { type Context, Hono } from "hono";
import { httpCopy } from "../copy/http.ts";
import type { AppDeps } from "./deps.ts";
import { processGate } from "./gate.ts";
import { failure } from "./respond.ts";
import { adminRoutes } from "./routes/admin.ts";
import { blobRoutes } from "./routes/blobs.ts";
import { decisionRoutes } from "./routes/decisions.ts";
import { draftRoutes } from "./routes/drafts.ts";
import { eventRoutes } from "./routes/events.ts";
import { healthRoutes } from "./routes/health.ts";
import { landRoutes } from "./routes/land.ts";
import { legacyRoutes } from "./routes/legacy.ts";
import { mainlineRoutes } from "./routes/mainline.ts";
import { pageRoutes } from "./routes/pages.ts";
import { projectRoutes } from "./routes/projects.ts";
import { queueRoutes } from "./routes/queue.ts";
import { roundRoutes } from "./routes/rounds.ts";
import { schemaRoutes } from "./routes/schema.ts";
import { skillRoutes } from "./routes/skill.ts";
import { storageRoutes } from "./routes/storage.ts";
import { submissionRoutes } from "./routes/submissions.ts";
import { useRoutes } from "./routes/use.ts";
import { versionRoutes } from "./routes/versions.ts";
import { webRoutes } from "./routes/web.ts";
import { checkClient, checkHost, checkOrigin, limitBody } from "./security.ts";

// 接口层：只做解析和检查，业务规则都在内核里，见「05 接口」第十节。
// 每个请求先过安全检查，再过进程的状态（见 gate.ts），然后按资源分到各个子应用。
// 子应用按资源拆开，类型检查不会太慢。
// 内核的结果统一由 respond.ts 变成响应外壳。没有的接口返回 NOT_FOUND。
// 没有接住的错误返回 INTERNAL，详情写进日志。

/** 建一个接口应用。进程入口把它交给 Node 的服务器，测试直接用 app.request 调用。 */
export function createApp(deps: AppDeps) {
  const app = new Hono();
  app.notFound((c) => {
    const text = httpCopy.notFound;
    const message = renderCopy(text.message, { method: c.req.method, path: c.req.path });
    return failure(c, errorBody("NOT_FOUND", [{ message, hint: renderCopy(text.hint) }]));
  });
  app.onError((error, c) => unexpected(c, error, deps));
  const checked = app.use(
    checkHost(deps.port),
    checkOrigin(deps.port),
    checkClient,
    limitBody,
    processGate(deps),
  );
  // 工作台的静态文件不在 /api/v1 下面，也不进类型化客户端。
  // 工作台排在接口后面，接口以外的 GET 都归它。
  const api = checked
    .basePath("/api/v1")
    .route("/", healthRoutes(deps))
    .route("/", eventRoutes(deps))
    .route("/", adminRoutes(deps))
    .route("/", projectRoutes(deps))
    .route("/", versionRoutes(deps))
    .route("/", roundRoutes(deps))
    .route("/", landRoutes(deps))
    .route("/", useRoutes(deps))
    .route("/", skillRoutes(deps))
    .route("/", queueRoutes(deps))
    .route("/", decisionRoutes(deps))
    .route("/", mainlineRoutes(deps))
    .route("/", schemaRoutes())
    .route("/", pageRoutes(deps))
    .route("/", submissionRoutes(deps))
    .route("/", draftRoutes(deps))
    .route("/", blobRoutes(deps))
    .route("/", storageRoutes(deps))
    .route("/", legacyRoutes(deps));
  checked.route("/", webRoutes(deps));
  return api;
}

/**
 * 没有接住的错误都是后端的问题：详情写进日志，返回 INTERNAL。
 * where 写是哪个请求，hint 写日志的位置；是数据对不上定义时，hint 再写出错的字段。
 */
function unexpected(c: Context, error: Error, deps: AppDeps): Response {
  const request = renderCopy(httpCopy.internal.request, { method: c.req.method, path: c.req.path });
  deps.log.error(error, request);
  const text = errorCodeCopyOf("INTERNAL");
  const field = badField(error);
  const hint = [
    ...(field === undefined ? [] : [renderCopy(httpCopy.internal.field, { field })]),
    renderCopy(text.hint, { logPath: deps.log.file }),
  ].join("");
  return failure(
    c,
    errorBody("INTERNAL", [{ message: renderCopy(text.message), hint, where: request }]),
  );
}

/** 数据对不上定义时的报错（zod 的 issues）里第一处出错的字段，例如 events.0.to。 */
function badField(error: Error): string | undefined {
  const issues: unknown = Reflect.get(error, "issues");
  if (!Array.isArray(issues)) return undefined;
  const path: unknown = Reflect.get(issues[0] ?? {}, "path");
  return Array.isArray(path) && path.length > 0 ? path.join(".") : undefined;
}
