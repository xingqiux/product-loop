import { describe, expect, it } from "vitest";
import { titleOf } from "./document-title.ts";

describe("标签页的标题", () => {
  it("前面写项目和页，后面是产品循环；没有内容的段跳过", () => {
    expect(titleOf(["product-loop", "第 2 版的落地阶段"])).toBe(
      "product-loop 第 2 版的落地阶段 - 产品循环",
    );
    expect(titleOf(["product-loop", undefined])).toBe("product-loop - 产品循环");
    expect(titleOf([])).toBe("产品循环");
    expect(titleOf([undefined, ""])).toBe("产品循环");
  });
});
