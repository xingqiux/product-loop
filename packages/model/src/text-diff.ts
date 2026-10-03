// 文字的逐行对比：把改前、改后的原文算成逐行的对照，工作台只负责上色。
// 从旧 skill 的 build-report.py 里的 text_diff 移植，不引入库，见「02 技术选型」第十八节。
// 输出要和旧脚本逐字节相同。对照数据由 tools/legacy/export_diff.py 导出。

/** 一段字的种类：没变、删掉、加上。 */
export type TextDiffPartKind = "same" | "del" | "ins";

/** 一行里的一段字，写成 [种类, 原文]。 */
export type TextDiffPart = readonly [kind: TextDiffPartKind, text: string];

/**
 * 一行的种类。
 * - same、del、ins：没变、删掉、加上的整行。
 * - mix：改了一部分的行，行内分段标出删的字和加的字。
 * - gap：折起来的一段没有变化的行，parts 是空的。
 */
export type TextDiffRowKind = TextDiffPartKind | "mix" | "gap";

export type TextDiffRow = {
  readonly k: TextDiffRowKind;
  readonly parts: readonly TextDiffPart[];
};

/**
 * 算出逐行对比。没有变化的长段折成一行 gap，改动前后各留 context 行，context 取整数。
 * 两边完全相同时，结果只有一行 gap。一边是空文字时，它算作一个空行。
 */
export function textDiff(before: string, after: string, context = 2): TextDiffRow[] {
  const a = stripNewlines(before).split("\n");
  const b = stripNewlines(after).split("\n");
  const rows: TextDiffRow[] = [];
  for (const [tag, i1, i2, j1, j2] of opcodes(a, b)) {
    if (tag === "equal") {
      for (const x of a.slice(i1, i2)) rows.push({ k: "same", parts: [["same", x]] });
      continue;
    }
    rows.push(...pairLines(a.slice(i1, i2), b.slice(j1, j2)));
  }
  return fold(rows, context);
}

/**
 * 一段改动里，删掉的每一行去找加上的行里最像的一行，配成 mix。
 * 相似度要高于 0.3，一样高时取靠前的一行。配上的那一行之前还没配过的行，先作为加上的行排出来。
 * 最后剩下没配上的行排在末尾。
 */
function pairLines(olds: readonly string[], news: readonly string[]): TextDiffRow[] {
  const rows: TextDiffRow[] = [];
  const newChars = news.map((y) => Array.from(y));
  const used = new Set<number>();
  for (const x of olds) {
    const xChars = Array.from(x);
    let best: { readonly k: number; readonly chars: readonly string[] } | undefined;
    let score = 0.3;
    for (const [k, chars] of newChars.entries()) {
      if (used.has(k)) continue;
      const r = ratio(xChars, chars);
      if (r > score) {
        best = { k, chars };
        score = r;
      }
    }
    if (best === undefined) {
      rows.push({ k: "del", parts: [["del", x]] });
      continue;
    }
    for (const [k, y] of news.slice(0, best.k).entries()) {
      if (used.has(k)) continue;
      used.add(k);
      rows.push({ k: "ins", parts: [["ins", y]] });
    }
    used.add(best.k);
    rows.push({ k: "mix", parts: lineParts(xChars, best.chars) });
  }
  for (const [k, y] of news.entries()) {
    if (!used.has(k)) rows.push({ k: "ins", parts: [["ins", y]] });
  }
  return rows;
}

/** 配成一对的两行逐字比较，删的和加的分段标出。 */
function lineParts(x: readonly string[], y: readonly string[]): TextDiffPart[] {
  const parts: TextDiffPart[] = [];
  for (const [tag, p1, p2, q1, q2] of opcodes(x, y)) {
    if (tag === "equal") {
      parts.push(["same", x.slice(p1, p2).join("")]);
      continue;
    }
    if (p2 > p1) parts.push(["del", x.slice(p1, p2).join("")]);
    if (q2 > q1) parts.push(["ins", y.slice(q1, q2).join("")]);
  }
  return parts;
}

/**
 * 有改动的行前后各留 context 行，其余连续的一段折成一行 gap。
 * 紧跟在留下的范围后面的一行如果只有空白，也留下。只看它前一行是否在范围内，所以最多多留一行。
 */
function fold(rows: readonly TextDiffRow[], context: number): TextDiffRow[] {
  const keep = rows.map(() => false);
  for (const [i, row] of rows.entries()) {
    if (row.k === "same") continue;
    const end = Math.min(rows.length, i + context + 1);
    for (let k = Math.max(0, i - context); k < end; k++) keep[k] = true;
  }
  const out: TextDiffRow[] = [];
  let gap = false;
  for (const [i, row] of rows.entries()) {
    // 走到后半个条件的只有 same 行，它总有一段字
    const first = row.parts[0];
    if (keep[i] || (first !== undefined && isBlank(first[1]) && i > 0 && keep[i - 1])) {
      out.push(row);
      gap = false;
    } else if (!gap) {
      out.push({ k: "gap", parts: [] });
      gap = true;
    }
  }
  return out;
}

