import type { Decision } from "./decision.ts";
import { decisionKind, proposer, queueStatus, stage } from "./names.ts";
import type { QueueItem } from "./queue.ts";

// 导出和按旧格式写回的几个文件，见「03 数据模型」第九节和「08 版本与迁移」第八节。
// - 队列.md：只读的表格，按阶段和状态分组，备注也写进表里。
// - 旧格式的队列.json：旧 skill 的 queue.py 读的十格，见 tools/legacy/v1-final/queue.py 的「查一件」。
//   旧格式没有备注这一格，不写。
// - 旧格式的决定.md：旧模板的表头，作废的在决定一格开头写「已作废」，以后再说另成一张表。
// 创建时间按北京时间的日期写，日期由调用的一方算好给出，这里不碰时区。

/** 表格的一格：竖线转义，换行写成 <br>。 */
function cell(text: string): string {
  return text.replace(/\r\n?|\n/gu, "<br>").replaceAll("|", "\\|");
}

const row = (cells: readonly string[]) => `| ${cells.map(cell).join(" | ")} |`;

const queueHeader = [
  "编号",
  "内容",
  "备注",
  "提出",
  "依赖",
  "验收标准",
  "完成证据",
  "状态说明",
  "创建",
];

/** 导出的队列.md：每个阶段一节，节里每种状态一张表。没有事的阶段和状态不写。 */
export function renderQueueDoc(
  items: readonly QueueItem[],
  localDay: (iso: string) => string,
): string {
  const lines = ["# 队列", "", "本文由 ploop export 按集中存储里的队列生成，只读。", ""];
  for (const key of stage.keys) {
    const ofStage = items.filter((item) => item.stage === key);
    if (ofStage.length === 0) continue;
    lines.push(`## ${stage.label(key)}`, "");
    for (const status of queueStatus.keys) {
      const rows = ofStage.filter((item) => item.status === status);
      if (rows.length === 0) continue;
      lines.push(`### ${queueStatus.label(status)}`, "", row(queueHeader));
      lines.push(row(queueHeader.map(() => "---")));
      for (const item of rows) {
        lines.push(
          row([
            item.id,
            item.content,
            item.note ?? "",
            proposer.label(item.proposer),
            item.dependsOn ?? "",
            item.acceptance ?? "",
            item.evidence ?? "",
            item.statusNote ?? "",
            localDay(item.createdAt),
          ]),
        );
      }
      lines.push("");
    }
  }
  if (items.length === 0) lines.push("队列里还没有事。", "");
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 旧格式的一件事：queue.py 要的十格，键是中文。 */
type LegacyQueueEntry = Readonly<Record<string, unknown>>;

/**
 * 旧格式的队列.json，旧 skill 的 queue.py 能读。编号不在旧格式里，写进来源一格的开头。
 * 提出一格旧的写法是随手写的一句话，这里写提出者的中文名。
 */
export function renderLegacyQueue(
  items: readonly QueueItem[],
  localDay: (iso: string) => string,
): string {
  // 旧格式的键是中文，写成键值对再拼成对象。
  const entries: LegacyQueueEntry[] = items.map((item) =>
    Object.fromEntries([
      ["内容", item.content],
      ["阶段", stage.label(item.stage)],
      ["提出", proposer.label(item.proposer)],
      ["依赖", item.dependsOn ?? ""],
      ["验收标准", item.acceptance ?? ""],
      ["完成证据", item.evidence ?? ""],
      ["来源", item.source === undefined ? item.id : `${item.id}；${item.source}`],
      ["创建时间", localDay(item.createdAt)],
      [
        "状态",
        Object.fromEntries([
          ["值", queueStatus.label(item.status)],
          ["说明", item.statusNote ?? ""],
        ]),
      ],
      ["子项", [...item.subItems]],
    ]),
  );
  const doc = Object.fromEntries([
    ["版本", 1],
    ["事项", entries],
  ]);
  return `${JSON.stringify(doc, null, 1)}\n`;
}

/**
 * 旧格式的决定.md：五列带编号的表，以后再说另成三列的表，和旧模板相同。
 * 作废的一条在决定一格开头写「已作废（被第 N 条推翻）。」，旧的读法据此认出作废。
 */
export function renderLegacyDecisionDoc(decisions: readonly Decision[]): string {
  const sorted = [...decisions].sort((a, b) => a.id - b.id);
  const text = (decision: Decision) =>
    decision.status === "voided"
      ? `已作废（被第 ${decision.voidedBy ?? ""} 条推翻）。${decision.decision}`
      : decision.decision;
  const main = sorted.filter((decision) => decision.kind !== "later");
  const later = sorted.filter((decision) => decision.kind === "later");
  const lines = [
    "# 决定",
    "",
    "只收用户看得见的行为决定。一行一条：决定 / 原因 / 当时的案例。被推翻的原地标「已作废」，不删。",
    "",
    row(["#", "决定", "原因", "案例", "日期"]),
    row(["---", "---", "---", "---", "---"]),
    ...main.map((d) => row([String(d.id), text(d), d.reason, d.case, d.date])),
    "",
    `## ${decisionKind.label("later")}`,
    "",
    row(["请求", "原因", "日期"]),
    row(["---", "---", "---"]),
    ...later.map((d) => row([text(d), d.reason, d.date])),
  ];
  return `${lines.join("\n")}\n`;
}
