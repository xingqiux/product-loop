import { describe, expect, it } from "vitest";
import { sinceText } from "./time.ts";

// 北京时间 2026-09-29 10:00。
const now = new Date("2026-09-29T02:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

describe("离现在多久", () => {
  it.each([
    [30_000, "刚才"],
    [12 * 60_000, "12 分钟前"],
    [2 * 3_600_000, "2 小时前"],
    [(11 * 60 + 20) * 60_000, "昨天 22:40"],
    [3 * 86_400_000, "3 天前"],
    [45 * 86_400_000, "2026-08-15"],
  ])("%i 毫秒以前写成 %s", (ms, text) => {
    expect(sinceText(ago(ms), now)).toBe(text);
  });
});
