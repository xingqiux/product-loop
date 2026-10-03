import type { RuleLevel } from "../names.ts";

// 术语表分两层，见「07 校验」第五节第 1 条：skill 自带一层，项目主线的「写作规范」一节再加一层。
// 每次校验时合并两层。项目那一层的写法见 ADR 0001 第 24 条：一张两列表写停用的说法和改成什么，
// 另写一个例外列表。

/** 术语表的一条。 */
export type GlossaryEntry = {
  /** 停用的说法。 */
  readonly phrase: string;
  /** 统一的术语，报错里写「改成什么」。 */
  readonly replacement: string;
  /** 拦截：含义明确的短语。警告：在别的语境里是正常用词。 */
  readonly level: RuleLevel;
  /** 紧跟在这些字后面时不算，例如「暴露出来」里的「露出来」。 */
  readonly notAfter?: string;
};

/**
 * skill 自带的一层，照搬旧 writing.py 的 BANNED、BANNED_RE、SOFT 三张表，顺序不变。
 * 「露出来」按第五节第 3 条改成警告：旧代码的注释和正文都说只警告，实际却拦截。
 */
export const builtInGlossary: readonly GlossaryEntry[] = [
  { phrase: "替人用的脚本", replacement: "走查脚本", level: "block" },
  { phrase: "管落地的脚本", replacement: "落地脚本", level: "block" },
  { phrase: "那道检查", replacement: "构建校验", level: "block" },
  { phrase: "做偏的样例", replacement: "反例测试", level: "block" },
  { phrase: "样例检查", replacement: "反例测试", level: "block" },
  { phrase: "改行为", replacement: "功能改动", level: "block" },
  { phrase: "收起来", replacement: "折叠", level: "block" },
  { phrase: "那一格", replacement: "字段的名称", level: "block" },
  { phrase: "那一块", replacement: "区块的名称", level: "block" },
  { phrase: "那一屏", replacement: "页面的名称", level: "block" },
  { phrase: "齐不齐", replacement: "是否齐全", level: "block" },
  { phrase: "露出来", replacement: "显示", level: "warn", notAfter: "暴" },
  { phrase: "人话", replacement: "说明", level: "warn" },
  { phrase: "整理", replacement: "重构", level: "warn" },
  { phrase: "拦住", replacement: "拦截", level: "warn" },
  { phrase: "放行", replacement: "通过", level: "warn" },
  { phrase: "点开", replacement: "展开", level: "warn" },
  { phrase: "你定", replacement: "由用户决定", level: "warn" },
];

/** 项目主线「写作规范」一节写的一层。 */
export type ProjectWritingSpec = {
  /** 两列表的每一行：停用的说法和改成什么。出现即拦截，写在引号里只警告。 */
  readonly banned: readonly { readonly phrase: string; readonly replacement: string }[];
  /** 例外的写法，例如带间隔号的外国人名。文字里出现这些写法的地方，各项都不再报。 */
  readonly exceptions: readonly string[];
};

/** 合并两层。项目写了和 skill 相同的说法时，以项目的为准。空的说法不收。 */
export function mergeGlossary(project: ProjectWritingSpec | undefined): readonly GlossaryEntry[] {
  if (project === undefined) return builtInGlossary;
  const own = project.banned
    .filter((row) => row.phrase !== "")
    .map(
      (row): GlossaryEntry => ({
        phrase: row.phrase,
        replacement: row.replacement,
        level: "block",
      }),
    );
  const taken = new Set(own.map((row) => row.phrase));
  return [...builtInGlossary.filter((entry) => !taken.has(entry.phrase)), ...own];
}

// 盖住例外的字符。它不是字母、数字、空白，也不会出现在任何停用的说法里，盖住以后前后的字连不成一个说法。
const hole = "\u0000";

/** 把例外的写法逐字盖住，长度不变。几个例外重叠时，盖住它们的并集。 */
export function maskExceptions(text: string, exceptions: readonly string[]): string {
  const covered = new Uint8Array(text.length);
  let any = false;
  for (const x of exceptions) {
    if (x === "") continue;
    for (let i = text.indexOf(x); i !== -1; i = text.indexOf(x, i + 1)) {
      covered.fill(1, i, i + x.length);
      any = true;
    }
  }
  if (!any) return text;
  return Array.from(covered, (c, i) => (c ? hole : text.charAt(i))).join("");
}

/** 文字里有没有这一条停用的说法。 */
export function containsPhrase(text: string, entry: GlossaryEntry): boolean {
  const { phrase, notAfter } = entry;
  if (notAfter === undefined) return text.includes(phrase);
  for (let i = text.indexOf(phrase); i !== -1; i = text.indexOf(phrase, i + 1)) {
    if (i === 0 || !notAfter.includes(text.charAt(i - 1))) return true;
  }
  return false;
}
