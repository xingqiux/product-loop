import { allCopy, checkWriting, flattenCopy, renderCopy } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { nodeCopy } from "./copy.ts";

// 并进共用定义的文案表以前，先在这里做那边对每条文案做的检查，包括写作校验。

const items = flattenCopy("clientNode", nodeCopy);

describe("Node 入口的文案", () => {
  it("每条文案用样例渲染以后，写作校验没有拦截", () => {
    const blocked = items.flatMap(({ key, entry }) =>
      checkWriting(renderCopy(entry, entry.sample)).block.map((x) => `${key}：${x.message}`),
    );
    expect(blocked).toEqual([]);
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

  it("键和共用定义文案表里的不重复", () => {
    const taken = new Set(allCopy().map((item) => item.key));
    expect(items.filter(({ key }) => taken.has(key)).map((item) => item.key)).toEqual([]);
  });
});
