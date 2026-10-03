import { describe, expect, it } from "vitest";
import { defaultCoveragePath, parseCoverage, useCodeDir } from "./coverage.ts";

describe("覆盖表", () => {
  it("「被哪个场景用到」一列写 S 编号，一个都没有的行是缺口", () => {
    const table = [
      "# 覆盖表",
      "",
      "| 页面、入口、操作、状态 | 被哪个场景用到 | 尺寸 |",
      "| --- | --- | --- |",
      "| 页头：系统、阶段、第几轮 | S3、S14 | 小 |",
      "| 左边一栏收起、展开 | 缺口 | 小 |",
      "| 键盘左右键换一屏 |  | 小 |",
      "| 队列按阶段分组 | S9；s3；S03 | 小 |",
    ].join("\n");
    const { rows, gaps } = parseCoverage(table);
    expect(rows.map((row) => [row.line, row.item, row.scenes])).toEqual([
      [5, "页头：系统、阶段、第几轮", ["S3", "S14"]],
      [6, "左边一栏收起、展开", []],
      [7, "键盘左右键换一屏", []],
      [8, "队列按阶段分组", ["S9"]],
    ]);
    expect(gaps.map((row) => row.item)).toEqual(["左边一栏收起、展开", "键盘左右键换一屏"]);
  });

  it("没有「场景」一列时，表头写成 S 编号的列是场景，格子里写了东西就算用到", () => {
    const table = [
      "| 东西 | S1 | S2 |",
      "| --- | --- | --- |",
      "| 首页 | ✓ |  |",
      "| 设置 |  |  |",
    ];
    const { gaps, rows } = parseCoverage(table.join("\n"));
    expect(rows.map((row) => row.scenes)).toEqual([["S1"], []]);
    expect(gaps.map((row) => row.item)).toEqual(["设置"]);
  });

  it("没有表格时一行都没有", () => {
    expect(parseCoverage("只有一段文字。")).toEqual({ rows: [], gaps: [] });
  });
});

describe("使用代码的位置", () => {
  it("自己的仓库在 scripts/use，共用的仓库在项目缓存的 use-code，覆盖表跟着走", () => {
    expect(useCodeDir("own")).toBe("scripts/use");
    expect(useCodeDir("shared")).toBe(".product-loop/use-code");
    expect(defaultCoveragePath("own")).toBe("scripts/use/覆盖表.md");
    expect(defaultCoveragePath("shared")).toBe(".product-loop/use-code/覆盖表.md");
  });
});
