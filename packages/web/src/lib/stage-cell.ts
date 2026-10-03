// 一个阶段做过很多次时，格子里的方块怎么摆：最近几次画成方块，其余在别处点开看。
// 同一种符号同一种颜色的方块摞成一片（真实项目里一格 31 个，200 多像素高），有用的只有次数，
// 所以最多摆五个。项目页的进度格子和阶段页页头的阶段条用同一个规矩。

/** 一格里最多摆几个方块。 */
const shownMarks = 5;

export function stageCellOf<T>(
  rounds: readonly T[],
  /** 正在看的那一次：不在最近五次里也要画出来，条上得看得出自己在哪。 */
  current?: (round: T) => boolean,
): {
  /** 画成方块的：最近的几次，顺序不变。 */
  readonly shown: readonly T[];
  /** 有没画出来的，次数要写成能点开的「全部 N 次」。 */
  readonly many: boolean;
  /** 方块下面写的次数。 */
  readonly countText: string;
} {
  const many = rounds.length > shownMarks;
  const recent = rounds.slice(-shownMarks);
  const here = current === undefined ? undefined : rounds.find(current);
  const shown =
    many && here !== undefined && !recent.includes(here) ? [here, ...recent.slice(1)] : recent;
  return {
    shown,
    many,
    countText: many ? `全部 ${rounds.length} 次` : `${rounds.length} 次`,
  };
}
