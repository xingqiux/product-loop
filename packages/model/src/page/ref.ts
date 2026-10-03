import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import { optionalText, textSchema } from "./fields.ts";

// 参考：外面看来的东西，概览一行一条，点一条出展示卡片，见旧格式第十二版。
// 五个属性都是枚举，取值和旧格式相同。页面数据里写中文，解析以后是英文键，见「05 接口」第一节。

export const refKind = defineEnum({
  book: "书",
  article: "文章",
  standard: "规范",
  product: "产品",
  openSource: "开源项目",
  research: "研究",
});
export type RefKind = KeyOf<typeof refKind>;

/** 读到了哪一步。 */
export const refDepth = defineEnum({ fullText: "已读原文", summaryOnly: "仅摘要" });
export type RefDepth = KeyOf<typeof refDepth>;

export const refRelevance = defineEnum({ high: "高", medium: "中", low: "低" });
export type RefRelevance = KeyOf<typeof refRelevance>;

/** 证据强度。 */
export const refStrength = defineEnum({ strong: "强", medium: "中", weak: "弱" });
export type RefStrength = KeyOf<typeof refStrength>;

export const refAdvice = defineEnum({ adopt: "采用", trial: "试用", assess: "观察", hold: "不用" });
export type RefAdvice = KeyOf<typeof refAdvice>;

export const refSchema = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.ref.name)),
  kind: refKind.codec.describe(renderCopy(pageFieldCopy.ref.kind)),
  depth: refDepth.codec.describe(renderCopy(pageFieldCopy.ref.depth)),
  relevance: refRelevance.codec.describe(renderCopy(pageFieldCopy.ref.relevance)),
  strength: refStrength.codec.describe(renderCopy(pageFieldCopy.ref.strength)),
  advice: refAdvice.codec.describe(renderCopy(pageFieldCopy.ref.advice)),
  /** 它说了什么，以及这个项目用到了哪一条。 */
  body: textSchema.describe(renderCopy(pageFieldCopy.ref.body)),
  /** 用在这个项目的哪里。 */
  where: optionalText.describe(renderCopy(pageFieldCopy.ref.where)),
});

export type Ref = z.output<typeof refSchema>;
