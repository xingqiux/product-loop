// 看板小卡的样子。项目页的队列看板和阶段页的队列屏用同一套。

/** 状态词的颜色。待办是常态，不写词，见 showsStatus。 */
export const statusTone = new Map<string, string>([
  ["进行中", "text-brand-secondary"],
  ["等待", "text-warning-primary"],
]);

/** 待办占绝大多数，每张都写一遍等于没有信息；只写偏离常态的。 */
export function showsStatus(status: string): boolean {
  return status !== "待办";
}

/**
 * 小卡的底和框。停了七天的淡一些：底去掉白色和阴影，框的线减半，字保持原色，
 * 不然次要的字叠上不透明度以后对比度不够（低于 4.5 比 1）。
 */
export function cardSurface(stale: boolean): string {
  return stale
    ? "bg-transparent ring-1 ring-secondary/50 hover:ring-fg-quaternary"
    : "bg-primary shadow-xs ring-1 ring-secondary hover:ring-fg-quaternary";
}
