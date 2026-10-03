import { flattenCopy, renderCopy } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { backupCopy } from "./backup.ts";

// 并进 model 的文案表以前，先在这里做 model 那边对每条文案做的检查。

const items = flattenCopy("backup", backupCopy);

describe("备份的文案", () => {
  it("每条都有 message 和 hint", () => {
    const keys = items.map((item) => item.key);
    expect(keys.filter((key) => !/\.(message|hint)$/u.test(key))).toEqual([]);
    expect(keys.filter((key) => key.endsWith(".message"))).toHaveLength(keys.length / 2);
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

  it("每条样例渲染以后没有残留的 {…}", () => {
    const leftovers = items
      .filter(({ entry }) => /[{}]/u.test(renderCopy(entry, entry.sample)))
      .map((item) => item.key);
    expect(leftovers).toEqual([]);
  });
});
