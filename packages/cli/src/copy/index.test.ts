import { allCopy, checkWriting, renderCopy } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { allCliCopy } from "./index.ts";

const items = allCliCopy();

describe("命令行的文案", () => {
  it("键不重复，也不和共用定义的文案重名", () => {
    const keys = [...items, ...allCopy()].map((item) => item.key);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it("键是英文的几段，用点连起来，都以 cli 开头", () => {
    for (const { key } of items) expect(key).toMatch(/^cli(\.[A-Za-z][A-Za-z0-9_]*)+$/u);
  });

  it("每条用样例渲染以后，写作校验没有拦截", () => {
    const blocked = items.flatMap(({ key, entry }) =>
      checkWriting(renderCopy(entry, entry.sample)).block.map((x) => `${key}：${x.message}`),
    );
    expect(blocked).toEqual([]);
  });

  it("每条都有文字", () => {
    expect(items.filter(({ entry }) => entry.text.trim() === "").map((item) => item.key)).toEqual(
      [],
    );
  });

  it("每条样例渲染以后没有残留的 {…}", () => {
    const leftovers = items
      .filter(({ entry }) => /[{}]/u.test(renderCopy(entry, entry.sample)))
      .map((item) => item.key);
    expect(leftovers).toEqual([]);
  });

  it("每条的样例正好给了文字里的每个参数，不多也不少", () => {
    const mismatched = items
      .filter(({ entry }) => {
        const names = [...entry.text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((m) => m[1]);
        const wanted = [...new Set(names)].sort();
        return JSON.stringify(Object.keys(entry.sample).sort()) !== JSON.stringify(wanted);
      })
      .map((item) => item.key);
    expect(mismatched).toEqual([]);
  });
});
