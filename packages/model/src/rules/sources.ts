import { cardRulesCopy } from "../copy/card-rules.ts";
import { rulesCopy } from "../copy/rules.ts";
import { sourceForm } from "../page/source.ts";
import {
  cardNames,
  cardPath,
  cardsAdded,
  cardsOf,
  onCards,
  type PageRule,
  type PageSubject,
} from "./cards.ts";
import { defineRule } from "./rule.ts";
import { sourceSamples } from "./sources.samples.ts";

// 页面规则第一批里来源一级的，见「07 校验」第二节的三种写法。
// 三种写法各自写全了没有、有没有混在一起，由数据定义查，见 page/source.ts。
// 这里查一种写法都没有的来源。共同的写法和起始日期见 cards.ts 的开头。

/**
 * 旧脚本第 239 到 240 行：除了用户的原话，来源都要有图（决定 59）。
 * 新格式多了文字的来源，原文由命令摘录，所以查的是三种写法一种都没有。
 * 每张卡的每条来源都查，没有写法的各报一次。
 */
const sourceVisual = defineRule({
  id: "card.source.visual",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: rulesCopy.about.card.source.visual,
  copy: cardRulesCopy.source.visual,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) =>
      at.card.sources.flatMap((source, i) => {
        if (sourceForm(source) !== undefined) return [];
        return [
          { where: cardPath(at, "sources", i), params: { ...cardNames(at), name: source.name } },
        ];
      }),
    ),
  samples: sourceSamples["card.source.visual"],
});

/** 来源一级的规则。 */
export const sourceRuleList: readonly PageRule[] = [sourceVisual];
