import { exportBundleSchema, exportQuerySchema, storageUsageSchema } from "@product-loop/model";
import { Hono } from "hono";
import { exportProject } from "../../core/export.ts";
import { storageUsage } from "../../core/storage.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { queryParams } from "../validate.ts";

// 集中存储的占用和导出，见「05 接口」第四节和「03 数据模型」第六节、第九节。
// 附件按项目统计，数据库只给合计，算法见 core/storage.ts。

export function storageRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 每个项目引用的附件，附件库和数据库的合计。 */
      .get("/storage", (c) => {
        const usage = storageUsage(deps.db, deps.paths.database);
        return reply(c, 200, storageUsageSchema, usage);
      })
      /** 导出一个项目的文件，legacy=true 时给出旧格式的文件。ploop export 用。 */
      .get("/projects/:pid/export", queryParams(exportQuerySchema), (c) => {
        const { legacy } = c.req.valid("query");
        const result = exportProject(deps.db, c.req.param("pid"), { legacy });
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, exportBundleSchema, result.value);
      })
  );
}
