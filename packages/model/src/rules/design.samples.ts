import type { AskCard, CardOption } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 设计类的卡三条规则的样本，见「07 校验」第六节。基础数据是一页合格的构思页：
// 一张设计类的疑问卡先看再画，同一页带着设计规范。每份会命中的样本在它上面改一处。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;

const context: RuleContextOf<never> = {};

const optionA: CardOption = {
  key: "a",
  title: "顶栏右边一个主按钮",
  diffs: ["顶栏右边"],
  why: "每一页都能新建。",
  cost: "顶栏多一个按钮。",
  when: "新建是最常做的事。",
  sketch: '<div class="wf"><div class="wf-row"><span class="wf-btn">新建设计</span></div></div>',
};

/** 选项 b 还没有画草稿。 */
const optionBare: CardOption = {
  key: "b",
  title: "列表最前面一张空卡",
  diffs: ["列表的第一格"],
  why: "新建和已有的设计在一处。",
  cost: "要先回到列表。",
  when: "设计不多，列表就是首页。",
};

const optionB: CardOption = { ...optionBare, sketch: '<img src="img/entry-card.png">' };

const ownSource: AskCard["sources"][number] = {
  name: "现在的首页",
  saw: "新建藏在右上角的菜单里。",
  img: "img/home-now.png",
};

const designAsk: AskCard = {
  title: "新建设计的入口放在哪里",
  why: "入口放在顶栏，还是放在列表里。",
  sources: [
    ownSource,
    {
      name: "Figma 的文件列表",
      saw: "列表最前面是一张新建的空卡。",
      img: "img/figma-files.png",
      outside: true,
    },
  ],
  design: true,
  shared: { text: "两种放法都用同一个按钮样式。" },
  rows: ["放在哪里"],
  options: [optionA, optionB],
  stance: { pick: "a", because: "新建是每天都做的事。" },
  research: { tier: "quick" },
};

const followUp: AskCard = {
  title: "上次新建设计是什么时候",
  why: "答案写进给谁用。",
  sources: [{ name: "用户昨天说的", saw: "「我一周新建两三份」", quote: true }],
};

const spec: PageSections["spec"] = [
  { name: "主按钮", kind: "type", for: "新建设计的按钮", values: [{ name: "按钮", size: 13 }] },
];

const base: PageSections = { spec, asks: [designAsk, followUp] };

export const designOutsideSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "设计类的卡只有自己产品的截图，候选都是从 AI 脑子里来的",
      subject: { spec, asks: [{ ...designAsk, sources: [ownSource] }, followUp] },
      expect: [{ where: ["asks", 0, "sources"], params: { title: "新建设计的入口放在哪里" } }],
    },
  ],
};

export const designSketchSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "设计类的卡有一个选项没有草稿",
      subject: {
        spec,
        asks: [{ ...designAsk, options: [optionA, optionBare] }, followUp],
      },
      expect: [
        {
          where: ["asks", 0, "options", 1, "sketch"],
          params: { title: "新建设计的入口放在哪里", key: "b" },
        },
      ],
    },
  ],
};

export const designSpecSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "构思页有设计类的卡，同一页没有带上设计规范",
      subject: { asks: [followUp, designAsk] },
      expect: [{ where: ["spec"], params: { title: "新建设计的入口放在哪里" } }],
    },
  ],
};
