import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import { queueStatus } from "../names.ts";
import { cardIdSchema } from "./card-id.ts";
import {
  enumLiteral,
  hexColorSchema,
  optionalText,
  queueRefsSchema,
  textSchema,
} from "./fields.ts";
import { reportIssue } from "./issue.ts";

// 设计规范：构思阶段的样张墙，每一格点保留、修改或删除，见旧格式第十版和第十一版。
// 每一格按 kind 有七种。for 写这一格规范用在哪个组件上。
//
// 新格式里每一格都要写 for（「07 校验」第四节），这一条由第 27 步的规则查，定义里不写成必填。
// 规则有起始日期，迁移旧页面时的历史页面模式能跳过它，旧页面没有 for 也能收进来。
// text 超过三行、设计类的卡没有带规范，也由第 27 步的规则查。
//
// 下面几个枚举在页面数据里写中文，解析以后是英文键，见「05 接口」第一节。
// 英文键就是旧格式的写法，旧页面数据按这几张表换成中文。

/** 设计规范一格的种类，按 kind 区分。 */
export const specKind = defineEnum({
  colors: "颜色",
  type: "字号",
  radius: "圆角",
  spacing: "间距",
  motion: "动效",
  table: "表格",
  text: "文字",
});
export type SpecKind = KeyOf<typeof specKind>;

/** 动效的效果：点一下样张时，小方块怎么动。 */
export const motionEffect = defineEnum({ move: "移动", fade: "淡入", grow: "放大" });
export type MotionEffect = KeyOf<typeof motionEffect>;

/** 表格一列的格子怎么画：加粗、色块加色值、正例、反例、划掉的旧叫法。 */
export const columnStyle = defineEnum({
  strong: "加粗",
  color: "色块",
  good: "正例",
  bad: "反例",
  old: "旧叫法",
});
export type ColumnStyle = KeyOf<typeof columnStyle>;

const specShape = {
  id: cardIdSchema.optional().describe(renderCopy(pageFieldCopy.card.id)),
  queue: queueRefsSchema.optional().describe(renderCopy(pageFieldCopy.card.queue)),
  name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
  /** 用在哪个组件上。新写的页面必填，由规则查。 */
  for: optionalText.describe(renderCopy(pageFieldCopy.spec.for)),
  /** 一句补充，显示在名字旁边。 */
  note: optionalText.describe(renderCopy(pageFieldCopy.spec.note)),
};

const namedColor = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
  hex: hexColorSchema.describe(renderCopy(pageFieldCopy.spec.hex)),
});

const fontSize = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
  size: z.number().positive().describe(renderCopy(pageFieldCopy.spec.size)),
  weight: z.number().positive().optional().describe(renderCopy(pageFieldCopy.spec.weight)),
  /** 用项目里的真文字。 */
  sample: optionalText.describe(renderCopy(pageFieldCopy.spec.sample)),
});

const motion = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
  ms: z.number().nonnegative().describe(renderCopy(pageFieldCopy.spec.ms)),
  easing: optionalText.describe(renderCopy(pageFieldCopy.spec.easing)),
  effect: motionEffect.codec.optional().describe(renderCopy(pageFieldCopy.spec.effect)),
});

/** 表格的一列。as 决定这一列的格子怎么画。 */
const tableColumn = z.strictObject({
  name: textSchema.describe(renderCopy(pageFieldCopy.spec.name)),
  as: columnStyle.codec.optional().describe(renderCopy(pageFieldCopy.spec.as)),
});

/**
 * 表格的一格：一段文字，或者一个真的状态标签。状态标签的色调就是队列的五种状态，
 * 和旧格式的 todo、doing、wait、done、drop 一一对应。
 */
const tableCell = z.union([
  z.string(),
  z.strictObject({
    text: textSchema.describe(renderCopy(pageFieldCopy.spec.cellText)),
    tone: queueStatus.codec.describe(renderCopy(pageFieldCopy.spec.tone)),
  }),
]);

const tableSpec = z
  .strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "table"),
    columns: z.array(tableColumn).min(1).describe(renderCopy(pageFieldCopy.spec.columns)),
    /** 一行一条规范，格数和 columns 一样多。 */
    rows: z.array(z.array(tableCell)).min(1).describe(renderCopy(pageFieldCopy.spec.rows)),
  })
  .superRefine((spec, ctx) => {
    const columns = spec.columns.length;
    spec.rows.forEach((row, i) => {
      if (row.length !== columns) {
        const values = { name: spec.name, row: i + 1, cells: row.length, columns };
        reportIssue(ctx, "page.spec.rowCells", pageCopy.spec.rowCells, values, ["rows", i]);
      }
    });
  });

export const specDraftSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "colors"),
    values: z.array(namedColor).min(1).describe(renderCopy(pageFieldCopy.spec.values)),
  }),
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "type"),
    values: z.array(fontSize).min(1).describe(renderCopy(pageFieldCopy.spec.values)),
  }),
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "radius"),
    values: z
      .array(z.number().nonnegative())
      .min(1)
      .describe(renderCopy(pageFieldCopy.spec.values)),
  }),
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "spacing"),
    values: z
      .array(z.number().nonnegative())
      .min(1)
      .describe(renderCopy(pageFieldCopy.spec.values)),
  }),
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "motion"),
    values: z.array(motion).min(1).describe(renderCopy(pageFieldCopy.spec.values)),
  }),
  tableSpec,
  /** 说不成样张的，写一条规则或一个例子。 */
  z.strictObject({
    ...specShape,
    kind: enumLiteral(specKind, "text"),
    text: textSchema.describe(renderCopy(pageFieldCopy.spec.text)),
  }),
]);

export type SpecDraft = z.output<typeof specDraftSchema>;
