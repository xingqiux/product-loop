import {
  clientHeader,
  foundProjectSchema,
  projectQuerySchema,
  projectRegisterSchema,
  projectStatusListSchema,
  projectStatusSchema,
  projectUpdateSchema,
  projectViewSchema,
  registeredProjectSchema,
} from "@product-loop/model";
import { type Context, Hono } from "hono";
import {
  findProjectByPath,
  getProject,
  registerProject,
  updateProject,
} from "../../core/projects.ts";
import { allProjectStatuses, projectStatus } from "../../core/status.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply, respond } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// 项目和状态的接口，见「05 接口」第四节。业务规则都在内核里，这里只解析请求、调用用例。
// GET /projects?path= 是 05 里没写的，给命令行按路径找项目。版本的接口见 versions.ts。

/**
 * 状态里要不要带 Time Machine 的警告：工作台顶上要显示，命令行不带。
 * 它们和产品循环无关，命令行只在 ploop backup list 里写，见审查报告 P29。
 */
function wantsTimeMachine(c: Context): boolean {
  return !(c.req.header(clientHeader) ?? "").startsWith("cli/");
}

export function projectRoutes(deps: AppDeps) {
  return (
    new Hono()
      /**
       * 写了 path：按路径找项目，只认登记过的根目录，离路径最近的根目录算数。
       * 不写：所有项目的状态，ploop status --all 和所有项目的看板用。
       * 各项目的警告都写明是哪个项目，一起放进外壳的 warnings。各项目的下一步不放。
       * 备份的警告不属于哪个项目，放在各项目的警告后面。
       */
      .get("/projects", queryParams(projectQuerySchema), async (c) => {
        const { path } = c.req.valid("query");
        if (path !== undefined) {
          return respond(c, findProjectByPath(deps.db, path), 200, foundProjectSchema);
        }
        const now = deps.now();
        const statuses = allProjectStatuses(deps.db, { now });
        const warnings = [
          ...statuses.flatMap((status) => status.warnings),
          ...(await deps.backupWarnings(now, { timeMachine: wantsTimeMachine(c) })),
        ];
        const data = statuses.map(({ next: _next, warnings: _warnings, ...status }) => status);
        return reply(c, 200, projectStatusListSchema, data, { warnings });
      })
      /** 登记一个项目，ploop init 用。 */
      .post("/projects", ...jsonBody(projectRegisterSchema), (c) => {
        const input = c.req.valid("json");
        const result = registerProject(writeContext(c, deps), deps.reserved, input);
        return respond(c, result, 201, registeredProjectSchema);
      })
      .get("/projects/:pid", (c) =>
        respond(c, getProject(deps.db, c.req.param("pid")), 200, projectViewSchema),
      )
      /** 改名称、仓库类别、忽略规则的位置和根目录，ploop init 重跑时用。 */
      .patch("/projects/:pid", ...jsonBody(projectUpdateSchema), (c) => {
        const patch = c.req.valid("json");
        const ctx = writeContext(c, deps);
        const result = updateProject(ctx, deps.reserved, c.req.param("pid"), patch);
        return respond(c, result, 200, projectViewSchema);
      })
      /**
       * 当前状态，ploop status 用。内核给的下一步和警告放进外壳的 next 和 warnings。
       * 备份的警告接在项目的警告后面，见「03 数据模型」第七节。
       */
      .get("/projects/:pid/status", async (c) => {
        const now = deps.now();
        const result = projectStatus(deps.db, c.req.param("pid"), { now });
        if (!result.ok) return failure(c, result.error);
        const { next, warnings, ...status } = result.value;
        const backup = await deps.backupWarnings(now, { timeMachine: wantsTimeMachine(c) });
        const all = [...warnings, ...backup];
        return reply(c, 200, projectStatusSchema, status, { warnings: all, next });
      })
  );
}
