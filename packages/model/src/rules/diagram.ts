import { diagramCopy } from "../copy/diagram.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { DiagramKind } from "../page/fields.ts";
import type { PageSections } from "../page/sections.ts";
import { space, splitLines, strip } from "../writing/python.ts";
import { diagramEdgeRelationSamples } from "./diagram.samples.ts";
import { defineRule, type Rule, type RuleContextOf } from "./rule.ts";

// 图表的规则，见「07 校验」第四节的 check_diagrams。种类、标题和文字定义由数据定义查，见 page/fields.ts。
// 定义查不了的只有一条：架构图的每条线写明是什么关系（决定 113）。
// 照旧 build-report.py 的第 485 到 500 行移植，旧脚本认不出的写法照样放过，见 diagram.test.ts。
// 断行、空白和去掉两头的空白都按 Python 的做法，见 writing/python.ts。
// 旧脚本遇到第一处就停下。这里每条没写关系的线各报一处。

/** 这道检查加进构建校验的那一天，提交 3dc5318。逐条线判断在同一天的提交 6f8449a 改成现在的样子。 */
const edgeRelationAdded = "2026-09-21";

/** 页面数据里的一张图表，解析以后的样子。 */
type Diagram = { readonly kind: DiagramKind; readonly title: string; readonly code: string };

/** 卡上的图表，和共同的部分里的图表。 */
type CardDiagrams = {
  readonly diagrams?: readonly Diagram[] | undefined;
  readonly shared?: { readonly diagrams?: readonly Diagram[] | undefined } | undefined;
};

/** 一张图表和它在页面数据里的路径。 */
type PlacedDiagram = { readonly path: readonly (string | number)[]; readonly diagram: Diagram };

/** 能画图表的三种卡，顺序是区块在页面上的顺序。 */
const cardSections = ["asks", "findings", "improvements"] as const;

/**
 * 页面上的每一张图表，和旧脚本的 iter_diagrams 查的相同：先对齐的小卡，三种卡上的，
 * 以及卡上共同的部分里的。先对齐在前，一张卡里先卡上的，再共同的部分里的。
 */
export function pageDiagrams(page: PageSections): PlacedDiagram[] {
  const placed: PlacedDiagram[] = [];
  (page.align ?? []).forEach((term, i) => {
    if (term.diagram !== undefined) {
      placed.push({ path: ["align", i, "diagram"], diagram: term.diagram });
    }
  });
  for (const section of cardSections) {
    const cards: readonly CardDiagrams[] = page[section] ?? [];
    cards.forEach((card, i) => {
      (card.diagrams ?? []).forEach((diagram, j) => {
        placed.push({ path: [section, i, "diagrams", j], diagram });
      });
      (card.shared?.diagrams ?? []).forEach((diagram, j) => {
        placed.push({ path: [section, i, "shared", "diagrams", j], diagram });
      });
    });
  }
  return placed;
}

// 一条线：两个以上的短横或等号再加 >，或者短横、几个点、短横再加 >。后面可以紧跟 |关系|。
const edgePattern = /(--+>|==+>|-\.+->)(\|[^|]+\|)?/gu;
// 线前面这一段以「-- 关系」「== 关系」或「-. 关系」结尾。关系不以空白和线的符号开头，里面没有 >。
const relationBefore = new RegExp(`(--|==|-\\.)[${space}]*[^${space}\\-=.>|][^>]*$`, "u");

/**
 * 一行里没写明关系的线是第几条，从 1 数。逐条线判断：线后面跟着 |关系|，
 * 或者从上一条线到这一条线之间的一段以「-- 关系」结尾，就算写明了。
 */
export function unlabelledEdges(line: string): number[] {
  const orders: number[] = [];
  let from = 0;
  let order = 0;
  for (const match of line.matchAll(edgePattern)) {
    order += 1;
    const before = line.slice(from, match.index);
    from = match.index + match[0].length;
    if (match[2] === undefined && !relationBefore.test(before)) orders.push(order);
  }
  return orders;
}

/** 规则 diagram.edge.relation：架构图里没写明关系的每一条线报一处，位置写到这张图的 code。 */
export const diagramEdgeRelation = defineRule({
  id: "diagram.edge.relation",
  level: "block",
  scope: {
    subjects: ["page"],
    sections: ["align", "asks", "findings", "improvements"],
    commands: ["page check", "page present"],
  },
  since: edgeRelationAdded,
  needs: [],
  about: rulesCopy.about.diagram.edge.relation,
  copy: diagramCopy.edge.relation,
  check: (page: PageSections) =>
    pageDiagrams(page)
      .filter(({ diagram }) => diagram.kind === "architecture")
      .flatMap(({ path, diagram }) =>
        splitLines(diagram.code).flatMap((line, i) =>
          unlabelledEdges(line).map((order) => ({
            where: [...path, "code"],
            params: { title: diagram.title, row: i + 1, order, text: strip(line) },
          })),
        ),
      ),
  samples: diagramEdgeRelationSamples,
});

/** 图表的规则，登记在 registry.ts。 */
export const diagramRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  diagramEdgeRelation,
];
