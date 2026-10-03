import { baseCards, basePage, noContext, pageWith } from "./cards.samples.ts";
import type { PageContext, PageSubject } from "./cards.ts";
import type { RuleSamples } from "./rule.ts";

// 规则 card.title.name 的样本，见「07 校验」第六节，写法见 cards.samples.ts 的开头。
// 基础数据里卡片、选项、更改和图表的标题都是名字。会命中的样本各把一个标题改成句子。

type Samples = RuleSamples<PageSubject, PageContext>;

const base = { subject: basePage, context: noContext };
const { ask } = baseCards;

/** 更改的标题写成了解释：十七个字，没有标点，只是太长。这是用户指出的那一条。 */
const longChange = "队列看板下面横着列出这一轮做完的事";
const longOption = "看板放在顶上：一排筛选，一眼看到，不占别的地方。";

/** 标题里带着逗号，只有九个字，不长，但是一句话。 */
const withComma = "改完以后，看板放下面";

const tooLong = (width: number) => `标题有 ${width} 个字，超过 16 个字。`;
const hasMark = (marks: string) => `标题里有「${marks}」，是一句话。`;

export const titleSamples: Samples = {
  base,
  hits: [
    {
      why: "更改的标题写成了解释，长过十六个字，用户指出的那一条",
      subject: pageWith([["changes", 0, "title"], longChange]),
      expect: [
        {
          where: ["changes", 0, "title"],
          params: { kind: "更改", title: longChange, problem: tooLong(17) },
        },
      ],
    },
    {
      why: "卡片的标题只有九个字，带着逗号",
      subject: pageWith([["asks", 0, "title"], withComma]),
      expect: [
        {
          where: ["asks", 0, "title"],
          params: { kind: ask.section, title: withComma, problem: hasMark("，") },
        },
      ],
    },
    {
      why: "选项的标题带着句号和冒号，又长过十六个字，两条原因写在同一处",
      subject: pageWith([["asks", 0, "options", 0, "title"], longOption]),
      expect: [
        {
          where: ["asks", 0, "options", 0, "title"],
          params: {
            kind: "选项",
            title: longOption,
            problem: `${tooLong(20)}${hasMark("：，。")}`,
          },
        },
      ],
    },
    {
      why: "图表的标题带着分号",
      subject: pageWith([["asks", 0, "shared", "diagrams", 0, "title"], "写入路径；先写队列"]),
      expect: [
        {
          where: ["asks", 0, "shared", "diagrams", 0, "title"],
          params: { kind: "图表", title: "写入路径；先写队列", problem: hasMark("；") },
        },
      ],
    },
  ],
};
