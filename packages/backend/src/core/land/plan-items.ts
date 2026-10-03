import { formatCommand, formatQueueId } from "@product-loop/model";

// 计划「功能改动」一节里的每一件，和「检查命令原样写在计划里」的查法，见「07 校验」第四节的
// land.change.planned（决定 118）。计划的七节由 model 的 parseLandPlan 切开，这里只看一节的正文。
// 一件功能改动写成一个三级标题，或者一个顶格的列表项。标题的那一行是这一件的名字，
// 下面的几行写检查命令和它查的是什么，例如：
//   1. 空列表显示一句提示（Q12）
//      检查 `pnpm vitest run src/list.test.ts`，查空列表时页面显示一句提示。
// 有三级标题时按三级标题分，没有时按顶格的列表项分。

/** 功能改动里的一件。 */
export type PlanChangeItem = {
  /** 名字：标题那一行去掉编号和末尾的标点。ploop land red 写的名字要和它相同。 */
  readonly name: string;
  /** 这一件的全文，从标题那一行起。 */
  readonly text: string;
  /** 这一件里写到的队列编号，按编号排，重复的只留一个。 */
  readonly queueNumbers: readonly number[];
};

/** 三级标题，前面最多三个空格。 */
const headingItem = /^ {0,3}###[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/u;

/** 顶格的列表项：1. 1) - * + 后面跟空白，1、1． 后面可以不跟，前面最多三个空格。 */
const listItem = /^ {0,3}(?:\d+[.)][ \t]+|\d+[、．][ \t]*|[-*+][ \t]+)(.*)$/u;

/** 标题前的编号，例如「1.」「一、」。 */
const numberPrefix = /^(?:\d+|[一二三四五六七八九十]+)[.、．][ \t]*/u;

/** 名字末尾不算的标点。 */
const trailingMarks = /[。．.：:；;，,\s]+$/u;

/** 代码块的围栏。 */
const fence = /^ {0,3}(?:`{3,}|~{3,})/u;

/** 名字的写法：去掉首尾的空白和末尾的标点。比较名字时两边都这样整理。 */
export function normalizeChangeName(name: string): string {
  return name.trim().replace(trailingMarks, "");
}

/** 把「功能改动」一节切成一件一件。代码块里的行不算标题。 */
export function parseChangeItems(section: string): PlanChangeItem[] {
  const lines = section.split(/\r\n|\r|\n/u);
  const fenced = fencedLines(lines);
  const outside = lines.filter((_, i) => !fenced[i]);
  const pattern = outside.some((line) => headingItem.test(line)) ? headingItem : listItem;
  const starts: { readonly index: number; readonly title: string }[] = [];
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    const match = pattern.exec(line);
    if (match !== null) starts.push({ index, title: match[1] ?? "" });
  }
  return starts.flatMap(({ index, title }, i) => {
    const name = normalizeChangeName(title.replace(numberPrefix, ""));
    if (name === "") return [];
    const end = starts[i + 1]?.index ?? lines.length;
    const text = lines.slice(index, end).join("\n").trim();
    return [{ name, text, queueNumbers: queueNumbersIn(text) }];
  });
}

/** 每一行在不在代码块里，围栏那一行也算。 */
function fencedLines(lines: readonly string[]): boolean[] {
  let open = false;
  return lines.map((line) => {
    if (fence.test(line)) {
      open = !open;
      return true;
    }
    return open;
  });
}

/** 文字里写到的队列编号：Q 加不补 0 的数字，前后不连着英文字母和数字。 */
export function queueNumbersIn(text: string): number[] {
  const found = [...text.matchAll(/(?<![A-Za-z0-9_])Q([1-9]\d*)(?![A-Za-z0-9_])/gu)].map((m) =>
    Number(m[1]),
  );
  return [...new Set(found)].sort((a, b) => a - b);
}

/** 队列编号写成 Q12、Q15。 */
export function queueIdsText(numbers: readonly number[]): string {
  return numbers.map(formatQueueId).join("、");
}

/**
 * 这段文字里有没有原样写着这条命令。三种写法都算：
 * - 按 shell 的写法写出来的一行，和 formatCommand 的结果相同。
 * - 行内代码或代码块里的一行，按 shell 的规矩切开以后和命令逐项相同。引号用单引号还是双引号都行。
 * - 同样切开以后，末尾是「-- 命令」，例如写了整条 ploop land red 名字 -- 命令。
 */
export function mentionsCommand(text: string, command: readonly string[]): boolean {
  if (containsWhole(text, formatCommand(command))) return true;
  return commandCandidates(text).some((candidate) => {
    const words = shellWords(candidate);
    if (words === undefined) return false;
    if (sameWords(words, command)) return true;
    const tail = words.slice(words.length - command.length - 1);
    return tail[0] === "--" && sameWords(tail.slice(1), command);
  });
}

/** 命令能接着写下去的字：前后连着这些字时，看到的只是更长的一条命令的一段。 */
const commandChar = /[A-Za-z0-9_\-./'"$=~:@%+,]/u;

/**
 * 文字里有没有写着这一整条命令：前面不连着命令的字，后面这一行在空白以后也不再接着写参数。
 * 这样「pnpm test --watch」里不算写了「pnpm test」。
 */
function containsWhole(text: string, needle: string): boolean {
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    const rest = text.slice(i + needle.length).split("\n")[0] ?? "";
    const next = rest.trimStart().charAt(0);
    if (!commandChar.test(text.charAt(i - 1)) && !commandChar.test(next)) return true;
  }
  return false;
}

function sameWords(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((word, i) => word === b[i]);
}

/** 可能写着命令的地方：行内代码，和代码块里的每一行。 */
function commandCandidates(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/u);
  const fenced = fencedLines(lines);
  const blockLines = lines.filter((line, i) => fenced[i] && !fence.test(line));
  const spans = lines
    .filter((_, i) => !fenced[i])
    .flatMap((line) => [...line.matchAll(/(`+)(.+?)\1/gu)].map((m) => m[2] ?? ""));
  return [...spans, ...blockLines].map((s) => s.trim()).filter((s) => s !== "");
}

/**
 * 按 shell 的规矩把一行切成程序和参数：空白分开，单引号里原样，双引号里认 \" \\ \$ \` 四种转义，
 * 引号外面的反斜杠转义下一个字。不展开变量。引号没有配对时返回 undefined。
 */
export function shellWords(line: string): string[] | undefined {
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let quote: "'" | '"' | undefined;
  for (let i = 0; i < line.length; i += 1) {
    const char = line.charAt(i);
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else word += char;
      continue;
    }
    if (quote === '"') {
      const next = line.charAt(i + 1);
      if (char === '"') quote = undefined;
      else if (char === "\\" && '"\\$`'.includes(next) && next !== "") {
        word += next;
        i += 1;
      } else word += char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      continue;
    }
    inWord = true;
    if (char === "'" || char === '"') quote = char;
    else if (char === "\\" && i + 1 < line.length) {
      word += line.charAt(i + 1);
      i += 1;
    } else word += char;
  }
  if (quote !== undefined) return undefined;
  if (inWord) words.push(word);
  return words;
}
