import { describe, expect, it } from "vitest";
import { busyLimitMs, busyWaitMs, retryAfterMs } from "./busy.ts";

// Retry-After 的两种写法，和六十秒的上限。

const now = Date.parse("2026-09-28T03:00:00Z");

describe("Retry-After 要等多久", () => {
  it.each([
    ["1", 1_000],
    ["30", 30_000],
    [" 5 ", 5_000],
    ["0", 100],
  ])("写秒数 %j 时等 %i 毫秒，至少等一百毫秒", (value, ms) => {
    expect(retryAfterMs(value, now)).toBe(ms);
  });

  it("写 HTTP 日期时等到那个时间，日期已过时等一百毫秒", () => {
    expect(retryAfterMs(new Date(now + 9_000).toUTCString(), now)).toBe(9_000);
    expect(retryAfterMs("Monday, 28-Sep-26 03:00:09 GMT", now)).toBe(9_000);
    expect(retryAfterMs(new Date(now - 9_000).toUTCString(), now)).toBe(100);
  });

  it.each([null, "", "明天", "-3", "1.5"])("没写或写得不对时等一秒：%j", (value) => {
    expect(retryAfterMs(value, now)).toBe(1_000);
  });
});

describe("六十秒的上限", () => {
  it("从第一次收到 BUSY 算起，照 Retry-After 等", () => {
    expect(busyWaitMs(now, now, "2")).toBe(2_000);
    expect(busyWaitMs(now, now + 30_000, "2")).toBe(2_000);
  });

  it("最后一次只等到六十秒为止，用完以后不再等", () => {
    expect(busyWaitMs(now, now + 55_000, "10")).toBe(5_000);
    expect(busyWaitMs(now, now + busyLimitMs, "1")).toBeUndefined();
    expect(busyWaitMs(now, now + busyLimitMs + 1, "1")).toBeUndefined();
  });
});
