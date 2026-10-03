import {
  ingestedUseRunSchema,
  jsonSchemaSchema,
  screenListSchema,
  screensQuerySchema,
  useRunJsonSchema,
  useRunRequestSchema,
  useRunViewSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { ingestUseRun } from "../../core/use/ingest.ts";
import { latestUseRun } from "../../core/use/runs.ts";
import { listScreens } from "../../core/use/screens.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 使用记录和屏的接口，见「05 接口」第四节。业务规则都在 core/use/。
// 截图先上传到附件库，请求里按路径写哈希，见「05 接口」第七节。
// use-run.json 的定义也从这里给出，ploop use schema 打印的就是它。

export function useRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 收一次运行。ploop use run 和 ploop use ingest 用。 */
      .post("/projects/:pid/use-runs", ...jsonBody(useRunRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const input = c.req.valid("json");
        const result = ingestUseRun(ctx, deps.paths.dirs.blobs, c.req.param("pid"), input);
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...ingested } = result.value;
        return reply(c, 200, ingestedUseRunSchema, ingested, { warnings, next });
      })
      /** 最近一次运行和它的每一步。还没有运行时 data 为 null。 */
      .get("/projects/:pid/use-runs/latest", (c) => {
        const result = latestUseRun(deps.db, c.req.param("pid"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, useRunViewSchema.nullable(), result.value);
      })
      /** 这一版新出现和变过的屏，all=true 时连没变的一起列。ploop use changed 用。 */
      .get("/projects/:pid/screens/changed", queryParams(screensQuerySchema), (c) => {
        const { version, all } = c.req.valid("query");
        const result = listScreens(deps.db, c.req.param("pid"), {
          version,
          changedOnly: all !== "true",
        });
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, screenListSchema, result.value);
      })
      /** use-run.json 的定义。ploop use schema 用。 */
      .get("/schema/use-run", (c) => reply(c, 200, jsonSchemaSchema, useRunJsonSchema()))
  );
}
