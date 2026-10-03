import { describe, expect, it } from "vitest";
import type { Decision } from "./decision.ts";
import { renderLegacyDecisionDoc, renderLegacyQueue, renderQueueDoc } from "./export.ts";
import { parseLegacyDecisions } from "./legacy/decision-table.ts";
import { readLegacyQueueJson } from "./legacy/queue-table.ts";
import type { QueueItem } from "./queue.ts";

// 导出的队列表格，和按旧格式写回的队列、决定。旧格式写出来，旧格式的读法要能原样读回。

const day = (iso: string) => iso.slice(0, 10);

const base = {
  proposer: "ai" as const,
  createdAt: "2026-09-20T08:00:00.000Z",
  subItems: [] as string[],
  editCount: 0,
};

const items: QueueItem[] = [
  { ...base, id: "Q1", content: "看板放到首页", stage: "land", status: "todo" },
  {
    ...base,
    id: "Q2",
    content: "理清给谁用",
    stage: "think",
    status: "done",
    evidence: "主线第二节写了",
    subItems: ["先问用户"],
  },
  {
    ...base,
    id: "Q3",
    content: "窄屏的回复框",
    stage: "land",
    status: "waiting",
    dependsOn: "等构思定下窄屏的布局",
    proposer: "user",
    note: "第一行\n第二行 | 竖线",
  },
];

const decisions: Decision[] = [
  {
    id: 1,
    kind: "decision",
    decision: "返回回到来源页",
    reason: "固定父级会错",
    case: "从设计点新建",
    date: "2026-09-20",
    status: "voided",
    voidedBy: 2,
  },
  {
    id: 2,
    kind: "decision",
    decision: "返回按来源页",
    reason: "同上",
    case: "同上的例子",
    date: "2026-09-21",
    status: "active",
  },
  {
    id: 3,
    kind: "later",
    decision: "导出成 PDF",
    reason: "现在用不上",
    case: "无",
    date: "2026-09-22",
    status: "active",
  },
];

describe("导出的队列表格", () => {
  it("按阶段分节，节里按状态分表，空的阶段不写", () => {
    const doc = renderQueueDoc(items, day);
    expect(doc).toContain("## 构思\n\n### 已完成\n\n| 编号 | 内容 | 备注 |");
    expect(doc).toContain("## 落地\n\n### 待办\n");
    expect(doc).toContain("### 等待\n");
    expect(doc).not.toContain("## 使用");
    expect(doc).toContain(
      "| Q3 | 窄屏的回复框 | 第一行<br>第二行 \\| 竖线 | 用户 | 等构思定下窄屏的布局 |",
    );
    // 没有备注的事，备注一格是空的。
    expect(doc).toContain("| Q1 | 看板放到首页 |  | AI |");
  });
});

describe("按旧格式写回", () => {
  it("队列.json 用旧的读法读回，内容、阶段、状态和子项都对得上", () => {
    const back = readLegacyQueueJson(JSON.parse(renderLegacyQueue(items, day)));
    expect(back.problems).toEqual([]);
    expect(back.rows.map((r) => [r.content, r.stage, r.status, r.subItems])).toEqual([
      ["看板放到首页", "land", "todo", []],
      ["理清给谁用", "think", "done", ["先问用户"]],
      ["窄屏的回复框", "land", "waiting", []],
    ]);
    expect(back.rows[2]?.dependsOn).toBe("等构思定下窄屏的布局");
  });

  it("决定.md 用旧的读法读回，编号、状态、推翻它的编号和以后再说都对得上", () => {
    const back = parseLegacyDecisions(renderLegacyDecisionDoc(decisions));
    expect(back.skipped).toEqual([]);
    expect(
      back.rows.map((r) => [
        r.decision.replace(/^已作废（[^）]*）。/u, ""),
        r.kind,
        r.status,
        r.voidedBy,
      ]),
    ).toEqual([
      ["返回回到来源页", "decision", "voided", 2],
      ["返回按来源页", "decision", "active", undefined],
      ["导出成 PDF", "later", "active", undefined],
    ]);
    expect(back.rows.slice(0, 2).map((r) => r.id)).toEqual([1, 2]);
  });
});
