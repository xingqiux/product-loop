import { describe, expect, it } from "vitest";
import { revisionDay, revisionMinute } from "./revision.ts";

const inRound = { revision: 3, createdAt: "2026-09-29T02:55:00.000Z", round: "v2-落地-1" };
const between = { revision: 2, createdAt: "2026-09-28T16:30:00.000Z", round: null };

describe("主线的修订对用户怎么写", () => {
  it("目录里写修订、北京时间的日期和阶段", () => {
    expect(revisionDay(inRound)).toBe("修订 3，2026-09-29，第 2 版的落地阶段");
  });

  it("两个阶段之间交的，不写阶段，也不写「两轮之间」", () => {
    expect(revisionDay(between)).toBe("修订 2，2026-09-29");
    expect(revisionMinute(between)).toBe("修订 2，2026-09-29 00:30");
  });

  it("下拉里日期精确到分", () => {
    expect(revisionMinute(inRound)).toBe("修订 3，2026-09-29 10:55，第 2 版的落地阶段");
  });

  it("不出现「版」字开头的写法和 v2- 这类内部写法", () => {
    for (const text of [revisionDay(inRound), revisionMinute(inRound), revisionDay(between)]) {
      expect(text).not.toMatch(/^第 \d+ 版，|v\d+-|两轮/u);
    }
  });
});
