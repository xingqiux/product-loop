import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { editBodyOf, listLines } from "./decision.ts";

// 决定的文字输出和不用碰后端就能报的错。缺项的拦截和重写决定.md 要真的后端，写在使用测试里。

type Decision = Parameters<typeof listLines>[0][number];

function decision(patch: Partial<Decision> = {}): Decision {
  return {
    id: 12,
    kind: "决定",
    decision: "队列看板默认按阶段分列",
    reason: "用户按阶段找事",
    case: "v2-检查-1 第 3 行",
    date: "2026-09-28",
    status: "有效",
    ...patch,
  };
}

describe("ploop decision list 的文字", () => {
  it("编号和种类按最宽的一项对齐，已作废的写明被哪一条推翻", () => {
    const list = [
      decision({ id: 3, status: "已作废", voidedBy: 12, decision: "队列看板默认按状态分列" }),
      decision(),
      decision({ id: 13, kind: "以后再说", decision: "看板加上拖动排序" }),
    ];
    expect(listLines(list)).toEqual([
      "  3   2026-09-28  决定      队列看板默认按状态分列  已作废，被第 12 条推翻",
      "  12  2026-09-28  决定      队列看板默认按阶段分列",
      "  13  2026-09-28  以后再说  看板加上拖动排序",
    ]);
  });
});

describe("ploop decision edit 的请求体", () => {
  it("只带写了的项，没写的不带", () => {
    expect(editBodyOf({ reason: "新的原因" })).toEqual({ reason: "新的原因" });
    expect(editBodyOf({ decision: "a", reason: "b", case: "c" })).toEqual({
      decision: "a",
      reason: "b",
      case: "c",
    });
    expect(editBodyOf({})).toEqual({});
  });

  it("写成空字符串的照原样带，由后端按 decision.fields 拦截", () => {
    expect(editBodyOf({ case: "" })).toEqual({ case: "" });
  });
});

describe("ploop decision 不用碰后端就能报的错", () => {
  it("edit 编号不是从 1 起的整数：用法错误，退出码 2，报的是 <决定编号>", async () => {
    const { code, stderr } = await ploop(["decision", "edit", "03", "--reason", "新的原因"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：参数 <决定编号> 的取值「03」不对。编号要写从 1 起的整数，例如 12。",
    );
    expect(code).toBe(2);
    expect((await ploop(["decision", "edit", "--reason", "新的原因"])).code).toBe(2);
  });

  it("void 不写 --by：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["decision", "void", "3"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：ploop decision void 缺少必填的选项 --by <新决定编号>。",
    );
    expect(code).toBe(2);
  });

  it("编号不是从 1 起的整数：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["decision", "void", "03", "--by", "12"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：参数 <被推翻的决定编号> 的取值「03」不对。编号要写从 1 起的整数，例如 12。",
    );
    expect(code).toBe(2);
    expect((await ploop(["decision", "void", "3", "--by", "x"])).code).toBe(2);
  });

  it("--kind 只收决定、以后再说", async () => {
    const { code } = await ploop(["decision", "add", "--kind", "想法"]);
    expect(code).toBe(2);
  });
});
