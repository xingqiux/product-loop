import type { ProjectWritingSpec } from "../writing/glossary.ts";
import {
  bulletItem,
  isBlank,
  isTableRow,
  numberedItem,
  type SourceLine,
  sectionEnd,
  tablesIn,
} from "./lines.ts";
import { isWritingSpecTitle, removeParens, squash } from "./parts.ts";
import type { MainlineProblem } from "./problems.ts";

// 主线的「写作规范」一节。写作校验在 skill 自带的术语表上再加这一层，见「07 校验」第五节第 1 条。
// 写法见 ADR 0001 第 24 条：一张两列的表格写停用的说法和改成什么，另写一个例外的列表。
// 这一节可以是二级标题，也可以是设计规范下面的三级标题，按标题去掉编号、括号和空白以后认。
// 具体的认法如下：
// - 表头第一格含「停用」两个字的表格，第一列是停用的说法，第二列是改成什么。别的列不管。
//   一格里用顿号列了几个说法的，拆开各算一条。两列的个数相同时一一对应，否则都改成第二列的全文。
// - 「例外：」这一行后面的字，以及紧跟的列表，每一项是一个例外的写法。
//   这一行也可以写成「例外的写法：」，或者写成标题。
// - 书名号、引号、反引号里的字取出里面的部分。

/** 空的写作规范：主线里没有这一节。 */
const empty: ProjectWritingSpec = { banned: [], exceptions: [] };

/** 例外那一行：「例外」或「例外的写法」，后面可以接冒号和几个例外。粗体的星号先去掉。 */
const exceptionLabel = /^例外(?:的写法)?(?:\s*[：:]\s*(.*))?$/u;

/** 整个包在书名号、引号或反引号里的，取出里面的部分。 */
function unwrap(text: string): string {
  const m = /^(?:「(.*)」|“(.*)”|"(.*)"|`(.*)`)$/u.exec(text.trim());
  return (m === null ? text : (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "")).trim();
}

/** 按顿号拆开，去掉包着的符号和空的项。 */
function splitList(text: string): string[] {
  return text
    .split("、")
    .map(unwrap)
    .filter((item) => item !== "");
}

/** 一行或列表的一项里的例外，按顿号拆开。开头包在符号里的，只取符号里的部分，后面的是说明。 */
function exceptionsIn(text: string): string[] {
  return text
    .trim()
    .replace(/[。；;]$/u, "")
    .split("、")
    .map((part) => {
      const lead = /^(?:「([^」]+)」|“([^”]+)”|"([^"]+)"|`([^`]+)`)/u.exec(part.trim());
      return (lead === null ? part : (lead[1] ?? lead[2] ?? lead[3] ?? lead[4] ?? "")).trim();
    })
    .filter((item) => item !== "");
}

function isExceptionTitle(title: string): boolean {
  const name = squash(removeParens(title));
  return name === "例外" || name === "例外的写法";
}

/**
 * 解析写作规范一节。没有这一节时返回空的。写了几节的只用第一节，另报 writingSpecDuplicate。
 */
export function parseWritingSpec(lines: readonly SourceLine[]): {
  readonly spec: ProjectWritingSpec;
  readonly problems: readonly MainlineProblem[];
} {
  const found = lines.flatMap((line, i) => {
    const heading = line.heading;
    return heading !== undefined && heading.level >= 2 && isWritingSpecTitle(heading.text)
      ? [i]
      : [];
  });
  const [first] = found;
  if (first === undefined) return { spec: empty, problems: [] };
  const problems: MainlineProblem[] = [];
  const at = (i: number) => lines[i]?.n ?? i + 1;
  if (found.length > 1) {
    problems.push({ kind: "writingSpecDuplicate", line: at(first), lines: found.map(at) });
  }
  const level = lines[first]?.heading?.level ?? 2;
  const end = sectionEnd(lines, first, level);
  const banned: { phrase: string; replacement: string }[] = [];
  for (const table of tablesIn(lines, first + 1, end)) {
    if (!(table.header[0] ?? "").includes("停用")) {
      problems.push({ kind: "writingSpecTable", line: table.line });
      continue;
    }
    for (const row of table.rows) {
      const [phraseCell = "", replacementCell = ""] = row.cells;
      const phrases = splitList(phraseCell);
      const replacements = splitList(replacementCell);
      const paired = phrases.length > 1 && replacements.length === phrases.length;
      for (const [i, phrase] of phrases.entries()) {
        if (/…|\.{3}/u.test(phrase)) {
          problems.push({ kind: "writingSpecEllipsis", line: row.line, phrase });
          continue;
        }
        const replacement = paired ? (replacements[i] ?? "") : unwrap(replacementCell);
        if (replacement === "") {
          problems.push({ kind: "writingSpecReplacementEmpty", line: row.line, phrase });
        }
        banned.push({ phrase, replacement });
      }
    }
  }
  return { spec: { banned, exceptions: exceptionsOf(lines, first + 1, end) }, problems };
}

/** 例外的列表：「例外：」后面的字，和紧跟在它或例外标题下面的列表。 */
function exceptionsOf(lines: readonly SourceLine[], from: number, to: number): string[] {
  const exceptions: string[] = [];
  let listing = false;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (line.heading !== undefined) {
      listing = isExceptionTitle(line.heading.text);
      continue;
    }
    if (isBlank(line)) continue;
    if (line.fenced || isTableRow(line)) {
      listing = false;
      continue;
    }
    // 列表项的文字在不编号的列表里是第一组，在编号的列表里是第二组
    const item = bulletItem.exec(line.text)?.[1] ?? numberedItem.exec(line.text)?.[2];
    if (item !== undefined && listing) {
      exceptions.push(...exceptionsIn(item));
      continue;
    }
    const label = exceptionLabel.exec(line.text.replaceAll("**", "").trim());
    listing = label !== null;
    if (label !== null) exceptions.push(...exceptionsIn(label[1] ?? ""));
  }
  return exceptions;
}
