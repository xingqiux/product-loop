import { describe, expect, it } from "vitest";
import type { Decision } from "./decision.ts";
import { decisionDocFileName, decisionDocHeader, renderDecisionDoc } from "./decision-doc.ts";
import { checkWriting } from "./writing/check.ts";

/** 几种样子各一条，故意不按编号排。 */
const sample: Decision[] = [
  {
    id: 25,
    kind: "decision",
    decision: "卡片右边只放可视化的东西，直接展示",
    reason: "左边都说完了，右边看渲染和效果就行",
    case: "修复第 2 轮的感受 1 到 4",
    date: "2026-09-19",
    status: "active",
  },
  {
    id: 17,
    kind: "decision",
    decision: "「看到」左边只留一句，右边一句解释加按钮",
    reason: "用户在 5b 上加的",
    case: "构思第 2 轮 5b",
    date: "2026-09-19",
    status: "voided",
    voidedBy: 25,
    voidReason: "右边不放说明文字和按钮",
  },
  {
    id: 18,
    kind: "decision",
    decision: "右边四样按标签切换：证据、位置、上次、影响",
    reason: "用户选 6a 并问是否必选",
    case: "构思第 2 轮 6a",
    date: "2026-09-19",
    status: "voided",
    voidedBy: 25,
  },
  {
    id: 3,
    kind: "later",
    decision: "每天自动用一遍，发现改坏了的地方",
    reason: "还没有发生过，真的定时运行过一次再写回主线",
    case: "提升第 1 轮第 3 条",
    date: "2026-09-20",
    status: "active",
    fromLine: { submission: 4, line: 2 },
  },
  {
    id: 1,
    kind: "decision",
    decision: "选项写成 a | b 两种时，竖线照原样显示",
    reason: "第一行\n第二行",
    case: "构思第 1 轮 1b",
    date: "2026-09-18",
    status: "active",
  },
];

const tableRows = (doc: string) => doc.split("\n").filter((line) => line.startsWith("| "));

/** 表格一行按没转义的竖线切开以后的各格。 */
const cellsOf = (line: string) =>
  line
    .slice(2, -2)
    .split(/(?<!\\) \| /u)
    .map((cell) => cell.replaceAll("\\|", "|"));

describe("决定.md", () => {
  it("和快照相同：说明在最上面，表头统一，已作废的留在原处", async () => {
    await expect(renderDecisionDoc(sample)).toMatchFileSnapshot("__snapshots__/decision-doc.md");
  });

  it("表头是统一的七列：编号、决定、原因、案例、日期，另加状态和种类", () => {
    const [header, divider] = tableRows(renderDecisionDoc(sample));
    expect(header).toBe("| 编号 | 决定 | 原因 | 案例 | 日期 | 状态 | 种类 |");
    expect(divider).toBe("| --- | --- | --- | --- | --- | --- | --- |");
    expect(decisionDocHeader).toHaveLength(7);
  });

  it("按编号从小到大排，传进来的顺序不影响结果，也不改动传进来的数组", () => {
    const before = sample.map((decision) => decision.id);
    const doc = renderDecisionDoc(sample);
    expect(renderDecisionDoc([...sample].reverse())).toBe(doc);
    expect(sample.map((decision) => decision.id)).toEqual(before);
    const ids = tableRows(doc)
      .slice(2)
      .map((line) => cellsOf(line)[0]);
    expect(ids).toEqual(["1", "3", "17", "18", "25"]);
  });

  it("已作废的状态写明被哪一条推翻，写了作废原因的接在后面", () => {
    const status = new Map(
      tableRows(renderDecisionDoc(sample))
        .slice(2)
        .map((line) => {
          const cells = cellsOf(line);
          return [cells[0], [cells[5], cells[6]]];
        }),
    );
    expect(status.get("17")).toEqual([
      "已作废，被第 25 条推翻。作废原因：右边不放说明文字和按钮",
      "决定",
    ]);
    expect(status.get("18")).toEqual(["已作废，被第 25 条推翻", "决定"]);
    expect(status.get("25")).toEqual(["有效", "决定"]);
    expect(status.get("3")).toEqual(["有效", "以后再说"]);
  });

  it("竖线转义，换行写成 <br>，每条决定只占一行，正好七格", () => {
    const rows = tableRows(renderDecisionDoc(sample));
    expect(rows).toHaveLength(2 + sample.length);
    for (const line of rows) expect(cellsOf(line)).toHaveLength(7);
    const [, , first] = rows;
    expect(first).toContain("选项写成 a \\| b 两种时");
    expect(cellsOf(first ?? "")[2]).toBe("第一行<br>第二行");
    expect(renderDecisionDoc([{ ...sample[4], reason: "甲\r\n乙\r丙" } as Decision])).toContain(
      "| 甲<br>乙<br>丙 |",
    );
  });

  it("一条决定也没有时，写一句还没有决定，不写空表", () => {
    const doc = renderDecisionDoc([]);
    expect(tableRows(doc)).toEqual([]);
    expect(doc.endsWith("\n\n还没有决定。\n")).toBe(true);
  });

  it("第一段说明文件由命令生成、只读，所有说明都过写作校验", () => {
    const doc = renderDecisionDoc([]);
    const paragraphs = doc.split("\n\n").slice(1);
    expect(paragraphs[0]).toMatch(/^本文由 ploop 按集中存储里的决定生成，只读。/u);
    for (const paragraph of paragraphs) {
      expect(checkWriting(paragraph)).toEqual({ block: [], warn: [] });
    }
  });

  it("文件名是决定.md，结尾只有一个换行", () => {
    expect(decisionDocFileName).toBe("决定.md");
    const doc = renderDecisionDoc(sample);
    expect(doc.startsWith("# 决定\n\n")).toBe(true);
    expect(doc.endsWith(" |\n")).toBe(true);
  });
});
