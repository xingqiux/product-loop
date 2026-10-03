import { renderCopy } from "./copy/define.ts";
import { landCopy } from "./copy/land.ts";
import { defineEnum, type KeyOf } from "./enum.ts";
import type { Issue } from "./envelope.ts";
import { err, ok, type Result } from "./result.ts";

// 落地计划的解析。AI 在项目缓存里写 rounds/<轮次>/计划.md。
// ploop land plan 把全文交给后端，后端解析出七节，存进落地记录。
// 见「04 命令行」第十一节和「03 数据模型」第二节。
// 从旧 skill 的 land.py 移植：按二级标题切节，标题以节名开头就算这一节，例如「## 要做的事（Q12）」。
// 和旧脚本相比有五处改动：
// - 一次报出全部问题，旧脚本遇到第一个就停。
// - 代码块里以 ## 开头的行不算标题。
// - 标题前可以带编号，例如「## 1. 要做的事」「## 一、要做的事」。
// - 同一节写了几次时报出来，旧脚本不报，只用其中一次的正文。
// - 裁决表的分隔行只认只有竖线、连字符、冒号和空格的行。某一格里有 --- 的行照常收下，
//   旧脚本丢掉所有含 --- 的行，见「07 校验」第六节。

/** 计划的七节，顺序就是计划里写的顺序。 */
export const landPlanSection = defineEnum({
  goal: "要做的事",
  current: "现状",
  tidy: "要不要先重构",
  changes: "功能改动",
  guard: "用什么锁住现有的行为",
  scenes: "对应哪个场景",
  verdicts: "裁决",
});
export type LandPlanSection = KeyOf<typeof landPlanSection>;

/** 从简的计划要写的三节，别的四节从简时不写。 */
export const shortPlanSections = [
  "goal",
  "changes",
  "guard",
] as const satisfies readonly LandPlanSection[];

/** 从简的计划不重构，记下的理由。 */
export const shortPlanTidyReason = "计划从简，这一批不先重构";

/** 「要不要先重构」写的是要，还是不要加理由。这个理由就是跳过重构时记下的理由。 */
export type LandPlanTidy =
  | { readonly wanted: true }
  | { readonly wanted: false; readonly reason: string };

/** 裁决表的一行，按格原样取出，通常是裁决、理由、错了的代价三格。 */
export type VerdictRow = readonly string[];

export type LandPlan = {
  /** 七节各自的正文，去掉了首尾的空白。从简的计划没写的四节是空字符串。 */
  readonly sections: Readonly<Record<LandPlanSection, string>>;
  /**
   * 小改动可以从简：只写要做的事、功能改动、用什么锁住现有的行为三节，别的四节一个标题也不写。
   * 从简的计划不重构，理由是 shortPlanTidyReason。改动超过评审界线时要补全七节，见 land.plan.sections。
   */
  readonly short: boolean;
  readonly tidy: LandPlanTidy;
  /** 裁决表的每一行，不含表头和分隔行。「裁决」一节里没有表格时是空的。 */
  readonly verdicts: readonly VerdictRow[];
};

/**
 * 计划的问题。line 是这一节标题所在的行号，从 1 数。
 * - missing：没有这一节的标题。
 * - empty：有标题，正文是空的。
 * - duplicate：同一节写了几次，lines 是各次标题的行号。解析时用第一次的正文。
 * - tidyWord：「要不要先重构」没有以「要」或「不要」开头。
 * - tidyReason：写了「不要」，后面的理由不到六个字。
 */
export type LandPlanProblem =
  | { readonly kind: "missing"; readonly section: LandPlanSection }
  | { readonly kind: "empty"; readonly section: LandPlanSection; readonly line: number }
  | {
      readonly kind: "duplicate";
      readonly section: LandPlanSection;
      readonly lines: readonly number[];
    }
  | { readonly kind: "tidyWord"; readonly line: number }
  | { readonly kind: "tidyReason"; readonly line: number };
export type LandPlanProblemKind = LandPlanProblem["kind"];

/**
 * 写「不要」时，理由至少要有几个字。沿用旧脚本的算法：去掉开头的「不要」和紧跟的标点、空白，
 * 剩下的按字数算，标点也算。
 */
const minTidyReasonLength = 6;

/**
 * 解析计划的全文。七节都在、都有正文，「要不要先重构」写清要或不要，才返回解析的结果。
 * 只写要做的事、功能改动、用什么锁住现有的行为三节的，是从简的计划，也返回解析的结果。
 * 有问题时一次返回全部问题，顺序和七节的顺序相同。七节以外的二级标题不管。
 */
