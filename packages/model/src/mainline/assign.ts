import { formatSceneId } from "../ids.ts";
import { lineBreak, scanLines, sectionEnd } from "./lines.ts";
import { findParts } from "./parse.ts";
import { findSceneHeads, type SceneHead } from "./scenes.ts";

// 给没写编号的场景补上编号。编号由命令在场景第一次出现时补上，此后不变。
// 依据是「09 skill 与软件」第三节和「03 数据模型」第二节。
// 命令把主线交给后端，后端补上编号，命令再把补好的全文写回项目缓存的主线.md。
// 体检迁移旧主线时，也用它补上场景编号。
// 这是纯粹的文字替换：只改要补编号的场景的标题行，别的字节都不动，行数也不变。

/** 补上的一个编号。line 是场景标题所在的行，补编号前后相同。 */
export type SceneIdAssignment = {
  readonly id: number;
  readonly name: string;
  readonly line: number;
};

export type SceneIdsAssigned = {
  /** 补好编号的全文。没有要补的场景时和原文相同。 */
  readonly text: string;
  /** 补上的编号，按场景在主线里的先后。 */
  readonly assigned: readonly SceneIdAssignment[];
};

/** 三级标题开头的 # 和后面的空白。 */
const headingMarker = /^ {0,3}###[ \t]+/u;

/**
 * 给场景清单里没写编号的场景补上编号。
 * maxKnownId 是这个项目用过的最大的场景编号，包括已经删掉的场景，所以删掉的编号不会再用。
 * 新编号从它和主线里已写的编号中较大的一个往后数。已写的编号一律不改，写错的也不改。
 * 不补编号的场景有三种：标题开头的编号写错了、没有名字、没有步骤。它们由解析报成问题。
 * 旧写法的场景，整个标题行改成新的写法，例如「场景「回答疑问」：」改成「### S1 回答疑问」。
 */
export function assignSceneIds(markdown: string, maxKnownId = 0): SceneIdsAssigned {
  const lines = scanLines(markdown);
  const at = findParts(lines).found.get("scenes")?.[0];
  if (at === undefined) return { text: markdown, assigned: [] };
  const heads = findSceneHeads(lines, at + 1, sectionEnd(lines, at, 2));
  let next = Math.max(maxKnownId, ...heads.map((head) => head.title.id ?? 0)) + 1;
  const pieces = splitKeepingEnds(markdown);
  const assigned: SceneIdAssignment[] = [];
  for (const head of heads) {
    const { title } = head;
    const eligible =
      title.id === undefined &&
      title.invalidId === undefined &&
      title.name !== "" &&
      head.stepCount > 0;
    const piece = pieces[head.index];
    if (!eligible || piece === undefined) continue;
    const id = next++;
    piece.content = rewrite(head, piece.content, id);
    assigned.push({ id, name: title.name, line: head.index + 1 });
  }
  if (assigned.length === 0) return { text: markdown, assigned };
  return { text: pieces.map((piece) => piece.content + piece.end).join(""), assigned };
}

/** 补上编号以后的标题行。 */
function rewrite(head: SceneHead, content: string, id: number): string {
  const { name, note, legacy } = head.title;
  const title = `${formatSceneId(id)} ${name}${note === undefined ? "" : `（${note}）`}`;
  if (head.form === "line") return `### ${title}`;
  const marker = headingMarker.exec(content)?.[0] ?? "### ";
  // 新写法只在名字前面插进编号，标题里别的字原样保留
  return legacy
    ? `${marker}${title}`
    : `${marker}${formatSceneId(id)} ${content.slice(marker.length)}`;
}

/** 按行切开，记下每一行原来的换行符，拼回去时逐字节相同。行的下标和 scanLines 的一致。 */
function splitKeepingEnds(text: string): { content: string; readonly end: string }[] {
  const pieces: { content: string; readonly end: string }[] = [];
  let start = 0;
  for (const m of text.matchAll(new RegExp(lineBreak.source, "gu"))) {
    pieces.push({ content: text.slice(start, m.index), end: m[0] });
    start = m.index + m[0].length;
  }
  pieces.push({ content: text.slice(start), end: "" });
  return pieces;
}
