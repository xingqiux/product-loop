import type { AskCard, FindingCard } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 元素清单两条规则的样本，见「07 校验」第六节。基础数据是一页合格的检查页：
// 一条发现问题，两屏元素清单，每屏都写了 where。每份会命中的样本在它上面改一处。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type Screen = NonNullable<PageSections["screens"]>[number];

const context: RuleContextOf<never> = {};

const finding: FindingCard = {
  title: "每一块名字下面的说明没有必要",
  why: "控件自己能说明怎么操作。",
  sources: [{ name: "疑问块", saw: "名字下面有一句说明。", img: "img/ask-block.png" }],
  where: { scene: "S3", step: 2 },
};

const followUp: AskCard = {
  title: "你平时先看哪一块",
  why: "答案决定块的顺序。",
  sources: [{ name: "用户昨天说的", saw: "「先看更改」", quote: true }],
};

const askBlock: Screen = {
  name: "报告网页：疑问块",
  where: { scene: "S3", step: 1 },
  elements: [
    { what: "块标题「疑问」", answers: "这一块是什么" },
    { what: "选项小卡", answers: "我可以选哪个" },
  ],
};

const changeBlock: Screen = {
  name: "报告网页：更改块",
  where: { scene: "S5", step: 2 },
  elements: [{ what: "改前改后两张图", answers: "改了什么" }],
};

export const screensPresentSamples: Samples = {
  base: { subject: { asks: [followUp], findings: [finding], screens: [askBlock] }, context },
  hits: [
    {
      why: "检查阶段没有元素清单",
      subject: { asks: [followUp], findings: [finding] },
      expect: [{ where: ["screens"], params: {} }],
    },
  ],
};

export const screensWhereSamples: Samples = {
  base: { subject: { findings: [finding], screens: [askBlock, changeBlock] }, context },
  hits: [
    {
      why: "有一屏没有写是哪个场景的第几步",
      subject: {
        findings: [finding],
        screens: [askBlock, { name: changeBlock.name, elements: changeBlock.elements }],
      },
      expect: [{ where: ["screens", 1, "where"], params: { name: "报告网页：更改块" } }],
    },
  ],
};
