// 备份的提示：只在首页和项目页顶上显示，用户可以关掉，七天内不再出现。
// 用户正在回复一页时，不拿备份的事打扰他。连不上后端的提示不在这里，它要一直显示。

const dayMs = 24 * 60 * 60 * 1000;

/** 关掉以后隔多久再出现。 */
const dismissDays = 7;

/** 首页和项目页（概览、队列、主线、决定）显示，每个阶段的页面和 skill 的问题页不显示。 */
export function showsBackupNotice(pathname: string): boolean {
  if (pathname === "/") return true;
  return /^\/p\/[^/]+(?:\/(?:queue|mainline|decisions))?\/?$/u.test(pathname);
}

/** 关掉的时间还没过七天，就不显示。 */
export function backupNoticeHidden(dismissedAt: number | undefined, now: number): boolean {
  return dismissedAt !== undefined && now - dismissedAt < dismissDays * dayMs;
}
