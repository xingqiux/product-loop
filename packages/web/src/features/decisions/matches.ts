// 决定页的搜索：一个词也不写就全部列出，写了几个词，每个词都要在这条决定里出现。

type Searchable = {
  readonly id: number;
  readonly decision: string;
  readonly reason: string;
  readonly case: string;
};

/** 搜索的词按空白分开，每个词都要在编号、决定、原因或案例里出现。不分大小写。 */
export function matches(decision: Searchable, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const text =
    `${decision.id} ${decision.decision} ${decision.reason} ${decision.case}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
