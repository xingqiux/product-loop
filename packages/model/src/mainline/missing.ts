import type { MainlineParse } from "./parse.ts";
import type { DesignSpecItem, MainlinePart } from "./parts.ts";

// 主线缺哪几样：状态、开始一轮、检查主线和查看主线的一版都用这一处，不各算各的。

/** 主线缺的几样。 */
export type MainlineMissing = {
  /**
   * 十样里缺的，按十样的顺序。没写这一样的二级标题，或者标题下面是空的，都算缺。
   * 设计规范的十二样都缺时，设计规范这一样也算缺。
   */
  readonly parts: readonly MainlinePart[];
  /**
   * 设计规范十二样里缺的，按十二样的顺序。没写这一样的三级标题，或者标题下面是空的，都算缺。
   * 写了「无」的不算缺，没写原因由解析结果的问题另报。
   */
  readonly designSpec: readonly DesignSpecItem[];
};

/** 从解析结果算出缺哪几样。 */
export function missingOfParse(
  parsed: Pick<MainlineParse, "parts" | "designSpec">,
): MainlineMissing {
  const designSpec = parsed.designSpec.flatMap((entry) =>
    entry.status === "missing" || entry.status === "empty" ? [entry.item] : [],
  );
  // 设计规范下面只有十二样的空标题时，这一样也算缺，例如 ploop init 写的模板。
  const specEmpty = designSpec.length === parsed.designSpec.length;
  return {
    parts: parsed.parts.flatMap((entry) =>
      entry.present &&
      entry.heading.endLine > entry.heading.line &&
      !(entry.part === "designSpec" && specEmpty)
        ? []
        : [entry.part],
    ),
    designSpec,
  };
}
