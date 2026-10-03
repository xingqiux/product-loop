import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { decisionCopy } from "../copy/records.ts";
import { decisionSchema } from "../decision.ts";
import { decisionKind } from "../names.ts";

// 决定的接口：请求和响应的定义，路径见「05 接口」第四节，按约定 0001 第 4 条挂在 /projects/:pid 下面。
// 一条决定用 decision.ts 的 decisionSchema，作废的请求用 decisionVoidSchema。这里补上其余几样。
// 枚举在接口上写中文，请求经 codec 解码成英文键，响应由后端编码回中文，见约定 0002 第 1 条。

/**
 * GET /projects/:pid/decisions 的查询参数。默认只列有效的，见「05 接口」第四节。
 * includeVoided 写 true 时连已作废的一起列，重写决定.md 和工作台切换成全部时用。
 */
export const decisionQuerySchema = z.strictObject({
  includeVoided: z.stringbool({ truthy: ["true"], falsy: ["false"] }).optional(),
});

/** 决定，按编号从小到大排：GET /projects/:pid/decisions。 */
export const decisionListSchema = z.array(decisionSchema).readonly();

/**
 * 新增一条：POST /projects/:pid/decisions，ploop decision add 用。编号、日期和状态由后端填。
 * 决定、原因、案例三项可以没写、写成 null 或只写空白。缺的由内核按规矩 decision.fields 拦截，
 * 一次报齐缺的几项，见「07 校验」第四节。写的不是文字的，才算请求的格式不对。
 */
export const decisionAddSchema = z.strictObject({
  /** 不写就是决定。 */
  kind: decisionKind.codec.optional(),
  decision: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  case: z.string().nullable().optional(),
});

/**
 * 改一条决定的文字：PATCH /projects/:pid/decisions/:id，ploop decision edit 用。
 * 只改决定、原因、案例，写了的项才改；编号、日期、种类和状态不变，已作废的也能改。
 * 写成 null 或只写空白的，由内核按规矩 decision.fields 拦截；「决定」一项太长由
 * 规矩 decision.decision.tooLong 拦截。三项一项都没写，请求的格式不合定义。
 */
export const decisionEditSchema = z
  .strictObject({
    decision: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    case: z.string().nullable().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: renderCopy(decisionCopy.edit.empty),
  });
