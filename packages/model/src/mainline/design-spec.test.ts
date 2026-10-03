import { describe, expect, it } from "vitest";
import { noneReason } from "./design-spec.ts";
import { parseMainline } from "./parse.ts";
import { designSpecItem } from "./parts.ts";

/** 只有设计规范一节的主线。第 1 行是这一节的标题，传进来的第一行是第 2 行。 */
const spec = (...lines: string[]) => parseMainline(["## 设计规范", ...lines].join("\n"));

const statusOf = (result: ReturnType<typeof spec>) =>
  Object.fromEntries(result.designSpec.map((entry) => [entry.item, entry.status]));

describe("设计规范的十二个部分", () => {
  it("十二个三级标题都写了内容：每一样都是已写，带标题的行号和管到的行", () => {
    const lines = designSpecItem.labels.flatMap((name) => [`### ${name}`, `${name}的规则。`, ""]);
    const result = spec(...lines);
    expect(result.problems).toEqual([]);
    expect(result.otherSpecHeadings).toEqual([]);
    expect(result.designSpec.map((entry) => entry.status)).toEqual(Array(12).fill("written"));
    expect(result.designSpec[0]).toEqual({
      item: "informationArchitecture",
      status: "written",
      heading: { text: "信息结构", line: 2, endLine: 3 },
    });
    expect(result.designSpec[11]).toEqual({
      item: "approach",
      status: "written",
      heading: { text: "做法和阶段", line: 35, endLine: 36 },
    });
  });

  it("标题后面的括号写用在哪里，名字里的空格可以不写", () => {
    const result = spec("### 配色（用在：状态标签）", "只有一个蓝。", "### 给AI的界面", "命令行。");
    expect(statusOf(result)).toMatchObject({ color: "written", agentInterface: "written" });
    expect(result.designSpec[1]).toMatchObject({
      heading: { text: "配色（用在：状态标签）", line: 2, endLine: 3 },
    });
  });

  it("没有的一样写「无」和原因", () => {
    const result = spec("### 动效", "无。这个产品只有命令行，没有界面。");
    expect(result.designSpec[5]).toEqual({
      item: "motion",
      status: "none",
      heading: { text: "动效", line: 2, endLine: 3 },
      reason: "这个产品只有命令行，没有界面。",
    });
    expect(result.problems).toEqual([]);
  });

  it("写了「无」没写原因，报出来", () => {
    const result = spec("### 动效", "无。");
    expect(result.designSpec[5]).toMatchObject({ status: "none", reason: "" });
    expect(result.problems).toEqual([{ kind: "designSpecNoneReason", line: 2, item: "motion" }]);
  });

  it("标题下面是空的，报出来，不算写了", () => {
    const result = spec("### 动效", "", "### 配色", "只有一个蓝。");
    expect(statusOf(result)).toMatchObject({ motion: "empty", color: "written" });
    expect(result.designSpec[5]).toEqual({
      item: "motion",
      status: "empty",
      heading: { text: "动效", line: 2, endLine: 2 },
    });
    expect(result.problems).toEqual([{ kind: "designSpecEmpty", line: 2, item: "motion" }]);
  });

  it("没写标题的算缺，不算问题", () => {
    const result = spec("### 配色", "只有一个蓝。");
    expect(result.designSpec.filter((entry) => entry.status === "missing")).toHaveLength(11);
    expect(result.designSpec[0]).toEqual({ item: "informationArchitecture", status: "missing" });
    expect(result.problems).toEqual([]);
  });

  it("一个标题只算一个部分：「配色和字体排版」两个部分都缺，记在十二个部分以外的标题里", () => {
    const result = spec("### 配色和字体排版", "只有一个蓝，字号三档。");
    expect(statusOf(result)).toMatchObject({ color: "missing", typography: "missing" });
    expect(result.otherSpecHeadings).toEqual([{ text: "配色和字体排版", line: 2, endLine: 3 }]);
  });

  it("同一样写了两个标题，用第一个，报出两处的行号", () => {
    const result = spec("### 配色", "只有一个蓝。", "### 配色（补充）", "无。");
    expect(result.designSpec[1]).toMatchObject({ status: "written", heading: { line: 2 } });
    expect(result.problems).toEqual([
      { kind: "designSpecDuplicate", line: 2, item: "color", lines: [2, 4] },
    ]);
  });

  it("四级标题和设计规范以外的三级标题不算", () => {
    const result = parseMainline(
      ["## 给谁用", "### 配色", "蓝。", "## 设计规范", "#### 动效", "干脆。"].join("\n"),
    );
    expect(result.designSpec.every((entry) => entry.status === "missing")).toBe(true);
  });

  it("一样下面可以有四级标题，都算这一样的内容", () => {
    const result = spec("### 交互", "#### 悬停细则", "| 状态 | 悬停做法 |", "", "### 配色", "蓝。");
    expect(result.designSpec[4]).toMatchObject({
      status: "written",
      heading: { line: 2, endLine: 4 },
    });
  });

  it("旧模板写成表格的，按表格认不出，十二个部分都缺，报成旧写法", () => {
    const result = spec(
      "",
      "| 职能 | 规则 | 例 |",
      "| --- | --- | --- |",
      "| 配色 | 主色 | … |",
      "| 状态 | 空、等、错 | … |",
    );
    expect(result.designSpec.every((entry) => entry.status === "missing")).toBe(true);
    expect(result.problems).toEqual([{ kind: "designSpecTable", line: 3 }]);
  });

  it("别的表格里第一格正好是某一样的名字，不当成旧写法", () => {
    const result = spec("### 字段", "| 字段名 | 类型 |", "| --- | --- |", "| 状态 | 枚举 |");
    expect(result.problems).toEqual([]);
  });

  it("没有设计规范这一节：十二个部分都缺，没有问题", () => {
    const result = parseMainline("## 给谁用\n\n你。\n");
    expect(result.designSpec).toEqual(
      designSpecItem.keys.map((item) => ({ item, status: "missing" })),
    );
    expect(result.otherSpecHeadings).toEqual([]);
  });
});

describe("「无」的认法", () => {
  it.each([
    ["无。这个产品只有命令行。", "这个产品只有命令行。"],
    ["无，只有命令行。", "只有命令行。"],
    ["无：只有命令行。", "只有命令行。"],
    ["无 只有命令行。", "只有命令行。"],
    ["「无」：只有命令行。", "只有命令行。"],
    ["无（只有命令行）", "只有命令行"],
    ["无\n原因：只有命令行。", "原因：只有命令行。"],
    ["无", ""],
    ["无。", ""],
  ])("「%s」写的是无，原因是「%s」", (body, reason) => {
    expect(noneReason(body)).toBe(reason);
  });

  it.each(["无障碍按 WCAG 2.2 的 AA 级。", "无论哪一屏都只有一个蓝。", "没有。"])(
    "「%s」不是无",
    (body) => {
      expect(noneReason(body)).toBeUndefined();
    },
  );
});
