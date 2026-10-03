import { cardRulesCopy } from "../copy/card-rules.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { Card } from "../page/card.ts";
import { pageSection } from "../page/section-names.ts";
import type { PageSections } from "../page/sections.ts";
import { displayWidth } from "../writing/measure.ts";
import { cardSamples } from "./cards.samples.ts";
import {
  defineRule,
  type Rule,
  type RuleContextOf,
  type RuleScope,
  type RuleWhere,
  sinceRelease,
} from "./rule.ts";

// 页面规则第一批：卡片、选项和来源，见第一期计划第 25 步和「07 校验」第四节。
// 规则查的是通过了数据定义的页面数据。字段在不在、写法对不对由定义查，这里只查定义查不了的：
// 要看同一张卡上别的字段，或者要算长度，见 page/card.ts 的开头。
// 这个文件放卡片一级的：only 和 dropped、行名的宽度、看法。选项的见 options.ts，来源的见 sources.ts。
// 起始日期按约定 0001 第 14 条，在子树导入的提交历史里用 git log -S 查旧脚本那一行，见下面的常量。
// 旧脚本的行号指 v1-final 的 skill/scripts/build-report.py，第 29 步按它对照反例样本。

/** 页面规则查的数据：通过了数据定义的页面数据，枚举是英文键。 */
export type PageSubject = PageSections;

/** 这一批规则不要上下文。 */
export type PageContext = RuleContextOf<never>;

/** 这一批的一条规则。 */
export type PageRule = Rule<PageSubject, PageContext>;

// 起始日期按 UTC 取：旧页面数据里的日期是 UTC 的日期，旧 skill 的提交时间写的是 -07:00。
// 例如 2026-09-20 21:10 -07:00 的提交，按 UTC 是 21 日，那天晚上生成的页面写的也是 21 日。
/**
 * 旧脚本里一建仓库就有的检查：来源要有图、only 和 dropped、理由和代价、适用场景、选项长短的提醒。
 * 建仓库的提交 75b4c2d 里都已经有了，那一天是 2026-09-20，更早的日期查不到。
 */
export const cardsAdded = "2026-09-20";

/** 对照表的行名限制在八个字以内，提交 7f6ab97。同一天的 6d8de7c 改成按显示宽度算。 */
const rowAdded = "2026-09-21";

/** 两个以上选项的卡要写 shared，提交 b2726e9。之前的页面按旧版式写，没有这一格。 */
const sharedAdded = "2026-09-21";

/** 行名最多几个字，按显示宽度算，见 writing/measure.ts 的 displayWidth。 */
const rowNameMax = 8;

/** 三种卡片所在的区块，按页面上的顺序，对应旧脚本的 CARD_BLOCKS。回到构思已经并进疑问。 */
const cardBlocks = ["asks", "findings", "improvements"] as const;

/** 页面上的一张卡：哪个区块的第几张。 */
export type CardAt = {
  readonly section: (typeof cardBlocks)[number];
  readonly index: number;
  readonly card: Card;
};

/** 页面上的全部卡片，按区块和卡片的顺序。 */
export function cardsOf(page: PageSubject): CardAt[] {
  return cardBlocks.flatMap((section) => {
    const cards: readonly Card[] = page[section] ?? [];
    return cards.map((card, index) => ({ section, index, card }));
  });
}

/** 卡上一个字段的位置，例如 ["asks", 0, "rows", 1]。 */
export function cardPath(at: CardAt, ...rest: readonly (string | number)[]): RuleWhere {
  return [at.section, at.index, ...rest];
}

/** 报错里怎么称呼一张卡：区块的名字和卡的标题，例如疑问「队列看板放在哪里」。 */
export function cardNames(at: CardAt): { readonly section: string; readonly title: string } {
  return { section: pageSection.label(at.section), title: at.card.title };
}

/** 这一批规则的范围：三种卡片，每个阶段都查，在 page check 和给出信息时执行。 */
export const onCards: RuleScope = {
  subjects: ["page"],
  sections: ["asks", "findings", "improvements"],
  commands: ["page check", "page present"],
};

const about = rulesCopy.about.card;

