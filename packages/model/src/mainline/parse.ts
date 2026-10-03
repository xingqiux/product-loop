import type { ProjectWritingSpec } from "../writing/glossary.ts";
import { allMissing, type DesignSpecEntry, parseDesignSpec } from "./design-spec.ts";
import {
  headingAt,
  type MainlineHeading,
  type SourceLine,
  scanLines,
  sectionEnd,
} from "./lines.ts";
import { type MainlinePart, mainlinePart, mainlinePartOf } from "./parts.ts";
import { type MainlineProblem, sortProblems } from "./problems.ts";
import { type MainlineScene, parseScenes } from "./scenes.ts";
import { parseWritingSpec } from "./writing-spec.ts";

// 主线的解析，见「03 数据模型」第二节。
// 后端每次收到新的主线，解析出十样、场景和设计规范，和全文一起存成主线的一个版本。
// 各部分的认法见以下几处：
// - 十样按二级标题认，见 ADR 0001 第 23 条。
// - 场景和设计规范的写法见「09 skill 与软件」第三节。
// - 写作规范一节见「07 校验」第五节和 ADR 0001 第 24 条。
// 主线是 AI 随手编辑的文字，所以解析不会失败。认不出的地方记成问题，一次全部报出。

/** 十样里的一样：在不在，在的话标题在哪一行、管到哪一行。 */
export type MainlinePartEntry =
  | { readonly part: MainlinePart; readonly present: false }
  | { readonly part: MainlinePart; readonly present: true; readonly heading: MainlineHeading };

export type MainlineParse = {
  /** 十样，顺序和 mainlinePart 相同。同一样写了几次的，用第一次。 */
  readonly parts: readonly MainlinePartEntry[];
  /** 十样以外的二级标题，例如「覆盖表」。 */
  readonly otherSections: readonly MainlineHeading[];
  /** 场景清单这一节里的场景，按在主线里的先后。 */
  readonly scenes: readonly MainlineScene[];
  /** 设计规范的十二样，顺序和 designSpecItem 相同。没有设计规范这一节时十二样都缺。 */
  readonly designSpec: readonly DesignSpecEntry[];
  /** 设计规范这一节里十二样以外的三级标题。 */
  readonly otherSpecHeadings: readonly MainlineHeading[];
  /** 写作规范一节写的停用说法和例外。没有这一节时两项都是空的。 */
  readonly writingSpec: ProjectWritingSpec;
  /** 查出的全部问题，按行号排。十样和十二样缺了哪几样不算问题。 */
  readonly problems: readonly MainlineProblem[];
};

/** 十样各自的二级标题在哪几行，用下标记。另返回十样以外的二级标题的下标。 */
export function findParts(lines: readonly SourceLine[]): {
  readonly found: ReadonlyMap<MainlinePart, readonly number[]>;
  readonly others: readonly number[];
} {
  const found = new Map<MainlinePart, number[]>();
  const others: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.heading?.level !== 2) continue;
    const part = mainlinePartOf(line.heading.text);
    if (part === undefined) others.push(i);
    else found.set(part, [...(found.get(part) ?? []), i]);
  }
  return { found, others };
}

export function parseMainline(markdown: string): MainlineParse {
  const lines = scanLines(markdown);
  const { found, others } = findParts(lines);
  const problems: MainlineProblem[] = [];
  const section = (i: number) => headingAt(lines, i, sectionEnd(lines, i, 2));
  const parts = mainlinePart.keys.map((part): MainlinePartEntry => {
    const [first, ...more] = found.get(part) ?? [];
    if (first === undefined) return { part, present: false };
    const heading = section(first);
    if (more.length > 0) {
      const all = [first, ...more].map((i) => lines[i]?.n ?? i + 1);
      problems.push({ kind: "partDuplicate", line: heading.line, part, lines: all });
    }
    return { part, present: true, heading };
  });

  const scenesAt = found.get("scenes")?.[0];
  const scenes =
    scenesAt === undefined
      ? { scenes: [], problems: [] }
      : parseScenes(lines, scenesAt, sectionEnd(lines, scenesAt, 2));
  const specAt = found.get("designSpec")?.[0];
  const spec =
    specAt === undefined
      ? { entries: allMissing, others: [], problems: [] }
      : parseDesignSpec(lines, specAt, sectionEnd(lines, specAt, 2));
  const writing = parseWritingSpec(lines);

  return {
    parts,
    otherSections: others.map(section),
    scenes: scenes.scenes,
    designSpec: spec.entries,
    otherSpecHeadings: spec.others,
    writingSpec: writing.spec,
    problems: sortProblems([
      ...problems,
      ...scenes.problems,
      ...spec.problems,
      ...writing.problems,
    ]),
  };
}
