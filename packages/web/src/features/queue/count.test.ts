import { describe, expect, it } from "vitest";
import { columnHead, waitingIn } from "./count.ts";

// 落地阶段共 11 件：看板列里 10 件，上面等待区里 1 件。首页、概览、阶段条写 11，列头写「10，另有 1 件等待」。

describe("看板列头", () => {
  const waiting = [{ stage: "落地" }, { stage: "检查" }, { stage: "落地" }];

  it("数上面等待区里属于这个阶段的", () => {
    expect(waitingIn(waiting, "落地")).toBe(2);
    expect(waitingIn(waiting, "构思")).toBe(0);
  });

  it("没有在等的，只写这一列的件数", () => {
    expect(columnHead(10, 0)).toBe("10");
  });

  it("有在等的，写另有几件，两个数加起来是别处写的那一个", () => {
    expect(columnHead(10, 1)).toBe("10，另有 1 件等待");
  });

  it("零也写", () => {
    expect(columnHead(0, 0)).toBe("0");
  });
});
