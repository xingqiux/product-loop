import { describe, expect, it } from "vitest";
import { readChecklist, readTable, tableLines } from "./md-table.ts";

// 迁移对照里的表格和勾选清单：写出去再读回来要一样，AI 调换列的顺序也读得出。

const columns = [
  ["id", "编号"],
  ["text", "内容"],
] as const;

describe("迁移对照的表格", () => {
  it("竖线和换行写出去再读回来不变", () => {
    const rows = [
      new Map([
        ["id", "Q1"],
        ["text", "a|b\n第二行"],
      ] as const),
    ];
    const text = tableLines(columns, rows).join("\n");
    expect(text).toContain("a\\|b<br>第二行");
    expect(readTable(text, columns)?.map((row) => row.get("text"))).toEqual(["a|b\n第二行"]);
  });

  it("按列名取格，列的顺序换了也读得出；找不到表头时是 undefined", () => {
    const text = "| 内容 | 编号 |\n| --- | --- |\n| 加搜索 | Q1 |\n\n后面的字";
    expect(readTable(text, columns)?.map((row) => [row.get("id"), row.get("text")])).toEqual([
      ["Q1", "加搜索"],
    ]);
    expect(readTable("没有表格", columns)).toBeUndefined();
  });

  it("勾选清单分出没勾的和勾上的", () => {
    expect(readChecklist("- [ ] 甲\n- [x] 乙\n* [X] 丙\n普通的一行")).toEqual({
      open: ["甲"],
      done: ["乙", "丙"],
    });
  });
});
