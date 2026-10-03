import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { runRules } from "./run.ts";
import { specForSamples, specTextLinesSamples } from "./spec.samples.ts";
import { specRuleList } from "./spec.ts";

// 设计规范两条规则在总测试以外的情况：七种 kind 都要写 for，文字的行数怎么数，以及历史页面模式。

type SpecItem = NonNullable<PageSections["spec"]>[number];

/** 一格文字，写了 for。 */
function textItem(name: string, text: string): SpecItem {
  return { name, kind: "text", for: "所有按钮", text };
}

/** 报出的问题写成「位置 报错」。 */
function reported(spec: SpecItem[]): string[] {
  return runRules(specRuleList, { spec }, {}).block.map(
    (issue) => `${issue.where ?? ""} ${issue.message}`,
  );
}

describe("样本都是合格的页面数据", () => {
  const samples = [specForSamples, specTextLinesSamples].flatMap(({ base, hits }) => [
    ["基础数据", base.subject] as const,
    ...hits.map((sample) => [sample.why, sample.subject] as const),
  ]);
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("每一格写 for", () => {
  it("七种 kind 都查，没写 for 的每一格各报一处", () => {
    const spec: SpecItem[] = [
      { name: "配色", kind: "colors", values: [{ name: "底", hex: "#ffffff" }] },
      { name: "字号", kind: "type", values: [{ name: "正文", size: 13 }] },
      { name: "圆角", kind: "radius", values: [4] },
      { name: "间距", kind: "spacing", values: [8] },
      { name: "动效", kind: "motion", values: [{ name: "展开", ms: 160 }] },
      { name: "状态标签", kind: "table", columns: [{ name: "状态" }], rows: [["待办"]] },
      { name: "按钮", kind: "text", text: "按钮写动词。" },
    ];
    expect(checkPageData("think", z.encode(pageSectionsSchema, { spec })).ok).toBe(true);
    expect(runRules(specRuleList, { spec }, {}).block.map((issue) => issue.where)).toEqual(
      spec.map((_item, i) => `spec[${i}].for`),
    );
  });
});

describe("文字的一格不超过三行", () => {
  it("空行和只有空白的行不算，全角空格也是空白", () => {
    expect(reported([textItem("按钮", "一。\n\n二。\n　\n三。\n \t")])).toEqual([]);
  });

  it("换行的认法和 Python 的 splitlines 相同，回车和行分隔符也算", () => {
    expect(reported([textItem("按钮", "一。\r\n二。\r三。 四。")])).toEqual([
      "spec[0].text 设计规范「按钮」的文字有 4 行，超过三行。",
    ]);
  });

  it("每一格各报一处，写出实际的行数", () => {
    const spec = [
      textItem("按钮", "一\n二\n三\n四"),
      textItem("链接", "一\n二\n三"),
      textItem("标题", "一\n二\n三\n四\n五"),
    ];
    expect(reported(spec)).toEqual([
      "spec[0].text 设计规范「按钮」的文字有 4 行，超过三行。",
      "spec[2].text 设计规范「标题」的文字有 5 行，超过三行。",
    ]);
  });
});

describe("历史页面模式", () => {
  it("for 起始写 2.0.0，旧页面跳过。超过三行从 2026-09-21 起查", () => {
    const page: PageSections = { spec: [{ name: "字段名", kind: "text", text: "一\n二\n三\n四" }] };
    const early = runRules(specRuleList, page, {}, { mode: "history", pageDate: "2026-09-21" });
    expect(early.skipped).toEqual(["spec.for", "spec.text.lines"]);
    expect(early.block).toEqual([]);
    const same = runRules(specRuleList, page, {}, { mode: "history", pageDate: "2026-09-22" });
    expect(same.skipped).toEqual(["spec.for"]);
    expect(same.block.map((issue) => issue.rule)).toEqual(["spec.text.lines"]);
  });
});
