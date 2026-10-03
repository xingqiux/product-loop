import { headingAt, type MainlineHeading, type SourceLine, sectionEnd, tablesIn } from "./lines.ts";
import { type DesignSpecItem, designSpecItem, designSpecItemOf, squash } from "./parts.ts";
import type { MainlineProblem } from "./problems.ts";

// 设计规范的十二样，见「09 skill 与软件」第三节：十二样各占一个三级标题，按标题认。
// 这个产品没有的一样，标题照写，内容写「无」和原因。
// 旧模板把十二样写成一张表，表头第一格是「职能」。按表格认不出十二样，只报成旧写法。

/**
 * 十二样里的一样。
 * - written：写了内容。
 * - none：写了「无」。reason 是「无」后面的原因，没写原因时是空的，另报 designSpecNoneReason。
 * - empty：有标题，下面是空的。
 * - missing：没有这一样的标题。
 */
export type DesignSpecEntry =
  | { readonly item: DesignSpecItem; readonly status: "missing" }
  | {
      readonly item: DesignSpecItem;
      readonly status: "written" | "empty";
      readonly heading: MainlineHeading;
    }
  | {
      readonly item: DesignSpecItem;
      readonly status: "none";
      readonly heading: MainlineHeading;
      readonly reason: string;
    };

/** 内容以「无」开头，后面是结尾、空白或标点。「无障碍」「无论」这类词不算。 */
const noneMark = /^「?无」?(?=$|[\s。，,：:；;、.（(])/u;

/** 内容写的是「无」时，返回后面的原因；不是时返回 undefined。 */
export function noneReason(body: string): string | undefined {
  const mark = noneMark.exec(body);
  if (mark === null) return undefined;
  const reason = body
    .slice(mark[0].length)
    .replace(/^[\s。，,：:；;、.]+/u, "")
    .trim();
  // 原因整个写在括号里的，去掉括号
  return /^[（(]([^（）()]*)[）)]$/u.exec(reason)?.[1]?.trim() ?? reason;
}

/** 十二样都没有：主线里没有设计规范这一节。 */
export const allMissing: readonly DesignSpecEntry[] = designSpecItem.keys.map((item) => ({
  item,
  status: "missing",
}));

/**
 * 解析设计规范这一节。heading 是这一节标题的下标，end 是这一节结束的下标（不含）。
 * 返回十二样，顺序和 designSpecItem 相同，另返回十二样以外的三级标题和查出的问题。
 */
export function parseDesignSpec(
  lines: readonly SourceLine[],
  heading: number,
  end: number,
): {
  readonly entries: readonly DesignSpecEntry[];
  readonly others: readonly MainlineHeading[];
  readonly problems: readonly MainlineProblem[];
} {
  const found = new Map<DesignSpecItem, number[]>();
  const others: MainlineHeading[] = [];
  for (let i = heading + 1; i < end; i++) {
    const title = lines[i]?.heading;
    if (title?.level !== 3) continue;
    const item = designSpecItemOf(title.text);
    if (item === undefined) others.push(headingAt(lines, i, sectionEnd(lines, i, 3)));
    else found.set(item, [...(found.get(item) ?? []), i]);
  }
  const problems: MainlineProblem[] = [];
  const entries = designSpecItem.keys.map((item): DesignSpecEntry => {
    const [first, ...more] = found.get(item) ?? [];
    if (first === undefined) return { item, status: "missing" };
    const to = sectionEnd(lines, first, 3);
    const head = headingAt(lines, first, to);
    if (more.length > 0) {
      const all = [first, ...more].map((i) => lines[i]?.n ?? i + 1);
      problems.push({ kind: "designSpecDuplicate", line: head.line, item, lines: all });
    }
    const body = lines
      .slice(first + 1, to)
      .map((line) => line.text)
      .join("\n")
      .trim();
    if (body === "") {
      problems.push({ kind: "designSpecEmpty", line: head.line, item });
      return { item, status: "empty", heading: head };
    }
    const reason = noneReason(body);
    if (reason === undefined) return { item, status: "written", heading: head };
    if (reason === "") problems.push({ kind: "designSpecNoneReason", line: head.line, item });
    return { item, status: "none", heading: head, reason };
  });
  for (const table of tablesIn(lines, heading + 1, end)) {
    if (squash(table.header[0] ?? "") === "职能") {
      problems.push({ kind: "designSpecTable", line: table.line });
    }
  }
  return { entries, others, problems };
}
