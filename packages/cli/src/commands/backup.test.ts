import { beijingMinute } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { snapshotTime } from "./backup.ts";

// backup list 里每份快照写明是什么时候的，见审查报告 P24。

describe("快照的时间", () => {
  it("每日快照的名字里只有日期，原样写日期", () => {
    expect(snapshotTime("2026-09-28")).toBe("2026-09-28");
  });

  it("其余快照的名字里是 UTC 时间，换成本机时区写到分钟", () => {
    expect(snapshotTime("20260928T080500123Z")).toBe(
      beijingMinute(new Date("2026-09-28T08:05:00.123Z")),
    );
  });

  it("认不出的写法原样交回，不吞掉", () => {
    expect(snapshotTime("昨天")).toBe("昨天");
  });
});
