import { describe, expect, it } from "vitest";
import { backupNoticeHidden, showsBackupNotice } from "./backup-notice.ts";

describe("备份提示在哪些页显示", () => {
  it("首页和项目页的四个标签显示", () => {
    for (const path of ["/", "/p/app", "/p/app/", "/p/app/queue", "/p/app/mainline"]) {
      expect(showsBackupNotice(path), path).toBe(true);
    }
    expect(showsBackupNotice("/p/app/decisions")).toBe(true);
  });

  it("每个阶段的页面、skill 的问题、别的地址不显示", () => {
    for (const path of ["/p/app/r/v1-%E6%9E%84%E6%80%9D-1", "/skill", "/proof", "/p/app/other"]) {
      expect(showsBackupNotice(path), path).toBe(false);
    }
  });
});

describe("关掉以后七天内不再出现", () => {
  const day = 24 * 60 * 60 * 1000;
  const closedAt = Date.UTC(2026, 8, 29);

  it("没关过就显示", () => {
    expect(backupNoticeHidden(undefined, closedAt)).toBe(false);
  });

  it("关掉以后不满七天不显示，满了再显示", () => {
    expect(backupNoticeHidden(closedAt, closedAt + 6 * day + 23 * 60 * 60 * 1000)).toBe(true);
    expect(backupNoticeHidden(closedAt, closedAt + 7 * day)).toBe(false);
  });
});
