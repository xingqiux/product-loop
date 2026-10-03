import { checkWriting, flattenCopy, renderCopy } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { processCopy } from "./process.ts";

// 并进 model 的文案表以前，先在这里做 model 那边对每条文案做的检查，包括写作校验。

const items = flattenCopy("process", processCopy);

describe("后端进程的文案", () => {
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

  it("数据库比程序新时，日志里写明原因和 ploop setup（约定 0002 第 7 条）", () => {
    const { message, hint } = processCopy.refused.dbNewer;
    expect(renderCopy(message)).toContain("数据库");
    expect(renderCopy(hint)).toContain("ploop setup");
  });
});
