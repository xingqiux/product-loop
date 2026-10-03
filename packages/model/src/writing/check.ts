import {
  containsPhrase,
  maskExceptions,
  mergeGlossary,
  type ProjectWritingSpec,
} from "./glossary.ts";
import { readingLength, splitSentences } from "./measure.ts";
import { count, digit, head, len, space } from "./python.ts";
import { collect, type Report, type WritingResult } from "./rules.ts";

// 写作校验，从旧 writing.py 的 check 逐项移植，另把 build-report.py 的措辞提醒并进警告，
// 见「07 校验」第四节和第五节。和旧脚本不同的地方只有第五节写明的三处有意改动：
// 1. 引号里的字照常算进句子的长度和分号，停用的说法出现在引号里只警告。
// 2. 术语表分两层，项目可以加停用的说法，也可以列出例外的写法。
// 3. 「露出来」从拦截改成警告。
// 标了 quote: true 的用户原话整段不校验，由调用的地方跳过。

export type WritingOptions = {
  /** 项目主线「写作规范」一节写的一层。不写时只用 skill 自带的一层。 */
  readonly project?: ProjectWritingSpec;
};

const quotes = /「[^」]*」|“[^”]*”/gu;
const links = new RegExp(`https?://[^${space}]+`, "gu");
const spaces = new RegExp(`[${space}]`, "gu");
const demonstratives = /这一|那一|这个|那个|这些|那些/gu;
const parens = /[（(]([^（）()]*)[）)]/gu;

// 措辞一类，照 build-report.py 的 WORDING 移植，顺序不变。它们查原文，引号和链接里的也查。
const wording = [
  ["writing.wording.redBlue", /红方|蓝方/u],
  ["writing.wording.interpunct", /[·・]/u],
  ["writing.wording.spoken", new RegExp(`我站|站[${space}]*[abc](?![a-z])|接着跑|抠|定过`, "u")],
  [
    "writing.wording.numberRef",
    new RegExp(`(?:场景|任务|决定|疑问|发现|提升)[${space}]*${digit}+`, "u"),
  ],
  [
    "writing.wording.statistics",
    new RegExp(
      `${digit}+[${space}]*(?:处|项|个问题|次|%|％)|(?:通过|失败)[${space}]*${digit}+|${digit}+[${space}]*(?:通过|失败)`,
      "u",
    ),
  ],
] as const;

/** 去掉文字里的链接。链接不参加校验，它从 http 起，到空白为止。 */
export function removeLinks(text: string): string {
  return text.replace(links, "");
}

/**
 * 一段文字有几个字，和写作校验量一句话的算法相同：链接不算，一串英文或数字算一个字，
 * 标点和空白不算。队列事项的内容和决定的「决定」一项不超过 40 个字，量的就是它。
 */
export function writingLength(text: string): number {
  return readingLength(removeLinks(text));
}

/** 对一段文字跑写作校验：拦截五项、警告五项。 */
export function checkWriting(text: string, options: WritingOptions = {}): WritingResult {
  const { result, report } = collect();
  reportWriting(text, options, report);
  return result;
}

/** 查法和 checkWriting 相同，查出的每一处交给 report。规则框架由此按编号分给各条规则。 */
export function reportWriting(text: string, options: WritingOptions, report: Report): void {
  checkProse(text, options.project, report);
  reportWording(text, options.project, report);
}

/**
 * 措辞一类：红方蓝方、间隔号、口头说法、编号指代、统计数字，都只警告，每条只报第一处。
 * skip 写不查的几条：会话回复的间隔号有自己的拦截，措辞里不再重复。
 */
export function reportWording(
  text: string,
  project: ProjectWritingSpec | undefined,
  report: Report,
  skip: readonly string[] = [],
): void {
  const masked = maskExceptions(text, project?.exceptions ?? []);
  for (const [rule, pattern] of wording) {
    if (skip.includes(rule)) continue;
    const hit = pattern.exec(masked)?.[0];
    if (hit !== undefined) report(rule, { hit });
  }
}

/** 旧 writing.py 的 check：停用的说法、句子的长度、分号、括号里的并列、指示词。回复自查也用它。 */
export function checkProse(
  text: string,
  project: ProjectWritingSpec | undefined,
  report: Report,
): void {
  // 链接不参加校验。引号里的字不再去掉，照常算进所在的句子（有意改动 1）
  const plain = removeLinks(text);
  const masked = maskExceptions(text, project?.exceptions ?? []);
  const maskedPlain = removeLinks(masked);
  // 停用的说法在不在引号外，按旧脚本的算法：先去掉引号里的字，再去掉链接
  const unquoted = removeLinks(masked.replace(quotes, ""));
  for (const entry of mergeGlossary(project)) {
    const params = { phrase: entry.phrase, replacement: entry.replacement };
    if (entry.level === "warn") {
      if (containsPhrase(maskedPlain, entry)) report("writing.term.soft", params);
    } else if (containsPhrase(unquoted, entry)) {
      report("writing.term.banned", params);
    } else if (containsPhrase(maskedPlain, entry)) {
      report("writing.term.quoted", params);
    }
  }
  for (const s of splitSentences(plain)) {
    // 连续的英文、数字、路径折算成一个字，按字符数算会把夹着英文的短句误判成长句
    const n = readingLength(s);
    if (n > 60) report("writing.sentence.tooLong", { head: head(s, 20) });
    else if (n > 40) report("writing.sentence.long", { head: head(s, 20) });
    if (count(s, "；") >= 2) report("writing.sentence.semicolons", { head: head(s, 20) });
    for (const [, inner = ""] of s.matchAll(parens)) {
      if (count(inner, "、") < 2) continue;
      if (len(inner) > 30) report("writing.paren.list", { head: head(inner, 16) });
      else report("writing.paren.items", { head: head(inner, 16) });
    }
  }
  const size = len(plain.replace(spaces, ""));
  const hits = plain.match(demonstratives)?.length ?? 0;
  if (hits >= 4 && (hits * 100) / Math.max(size, 1) > 3) report("writing.demonstrative.dense");
}
