import { cardRulesCopy } from "../copy/card-rules.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { CardOption } from "../page/card.ts";
import { pageSection } from "../page/section-names.ts";
import { readingLength } from "../writing/measure.ts";
import { len } from "../writing/python.ts";
import {
  type CardAt,
  cardNames,
  cardPath,
  cardsAdded,
  cardsOf,
  onCards,
  type PageRule,
  type PageSubject,
} from "./cards.ts";
import { optionSamples } from "./options.samples.ts";
import { defineRule, type RuleWhere } from "./rule.ts";

// 页面规则第一批里选项一级的：一格差别的长度，理由、代价、适用场景什么时候要写，选项长短的提醒。
// 旧脚本见 build-report.py 的 check_cards 和 wording_notes，行号写在每条规则上。
// 共同的写法和起始日期见 cards.ts 的开头。

/** 选项卡的新版式，一格最多六十字，提交 b2726e9。 */
const cellAdded = "2026-09-21";

/** 一格最多几个字，按读起来的长度算，见 writing/measure.ts 的 readingLength。六十字是两行。 */
const cellMax = 60;

/** 最长的选项超过最短的几倍时提醒。 */
const balanceRatio = 2.2;

/** 页面上的一个选项：在哪张卡上，是第几个，是不是最后一个。 */
type OptionAt = CardAt & {
  readonly option: CardOption;
  readonly position: number;
  readonly last: boolean;
};

/** 页面上的全部选项，按卡片和选项的顺序。 */
function optionsOf(page: PageSubject): OptionAt[] {
  return cardsOf(page).flatMap((at) => {
    const options = at.card.options ?? [];
    return options.map((option, position) => ({
      ...at,
      option,
      position,
      last: position === options.length - 1,
    }));
  });
}

/** 选项上一个字段的位置，例如 ["asks", 0, "options", 1, "when"]。 */
function optionPath(at: OptionAt, ...rest: readonly (string | number)[]): RuleWhere {
  return cardPath(at, "options", at.position, ...rest);
}

/** 报错里怎么称呼一个选项：卡的称呼加上选项的 key。 */
function optionNames(at: OptionAt) {
  return { ...cardNames(at), key: at.option.key };
}

/** 迁移时挪进疑问的发现问题和提升，标签写原来区块的名字（决定 189）。 */
const movedTags: ReadonlySet<string> = new Set([
  pageSection.label("findings"),
  pageSection.label("improvements"),
]);

/** 可以不写理由、代价和适用场景的那个选项的名字。 */
const noChangeTitle = "不改";

/**
 * 发现和提升的最后一个选项叫「不改」时，只写留下的是什么，理由、代价和适用场景都可以不写。
 * 最后一个选项叫别的名字，照常要写。迁移时挪进疑问的发现和提升照旧，不看名字。
 */
function mayBeNoChange(at: OptionAt): boolean {
  if (!at.last) return false;
  if (at.section === "findings" || at.section === "improvements") {
    return at.option.title === noChangeTitle;
  }
  return at.card.tag !== undefined && movedTags.has(at.card.tag);
}

const about = rulesCopy.about.card;

/** 旧脚本第 274 到 276 行：一格差别超过六十字。每个选项的每一格都查，超过的各报一次。 */
const cellLength = defineRule({
  id: "card.cell.length",
  level: "block",
  scope: onCards,
  since: cellAdded,
  needs: [],
  about: about.cell.length,
  copy: cardRulesCopy.cell.length,
  check: (page: PageSubject) =>
    optionsOf(page).flatMap((at) =>
      at.option.diffs.flatMap((text, i) => {
        const length = readingLength(text);
        if (length <= cellMax) return [];
        return [{ where: optionPath(at, "diffs", i), params: { ...optionNames(at), length } }];
      }),
    ),
  samples: optionSamples["card.cell.length"],
});

/** 旧脚本第 277 到 278 行的前一半：选项要写理由。写了 only 的卡也要写。 */
const optionWhy = defineRule({
  id: "card.option.why",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.option.why,
  copy: cardRulesCopy.option.why,
  check: (page: PageSubject) =>
    optionsOf(page)
      .filter((at) => at.option.why === undefined && !mayBeNoChange(at))
      .map((at) => ({ where: optionPath(at, "why"), params: optionNames(at) })),
  samples: optionSamples["card.option.why"],
});

/** 旧脚本第 277 到 278 行的后一半：选项要写代价。 */
const optionCost = defineRule({
  id: "card.option.cost",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.option.cost,
  copy: cardRulesCopy.option.cost,
  check: (page: PageSubject) =>
    optionsOf(page)
      .filter((at) => at.option.cost === undefined && !mayBeNoChange(at))
      .map((at) => ({ where: optionPath(at, "cost"), params: optionNames(at) })),
  samples: optionSamples["card.option.cost"],
});

/** 旧脚本第 280 到 281 行：选项要写适用场景。写了 only 的卡只有一个方向，不用写。 */
const optionWhen = defineRule({
  id: "card.option.when",
  level: "block",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.option.when,
  copy: cardRulesCopy.option.when,
  check: (page: PageSubject) =>
    optionsOf(page)
      .filter(
        (at) => at.option.when === undefined && at.card.only === undefined && !mayBeNoChange(at),
      )
      .map((at) => ({ where: optionPath(at, "when"), params: optionNames(at) })),
  samples: optionSamples["card.option.when"],
});

/**
 * 一个选项的篇幅，照旧脚本按字符数算：理由、代价、适用场景和每一格差别的字数加起来。
 * 字数照 Python 的 len 按码位数，标点和英文都算，和一格的长度的算法不同。
 */
function optionSize(option: CardOption): number {
  const texts = [option.why, option.cost, option.when, ...option.diffs];
  return texts.reduce((sum, text) => sum + len(text ?? ""), 0);
}

/**
 * 旧脚本第 57 到 60 行，措辞提醒里的一条：几个选项长短相差太多，多半是一个认真写、其余凑数。
 * 只比写了代价的选项，最后一个「不改」通常不写代价，不参加比较。至少两个才比。
 */
const optionsBalance = defineRule({
  id: "card.options.balance",
  level: "warn",
  scope: onCards,
  since: cardsAdded,
  needs: [],
  about: about.options.balance,
  copy: cardRulesCopy.options.balance,
  check: (page: PageSubject) =>
    cardsOf(page).flatMap((at) => {
      const sizes = (at.card.options ?? [])
        .filter((option) => option.cost !== undefined)
        .map(optionSize);
      if (sizes.length < 2 || Math.max(...sizes) <= balanceRatio * Math.min(...sizes)) return [];
      return [{ where: cardPath(at, "options"), params: cardNames(at) }];
    }),
  samples: optionSamples["card.options.balance"],
});

/** 选项一级的五条规则，顺序是旧脚本查的顺序，选项长短的提醒最后。 */
export const optionRuleList: readonly PageRule[] = [
  cellLength,
  optionWhy,
  optionCost,
  optionWhen,
  optionsBalance,
];
