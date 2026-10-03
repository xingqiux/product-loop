import { describe, expect, it } from "vitest";
import { noticeView } from "./notice.tsx";

// 读不到时的显示：连不上本机服务只写一句，不写英文码；正在读取时断了线，也写连不上。

describe("这一处该写什么", () => {
  it("出错但不是连不上，也没有后端的原因：照调用的一方写的话", () => {
    expect(noticeView("error", undefined, false)).toEqual({ lost: false, reason: undefined });
  });

  it("出错和空的状态不看连接，只有加载才看", () => {
    expect(noticeView("error", undefined, true).lost).toBe(false);
    expect(noticeView("empty", undefined, true).lost).toBe(false);
  });

  it("加载时断了线，写连不上本机服务，不再写正在读取", () => {
    expect(noticeView("loading", undefined, true).lost).toBe(true);
    expect(noticeView("loading", undefined, false).lost).toBe(false);
  });
});
