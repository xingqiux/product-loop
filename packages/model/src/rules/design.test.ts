import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Stage } from "../names.ts";
import type { AskCard } from "../page/card.ts";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { designOutsideSamples, designSketchSamples, designSpecSamples } from "./design.samples.ts";
import { designRuleList } from "./design.ts";
import { type RunOptions, runRules } from "./run.ts";

// 设计类的卡三条规则在总测试以外的情况：只在构思查，每一处各报一次，以及历史页面模式。

/** 一张有两个选项的疑问卡，来源只有自己产品的截图，选项都没有草稿。 */
const choice: AskCard = {
  title: "新建设计的入口放在哪里",
  why: "入口放在顶栏，还是放在列表里。",
  sources: [{ name: "现在的首页", saw: "新建藏在菜单里。", img: "img/home-now.png" }],
  shared: { text: "两种放法都用同一个按钮样式。" },
  rows: ["放在哪里"],
  options: [
    { key: "a", title: "顶栏右边", diffs: ["顶栏右边"] },
    { key: "b", title: "列表最前面", diffs: ["列表的第一格"] },
  ],
};

/** 同一张卡标成设计类：三条规则都会命中。 */
const bare: AskCard = { ...choice, design: true };

const outside = {
  name: "Figma 的文件列表",
  saw: "列表最前面是一张新建的空卡。",
  img: "img/figma-files.png",
  outside: true,
} as const;

/** 先看再画都做到了的设计类的卡。 */
const drawn: AskCard = {
  ...bare,
  sources: [...bare.sources, outside],
  options: (bare.options ?? []).map((option) => ({ ...option, sketch: "<div>草稿</div>" })),
};

const spec: PageSections["spec"] = [
  { name: "主按钮", kind: "type", for: "新建设计的按钮", values: [{ name: "按钮", size: 13 }] },
];

const think: RunOptions = { mode: "current", stage: "think" };

/** 命中写成「编号 位置」。 */
function hits(page: PageSections, options = think) {
  const run = runRules(designRuleList, page, {}, options);
  return [...run.block, ...run.warn].map((issue) => `${issue.rule} ${issue.where ?? ""}`);
}

describe("样本都是合格的页面数据", () => {
  const samples = [designOutsideSamples, designSketchSamples, designSpecSamples].flatMap(
    ({ base, hits: list }) => [
      ["基础数据", base.subject] as const,
      ...list.map((sample) => [sample.why, sample.subject] as const),
    ],
  );
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("只在构思查", () => {
  it("构思页上每一处都报", () => {
    expect(hits({ asks: [bare] })).toEqual([
      "design.outside asks[0].sources",
      "design.sketch asks[0].options[0].sketch",
      "design.sketch asks[0].options[1].sketch",
      "design.spec spec",
    ]);
  });

  it("别的阶段的设计类疑问卡不查", () => {
    const others: Stage[] = ["use", "check", "land", "improve"];
    for (const stage of others) {
      expect(hits({ asks: [bare] }, { mode: "current", stage }), stage).toEqual([]);
    }
  });

  it("执行时不写阶段，算调用的一方写错了", () => {
    expect(() => runRules(designRuleList, { asks: [bare] }, {})).toThrow("只在构思查");
  });
});

describe("先看再画", () => {
  it("不是设计类的卡不查", () => {
    expect(hits({ asks: [choice] })).toEqual([]);
  });

  it("标了 outside 的来源要有截图才算外面的东西", () => {
    const noImage = { name: outside.name, saw: outside.saw, outside: true } as const;
    const card: AskCard = { ...drawn, sources: [noImage] };
    expect(hits({ spec, asks: [card] })).toEqual(["design.outside asks[0].sources"]);
  });

  it("没有选项的设计类的卡，只查来源和设计规范", () => {
    const card: AskCard = { title: bare.title, why: bare.why, sources: bare.sources, design: true };
    expect(hits({ asks: [card] })).toEqual(["design.outside asks[0].sources", "design.spec spec"]);
  });

  it("每张设计类的卡各查各的", () => {
    expect(hits({ spec, asks: [drawn, choice, bare] })).toEqual([
      "design.outside asks[2].sources",
      "design.sketch asks[2].options[0].sketch",
      "design.sketch asks[2].options[1].sketch",
    ]);
  });
});

describe("同一页要有设计规范", () => {
  it("有几张设计类的卡都只报一处，写第一张的标题", () => {
    const second: AskCard = { ...drawn, title: "设计列表怎么排" };
    const run = runRules(designRuleList, { asks: [choice, drawn, second] }, {}, think);
    expect(run.block.map((issue) => [issue.where, issue.message])).toEqual([
      ["spec", "疑问「新建设计的入口放在哪里」是设计类的卡，这一页却没有设计规范。"],
    ]);
  });

  it("有设计规范就不报，不看规范里有没有这个组件", () => {
    const colors: PageSections["spec"] = [
      { name: "配色", kind: "colors", for: "整个工作台", values: [{ name: "底", hex: "#ffffff" }] },
    ];
    expect(hits({ spec: colors, asks: [drawn] })).toEqual([]);
  });
});

describe("历史页面模式", () => {
  it("先看再画两条从 2026-09-20 起查，带设计规范从 2026-09-21 起查，更早的页面跳过", () => {
    const history = (pageDate: string): RunOptions => ({
      mode: "history",
      pageDate,
      stage: "think",
    });
    const early = runRules(designRuleList, { asks: [bare] }, {}, history("2026-09-20"));
    expect(early.skipped).toEqual(["design.outside", "design.sketch", "design.spec"]);
    expect(hits({ asks: [bare] }, history("2026-09-20"))).toEqual([]);
    const middle = runRules(designRuleList, { asks: [bare] }, {}, history("2026-09-21"));
    expect(middle.skipped).toEqual(["design.spec"]);
    expect(hits({ asks: [bare] }, history("2026-09-21"))).toHaveLength(3);
    expect(hits({ asks: [bare] }, history("2026-09-22"))).toHaveLength(4);
  });
});
