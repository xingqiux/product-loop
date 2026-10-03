import {
  lintRequestSchema,
  lintResultSchema,
  renderCopy,
  skillIssueListSchema,
  skillIssuePatchSchema,
  skillIssueQuerySchema,
  skillIssueReportSchema,
  skillIssueSchema,
  skillSignalsSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { skillIssuesCopy } from "../../copy/skill.ts";
import { lintReply, lintText } from "../../core/lint.ts";
import { listSkillIssues, reportSkillIssue, updateSkillIssue } from "../../core/skill-issues.ts";
import { skillSignals } from "../../core/skill-signals.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody, queryParams } from "../validate.ts";

// skill 的问题和写作校验的接口，见「05 接口」第四节。业务规则在 core/skill-issues.ts 和 core/lint.ts。
// 写作校验只读，查出的拦截也返回 200，由命令行按有没有拦截定退出码，和 page check 相同。

export function skillRoutes(deps: AppDeps) {
  return (
    new Hono()
      /** 报一个问题。ploop skill report 用。 */
      .post("/skill/issues", ...jsonBody(skillIssueReportSchema), (c) => {
        const ctx = writeContext(c, deps);
        const result = reportSkillIssue(ctx, c.req.valid("json"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 201, skillIssueSchema, result.value, {
          next: [renderCopy(skillIssuesCopy.next.issues)],
        });
      })
      /** 问题的列表，可以按状态和项目筛。ploop skill issues 用。 */
      .get("/skill/issues", queryParams(skillIssueQuerySchema), (c) => {
        const result = listSkillIssues(deps.db, c.req.valid("query"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, skillIssueListSchema, result.value);
      })
      /** 处理一个问题。ploop skill issues reply 用。 */
      .patch("/skill/issues/:id", ...jsonBody(skillIssuePatchSchema), (c) => {
        // 编号不是正整数的，按找不到处理。
        const id = Number(c.req.param("id"));
        const ctx = writeContext(c, deps);
        const patch = c.req.valid("json");
        const result = updateSkillIssue(ctx, Number.isSafeInteger(id) ? id : 0, patch);
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, skillIssueSchema, result.value);
      })
      /** 三类信号：反复被拦截的规矩、停在旧版本的项目、停了很多天的事。工作台的 skill 问题页用。 */
      .get("/skill/signals", (c) =>
        reply(c, 200, skillSignalsSchema, skillSignals(deps.db, deps.now())),
      )
      /** 查一段文字。ploop lint text 用。 */
      .post("/lint/text", ...jsonBody(lintRequestSchema), (c) => {
        const result = lintText(deps.db, c.req.valid("json"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, lintResultSchema, result.value);
      })
      /** 查一份会话回复。ploop lint reply 用。 */
      .post("/lint/reply", ...jsonBody(lintRequestSchema), (c) => {
        const result = lintReply(deps.db, c.req.valid("json"));
        if (!result.ok) return failure(c, result.error);
        return reply(c, 200, lintResultSchema, result.value);
      })
  );
}