export function parseLandPlan(
  text: string,
): Result<LandPlan, readonly [LandPlanProblem, ...LandPlanProblem[]]> {
  const found = splitSections(text);
  // 三节都写了、另外四节一个标题也没有：从简的计划，只查这三节。
  const short =
    shortPlanSections.every((section) => found.has(section)) &&
    landPlanSection.keys.every(
      (section) => shortPlanSections.some((s) => s === section) || !found.has(section),
    );
  const problems: LandPlanProblem[] = [];
  const bodies = new Map<LandPlanSection, string>();
  let tidy: LandPlanTidy | undefined;
  for (const section of short ? shortPlanSections : landPlanSection.keys) {
    const [first, ...more] = found.get(section) ?? [];
    if (first === undefined) {
      problems.push({ kind: "missing", section });
      continue;
    }
    if (more.length > 0) {
      problems.push({ kind: "duplicate", section, lines: [first, ...more].map((s) => s.line) });
    }
    const body = bodyOf(first);
    bodies.set(section, body);
    if (body === "") problems.push({ kind: "empty", section, line: first.line });
    else if (section === "tidy") {
      const parsed = parseTidy(body);
      if (parsed.ok) tidy = parsed.value;
      else problems.push({ kind: parsed.error, line: first.line });
    }
  }
  const [problem, ...rest] = problems;
  if (problem !== undefined) return err([problem, ...rest]);
  const verdictSection = found.get("verdicts")?.[0];
  return ok({
    // 没有问题时要查的几节都在，从简的计划没写的四节记成空
    sections: Object.fromEntries(
      landPlanSection.keys.map((section) => [section, bodies.get(section) ?? ""]),
    ) as Record<LandPlanSection, string>,
    short,
    // 没有问题时「要不要先重构」一定解析过，并且写清了要或不要；从简的计划不重构
    tidy: short ? { wanted: false, reason: shortPlanTidyReason } : (tidy as LandPlanTidy),
    verdicts: verdictSection === undefined ? [] : parseVerdicts(verdictSection.lines),
  });
}

/**
 * 一条问题的报错：什么不对、怎么改。给了计划文件的路径时，另写在哪里，有行号的带上行号。
 * 规矩的编号由调用的地方写。
 */
export function describeLandPlanProblem(problem: LandPlanProblem, file?: string): Issue {
  const { message, hint, lines } = problemText(problem);
  if (file === undefined) return { message, hint };
  const where =
    lines.length === 0 ? file : renderCopy(landCopy.planWhere, { file, lines: lines.join("、") });
  return { message, hint, where };
}

/**
 * 缺了两节以上时，合成一条：写缺几节，缺的节名一行一个。只缺一节时仍用 describeLandPlanProblem。
 * 给了计划文件的路径时，另写在哪里。
 */
export function describeMissingSections(
  sections: readonly LandPlanSection[],
  file?: string,
): Issue {
  const text = landCopy.plan.missingMany;
  const names = sections.map((section) => `  ${landPlanSection.label(section)}`);
  return {
    message: [renderCopy(text.message, { count: sections.length }), ...names].join("\n"),
    hint: renderCopy(text.hint),
    ...(file === undefined ? {} : { where: file }),
  };
}

function problemText(problem: LandPlanProblem): {
  readonly message: string;
  readonly hint: string;
  readonly lines: readonly number[];
} {
  const { plan } = landCopy;
  switch (problem.kind) {
    case "missing":
      return {
        message: renderCopy(plan.missing.message, {
          section: landPlanSection.label(problem.section),
        }),
        hint: renderCopy(plan.missing.hint),
        lines: [],
      };
    case "empty":
      return {
        message: renderCopy(plan.empty.message, {
          section: landPlanSection.label(problem.section),
        }),
        hint: renderCopy(plan.empty.hint),
        lines: [problem.line],
      };
    case "duplicate":
      return {
        message: renderCopy(plan.duplicate.message, {
          section: landPlanSection.label(problem.section),
          count: problem.lines.length,
        }),
        hint: renderCopy(plan.duplicate.hint),
        lines: problem.lines,
      };
    case "tidyWord":
      return {
        message: renderCopy(plan.tidyWord.message),
        hint: renderCopy(plan.tidyWord.hint),
        lines: [problem.line],
      };
    case "tidyReason":
      return {
        message: renderCopy(plan.tidyReason.message),
        hint: renderCopy(plan.tidyReason.hint),
        lines: [problem.line],
      };
  }
}

