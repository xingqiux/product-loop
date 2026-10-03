import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import { enumLiteral, hexColorSchema, imgPathSchema, optionalText, textSchema } from "./fields.ts";

// 证据：画在卡片右边的东西，从数据画出来，不手写 HTML，见旧格式的 README。
// 旧格式里的 excerpt 证据已删除，原文写成文字的来源。evidence 只写成数组，一项也放进数组。

/**
 * 证据的种类，按 type 区分。页面数据里写中文，解析以后是英文键，见「05 接口」第一节。
 * 英文键就是旧格式的写法，旧页面数据按这张表换成中文。
 */
export const evidenceType = defineEnum({
  sizes: "尺寸",
  swatches: "色块",
  type: "字号",
  spacing: "间距",
  image: "截图",
  live: "真组件",
});
export type EvidenceType = KeyOf<typeof evidenceType>;

const caption = { caption: optionalText.describe(renderCopy(pageFieldCopy.evidence.caption)) };

/** 按真实像素画一排圆，keep 里的上色，例如图标用过的尺寸。 */
const sizesEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "sizes"),
  unit: optionalText.describe(renderCopy(pageFieldCopy.evidence.unit)),
  values: z.array(z.number().positive()).min(1).describe(renderCopy(pageFieldCopy.evidence.values)),
  keep: z
    .array(z.number().positive())
    .min(1)
    .optional()
    .describe(renderCopy(pageFieldCopy.evidence.keep)),
  ...caption,
});

/** 一排色块。 */
const swatchesEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "swatches"),
  values: z
    .array(
      z.strictObject({
        name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
        hex: hexColorSchema.describe(renderCopy(pageFieldCopy.spec.hex)),
      }),
    )
    .min(1)
    .describe(renderCopy(pageFieldCopy.evidence.values)),
  ...caption,
});

/** 按真实字号排的样张。 */
const typeEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "type"),
  values: z
    .array(
      z.strictObject({
        size: z.number().positive().describe(renderCopy(pageFieldCopy.spec.size)),
        weight: z.number().positive().optional().describe(renderCopy(pageFieldCopy.spec.weight)),
        sample: optionalText.describe(renderCopy(pageFieldCopy.spec.sample)),
      }),
    )
    .min(1)
    .describe(renderCopy(pageFieldCopy.evidence.values)),
  ...caption,
});

/** 按真实宽度画的间距条，keep 以外的画成灰色。 */
const spacingEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "spacing"),
  values: z
    .array(z.number().nonnegative())
    .min(1)
    .describe(renderCopy(pageFieldCopy.evidence.values)),
  keep: z
    .array(z.number().nonnegative())
    .min(1)
    .optional()
    .describe(renderCopy(pageFieldCopy.evidence.keep)),
  ...caption,
});

/** 一张截图。 */
const imageEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "image"),
  img: imgPathSchema.describe(renderCopy(pageFieldCopy.evidence.img)),
  ...caption,
});

/** 真组件下面的一个按钮：切类名，或者改属性。悬停和聚焦不用写，用户自己动鼠标。 */
const liveToggle = z.union([
  z.strictObject({
    label: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleLabel)),
    selector: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleSelector)),
    class: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleClass)),
  }),
  z.strictObject({
    label: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleLabel)),
    selector: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleSelector)),
    attr: textSchema.describe(renderCopy(pageFieldCopy.evidence.toggleAttr)),
    on: optionalText.describe(renderCopy(pageFieldCopy.evidence.toggleOn)),
    off: optionalText.describe(renderCopy(pageFieldCopy.evidence.toggleOff)),
  }),
]);

/**
 * 真组件：从真实界面取来的 HTML 和生效的样式，放进隔离的框里，用户能悬停、点、看它动。
 * 「07 校验」第四节保留这些字段，以后改由工具从运行中的产品取出。
 */
const liveEvidence = z.strictObject({
  type: enumLiteral(evidenceType, "live"),
  /** 从哪一屏、哪个组件取的。 */
  from: textSchema.describe(renderCopy(pageFieldCopy.evidence.from)),
  html: textSchema.describe(renderCopy(pageFieldCopy.evidence.html)),
  css: textSchema.describe(renderCopy(pageFieldCopy.evidence.css)),
  toggles: z
    .array(liveToggle)
    .min(1)
    .optional()
    .describe(renderCopy(pageFieldCopy.evidence.toggles)),
  /** 框的高度，默认 160。 */
  height: z.int().positive().optional().describe(renderCopy(pageFieldCopy.evidence.height)),
  /** 框的底色，默认白色，深色主题的组件要写。 */
  bg: optionalText.describe(renderCopy(pageFieldCopy.evidence.bg)),
  ...caption,
});

export const evidenceItemSchema = z
  .discriminatedUnion("type", [
    sizesEvidence,
    swatchesEvidence,
    typeEvidence,
    spacingEvidence,
    imageEvidence,
    liveEvidence,
  ])
  .meta({ id: "evidence" });

export type EvidenceItem = z.output<typeof evidenceItemSchema>;

export const evidenceSchema = z.array(evidenceItemSchema).min(1);
