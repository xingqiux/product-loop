import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { textSchema, whereSchema } from "./fields.ts";

// 元素清单：检查阶段逐屏列出每样东西是什么、替用户回答什么问题，见旧格式第四版。
// 页面上不显示整份清单，页头只列出这一轮看过哪几屏。
// 每一屏写 where，指到主线的场景编号和步号（第一期约定第 8 条）。
// 第 27 步的规则据此查清单盖没盖住这一版新出现或变过的屏。
//
// where 是新格式加的。新写的页面每一屏都要写，这一条由第 27 步的规则查，定义里不写成必填。
// 规则有起始日期，历史页面模式能跳过它，旧的元素清单没有 where 也能收进来。

/** 元素清单的一行。答不出来就写「答不出」，并写进发现问题。 */
export const elementSchema = z.strictObject({
  /** 这样东西是什么。 */
  what: textSchema.describe(renderCopy(pageFieldCopy.screen.what)),
  /** 它替用户回答什么问题。 */
  answers: textSchema.describe(renderCopy(pageFieldCopy.screen.answers)),
});

/** 元素清单的一屏。 */
export const screenEntrySchema = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.screen.name)),
  /** 这一屏是哪个场景的第几步。新写的页面必填，由规则查。 */
  where: whereSchema.optional().describe(renderCopy(pageFieldCopy.screen.where)),
  elements: z.array(elementSchema).min(1).describe(renderCopy(pageFieldCopy.screen.elements)),
});

export type ScreenEntry = z.output<typeof screenEntrySchema>;
