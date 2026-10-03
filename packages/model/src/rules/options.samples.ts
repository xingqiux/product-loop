import { baseCards, basePage, noContext, pageWith } from "./cards.samples.ts";
import type { PageContext, PageSubject } from "./cards.ts";
import type { RuleSamples } from "./rule.ts";

// 选项一级规则的样本，写法见 cards.samples.ts 的开头。
// 基础数据里，疑问卡的两个选项四格都写了，发现卡的最后一个选项是「不改」，只写了差别。

type Samples = RuleSamples<PageSubject, PageContext>;

const { ask, finding } = baseCards;
const base = { subject: basePage, context: noContext };

export const optionSamples = {
  "card.cell.length": {
    base,
    hits: [
      {
        why: "差别的一格写得太长，超过两行，同旧样本 legacy-093",
        subject: pageWith([
          ["asks", 0, "options", 0, "diffs", 0],
          "改完之后页面上会出现一个新的区块，".repeat(5),
        ]),
        expect: [
          {
            where: ["asks", 0, "options", 0, "diffs", 0],
            params: { ...ask, key: "a", length: 80 },
          },
        ],
      },
    ],
  },
  "card.option.why": {
    base,
    hits: [
      {
        why: "疑问的最后一个选项没写理由",
        subject: pageWith([["asks", 0, "options", 1, "why"], undefined]),
        expect: [{ where: ["asks", 0, "options", 1, "why"], params: { ...ask, key: "b" } }],
      },
      {
        why: "发现卡不是最后一个的选项没写理由",
        subject: pageWith([["findings", 0, "options", 0, "why"], undefined]),
        expect: [{ where: ["findings", 0, "options", 0, "why"], params: { ...finding, key: "a" } }],
      },
      {
        why: "发现卡的最后一个选项不叫「不改」，照常要写理由",
        subject: pageWith(
          [["findings", 0, "options", 1, "title"], "提示要输入"],
          [["findings", 0, "options", 1, "why"], undefined],
        ),
        expect: [{ where: ["findings", 0, "options", 1, "why"], params: { ...finding, key: "b" } }],
      },
    ],
  },
  "card.option.cost": {
    base,
    hits: [
      {
        why: "疑问的选项缺代价，同旧样本 legacy-001",
        subject: pageWith([["asks", 0, "options", 0, "cost"], undefined]),
        expect: [{ where: ["asks", 0, "options", 0, "cost"], params: { ...ask, key: "a" } }],
      },
      {
        why: "发现的选项缺代价，同旧样本 legacy-002",
        subject: pageWith([["findings", 0, "options", 0, "cost"], undefined]),
        expect: [
          { where: ["findings", 0, "options", 0, "cost"], params: { ...finding, key: "a" } },
        ],
      },
    ],
  },
  "card.option.when": {
    base,
    hits: [
      {
        why: "选项没写什么情况下该选它，同旧样本 legacy-107",
        subject: pageWith([["asks", 0, "options", 1, "when"], undefined]),
        expect: [{ where: ["asks", 0, "options", 1, "when"], params: { ...ask, key: "b" } }],
      },
    ],
  },
  "card.options.balance": {
    base,
    hits: [
      {
        why: "选项长短差得太多，同旧样本 legacy-110",
        subject: pageWith([["asks", 0, "options", 0, "why"], "去掉的是哪个根因。".repeat(12)]),
        expect: [{ where: ["asks", 0, "options"], params: ask }],
      },
    ],
  },
} satisfies Record<string, Samples>;
