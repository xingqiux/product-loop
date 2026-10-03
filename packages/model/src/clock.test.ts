import { describe, expect, it } from "vitest";
import { beijingDay, beijingMinute, beijingSecond, localDate, localMinute } from "./clock.ts";

describe("北京时间", () => {
  it("UTC 下午四点以后已是北京的第二天", () => {
    const at = new Date("2026-09-28T16:05:01Z");
    expect(beijingDay(at)).toBe("2026-09-29");
    expect(beijingMinute(at)).toBe("2026-09-29 00:05");
    expect(beijingSecond(at)).toBe("2026-09-29 00:05:01");
  });

  it("UTC 下午四点以前仍是同一天", () => {
    expect(beijingMinute(new Date("2026-09-28T15:59:00Z"))).toBe("2026-09-28 23:59");
  });

  it("跨年和跨月都对", () => {
    expect(beijingDay(new Date("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
    expect(beijingDay(new Date("2026-02-28T16:00:00Z"))).toBe("2026-03-01");
  });
});

describe("本机时区", () => {
  const at = new Date("2026-09-28T16:05:01Z");

  it("同一个时刻在不同时区写出各自的日期和分钟", () => {
    expect(localMinute(at, "Asia/Shanghai")).toBe("2026-09-29 00:05");
    expect(localMinute(at, "America/Los_Angeles")).toBe("2026-09-28 09:05");
    expect(localMinute(at, "UTC")).toBe("2026-09-28 16:05");
    expect(localDate(at, "Asia/Shanghai")).toBe("2026-09-29");
    expect(localDate(at, "America/Los_Angeles")).toBe("2026-09-28");
  });

  it("午夜写 00 点，不写 24 点", () => {
    expect(localMinute(new Date("2026-09-28T16:00:00Z"), "Asia/Shanghai")).toBe("2026-09-29 00:00");
  });

  it("不写时区就是本机的时区", () => {
    const local = new Date("2026-03-01T13:07:00");
    expect(localMinute(local)).toBe("2026-03-01 13:07");
    expect(localDate(local)).toBe("2026-03-01");
  });
});