/** 计划里的一行。fenced 表示它在代码块里，包括代码块开头和结尾的围栏。 */
type PlanLine = { readonly text: string; readonly fenced: boolean };

/** 找到的一节：标题所在的行号，和标题下面到下一个二级标题之前的各行。 */
type FoundSection = { readonly line: number; readonly lines: readonly PlanLine[] };

/** 二级标题。和 CommonMark 一样，前面最多三个空格，结尾可以带一串 #。 */
const headingPattern = /^ {0,3}##(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;

/** 代码块的围栏：三个以上的反引号或波浪号。 */
const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

/** 标题前的编号，例如「1.」「1、」「一、」。 */
const numberPrefix = /^(?:\d+|[一二三四五六七八九十]+)[.、．][ \t]*/u;

/** 按二级标题切开全文，只留七节的标题。第一个二级标题之前的行不属于任何一节。 */
function splitSections(text: string): Map<LandPlanSection, FoundSection[]> {
  const found = new Map<LandPlanSection, FoundSection[]>();
  // 开头的字节顺序标记不算正文，否则第一行的标题认不出来
  const lines = text.replace(/^\uFEFF/u, "").split(/\r\n|\r|\n/u);
  // 当前这一节的各行。遇到第一个二级标题之前是 undefined
  let body: PlanLine[] | undefined;
  let fence: { readonly char: string; readonly size: number } | undefined;
  for (const [index, line] of lines.entries()) {
    const run = fencePattern.exec(line);
    const marker = run?.[1] ?? "";
    const info = run?.[2] ?? "";
    if (fence !== undefined) {
      // 遇到同一种、不短于开头的围栏，并且后面没有别的字，代码块就结束了
      if (marker.startsWith(fence.char) && marker.length >= fence.size && info.trim() === "") {
        fence = undefined;
      }
      body?.push({ text: line, fenced: true });
      continue;
    }
    // 反引号的围栏后面不能再有反引号，否则那只是一段行内代码
    if (run !== null && !(marker.startsWith("`") && info.includes("`"))) {
      fence = { char: marker.charAt(0), size: marker.length };
      body?.push({ text: line, fenced: true });
      continue;
    }
    const heading = headingPattern.exec(line);
    if (heading === null) {
      body?.push({ text: line, fenced: false });
      continue;
    }
    body = [];
    const section = sectionOf(heading[1] ?? "");
    if (section !== undefined) {
      const sections = found.get(section) ?? [];
      sections.push({ line: index + 1, lines: body });
      found.set(section, sections);
    }
  }
  return found;
}

/** 标题去掉编号以后，以哪一节的名字开头就是哪一节。 */
function sectionOf(title: string): LandPlanSection | undefined {
  const name = title.trim().replace(numberPrefix, "");
  return landPlanSection.keys.find((section) => name.startsWith(landPlanSection.label(section)));
}

function bodyOf(section: FoundSection): string {
  return section.lines
    .map((line) => line.text)
    .join("\n")
    .trim();
}

/** 「要不要先重构」：以「不要」开头的是不要，其余以「要」开头的是要。 */
function parseTidy(body: string): Result<LandPlanTidy, "tidyWord" | "tidyReason"> {
  if (body.startsWith("不要")) {
    const reason = body.replace(/^不要[。，,.\s]*/u, "");
    return Array.from(reason).length < minTidyReasonLength
      ? err("tidyReason")
      : ok({ wanted: false, reason });
  }
  return body.startsWith("要") ? ok({ wanted: true }) : err("tidyWord");
}

/** 分隔行：整行只有竖线、连字符、冒号和空格。 */
const separatorRow = /^[|\-: \t]+$/u;

/**
 * 裁决表：「裁决」一节里以竖线开头的行，不算代码块里的。
 * 去掉分隔行以后，第一行是表头，其余每行一条裁决。某一格里有 --- 的行不是分隔行，照常收下。
 */
function parseVerdicts(lines: readonly PlanLine[]): VerdictRow[] {
  const rows = lines
    .filter((line) => !line.fenced)
    .map((line) => line.text.trim())
    .filter((row) => row.startsWith("|") && !separatorRow.test(row));
  return rows.slice(1).map(splitCells);
}

/** 按竖线切格。两头的竖线不算，格里写成 \| 的是竖线本身。 */
function splitCells(row: string): string[] {
  const inner = row.replace(/^\|/u, "").replace(/(?<!\\)\|$/u, "");
  return inner.split(/(?<!\\)\|/u).map((cell) => cell.trim().replaceAll("\\|", "|"));
}
