import { isTableRow, scanLines } from "../mainline/lines.ts";

// 旧 skill 的 队列.md 和 决定.md 是手写的 Markdown 表格，见「08 版本与迁移」第五节。
// 手写的表格会被空行截成几段，也会有别的表的行直接接在后面。
// 这里只按行切出一段段表格，每段记下表头和前面最近的标题。行归到哪张表，由读的一方按列数定。

/** 表格的一行：行号从 1 数，各格去掉了两头的空白，写成 \| 的换回竖线。 */
export type LegacyTableRow = { readonly line: number; readonly cells: readonly string[] };

/** 连在一起的一段表格。被空行或别的字隔开的，是另一段。 */
export type LegacyTableBlock = {
  /** 表格前面最近的一个标题的文字，没有标题时没有这一项。 */
  readonly heading?: string;
  /** 表头：下一行是分隔行的那一行。被空行截断的后半段没有表头。 */
  readonly header?: LegacyTableRow;
  /** 表头和分隔行下面的各行，没有表头时是这一段的全部行。 */
  readonly rows: readonly LegacyTableRow[];
};

/** 分隔行：整行只有竖线、连字符、冒号和空白，并且有连字符。 */
const separatorPattern = /^[|\-: \t]+$/u;

/** 按竖线切格。两头的竖线不算，格里写成 \| 的是竖线本身。 */
function splitTableCells(row: string): string[] {
  const inner = row
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "");
  return inner.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll("\\|", "|"));
}

/** 切出文件里的每一段表格。代码块里的不算。 */
export function legacyTableBlocks(markdown: string): LegacyTableBlock[] {
  const lines = scanLines(markdown);
  const blocks: { heading?: string; header?: LegacyTableRow; rows: LegacyTableRow[] }[] = [];
  let heading: string | undefined;
  let current: (typeof blocks)[number] | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.heading !== undefined) heading = line.heading.text;
    if (!isTableRow(line)) {
      // 空行、正文、标题和代码块都把表格隔开
      current = undefined;
      continue;
    }
    const next = lines[i + 1];
    const text = line.text.trim();
    const isHeader =
      next !== undefined &&
      isTableRow(next) &&
      separatorPattern.test(next.text.trim()) &&
      next.text.includes("-");
    if (isHeader) {
      // 表头开始新的一段，哪怕上一行也是表格
      current = { ...(heading === undefined ? {} : { heading }), rows: [] };
      current.header = { line: line.n, cells: splitTableCells(text) };
      blocks.push(current);
      i++;
      continue;
    }
    if (separatorPattern.test(text) && text.includes("-")) continue;
    if (current === undefined) {
      current = { ...(heading === undefined ? {} : { heading }), rows: [] };
      blocks.push(current);
    }
    current.rows.push({ line: line.n, cells: splitTableCells(text) });
  }
  return blocks;
}

/** 表头的一格去掉空白以后的写法，按它认列。 */
export function headerKey(cell: string): string {
  return cell.replace(/\s+/gu, "");
}
