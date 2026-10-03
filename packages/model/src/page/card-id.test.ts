import { describe, expect, it } from "vitest";
import { cardIdFromTitle, fnv1a32, isCardId, normalizeTitle } from "./card-id.ts";

// 期望的哈希值另用 Python 按同一个算法算出：
// h = 0x811c9dc5；对 UTF-8 的每个字节 h ^= b，h = h * 0x01000193 取低 32 位。

describe("FNV-1a 哈希", () => {
  it.each([
    ["", 0x811c9dc5],
    ["a", 0xe40c292c],
    ["foobar", 0xbf9cf968],
  ])("公开的测试值：%j", (text, hash) => {
    expect(fnv1a32(text)).toBe(hash);
  });

  it.each([
    ["中", 0xb846d3f4],
    ["😀", 0x33a29608],
    ["队列看板放在哪里", 0x9b40f1ee],
  ])("按 UTF-8 的字节算：%j", (text, hash) => {
    expect(fnv1a32(text)).toBe(hash);
  });

  it("单独出现的代理项按 U+FFFD 算", () => {
    expect(fnv1a32("\ud800")).toBe(fnv1a32("�"));
    expect(fnv1a32("�")).toBe(0x03479c4a);
  });

  it("结果是 32 位的无符号整数", () => {
    for (const text of ["", "a", "中文标题", "x".repeat(1000)]) {
      const hash = fnv1a32(text);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThan(2 ** 32);
    }
  });
});

describe("按标题生成的编号", () => {
  it.each([
    ["ask", "队列看板放在哪里", "ask-172sage"],
    ["change", "选项多一格适用场景", "change-11x9pdc"],
    ["scene", "看队列", "scene-0pkbvuj"],
    ["align", "信息结构", "align-18dwr6e"],
  ])("%s「%s」得到 %s，任何时候都一样", (prefix, title, id) => {
    expect(cardIdFromTitle(prefix, title)).toBe(id);
  });

  it("生成的编号合乎编号的写法", () => {
    for (const prefix of ["ask", "finding", "improvement", "change", "scene", "spec", "align"]) {
      for (const title of ["", "a", "队列看板放在哪里", "😀"]) {
        expect(isCardId(cardIdFromTitle(prefix, title))).toBe(true);
        expect(isCardId(`${cardIdFromTitle(prefix, title)}-12`)).toBe(true);
      }
    }
  });

  it("前缀不同，编号就不同", () => {
    expect(cardIdFromTitle("ask", "看队列")).not.toBe(cardIdFromTitle("change", "看队列"));
  });

  it("首尾空白、连着的空白、组合字符的写法不影响编号", () => {
    const id = cardIdFromTitle("ask", "队列 看板");
    expect(cardIdFromTitle("ask", "  队列   看板\n")).toBe(id);
    expect(cardIdFromTitle("ask", "队列\t看板")).toBe(id);
    expect(cardIdFromTitle("ask", "café")).toBe(cardIdFromTitle("ask", "café"));
  });

  it("标题改了一个字，编号就变", () => {
    expect(cardIdFromTitle("ask", "队列看板放在哪里")).not.toBe(
      cardIdFromTitle("ask", "队列看板放在哪儿"),
    );
  });

  it("规整标题", () => {
    expect(normalizeTitle("  a \n\t b  ")).toBe("a b");
  });
});

describe("编号的写法", () => {
  it.each(["spec-twelve", "ask-172sage", "a", "q12-v2", "improvement-0abc123-2"])("收 %j", (id) => {
    expect(isCardId(id)).toBe(true);
  });

  it.each(["", "Spec", "12-a", "a--b", "a-", "-a", "a_b", "a b", "卡片", `a${"b".repeat(48)}`])(
    "拒绝 %j",
    (id) => {
      expect(isCardId(id)).toBe(false);
    },
  );
});
