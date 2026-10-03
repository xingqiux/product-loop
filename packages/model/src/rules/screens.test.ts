import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Stage } from "../names.ts";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { type RunOptions, runRules } from "./run.ts";
import { screensPresentSamples, screensWhereSamples } from "./screens.samples.ts";
import { screensRuleList } from "./screens.ts";

// 元素清单两条规则在总测试以外的情况。
// 只有检查阶段要有元素清单，每一屏写 where，另查历史页面模式。

type Screen = NonNullable<PageSections["screens"]>[number];

const elements: Screen["elements"] = [{ what: "块标题", answers: "这一块是什么" }];

/** 命中写成「编号 位置」。 */
function hits(page: PageSections, options: RunOptions = { mode: "current", stage: "check" }) {
  const run = runRules(screensRuleList, page, {}, options);
  return [...run.block, ...run.warn].map((issue) => `${issue.rule} ${issue.where ?? ""}`);
}

describe("样本都是合格的页面数据", () => {
  const samples = [screensPresentSamples, screensWhereSamples].flatMap(({ base, hits: list }) => [
    ["基础数据", base.subject] as const,
    ...list.map((sample) => [sample.why, sample.subject] as const),
  ]);
  it.each(samples)("%s 能通过检查阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("check", written).ok).toBe(true);
  });
});

describe("检查阶段要有元素清单", () => {
  it("检查阶段没有元素清单时报一处，报在元素清单上", () => {
    expect(hits({})).toEqual(["screens.present screens"]);
  });

  it("别的阶段没有元素清单不报", () => {
    const others: Stage[] = ["think", "use", "land", "improve"];
    for (const stage of others) expect(hits({}, { mode: "current", stage }), stage).toEqual([]);
  });
});

describe("每一屏写 where", () => {
  it("没写的每一屏各报一处", () => {
    const screens: Screen[] = [
      { name: "报告网页：疑问块", elements },
      { name: "报告网页：更改块", where: { scene: "S5", step: 2 }, elements },
      { name: "报告网页：队列块", elements },
    ];
    expect(hits({ screens })).toEqual([
      "screens.where screens[0].where",
      "screens.where screens[2].where",
    ]);
  });
});

describe("历史页面模式", () => {
  it("where 起始写 2.0.0，旧页面跳过。元素清单从 2026-09-20 起查", () => {
    const history = (pageDate: string): RunOptions => ({
      mode: "history",
      pageDate,
      stage: "check",
    });
    const old: PageSections = { screens: [{ name: "报告网页：疑问块", elements }] };
    expect(hits(old, history("2026-09-21"))).toEqual([]);
    expect(runRules(screensRuleList, {}, {}, history("2026-09-20")).skipped).toEqual([
      "screens.present",
      "screens.where",
    ]);
    expect(hits({}, history("2026-09-21"))).toEqual(["screens.present screens"]);
  });
});
