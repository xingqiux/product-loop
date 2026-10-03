import { healthSchema } from "@product-loop/model";
import { Hono } from "hono";
import type { AppDeps } from "../deps.ts";
import { reply } from "../respond.ts";

// GET /health，见「05 接口」第四节和第八节。
// 命令行每次调用前请求它，按构建号判断要不要替换后端，见「01 架构」第六节。
// 只查 Host，不要别的请求头。

export function healthRoutes(deps: AppDeps) {
  return new Hono().get("/health", (c) =>
    reply(c, 200, healthSchema, {
      status: "running",
      build: deps.build,
      apiVersion: 1,
      schemaVersion: deps.schemaVersion,
      pid: process.pid,
      home: deps.paths.home,
    }),
  );
}
