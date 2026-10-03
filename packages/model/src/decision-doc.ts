import type { Decision } from "./decision.ts";
import { decisionKind, decisionStatus } from "./names.ts";

// 项目缓存里的决定.md 是决定的只读视图，见「03 数据模型」第五节。
// 命令按集中存储里的决定重写它，从不回读。导出的决定.md 也用它，含已作废的，见第九节。
// 表头统一成一种：编号、决定、原因、案例、日期，另加状态和种类，见第二节。
// 已作废的原地留着，状态一列写明被哪一条推翻，见「04 命令行」第十节。

/** 项目缓存里决定的只读视图的文件名。 */
export const decisionDocFileName = "决定.md";

/** 统一的表头，顺序就是列序。 */
export const decisionDocHeader = ["编号", "决定", "原因", "案例", "日期", "状态", "种类"] as const;

/** 表格上面的说明，一段一行：文件从哪里来、怎么改、收什么。 */
const intro = [
  "本文由 ploop 按集中存储里的决定生成，只读。手改的内容会在下一次生成时被覆盖。",
  "新增用 `ploop decision add`，作废用 `ploop decision void <编号> --by <新编号>`。",
  "改文字用 `ploop decision edit <编号>`，编号和日期不变。",
  "只收用户看得见的行为决定。作废的决定留在原处，状态一列写明被哪一条推翻。",
];

/** 一条决定也没有时，代替表格的一句。 */
const empty = "还没有决定。";

/** 表格的一格：竖线转义，换行写成 <br>，一条决定始终只占一行。 */
function cell(text: string): string {
  return text.replace(/\r\n?|\n/gu, "<br>").replaceAll("|", "\\|");
}

const row = (cells: readonly string[]) => `| ${cells.join(" | ")} |`;

/** 状态一格。已作废的写明被哪一条推翻，写了作废原因的接在后面。 */
function statusCell(decision: Decision): string {
  const label = decisionStatus.label(decision.status);
  if (decision.status !== "voided") return label;
  const by = decision.voidedBy === undefined ? "" : `，被第 ${decision.voidedBy} 条推翻`;
  const reason = decision.voidReason === undefined ? "" : `。作废原因：${decision.voidReason}`;
  return `${label}${by}${reason}`;
}

/** 一条决定的七格，和表头的列序相同。 */
function cellsOf(decision: Decision): string[] {
  const { id, reason, date, kind } = decision;
  const texts = [String(id), decision.decision, reason, decision.case, date];
  return [...texts, statusCell(decision), decisionKind.label(kind)].map(cell);
}

/**
 * 决定.md 的全文。按编号从小到大排，同样的决定总是得到逐字相同的结果。
 * 传进来几条就写几条：项目缓存的视图和导出都传全部决定，含已作废的。
 */
export function renderDecisionDoc(decisions: readonly Decision[]): string {
  const sorted = [...decisions].sort((a, b) => a.id - b.id);
  const table =
    sorted.length === 0
      ? [empty]
      : [
          row(decisionDocHeader),
          row(decisionDocHeader.map(() => "---")),
          ...sorted.map((d) => row(cellsOf(d))),
        ];
  const paragraphs = intro.flatMap((line) => [line, ""]);
  return `${["# 决定", "", ...paragraphs, ...table].join("\n")}\n`;
}
