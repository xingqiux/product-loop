import { join } from "node:path";
import { issuesOf } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { makeTree, tempRoot } from "../project/testing.ts";
import { readExcerpts } from "./assets.ts";
import { readPageData, shownFrom } from "./data.ts";

// 读页面数据：工作区的 page.json 和 cards/*.json 合并，报错的位置按合并前的文件写。
// 以及文字来源的原文摘录。命令整体的过程写在 commands/page.use.test.ts。

function workspace(items: Parameters<typeof makeTree>[1]) {
  const base = tempRoot();
  const dir = join(base, "rounds", "v1-检查-1");
  makeTree(dir, items);
  const read = (path?: string) =>
    readPageData({ workspace: dir, path, cwd: base, show: shownFrom(base) });
  return { base, dir, read };
}

describe("读页面数据", () => {
  it("page.json 在前，cards/*.json 按文件名接在后面，位置按原文件写", async () => {
    const { read } = workspace([
      ["page.json", JSON.stringify({ asks: [{ title: "一" }], screens: [] })],
      ["cards/S2.json", JSON.stringify({ asks: [{ title: "三" }] })],
      ["cards/S1.json", JSON.stringify({ asks: [{ title: "二" }], findings: [{ title: "四" }] })],
    ]);
    const result = await read();
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.data).toEqual({
      asks: [{ title: "一" }, { title: "二" }, { title: "三" }],
      screens: [],
      findings: [{ title: "四" }],
    });
    expect(result.value.locate("asks[2].sources[0]")).toBe(
      "rounds/v1-检查-1/cards/S2.json → asks[0].sources[0]",
    );
    expect(result.value.locate("asks[0]")).toBe("rounds/v1-检查-1/page.json → asks[0]");
    expect(result.value.locate("screens")).toBe("rounds/v1-检查-1/page.json → screens");
  });

  it("JSON 写坏了报到行和列，规矩是 page.json.syntax", async () => {
    const { read } = workspace([["page.json", '{\n  "asks": [,]\n}']]);
    const result = await read();
    expect(result.ok ? undefined : result.error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "page.json.syntax",
      where: "rounds/v1-检查-1/page.json 第 2 行第 12 列",
    });
  });

  it("不是列表的字段写在两个文件里，拦截", async () => {
    const { read } = workspace([
      ["page.json", JSON.stringify({ note: "a" })],
      ["cards/S1.json", JSON.stringify({ note: "b" })],
    ]);
    const result = await read();
    expect(result.ok ? undefined : result.error.message).toBe(
      "note 在 rounds/v1-检查-1/page.json 和 rounds/v1-检查-1/cards/S1.json 里都写了，只有列表能合并。",
    );
  });

  it("工作区里什么都没有时，找不到", async () => {
    const { read } = workspace(["img/"]);
    const result = await read();
    expect(result.ok ? undefined : result.error.code).toBe("NOT_FOUND");
  });

  it("写了文件就只读它", async () => {
    const { read } = workspace([
      ["page.json", JSON.stringify({ asks: [] })],
      ["other.json", JSON.stringify({ findings: [] })],
    ]);
    const result = await read("rounds/v1-检查-1/other.json");
    expect(result.ok ? result.value.data : undefined).toEqual({ findings: [] });
  });
});

describe("原文摘录", () => {
  const data = {
    asks: [
      {
        sources: [
          { name: "样式", file: "src/a.css", lines: "2-3" },
          { name: "样式", file: "src/a.css", lines: "2-3" },
          { name: "图", img: "img/a.png" },
        ],
      },
    ],
    findings: [{ sources: [{ name: "说明", file: "README.md", lines: "9" }] }],
  };

  it("读出起止行和文件的哈希，同一段只读一次；行号超出和文件不在的一次报齐", async () => {
    const root = tempRoot();
    makeTree(root, [
      ["src/a.css", "one\ntwo\nthree\n"],
      ["README.md", "only\n"],
    ]);
    const locate = (where: string) => where;
    const result = await readExcerpts({ data, root, locate });
    expect(result.ok ? undefined : issuesOf(result.error).map((issue) => issue.where)).toEqual([
      "findings[0].sources[0]",
    ]);

    makeTree(root, [["README.md", `${"line\n".repeat(9)}`]]);
    const again = await readExcerpts({ data, root, locate });
    if (!again.ok) throw new Error(again.error.message);
    expect(again.value.map(({ file, lines, text }) => ({ file, lines, text }))).toEqual([
      { file: "src/a.css", lines: "2-3", text: "two\nthree" },
      { file: "README.md", lines: "9", text: "line" },
    ]);
    expect(again.value[0]?.fileHash).toMatch(/^[0-9a-f]{64}$/u);
  });
});
