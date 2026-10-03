import { describe, expect, it } from "vitest";
import { stage } from "../names.ts";
import { pageBriefLines } from "./brief.ts";
import { pageJsonSchema, stageSections } from "./stages.ts";

// ploop page schema --brief：一行一个字段，比完整的 JSON Schema 短得多。

const briefOf = (key: (typeof stage.keys)[number]) => pageBriefLines(pageJsonSchema(key));

describe("页面数据定义的简表", () => {
  it.each(stage.keys)("%s 阶段：每个能写的区块各占一行，顶格写", (key) => {
    const tops = briefOf(key).filter((line) => !line.startsWith(" "));
    const names = tops.map((line) => line.split(/[[\s]/u)[0]);
    expect(names).toEqual([...stageSections[key]]);
  });

  it("必填的字段名后面带星号，选填的不带", () => {
    const lines = briefOf("check");
    expect(lines).toContain("  title *  文字：一个名字，不超过 16 个字，不写成句子。");
    const id = lines.find((line) => line.startsWith("  id  "));
    expect(id).toBeDefined();
  });

  it("嵌套的字段缩进两格，列表写成 名字[]", () => {
    const lines = briefOf("think");
    expect(lines.some((line) => line.startsWith("asks[]  "))).toBe(true);
    expect(lines.some((line) => line.startsWith("  sources[] *  "))).toBe(true);
    expect(lines.some((line) => line.startsWith("    name *  "))).toBe(true);
  });

  it("枚举写出全部取值", () => {
    const lines = briefOf("think");
    expect(lines.find((line) => line.includes("不查、快查、深查 之一"))).toBeDefined();
  });

  it("同一个定义第二次出现只写一行指回去", () => {
    const lines = briefOf("think");
    const pointers = lines.filter((line) => line.includes("（字段同 "));
    expect(pointers.length).toBeGreaterThan(0);
    // 指回去的那一行，前面出现过被指的路径。
    for (const line of pointers) {
      const target = /（字段同 (.+)）/u.exec(line)?.[1] ?? "";
      const last = target.split(".").at(-1)?.replace("[]", "") ?? "";
      expect(lines.some((other) => other.trimStart().startsWith(last))).toBe(true);
    }
  });

  it("每行只有一句说明，没有换行", () => {
    for (const key of stage.keys) {
      for (const line of briefOf(key)) expect(line).not.toContain("\n");
    }
  });

  it.each(stage.keys)("%s 阶段：简表不到完整定义的三分之一", (key) => {
    const brief = briefOf(key).join("\n").length;
    const full = JSON.stringify(pageJsonSchema(key), null, 2).length;
    expect(brief * 3).toBeLessThan(full);
  });

  it("不是 JSON Schema 时给空的简表", () => {
    expect(pageBriefLines(null)).toEqual([]);
    expect(pageBriefLines({})).toEqual([]);
  });
});
