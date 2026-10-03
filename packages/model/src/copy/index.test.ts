import { describe, expect, it } from "vitest";
import { errorCodes, exitCode } from "../errors.ts";
import { allCopy, renderCopy } from "./index.ts";

const items = allCopy();

describe("文案表的汇总", () => {
  it("键不重复", () => {
    const keys = items.map((item) => item.key);
    expect(keys.filter((key, i) => keys.indexOf(key) !== i)).toEqual([]);
  });

  it("键是英文的几段，用点连起来", () => {
    for (const { key } of items) expect(key).toMatch(/^[a-z][a-zA-Z]*(\.[A-Za-z][A-Za-z0-9_]*)+$/u);
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

  it("每个错误码、每个退出码都在汇总里", () => {
    const keys = new Set(items.map((item) => item.key));
    for (const { code } of errorCodes) {
      expect(keys.has(`errorCode.${code}.message`)).toBe(true);
      expect(keys.has(`errorCode.${code}.hint`)).toBe(true);
    }
    for (const name of Object.keys(exitCode)) {
      expect(keys.has(`exitCode.${name}.meaning`)).toBe(true);
      expect(keys.has(`exitCode.${name}.action`)).toBe(true);
    }
  });
});
