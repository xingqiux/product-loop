// 把主线按行切开，认出标题、代码块、列表项和表格。只认主线里用到的几种写法，不是完整的 Markdown 解析。
// 标题、围栏和分隔行的认法和落地计划的解析相同，见 land-plan.ts。

/** 标题的级别和文字。文字去掉了开头的 # 和结尾那一串 #。 */
type Heading = { readonly level: number; readonly text: string };

/** 主线的一行。 */
export type SourceLine = {
  /** 行号，从 1 数。 */
  readonly n: number;
  /** 这一行的文字，不含换行符。第一行开头的字节顺序标记已去掉。 */
  readonly text: string;
  /** 在代码块里，包括代码块开头和结尾的围栏。代码块里的行不算标题、步骤和表格。 */
  readonly fenced: boolean;
  /** 是标题时才有。 */
  readonly heading?: Heading;
};

/** ATX 标题。和 CommonMark 一样，前面最多三个空格，# 后面要有空白，结尾可以带一串 #。 */
const headingPattern = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;

/** 代码块的围栏：三个以上的反引号或波浪号。 */
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** 断行：回车换行、换行、回车，都算一处。 */
export const lineBreak = /\r\n|\r|\n/u;

export function scanLines(markdown: string): SourceLine[] {
  // 开头的字节顺序标记不算正文，否则第一行的标题认不出来
  const texts = markdown.replace(/^\uFEFF/u, "").split(lineBreak);
  const lines: SourceLine[] = [];
  let fence: { readonly char: string; readonly size: number } | undefined;
  for (const [index, text] of texts.entries()) {
    const n = index + 1;
    const run = fencePattern.exec(text);
    const marker = run?.[1] ?? "";
    const info = run?.[2] ?? "";
    if (fence !== undefined) {
      // 遇到同一种、不短于开头的围栏，并且后面没有别的字，代码块就结束了
      if (marker.startsWith(fence.char) && marker.length >= fence.size && info.trim() === "") {
        fence = undefined;
      }
      lines.push({ n, text, fenced: true });
      continue;
    }
    // 反引号的围栏后面不能再有反引号，否则那只是一段行内代码
    if (run !== null && !(marker.startsWith("`") && info.includes("`"))) {
      fence = { char: marker.charAt(0), size: marker.length };
      lines.push({ n, text, fenced: true });
      continue;
    }
    const heading = headingPattern.exec(text);
    if (heading === null) lines.push({ n, text, fenced: false });
    else {
      const level = (heading[1] ?? "").length;
      lines.push({ n, text, fenced: false, heading: { level, text: (heading[2] ?? "").trim() } });
    }
  }
  return lines;
}

/** 主线里的一个标题，和它管到哪一行。 */
export type MainlineHeading = {
  /** 标题的文字，不含开头的 #，例如「1 一句话新闻稿」「配色（用在：状态标签）」。 */
  readonly text: string;
  /** 标题所在的行。 */
  readonly line: number;
  /** 这一节最后一行有字的行。正文是空的时，等于标题所在的行。 */
  readonly endLine: number;
};

/** 下标 index 上的标题。它管到 end（不含）为止。 */
export function headingAt(
  lines: readonly SourceLine[],
  index: number,
  end: number,
): MainlineHeading {
  const line = lines[index];
  const n = line?.n ?? index + 1;
  return {
    text: line?.heading?.text ?? "",
    line: n,
    endLine: lastTextLine(lines, index, end) ?? n,
  };
}

/** 第 start 个下标上的标题管到哪里：下一个同级或更高级的标题之前，返回那个下标。 */
export function sectionEnd(lines: readonly SourceLine[], start: number, level: number): number {
  let end = start + 1;
  while (end < lines.length) {
    const heading = lines[end]?.heading;
    if (heading !== undefined && heading.level <= level) break;
    end++;
  }
  return end;
}

/** 下标 from 到 to（不含）之间最后一行有字的行号。都是空行时返回 undefined。 */
function lastTextLine(lines: readonly SourceLine[], from: number, to: number): number | undefined {
  for (let i = to - 1; i >= from; i--) {
    const line = lines[i];
    if (line !== undefined && line.text.trim() !== "") return line.n;
  }
  return undefined;
}

export const isBlank = (line: SourceLine): boolean => line.text.trim() === "";

/**
 * 编号的列表项：「1. 」「1) 」，另认中文里常写的「1、」「1．」「1）」，这三种后面可以不空格。
 * 第一组是写的编号，第二组是编号后面的文字。
 */
export const numberedItem = /^ {0,3}([0-9]{1,9})(?:[.)](?:[ \t]+|$)|[、．）][ \t]*)(.*)$/u;

/** 不编号的列表项，组是后面的文字。 */
export const bulletItem = /^ {0,3}[-*+][ \t]+(.*)$/u;

/** 表格的一行。 */
type TableRow = { readonly line: number; readonly cells: readonly string[] };

/** 一张表格：表头所在的行号、表头的各格，和分隔行下面的各行。 */
export type Table = {
  readonly line: number;
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
};

/** 表格里的一行，包括表头和分隔行：不在代码块里，以竖线开头。 */
export const isTableRow = (line: SourceLine): boolean =>
  !line.fenced && line.text.trimStart().startsWith("|");

/** 分隔行：整行只有竖线、连字符、冒号和空白，并且有连字符。 */
const isSeparator = (line: SourceLine): boolean =>
  isTableRow(line) && /^[|\-: \t]+$/u.test(line.text.trim()) && line.text.includes("-");

/** 下标 from 到 to（不含）之间的表格。以竖线开头、下一行是分隔行的，是一张表格的表头。 */
export function tablesIn(lines: readonly SourceLine[], from: number, to: number): Table[] {
  const tables: Table[] = [];
  let i = from;
  while (i < to) {
    const head = lines[i];
    const separator = lines[i + 1];
    if (head === undefined || separator === undefined || i + 1 >= to) break;
    if (!isTableRow(head) || !isSeparator(separator)) {
      i++;
      continue;
    }
    const rows: TableRow[] = [];
    let j = i + 2;
    while (j < to) {
      const row = lines[j];
      if (row === undefined || !isTableRow(row)) break;
      rows.push({ line: row.n, cells: splitCells(row.text) });
      j++;
    }
    tables.push({ line: head.n, header: splitCells(head.text), rows });
    i = j;
  }
  return tables;
}

/** 按竖线切格。两头的竖线不算，格里写成 \| 的是竖线本身。 */
function splitCells(row: string): string[] {
  const inner = row
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "");
  return inner.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll("\\|", "|"));
}
