import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { type Stage, stage } from "../names.ts";
import { enumLiteral } from "./fields.ts";
import { type PageSection, pageSection } from "./section-names.ts";
import { sectionsSchema } from "./sections.ts";

// 页面数据的定义按阶段区分，不同阶段能写的区块不同，见「07 校验」第二节。
// 这一阶段不能写的区块，和别的不认识的字段一样被拦截。报错写明它只在哪个阶段写。

/**
 * 各阶段的页面数据能写哪几个区块，顺序是页面上的顺序。依据如下：
 *
 * - 「06 工作台」第四节的区块表。先对齐、场景清单、设计规范在构思，发现问题在检查，更改在落地。
 *   提升只在提升阶段，落地页不再有提升卡（决定 137）。
 *   疑问在有要问的事时出现，五个阶段都能写。
 * - 旧 skill 的构建校验 build-report.py。场景清单和设计规范只在构思，检查阶段要有元素清单。
 * - 区块表里没有参考和元素清单，这两条由第 21 步定。
 *   参考是外面看来的东西（决定 93），来自构思第二步的调研，所以只在构思。
 *   元素清单要盖住这一版变过的屏，见「07 校验」第四节。它是检查阶段逐屏列出的，所以只在检查。
 *
 * 使用区块、工程证据、队列看板等由后端填，不在这里。
 */
export const stageSections = {
  think: ["align", "scenes", "spec", "asks", "refs"],
  use: ["asks"],
  check: ["asks", "findings", "screens"],
  land: ["asks", "changes"],
  improve: ["asks", "improvements"],
} as const satisfies Record<Stage, readonly PageSection[]>;

export type StageSection<S extends Stage> = (typeof stageSections)[S][number];

/** 五个阶段都能写的区块。 */
type EverywhereSection = StageSection<"think"> &
  StageSection<"use"> &
  StageSection<"check"> &
  StageSection<"land"> &
  StageSection<"improve">;

/** 有阶段不能写的区块。写在不能写的阶段时，报错写明它只在哪个阶段写。 */
export type RestrictedSection = Exclude<PageSection, EverywhereSection>;

/** 这个区块在这个阶段能不能写。 */
export function sectionAllowed(key: Stage, section: PageSection): boolean {
  return (stageSections[key] as readonly PageSection[]).includes(section);
}

/**
 * 页面数据的格式版本，记在每一页上，见「03 数据模型」第二节和第八节。
 * 旧 skill 的格式算第 1 版，就是 legacy-format.ts 对照的旧格式。格式有不兼容的变化时加一。
 */
export const pageFormatVersion = 2;

/** 一个阶段的页面数据的定义，导出 JSON Schema 时带着标题和说明。 */
function stagePageSchema<S extends Stage>(key: S) {
  const sections: readonly StageSection<S>[] = stageSections[key];
  return sectionsSchema<StageSection<S>>(sections).meta({
    title: renderCopy(pageCopy.schema.title, { stage: stage.label(key) }),
    description: renderCopy(pageCopy.schema.description, {
      stage: stage.label(key),
      sections: sections.map((section) => pageSection.label(section)).join("、"),
    }),
  });
}

/** 按阶段的页面数据的定义。严格：这一阶段不能写的区块和不认识的字段都拦截。 */
export const pageSchemas = {
  think: stagePageSchema("think"),
  use: stagePageSchema("use"),
  check: stagePageSchema("check"),
  land: stagePageSchema("land"),
  improve: stagePageSchema("improve"),
} satisfies Record<Stage, z.ZodType>;

/** 一个阶段的页面数据，解析以后的样子：枚举是英文键。 */
export type StagePage<S extends Stage> = z.output<(typeof pageSchemas)[S]>;

/**
 * 按阶段导出的 JSON Schema，GET /schema/page?stage= 和 ploop page schema 给出的就是它。
 * 给 AI 看的是页面数据的写法，所以取输入一侧：枚举列中文。
 * 几处共用的部分放在 $defs 里，各写一次。
 */
export function pageJsonSchema(key: Stage): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(pageSchemas[key], { io: "input" });
}

function pageEnvelope<S extends Stage>(key: S) {
  return z.strictObject({
    formatVersion: z.literal(pageFormatVersion),
    stage: enumLiteral(stage, key),
    sections: pageSchemas[key],
  });
}

/**
 * 页面数据的外壳：格式版本、阶段和 AI 写的各个区块。AI 只写区块。
 * 后端给出信息时，按这一轮填上格式版本和阶段，存下这一页。工作台按格式版本认写法。
 * 阶段在接口上写中文，解析以后是英文键。
 */
export const pageEnvelopeSchema = z.discriminatedUnion("stage", [
  pageEnvelope("think"),
  pageEnvelope("use"),
  pageEnvelope("check"),
  pageEnvelope("land"),
  pageEnvelope("improve"),
]);

export type PageEnvelope = z.output<typeof pageEnvelopeSchema>;
