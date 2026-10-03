import {
  versionChangeSchema,
  versionDetailSchema,
  versionListSchema,
  versionNextSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { currentVersion, listVersions, nextVersion } from "../../core/versions.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { respond } from "../respond.ts";
import { jsonBody } from "../validate.ts";

// 产品版本的接口，见「05 接口」第四节和「08 版本与迁移」第二节，业务规则都在内核里。
// GET /projects/:pid/versions/current 是 05 里没写的，给 ploop version show 用。
// 提升轮收尾以后自动进入下一版，由开始一轮的接口做，见 rounds.ts。

export function versionRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 各版和每版下的轮次，从第 1 版排起。工作台的项目页用。 */
      .get("/projects/:pid/versions", (c) =>
        respond(c, listVersions(deps.db, c.req.param("pid")), 200, versionListSchema),
      )
      /** 当前的一版和它下面的轮次，ploop version show 用。 */
      .get("/projects/:pid/versions/current", (c) =>
        respond(c, currentVersion(deps.db, c.req.param("pid")), 200, versionDetailSchema),
      )
      /** 提前结束当前的一版并开始下一版，ploop version next 用。 */
      .post("/projects/:pid/versions/next", ...jsonBody(versionNextSchema), (c) => {
        const { reason } = c.req.valid("json");
        const result = nextVersion(writeContext(c, deps), c.req.param("pid"), reason);
        return respond(c, result, 201, versionChangeSchema);
      })
  );
}
