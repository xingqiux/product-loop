import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AskCard } from "../page/card.ts";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { scenesPastedSamples, specPastedSamples } from "./pasted.samples.ts";
import { pastedRuleList } from "./pasted.ts";
import { type RunOptions, runRules } from "./run.ts";

// 卡里整段写场景清单或设计规范，两条规则在总测试以外的情况。
// 哪些行算数，查哪几段文字，另查历史页面模式。

const quote = { name: "用户昨天说的", saw: "「这一版看不出改了什么」", quote: true } as const;

/** 一张疑问卡，文字写在 why 里。 */
function ask(why: string): AskCard {
  return { title: "一条疑问", why, sources: [quote] };
}

/** 命中写成「编号 位置」。 */
function hits(page: PageSections, options: RunOptions = { mode: "current" }): string[] {
  const run = runRules(pastedRuleList, page, {}, options);
  return [...run.block, ...run.warn].map((issue) => `${issue.rule} ${issue.where ?? ""}`);
}

/** 每段文字单独写进一张疑问卡的 why，报了的留下。 */
function pasted(texts: readonly string[]): string[] {
  return texts.filter((text) => hits({ asks: [ask(text)] }).length > 0);
}

describe("样本都是合格的页面数据", () => {
  const samples = [scenesPastedSamples, specPastedSamples].flatMap(({ base, hits: list }) => [
    ["基础数据", base.subject] as const,
    ...list.map((sample) => [sample.why, sample.subject] as const),
  ]);
  it.each(samples)("%s 能通过检查阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("check", written).ok).toBe(true);
  });
});

describe("卡里整段写场景清单", () => {
  it("两行以场景加编号开头就算，编号是数字、汉字或全角数字都行", () => {
    const texts = [
      "场景1 看队列\n场景2 看主线",
      "场景十 看队列\n场景十一 看主线",
      "场景１\n场景２",
    ];
    expect(pasted(texts)).toEqual(texts);
  });

  it("照旧脚本的算法：行首有空白、场景后面不是编号、一行里写两个场景，都不算", () => {
    const texts = [
      " 场景一 看队列\n 场景二 看主线",
      "场景清单还没定。\n场景的第二步要改。",
      "场景一和场景二都要改。",
      "只有一行：\n场景一 看队列",
    ];
    expect(pasted(texts)).toEqual([]);
  });

  it("why 和选项的 diffs 合起来数，来源、shared、rows 和选项的理由不查", () => {
    const lines = "场景一 看队列\n场景二 看主线";
    const card: AskCard = {
      title: "一条疑问",
      why: "场景三 看进度",
      sources: [{ name: "主线的场景清单", saw: lines, img: "img/scenes.png" }],
      shared: { text: lines },
      rows: ["场景一", "场景二"],
      options: [
        { key: "a", title: "改", diffs: ["改第二步", "不变"], why: lines },
        { key: "b", title: "不改", diffs: ["不变", "不变"] },
      ],
    };
    expect(hits({ asks: [card] })).toEqual([]);
    const options = (card.options ?? []).map((option, i) =>
      i === 0 ? { ...option, diffs: ["场景四 改第二步", "不变"] } : option,
    );
    expect(hits({ asks: [{ ...card, options }] })).toEqual(["scenes.pasted asks[0]"]);
  });

  it("每张卡各数各的，报错写区块的名称", () => {
    const where = { scene: "S3", step: 2 };
    const improvement = { ...ask("场景一 看队列\n场景二 看主线"), title: "加一个筛选", where };
    const page: PageSections = {
      asks: [ask("场景一 看队列")],
      findings: [{ ...ask("场景二 看主线"), where }],
      improvements: [improvement],
    };
    const run = runRules(pastedRuleList, page, {});
    expect(run.block.map((issue) => [issue.where, issue.message])).toEqual([
      ["improvements[0]", "提升「加一个筛选」的文字里整段写了场景清单。"],
    ]);
  });
});

describe("卡里整段写设计规范", () => {
  it("小标题的几种写法都认：井号、列表、表格、编号和加粗", () => {
    const texts = [
      "## 配色\n### 字体",
      "- **配色**：灰底\n- 布局：两栏",
      "| 交互 | 点一下展开 |\n| 动效 | 160 毫秒 |",
      "1. 文案：写动作\n2、状态（空、加载、出错）",
      "（一）无障碍\n（二）图标",
    ];
    expect(pasted(texts)).toEqual(texts);
  });

  it("主线十二个部分的全称和旧主线的简写都认", () => {
    const texts = [
      "字体排版：13 号\n图标和 SVG：线性",
      "给 AI 的界面：命令行\n做法和阶段：先画再做",
      "信息结构：三层\n给AI：只读",
    ];
    expect(pasted(texts)).toEqual(texts);
  });

  it("句子里提到规范的名字不算小标题，同一个部分写几行只算一个部分", () => {
    const texts = [
      "配色用灰色，布局是两栏。\n状态标签不清楚。\n交互方式照旧。",
      "配色：底色\n配色：强调色",
    ];
    expect(pasted(texts)).toEqual([]);
  });

  it("样张墙的种类名不是十二个部分的名字，不算", () => {
    expect(pasted(["颜色：灰\n字号：13\n圆角：4\n间距：8\n表格：三列\n文字：一条"])).toEqual([]);
  });

  it("来源的 saw 不查", () => {
    const card: AskCard = {
      ...ask("待决定的事。"),
      sources: [{ name: "主线的设计规范", saw: "配色：灰底\n布局：两栏", img: "img/spec.png" }],
    };
    expect(hits({ asks: [card] })).toEqual([]);
  });
});

describe("历史页面模式", () => {
  it("场景清单从 2026-09-20 起查，设计规范起始写 2.0.0，旧页面跳过", () => {
    const page: PageSections = {
      asks: [ask("场景一 看队列\n场景二 看主线\n配色：灰\n布局：两栏")],
    };
    expect(hits(page)).toEqual(["scenes.pasted asks[0]", "spec.pasted asks[0]"]);
    const history = (pageDate: string): RunOptions => ({ mode: "history", pageDate });
    expect(hits(page, history("2026-09-21"))).toEqual(["scenes.pasted asks[0]"]);
    expect(runRules(pastedRuleList, page, {}, history("2026-09-20")).skipped).toEqual([
      "scenes.pasted",
      "spec.pasted",
    ]);
  });
});
