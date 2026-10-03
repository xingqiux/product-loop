import { describe, expect, it } from "vitest";
import { parseSearch, stringifySearch } from "./search.ts";

describe("查询参数只按字符串读写", () => {
  it("数字和布尔的样子也读成字符串", () => {
    expect(parseSearch("?item=3&open=true")).toEqual({ item: "3", open: "true" });
  });

  it("中文和空格来回不变", () => {
    const search = { item: "Q-1", field: "我的 看法" };
    expect(parseSearch(stringifySearch(search))).toEqual(search);
  });

  it("空的和不是字符串的值不写", () => {
    expect(stringifySearch({ item: "", page: undefined, n: 3 })).toBe("");
    expect(stringifySearch({ item: "F-2" })).toBe("?item=F-2");
  });
});
