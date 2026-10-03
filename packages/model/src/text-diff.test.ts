import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type TextDiffRow, textDiff } from "./text-diff.ts";

// 对照数据由 tools/legacy/export_diff.py 用旧 skill 的 v1-final 算出，见 tools/legacy/README.md。
type DiffCase = {
  readonly id: string;
  readonly kind: string;
  readonly context?: number;
  readonly before: string;
  readonly after: string;
  readonly output: readonly TextDiffRow[];
};

const file = new URL("../../../tools/legacy/out/diff-cases.json", import.meta.url);
const { count, cases } = JSON.parse(readFileSync(file, "utf8")) as {
  readonly count: Readonly<Record<string, number>>;
  readonly cases: readonly DiffCase[];
};

describe("和旧脚本的 text_diff 逐字节相同", () => {
  it("对照数据有历史页面，也有构造的样例", () => {
    const kinds = ["history", "sample", "edge", "derived", "random"];
    for (const kind of kinds) {
      expect(count[kind]).toBeGreaterThan(0);
      expect(cases.filter((c) => c.kind === kind)).toHaveLength(count[kind] ?? 0);
    }
    expect(cases).toHaveLength(kinds.reduce((sum, kind) => sum + (count[kind] ?? 0), 0));
  });

  // 写成 JSON 再比，字段的顺序和每一个字都要相同
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    expect(JSON.stringify(textDiff(c.before, c.after, c.context))).toBe(JSON.stringify(c.output));
  });
});

describe("文字的逐行对比", () => {
  it("改了一部分的行配成一对，行内标出删的字和加的字", () => {
    expect(textDiff("甲\n今天天气很好\n乙", "甲\n今天天气不好\n乙")).toEqual([
      { k: "same", parts: [["same", "甲"]] },
      {
        k: "mix",
        parts: [
          ["same", "今天天气"],
          ["del", "很"],
          ["ins", "不"],
          ["same", "好"],
        ],
      },
      { k: "same", parts: [["same", "乙"]] },
    ]);
  });

  it("两边相同时只剩一行折起来的 gap", () => {
    expect(textDiff("甲\n乙", "\n甲\n乙\n")).toEqual([{ k: "gap", parts: [] }]);
  });

  it("表情按一个字符比较，不会被拆成两半", () => {
    expect(textDiff("👍 好", "👎 好")).toEqual([
      {
        k: "mix",
        parts: [
          ["del", "👍"],
          ["ins", "👎"],
          ["same", " 好"],
        ],
      },
    ]);
  });

  it("留下的范围后面紧跟的一行空白也留下，只多留一行", () => {
    const before = ["开头", "要改的一行", "一", "二", "", "", "三", "四"].join("\n");
    const after = before.replace("要改的一行", "改过的一行");
    expect(textDiff(before, after).map((row) => row.k)).toEqual([
      "same",
      "mix",
      "same",
      "same",
      "same",
      "gap",
    ]);
  });
});
