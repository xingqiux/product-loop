// 队列里一个阶段有几件：首页、项目页概览、阶段页的阶段条、看板的列头，四处同一种算法。
// 算法是待办、进行中、等待三种状态的合计，后端的 queueCounts 就是这样数的。
// 看板把等待的事放在上面一块，列头只有这一列自己的，所以列头要写清另有几件在上面等着，
// 两个数加起来就是别处写的那一个（决定 208 之后，队列数不能两处不一样）。

/** 上面等待区里、属于这个阶段的有几件。 */
export function waitingIn(waiting: readonly { readonly stage: string }[], stage: string): number {
  return waiting.filter((item) => item.stage === stage).length;
}

/** 看板列头：这一列自己的件数，另有几件在上面等待。零也写 0，和别处一样。 */
export function columnHead(own: number, waiting: number): string {
  return waiting === 0 ? String(own) : `${own}，另有 ${waiting} 件等待`;
}
