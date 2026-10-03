import { describe, expect, it } from "vitest";
import {
  mentionsCommand,
  normalizeChangeName,
  parseChangeItems,
  queueNumbersIn,
  shellWords,
} from "./plan-items.ts";

describe("计划「功能改动」里的每一件", () => {
  it("按顶格的列表项分，标题那一行去掉编号和末尾的标点是名字，下面几行归这一件", () => {
    const section = [
      "每一件先写失败的检查。",
      "1. 空列表显示一句提示（Q12）。",
      "   检查 `pnpm vitest run src/list.test.ts`，查空列表时显示一句提示。",
      "2、保存按钮不被挡住",
      "   检查 `pnpm use s3`，查窄屏时按钮完整可见。",
      "- 评审：命令补上文件夹：",
    ].join("\n");
    expect(parseChangeItems(section)).toEqual([
      {
        name: "空列表显示一句提示（Q12）",
        text: "1. 空列表显示一句提示（Q12）。\n   检查 `pnpm vitest run src/list.test.ts`，查空列表时显示一句提示。",
        queueNumbers: [12],
      },
      {
        name: "保存按钮不被挡住",
        text: "2、保存按钮不被挡住\n   检查 `pnpm use s3`，查窄屏时按钮完整可见。",
        queueNumbers: [],
      },
      { name: "评审：命令补上文件夹", text: "- 评审：命令补上文件夹：", queueNumbers: [] },
    ]);
  });

  it("有三级标题时按三级标题分，列表项算这一件的正文，标题前的编号也去掉", () => {
    const section = [
      "### 1. 空列表显示一句提示",
      "- 对应 Q12、Q3，Q12 再写一次也只记一次",
      "- 检查 `pnpm test`",
      "### 保存按钮不被挡住 ###",
      "对应 Q15。",
    ].join("\n");
    expect(parseChangeItems(section).map((item) => [item.name, item.queueNumbers])).toEqual([
      ["空列表显示一句提示", [3, 12]],
      ["保存按钮不被挡住", [15]],
    ]);
  });

  it("代码块里像列表项和标题的行不算一件", () => {
    const section = ["1. 改提示", "   ```sh", "   - 不是一件", "   ### 也不是", "   ```"].join(
      "\n",
    );
    expect(parseChangeItems(section).map((item) => item.name)).toEqual(["改提示"]);
  });

  it("没有列表项也没有三级标题时，一件都认不出", () => {
    expect(parseChangeItems("把空列表的提示改好，再修保存按钮。")).toEqual([]);
  });

  it("名字比较前去掉首尾的空白和末尾的标点", () => {
    expect(normalizeChangeName("  阶段改名落地。 ")).toBe("阶段改名落地");
    expect(normalizeChangeName("评审：三处边界：")).toBe("评审：三处边界");
  });

  it("队列编号前后不能连着英文字母和数字，补 0 的不算", () => {
    expect(queueNumbersIn("对应Q12和 Q3，不是 Q012、Q0、XQ5、Q7a")).toEqual([3, 12]);
  });
});

describe("检查命令原样写在计划里", () => {
  const command = ["pnpm", "vitest", "run", "src/list.test.ts"] as const;

  it.each([
    ["写在正文里", "检查命令是 pnpm vitest run src/list.test.ts，查空列表。"],
    ["写在行内代码里", "检查 `pnpm vitest run src/list.test.ts`。"],
    ["写在代码块里", "检查：\n```sh\npnpm vitest run src/list.test.ts\n```"],
    ["写成整条 ploop 命令", "`ploop land red 空列表 -- pnpm vitest run src/list.test.ts`"],
  ])("%s，算写了", (_case, text) => {
    expect(mentionsCommand(text, command)).toBe(true);
  });

  it.each([
    ["只写了一半", "检查 `pnpm vitest run`。"],
    ["多了参数", "检查 `pnpm vitest run src/list.test.ts --watch`。"],
    ["写的是别的文件", "检查 `pnpm vitest run src/other.test.ts`。"],
  ])("%s，不算写了", (_case, text) => {
    expect(mentionsCommand(text, command)).toBe(false);
  });

  it("带引号的参数，单引号和双引号都认", () => {
    const quoted = ["bash", "-c", "test -f a && grep -q b c"];
    expect(mentionsCommand("`bash -c 'test -f a && grep -q b c'`", quoted)).toBe(true);
    expect(mentionsCommand('`bash -c "test -f a && grep -q b c"`', quoted)).toBe(true);
    expect(mentionsCommand("`bash -c test -f a && grep -q b c`", quoted)).toBe(false);
  });
});

describe("按 shell 的规矩切开一行", () => {
  it.each<[string, string[] | undefined]>([
    ["pnpm test", ["pnpm", "test"]],
    ["  a   b  ", ["a", "b"]],
    ["echo ''", ["echo", ""]],
    [`grep 'it'"'"'s'`, ["grep", "it's"]],
    [`echo "a \\"b\\" \\$c \\n"`, ["echo", 'a "b" $c \\n']],
    ["echo a\\ b", ["echo", "a b"]],
    ["echo 'unclosed", undefined],
  ])("%s", (line, words) => {
    expect(shellWords(line)).toEqual(words);
  });
});
