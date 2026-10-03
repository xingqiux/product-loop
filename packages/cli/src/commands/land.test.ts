import { describe, expect, it } from "vitest";
import { whatItChecks } from "./land.ts";

// ploop land diff 里「查什么」：只取计划里这件改动下面的说明文字。

describe("N24 land diff 的「查什么」", () => {
  it("三级标题和检查命令那一句都不带，只留说明", () => {
    const text = "### 空输入不添加\n检查命令：node check.mjs，查空字符串不会进入列表。";
    expect(whatItChecks("空输入不添加", text)).toBe("查空字符串不会进入列表。");
  });

  it("列表项的名字和「检查 `命令`」那一句也去掉", () => {
    const text = "1. 空列表 显示提示\n   对应 Q1。检查 `pnpm vitest run a.test.ts`，查提示。";
    expect(whatItChecks("空列表 显示提示", text)).toBe("对应 Q1。查提示。");
  });

  it("去掉以后什么都不剩时，用整段说明", () => {
    expect(whatItChecks("空输入不添加", "### 空输入不添加")).toBe("### 空输入不添加");
  });
});