/** 旧脚本第 245 到 247 行：写了 only 的卡，选项不是正好一个，或者没有 dropped。这里是前一半。 */
const onlyOne = defineRule({
  id: "card.only.one",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.only.one,
  copy: cardRulesCopy.only.one,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) => {
      const count = at.card.options?.length ?? 0;
      if (at.card.only === undefined || count === 1) return [];
      return [{ where: cardPath(at, "options"), params: { ...cardNames(at), count } }];
    }),
  samples: cardSamples["card.only.one"],
});

/** 旧脚本第 245 到 247 行的后一半：写了 only 的卡要有 dropped。 */
const onlyDropped = defineRule({
  id: "card.only.dropped",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.only.dropped,
  copy: cardRulesCopy.only.dropped,
  check: (page: PageSubject) =>
    cardsOf(page)
      .filter(({ card }) => card.only !== undefined && card.dropped === undefined)
      .map((at) => ({ where: cardPath(at, "dropped"), params: cardNames(at) })),
  samples: cardSamples["card.only.dropped"],
});

/** 旧脚本第 249 到 250 行：只有一个选项、没有写 only 的卡。只有一个方向时不凑第二个。 */
const onlyNeeded = defineRule({
  id: "card.only.needed",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.only.needed,
  copy: cardRulesCopy.only.needed,
  check: (page: PageSubject) =>
    cardsOf(page)
      .filter(({ card }) => card.only === undefined && card.options?.length === 1)
      .map((at) => ({ where: cardPath(at, "only"), params: cardNames(at) })),
  samples: cardSamples["card.only.needed"],
});

/**
 * 旧脚本第 263 到 265 行：两个以上选项的卡没有写 shared。
 * 原来由数据定义查，挪成规则以后有起始日期，历史页面模式跳过更早的页，见第一期计划第 60 步。
 */
const sharedRequired = defineRule({
  id: "card.shared.required",
  level: "block",
  scope: onCards,
  since: sharedAdded,
  needs: [],
  about: about.shared.required,
  copy: cardRulesCopy.shared.required,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) => {
      const count = at.card.options?.length ?? 0;
      if (count < 2 || at.card.shared !== undefined) return [];
      return [{ where: cardPath(at, "shared"), params: { ...cardNames(at), count } }];
    }),
  samples: cardSamples["card.shared.required"],
});

/**
 * 旧脚本第 257 到 260 行：行名超过八个字。一张卡的每个行名都查，超过的各报一次。
 * 旧脚本只查带选项的卡，这里照旧。没有选项的卡没有对照表，写了 rows 也不查。
 */
const rowWidth = defineRule({
  id: "card.row.width",
  level: "block",
  scope: onCards,
  since: rowAdded,
  needs: [],
  about: about.row.width,
  copy: cardRulesCopy.row.width,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) => {
      if (at.card.options === undefined) return [];
      return (at.card.rows ?? []).flatMap((row, i) => {
        const width = displayWidth(row);
        if (width <= rowNameMax) return [];
        return [{ where: cardPath(at, "rows", i), params: { ...cardNames(at), row, width } }];
      });
    }),
  samples: cardSamples["card.row.width"],
});

/**
 * 看法选的要是卡上有的选项。页面把看法标在所选选项的列头上（决定 109），选的选项不存在就没处标。
 * 看法的形状由数据定义查。旧脚本第 304 到 306 行也只查形状，没有查选的是哪一个，所以按新规则写 2.0.0。
 */
const stancePick = defineRule({
  id: "card.stance.pick",
  level: "block",
  scope: onCards,
  since: sinceRelease,
  needs: [],
  about: about.stance.pick,
  copy: cardRulesCopy.stance.pick,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) => {
      const { stance, options = [] } = at.card;
      if (stance === undefined || options.some((option) => option.key === stance.pick)) return [];
      return [
        { where: cardPath(at, "stance", "pick"), params: { ...cardNames(at), pick: stance.pick } },
      ];
    }),
  samples: cardSamples["card.stance.pick"],
});

/** 卡片一级的六条规则，顺序是旧脚本查的顺序。 */
export const cardRuleList: readonly PageRule[] = [
  onlyOne,
  onlyDropped,
  onlyNeeded,
  rowWidth,
  sharedRequired,
  stancePick,
];
