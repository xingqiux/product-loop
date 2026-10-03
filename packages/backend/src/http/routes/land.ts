import {
  landChangeRecordedSchema,
  landGreenRequestSchema,
  landPlanRecordedSchema,
  landPlanRequestSchema,
  landRedRequestSchema,
  landReviewRecordedSchema,
  landReviewRequestSchema,
  landStatusSchema,
  landTidyRecordedSchema,
  landTidyRequestSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { landStatus } from "../../core/land/status.ts";
import {
  recordGreen,
  recordPlan,
  recordRed,
  recordReview,
  recordTidy,
} from "../../core/land/steps.ts";
import type { ReviewThreshold } from "../../core/land/threshold.ts";
import { defaultConfig, readConfig } from "../../store/config.ts";
import { writeContext } from "../context.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";
import { jsonBody } from "../validate.ts";

// 落地五步的接口，见「05 接口」第四节和「04 命令行」第十一节。
// 按约定 0001 第 4 条挂在 /projects/:pid/rounds/:rid/land 下面，业务规则都在 core/land/。
// 路径里的名字是计划「功能改动」里的一件，里面有中文，要编码。
// 评审界线每次从 config.json 读，用户改了不用重启后端。读不出来时用默认的界线。

/** 这一次评审用的界线。 */
function thresholdOf(deps: AppDeps): ReviewThreshold {
  const config = readConfig(deps.paths.config);
  return (config.ok ? config.value : defaultConfig()).reviewThreshold;
}

export function landRoutes(deps: AppDeps) {
  const base = "/projects/:pid/rounds/:rid/land";
  return (
    new Hono()
      /** 五步到了哪一步、缺什么。ploop land status 用。 */
      .get(base, (c) => {
        const result = landStatus(deps.db, c.req.param("pid"), c.req.param("rid"));
        if (!result.ok) return failure(c, result.error);
        const { next, ...status } = result.value;
        return reply(c, 200, landStatusSchema, status, { next });
      })
      /** 交计划全文，检查七节。ploop land plan 用。 */
      .put(`${base}/plan`, ...jsonBody(landPlanRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const { text } = c.req.valid("json");
        const result = recordPlan(ctx, c.req.param("pid"), c.req.param("rid"), text);
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...recorded } = result.value;
        return reply(c, 200, landPlanRecordedSchema, recorded, { warnings, next });
      })
      /** 记重构：跳过，或者重构以后检查命令的那次运行。ploop land tidy 用。 */
      .post(`${base}/tidy`, ...jsonBody(landTidyRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const result = recordTidy(ctx, c.req.param("pid"), c.req.param("rid"), c.req.valid("json"));
        if (!result.ok) return failure(c, result.error);
        const { next, ...recorded } = result.value;
        return reply(c, 200, landTidyRecordedSchema, recorded, { next });
      })
      /** 记改之前失败的一次。ploop land red 用。 */
      .post(`${base}/changes/:name/red`, ...jsonBody(landRedRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const { pid, rid, name } = c.req.param();
        const result = recordRed(ctx, pid, rid, name, c.req.valid("json").run);
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...recorded } = result.value;
        return reply(c, 200, landChangeRecordedSchema, recorded, { warnings, next });
      })
      /** 记改之后通过的一次，核对是同一条命令。ploop land green 用。 */
      .post(`${base}/changes/:name/green`, ...jsonBody(landGreenRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const { pid, rid, name } = c.req.param();
        const result = recordGreen(ctx, pid, rid, name, c.req.valid("json"), thresholdOf(deps));
        if (!result.ok) return failure(c, result.error);
        const { warnings, next, ...recorded } = result.value;
        return reply(c, 200, landChangeRecordedSchema, recorded, { warnings, next });
      })
      /** 记评审意见，或跳过评审的理由。ploop land review 用。 */
      .post(`${base}/review`, ...jsonBody(landReviewRequestSchema), (c) => {
        const ctx = writeContext(c, deps);
        const { pid, rid } = c.req.param();
        const result = recordReview(ctx, pid, rid, c.req.valid("json"), thresholdOf(deps));
        if (!result.ok) return failure(c, result.error);
        const { next, ...recorded } = result.value;
        return reply(c, 200, landReviewRecordedSchema, recorded, { next });
      })
  );
}
