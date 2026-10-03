import { baseCards, basePage, noContext, pageWith } from "./cards.samples.ts";
import type { PageContext, PageSubject } from "./cards.ts";
import type { RuleSamples } from "./rule.ts";

// 来源一级规则的样本，写法见 cards.samples.ts 的开头。
// 基础数据里，疑问卡的三条来源正好是截图、文字和原话三种写法，提升卡有一条外面的截图。

type Samples = RuleSamples<PageSubject, PageContext>;

const { ask, finding, followUp, improvement } = baseCards;
const base = { subject: basePage, context: noContext };

/** 基础数据里截图来源的名字。疑问卡和发现卡的第一条来源都是它。 */
const shot = "报告网页现在的样子";

export const sourceSamples = {
  "card.source.visual": {
    base,
    hits: [
      {
        why: "来源有一条没有配图，同旧样本 legacy-005",
        subject: pageWith([["findings", 0, "sources", 0, "img"], undefined]),
        expect: [{ where: ["findings", 0, "sources", 0], params: { ...finding, name: shot } }],
      },
      {
        why: "来源只写了一段话，同旧样本 legacy-004 转换以后的样子",
        subject: pageWith([
          ["asks", 1, "sources"],
          [{ name: "看到", saw: "正文的写法规矩那一节。" }],
        ]),
        expect: [{ where: ["asks", 1, "sources", 0], params: { ...followUp, name: "看到" } }],
      },
      {
        why: "外面的来源只标了 outside，没有图",
        subject: pageWith([["improvements", 0, "sources", 0, "img"], undefined]),
        expect: [
          {
            where: ["improvements", 0, "sources", 0],
            params: { ...improvement, name: "Linear 的队列页" },
          },
        ],
      },
      {
        why: "两张卡各有一条来源没有写法，按卡片的顺序都报出来",
        subject: pageWith(
          [["asks", 0, "sources", 0, "img"], undefined],
          [["findings", 0, "sources", 0, "img"], undefined],
        ),
        expect: [
          { where: ["asks", 0, "sources", 0], params: { ...ask, name: shot } },
          { where: ["findings", 0, "sources", 0], params: { ...finding, name: shot } },
        ],
      },
    ],
  },
} satisfies Record<string, Samples>;
