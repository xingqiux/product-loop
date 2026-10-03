import { z } from "zod";
import { roundViewSchema, versionViewSchema } from "./projects.ts";

// 产品版本的接口：请求和响应的定义，路径见「05 接口」第四节，按约定 0001 第 4 条挂在 /projects/:pid 下面。
// 一版和一轮的样子在 projects.ts，项目的状态也要用它们。
// GET /projects/:pid/versions/current 是 05 里没写的，给 ploop version show 用。

/** 提前结束这一版、开始下一版：POST /projects/:pid/versions/next，ploop version next 用。 */
export const versionNextSchema = z.strictObject({
  /** 提前结束的原因，例如跳过提升。 */
  reason: z.string(),
});

/** 一版和这一版下的轮次：GET /projects/:pid/versions 的每一项，和 ploop version show 看的当前一版。 */
export const versionDetailSchema = z.strictObject({
  ...versionViewSchema.shape,
  rounds: z.array(roundViewSchema).readonly(),
});

/** 各版和每版下的轮次，从第 1 版排起：GET /projects/:pid/versions。 */
export const versionListSchema = z.array(versionDetailSchema).readonly();

/** 换版的结果：结束的一版和新开始的一版。ploop version next 和开始一轮时进入下一版都用它。 */
export const versionChangeSchema = z.strictObject({
  ended: versionViewSchema,
  started: versionViewSchema,
});
