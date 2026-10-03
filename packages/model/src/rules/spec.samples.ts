import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 设计规范两条规则的样本，见「07 校验」第六节。基础数据是一面合格的样张墙，
// 每份会命中的样本在它上面改一处。页面数据是通过了定义以后的样子，枚举是英文键。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type SpecItem = NonNullable<PageSections["spec"]>[number];

const context: RuleContextOf<never> = {};

const colors: SpecItem = {
  name: "配色",
  kind: "colors",
  for: "整个工作台",
  values: [
    { name: "底", hex: "#f4f5f7" },
    { name: "强调", hex: "#1f6feb" },
  ],
};

const states: SpecItem = {
  name: "状态标签",
  kind: "table",
  for: "队列看板的小卡",
  columns: [{ name: "状态" }, { name: "颜色", as: "color" }],
  rows: [
    [{ text: "待办", tone: "todo" }, "#eef1f4"],
    [{ text: "等待", tone: "waiting" }, "#fff4e5"],
  ],
};

/** 三行字，中间隔着一个空行。空行不算，正好三行。 */
const buttonText: SpecItem = {
  name: "按钮的文案",
  kind: "text",
  for: "所有按钮",
  text: "按钮写动词。\n不写「确定」。\n\n删除的按钮写清删的是什么。",
};

const base: PageSections = { spec: [colors, states, buttonText] };

export const specForSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "表格的一格没有写 for",
      subject: {
        spec: [
          colors,
          {
            name: "状态标签",
            kind: "table",
            columns: [{ name: "状态" }],
            rows: [[{ text: "待办", tone: "todo" }]],
          },
          buttonText,
        ],
      },
      expect: [{ where: ["spec", 1, "for"], params: { name: "状态标签" } }],
    },
    {
      why: "旧页面的样张墙都没有写 for，每一格各报一处",
      subject: {
        spec: [
          { name: "配色", kind: "colors", values: [{ name: "底", hex: "#f4f5f7" }] },
          { name: "圆角", kind: "radius", values: [4, 8] },
        ],
      },
      expect: [
        { where: ["spec", 0, "for"], params: { name: "配色" } },
        { where: ["spec", 1, "for"], params: { name: "圆角" } },
      ],
    },
  ],
};

export const specTextLinesSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "文字的一格写了四行，之前的构思阶段真实留下的",
      subject: {
        spec: [
          colors,
          states,
          {
            name: "字段名",
            kind: "text",
            for: "队列的展示卡片",
            text: "内容写这件事是什么。\n阶段写五个阶段之一。\n状态写五种之一。\n依赖写在等什么。",
          },
        ],
      },
      expect: [{ where: ["spec", 2, "text"], params: { name: "字段名", lines: 4 } }],
    },
  ],
};
