import { describe, expect, it } from "vitest";
import { terms } from "./terms.ts";

describe("术语对照", () => {
  it("每个中文术语只出现一次", () => {
    const seen = terms.map((t) => t.term);
    expect(seen.filter((t, i) => seen.indexOf(t) !== i)).toEqual([]);
  });

  it("每个英文名只对应一个中文术语", () => {
    const seen = terms.map((t) => t.code);
    expect(seen.filter((c, i) => seen.indexOf(c) !== i)).toEqual([]);
  });

  it("英文名是 ASCII 小驼峰", () => {
    for (const t of terms) expect(t.code).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it("「10 工程规范与流程」第一节列出的对照都在", () => {
    const table = new Map(terms.map((t) => [t.term, t.code]));
    const required: [string, string][] = [
      ["主线", "mainline"],
      ["决定", "decision"],
      ["队列", "queue"],
      ["队列事项", "queueItem"],
      ["产品版本", "productVersion"],
      ["阶段", "round"],
      ["阶段名", "stage"],
      ["页面", "page"],
      ["卡片", "card"],
      ["选项", "option"],
      ["回复", "submission"],
      ["回复的一行", "replyLine"],
      ["去处", "destination"],
      ["使用代码", "useCode"],
      ["使用代码的一次运行", "useRun"],
      ["落地记录", "landRecord"],
      ["功能改动", "change"],
      ["重构", "tidy"],
    ];
    for (const [term, code] of required) expect(table.get(term)).toBe(code);
  });
});
