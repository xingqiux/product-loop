import { designCopy } from "../copy/design.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { AskCard } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import { designOutsideSamples, designSketchSamples, designSpecSamples } from "./design.samples.ts";
import { defineRule, type Rule, type RuleContextOf, type RuleScope } from "./rule.ts";

// 设计类的卡的规则，见「07 校验」第四节的 check_design 和决定 77、98。设计类的卡先看、再画、再谈：
// - design.outside：来源里至少有一张外面的截图，照旧 build-report.py 的第 399 到 401 行。
// - design.sketch：每个选项都有草稿，照旧第 402 到 404 行。
// - design.spec：同一页要有设计规范，照旧第 355 到 356 行，旧脚本写在 check_spec 里。
// 旧的 check_design 在每个阶段都查。「07 校验」第四节改为只在构思查，检查和落地不再要求
// 外面的来源和草稿。这是放宽，只会少拦，所以起始日期照旧。旧的 design.spec 本来就只在构思查。
// 构思页的卡只有疑问，所以只查疑问。旧脚本遇到第一处就停下，这里每一处各报一次。

/** 先看再画的两道检查加进构建校验的那一天，提交 a2baf40。 */
const designAdded = "2026-09-20";

/** 设计类的卡要带设计规范，加进构建校验的那一天，提交 d6e1bdc。按 UTC 是 21 日，见 cards.ts 的开头。 */
const designSpecAdded = "2026-09-21";

const onAsks: RuleScope = {
  subjects: ["page"],
  stages: ["think"],
  sections: ["asks"],
  commands: ["page check", "page present"],
};

/** 页面上设计类的疑问卡，连同它是第几张。 */
function designAsks(page: PageSections): { readonly card: AskCard; readonly index: number }[] {
  return (page.asks ?? []).flatMap((card, index) => (card.design ? [{ card, index }] : []));
}

/** 规则 design.outside：来源里没有外面截图的设计类的卡各报一处，报在来源上。 */
const designOutside = defineRule({
  id: "design.outside",
  level: "block",
  scope: onAsks,
  since: designAdded,
  needs: [],
  about: rulesCopy.about.design.outside,
  copy: designCopy.outside,
  check: (page: PageSections) =>
    designAsks(page).flatMap(({ card, index }) =>
      card.sources.some((source) => source.outside === true && source.img !== undefined)
        ? []
        : [{ where: ["asks", index, "sources"], params: { title: card.title } }],
    ),
  samples: designOutsideSamples,
});

/** 规则 design.sketch：设计类的卡上没有草稿的选项各报一处。 */
const designSketch = defineRule({
  id: "design.sketch",
  level: "block",
  scope: onAsks,
  since: designAdded,
  needs: [],
  about: rulesCopy.about.design.sketch,
  copy: designCopy.sketch,
  check: (page: PageSections) =>
    designAsks(page).flatMap(({ card, index }) =>
      (card.options ?? []).flatMap((option, i) =>
        option.sketch === undefined
          ? [
              {
                where: ["asks", index, "options", i, "sketch"],
                params: { title: card.title, key: option.key },
              },
            ]
          : [],
      ),
    ),
  samples: designSketchSamples,
});

/** 规则 design.spec：有设计类的卡、却没有设计规范时报一处，报在设计规范上，写第一张设计类的卡。 */
const designSpec = defineRule({
  id: "design.spec",
  level: "block",
  scope: { ...onAsks, sections: ["asks", "spec"] },
  since: designSpecAdded,
  needs: [],
  about: rulesCopy.about.design.spec,
  copy: designCopy.spec,
  check: (page: PageSections) => {
    const [first] = designAsks(page);
    if (first === undefined || page.spec !== undefined) return [];
    return [{ where: ["spec"], params: { title: first.card.title } }];
  },
  samples: designSpecSamples,
});

/** 设计类的卡的规则，登记在 registry.ts。 */
export const designRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  designOutside,
  designSketch,
  designSpec,
];