/** 对应 Python 的 strip("\n")：只去掉两头的换行符，回车留在行尾。 */
function stripNewlines(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "\n") start++;
  while (end > start && text[end - 1] === "\n") end--;
  return text.slice(start, end);
}

// Python 的 str.strip() 去掉的空白，按码位列出，和 str.isspace() 相同。
// 和 JS 的 trim() 不同：多了 0x1c 到 0x1f 和 0x85，少了 0xfeff。
const pythonSpaces = new Set(
  [
    0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
    0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
    0x205f, 0x3000,
  ].map((c) => String.fromCodePoint(c)),
);

/** 对应 Python 的 not text.strip()：空的，或者只有空白。 */
function isBlank(text: string): boolean {
  for (const c of text) if (!pythonSpaces.has(c)) return false;
  return true;
}

// 下面三个函数按 Python 的 difflib.SequenceMatcher 移植，只移植旧脚本用到的情形：
// 不设垃圾元素，并且 autojunk=False，出现次数多的元素也不当作垃圾。
// 这时 find_longest_match 最后向两头延伸的四步不会延长匹配，所以没有移植。
// 序列的一项是一行或一个字符。字符按码位拆开，和 Python 一致，一个表情不会被拆成两半。

type Block = readonly [i: number, j: number, size: number];
type Opcode = readonly [
  tag: "replace" | "delete" | "insert" | "equal",
  i1: number,
  i2: number,
  j1: number,
  j2: number,
];

/** 对应 get_matching_blocks：按顺序排好的匹配段，最后一段是 [a 的长度, b 的长度, 0]。 */
function matchingBlocks(a: readonly string[], b: readonly string[]): Block[] {
  const b2j = new Map<string, number[]>();
  for (const [j, x] of b.entries()) {
    const list = b2j.get(x);
    if (list) list.push(j);
    else b2j.set(x, [j]);
  }

  // 对应 find_longest_match：最长的匹配段。一样长时取在 a 里靠前的，再取在 b 里靠前的
  const longest = (alo: number, ahi: number, blo: number, bhi: number): Block => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    // j2len 的键是 b 里的位置 j，值是以 a[i - 1] 和 b[j] 结尾的最长匹配的长度
    let j2len = new Map<number, number>();
    for (const [offset, x] of a.slice(alo, ahi).entries()) {
      const i = alo + offset;
      const next = new Map<number, number>();
      for (const j of b2j.get(x) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = next;
    }
    return [besti, bestj, bestsize];
  };

  const found: Block[] = [];
  const queue: (readonly [number, number, number, number])[] = [[0, a.length, 0, b.length]];
  for (let range = queue.pop(); range !== undefined; range = queue.pop()) {
    const [alo, ahi, blo, bhi] = range;
    const block = longest(alo, ahi, blo, bhi);
    const [i, j, k] = block;
    if (k === 0) continue;
    found.push(block);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  found.sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);

  // 首尾相接的两段合成一段。没有垃圾元素时找出的段不会相接，保留这一步是为了和 Python 逐段对应
  const blocks: Block[] = [];
  let [i1, j1, k1] = [0, 0, 0];
  for (const [i2, j2, k2] of found) {
    if (i1 + k1 === i2 && j1 + k1 === j2) {
      k1 += k2;
      continue;
    }
    if (k1) blocks.push([i1, j1, k1]);
    [i1, j1, k1] = [i2, j2, k2];
  }
  if (k1) blocks.push([i1, j1, k1]);
  blocks.push([a.length, b.length, 0]);
  return blocks;
}

/** 对应 get_opcodes：把 a 改成 b 的每一步。 */
function opcodes(a: readonly string[], b: readonly string[]): Opcode[] {
  const answer: Opcode[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj, size] of matchingBlocks(a, b)) {
    if (i < ai && j < bj) answer.push(["replace", i, ai, j, bj]);
    else if (i < ai) answer.push(["delete", i, ai, j, bj]);
    else if (j < bj) answer.push(["insert", i, ai, j, bj]);
    i = ai + size;
    j = bj + size;
    if (size) answer.push(["equal", ai, i, bj, j]);
  }
  return answer;
}

/** 对应 ratio：2 × 匹配的项数 ÷ 两边的总项数，两边都空时是 1。计算顺序和 Python 相同，浮点结果一致。 */
function ratio(a: readonly string[], b: readonly string[]): number {
  let matches = 0;
  for (const [, , size] of matchingBlocks(a, b)) matches += size;
  const length = a.length + b.length;
  return length ? (2 * matches) / length : 1;
}
