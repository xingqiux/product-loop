import { describe, expect, it } from "vitest";
import { checkWriting } from "../writing/check.ts";
import { parseMainline } from "./parse.ts";

const parse = (...lines: string[]) => parseMainline(lines.join("\n"));

describe("写作规范一节", () => {
  it("ADR 0001 第 24 条的写法：两列的表格写停用的说法和改成什么，另写例外的列表", () => {
    const result = parse(
      "## 写作规范",
      "",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 工作流 | 流程 |",
      "| 抓手 | 做法 |",
      "",
      "例外：",
      "- 史蒂夫·乔布斯",
      "- 让-保罗·萨特",
    );
    expect(result.writingSpec).toEqual({
      banned: [
        { phrase: "工作流", replacement: "流程" },
        { phrase: "抓手", replacement: "做法" },
      ],
      exceptions: ["史蒂夫·乔布斯", "让-保罗·萨特"],
    });
    expect(result.problems).toEqual([]);
  });

  it("也可以是设计规范下面的三级标题，表格的第三列不管", () => {
    const result = parse(
      "## 设计规范",
      "### 写作规范（决定 119 到 122）",
      "| 停用的说法 | 统一的术语 | 含义 |",
      "| --- | --- | --- |",
      "| 替人用的脚本 | 走查脚本 | 按场景自动操作产品并截图的脚本 |",
      "### 状态",
      "| 工作流 | 流程 |",
    );
    expect(result.writingSpec.banned).toEqual([
      { phrase: "替人用的脚本", replacement: "走查脚本" },
    ]);
  });

  it("一格里用顿号列了几个说法：个数相同时一一对应，否则都改成第二列的全文", () => {
    const result = parse(
      "## 写作规范",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 拦住、放行、提醒 | 拦截、通过、警告 |",
      "| 露、露出来 | 显示 |",
      "| 那一格、那一块、那一屏 | 字段、区块 |",
    );
    expect(result.writingSpec.banned).toEqual([
      { phrase: "拦住", replacement: "拦截" },
      { phrase: "放行", replacement: "通过" },
      { phrase: "提醒", replacement: "警告" },
      { phrase: "露", replacement: "显示" },
      { phrase: "露出来", replacement: "显示" },
      { phrase: "那一格", replacement: "字段、区块" },
      { phrase: "那一块", replacement: "字段、区块" },
      { phrase: "那一屏", replacement: "字段、区块" },
    ]);
  });

  it("书名号、引号和反引号里的字取出里面的部分", () => {
    const result = parse(
      "## 写作规范",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 「工作流」、`workflow` | “流程” |",
    );
    expect(result.writingSpec.banned).toEqual([
      { phrase: "工作流", replacement: "流程" },
      { phrase: "workflow", replacement: "流程" },
    ]);
  });

  it("例外写在同一行，用顿号隔开", () => {
    const result = parse("## 写作规范", "例外：史蒂夫·乔布斯、「比尔·盖茨」。");
    expect(result.writingSpec.exceptions).toEqual(["史蒂夫·乔布斯", "比尔·盖茨"]);
  });

  it("例外写成标题或粗体，下面的列表可以编号，列表项开头包在符号里的只取符号里的部分", () => {
    const heading = parse("## 写作规范", "### 例外的写法", "1. 「史蒂夫·乔布斯」：外国人名");
    expect(heading.writingSpec.exceptions).toEqual(["史蒂夫·乔布斯"]);
    const bold = parse("## 写作规范", "**例外**", "", "- `A·B`（代号）", "- 甲·乙、丙·丁");
    expect(bold.writingSpec.exceptions).toEqual(["A·B", "甲·乙", "丙·丁"]);
  });

  it("例外的列表到第一行别的字为止，以「例外」开头的普通句子不算", () => {
    const result = parse(
      "## 写作规范",
      "例外：",
      "- 史蒂夫·乔布斯",
      "别的说明。",
      "- 不是例外",
      "例外的情况是引用原话。",
      "- 也不是例外",
    );
    expect(result.writingSpec.exceptions).toEqual(["史蒂夫·乔布斯"]);
  });

  it("没写改成什么的照收，报出来", () => {
    const result = parse(
      "## 写作规范",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 工作流 | |",
    );
    expect(result.writingSpec.banned).toEqual([{ phrase: "工作流", replacement: "" }]);
    expect(result.problems).toEqual([
      { kind: "writingSpecReplacementEmpty", line: 4, phrase: "工作流" },
    ]);
  });

  it("带省略号的说法不收，报出来", () => {
    const result = parse(
      "## 写作规范",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 查……齐不齐 | 校验……是否齐全 |",
      "| 查...对不对 | 核对 |",
    );
    expect(result.writingSpec.banned).toEqual([]);
    expect(result.problems).toEqual([
      { kind: "writingSpecEllipsis", line: 4, phrase: "查……齐不齐" },
      { kind: "writingSpecEllipsis", line: 5, phrase: "查...对不对" },
    ]);
  });

  it("表头第一格没有「停用」的表格认不出，报出来", () => {
    const result = parse("## 写作规范", "| 说法 | 改成 |", "| --- | --- |", "| 工作流 | 流程 |");
    expect(result.writingSpec.banned).toEqual([]);
    expect(result.problems).toEqual([{ kind: "writingSpecTable", line: 2 }]);
  });

  it("写了两节的只用第一节，报出两节的行号", () => {
    const result = parse(
      "## 写作规范",
      "例外：甲·乙",
      "## 设计规范",
      "### 写作规范",
      "例外：丙·丁",
    );
    expect(result.writingSpec.exceptions).toEqual(["甲·乙"]);
    expect(result.problems).toEqual([{ kind: "writingSpecDuplicate", line: 1, lines: [1, 4] }]);
  });

  it("没有这一节时两项都是空的", () => {
    expect(parse("## 给谁用", "你。").writingSpec).toEqual({ banned: [], exceptions: [] });
  });

  it("代码块里的表格和例外不算", () => {
    const result = parse(
      "## 写作规范",
      "```",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 工作流 | 流程 |",
      "例外：甲·乙",
      "```",
    );
    expect(result.writingSpec).toEqual({ banned: [], exceptions: [] });
  });
});

describe("解析出的写作规范交给写作校验", () => {
  const { writingSpec } = parse(
    "## 写作规范",
    "| 停用的说法 | 改成什么 |",
    "| --- | --- |",
    "| 工作流 | 流程 |",
    "",
    "例外：",
    "- 史蒂夫·乔布斯",
  );

  it("项目加的停用说法被拦截，报错里写改成什么", () => {
    expect(checkWriting("这个工作流要重写。", { project: writingSpec }).block).toEqual([
      {
        rule: "writing.term.banned",
        message: "出现了术语表停用的说法「工作流」，统一的术语是「流程」",
        hint: "改成术语表里的说法「流程」，或者换一种说法。引号里的原话不用改",
      },
    ]);
  });

  it("列为例外的写法不再报", () => {
    const text = "史蒂夫·乔布斯说过这句话。";
    expect(checkWriting(text).warn.map((x) => x.rule)).toEqual(["writing.wording.interpunct"]);
    expect(checkWriting(text, { project: writingSpec }).warn).toEqual([]);
  });
});
