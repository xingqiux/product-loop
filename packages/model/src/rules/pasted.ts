import { rulesCopy } from "../copy/rules.ts";
import { scenesCopy } from "../copy/scenes.ts";
import { specCopy } from "../copy/spec.ts";
import type { DesignSpecItem } from "../mainline/parts.ts";
import type { Card } from "../page/card.ts";
import { pageSection } from "../page/section-names.ts";
import type { PageSections } from "../page/sections.ts";
import { scenesPastedSamples, specPastedSamples } from "./pasted.samples.ts";
import { defineRule, type Rule, type RuleContextOf, type RuleScope, sinceRelease } from "./rule.ts";

// 卡里整段写场景清单或设计规范，见「07 校验」第四节的 check_scene_text 和决定 69。
// 场景清单和设计规范各有自己的区块，草稿整段写进卡片的文字里，读的人看不下去。
// 查的文字照旧 build-report.py 的第 411 行：卡的 why 和每个选项的 diffs。
// 旧脚本还拼进了卡上的 saw，新格式里它已经并进来源，来源的 saw 不查。
// 来源写的是看到了什么，照录主线里的场景清单是正当的写法。
// - scenes.pasted：有两行以上以「场景」加编号开头，照旧第 412 到 413 行。
//   旧脚本用 Python 的 (?m)^，只在换行符后面算一行的开头，这里也只按换行符分行。
// - spec.pasted：「07 校验」第四节新增的同类一条，按新规则写 2.0.0。
//   有两样以上设计规范的名字各自起一行，当作小标题，就算整段写了设计规范。
//   名字取主线设计规范的十二样，见 mainline/parts.ts，另认旧主线里的简写，例如「字体」「做法」。
//   名字后面紧跟冒号、括号、竖线，或者这一行只有名字，才算小标题。

/** 卡里整段写场景清单，建仓库的提交 75b4c2d 里已经有了，那一天是 2026-09-20。 */
const scenesPastedAdded = "2026-09-20";

/** 有卡片的三个区块，按页面上的顺序，对应旧脚本的 CARD_BLOCKS。回到构思已经并进疑问。 */
const cardBlocks = ["asks", "findings", "improvements"] as const;

const onCards: RuleScope = {
  subjects: ["page"],
  sections: cardBlocks,
  commands: ["page check", "page present"],
};

/** 页面上的一张卡：哪个区块的第几张。 */
type CardAt = {
  readonly section: (typeof cardBlocks)[number];
  readonly index: number;
  readonly card: Card;
};

function cardsOf(page: PageSections): CardAt[] {
  return cardBlocks.flatMap((section) => {
    const cards: readonly Card[] = page[section] ?? [];
    return cards.map((card, index) => ({ section, index, card }));
  });
}

/** 查的文字按换行符分成的行：why 在前，接着是每个选项的 diffs。 */
function cardLines(card: Card): string[] {
  const texts = [card.why, ...(card.options ?? []).flatMap((option) => option.diffs)];
  return texts.flatMap((text) => text.split("\n"));
}

/** 以「场景」加编号开头的一行，编号是数字或汉字的数字，照旧脚本的正则。 */
const sceneLine = /^场景[一二三四五六七八九十\p{Nd}]+/u;

/** 行首可以有的标记：标题的井号、列表的符号、表格的竖线、编号，以及加粗的星号。 */
const lineLead = String.raw`^\s*(?:#{1,6}\s*|[-*+>]\s+|\|\s*)?(?:(?:\d+|[一二三四五六七八九十]+)[.、．]\s*|[（(](?:\d+|[一二三四五六七八九十]+)[）)]\s*)?(?:\*\*)?`;

/** 名字后面：可以有加粗的星号，接着是行尾、冒号、括号或竖线。 */
const nameEnd = String.raw`(?:\*\*)?(?=\s*(?:$|[：:（(|]))`;

/** 十二样的名字，另加旧主线里的简写和旧模板里的写法。名字里的空格可有可无。 */
const specItemNames: Readonly<Record<DesignSpecItem, string>> = {
  informationArchitecture: "信息结构",
  color: "配色",
  typography: "字体(?:排版)?",
  layout: "布局",
  interaction: "交互",
  motion: "动效",
  icons: String.raw`图标(?:\s*[和与]\s*SVG)?`,
  copywriting: "文案",
  agentInterface: String.raw`给\s*AI(?:\s*的界面)?`,
  states: "状态",
  accessibility: "无障碍",
  approach: "做法(?:和阶段)?",
};

const specItemLines = Object.entries(specItemNames).map(
  ([item, name]) => [item, new RegExp(`${lineLead}(?:${name})${nameEnd}`, "u")] as const,
);

/** 各自起一行的设计规范有几样。同一样写了几行只算一样。 */
function specItemCount(lines: readonly string[]): number {
  const items = new Set<string>();
  for (const line of lines) {
    for (const [item, pattern] of specItemLines) if (pattern.test(line)) items.add(item);
  }
  return items.size;
}

/** 规则 scenes.pasted：文字里有两行以上以「场景」加编号开头的卡，每张报一处。 */
const scenesPasted = defineRule({
  id: "scenes.pasted",
  level: "block",
  scope: onCards,
  since: scenesPastedAdded,
  needs: [],
  about: rulesCopy.about.scenes.pasted,
  copy: scenesCopy.pasted,
  check: (page: PageSections) =>
    cardsOf(page).flatMap(({ section, index, card }) =>
      cardLines(card).filter((line) => sceneLine.test(line)).length >= 2
        ? [
            {
              where: [section, index],
              params: { section: pageSection.label(section), title: card.title },
            },
          ]
        : [],
    ),
  samples: scenesPastedSamples,
});

/** 规则 spec.pasted：文字里有两样以上设计规范各自起一行的卡，每张报一处。 */
const specPasted = defineRule({
  id: "spec.pasted",
  level: "block",
  scope: onCards,
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.spec.pasted,
  copy: specCopy.pasted,
  check: (page: PageSections) =>
    cardsOf(page).flatMap(({ section, index, card }) =>
      specItemCount(cardLines(card)) >= 2
        ? [
            {
              where: [section, index],
              params: { section: pageSection.label(section), title: card.title },
            },
          ]
        : [],
    ),
  samples: specPastedSamples,
});

/** 卡里整段写场景清单或设计规范的规则，登记在 registry.ts。 */
export const pastedRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  scenesPasted,
  specPasted,
];
