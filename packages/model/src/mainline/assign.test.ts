import { describe, expect, it } from "vitest";
import { assignSceneIds } from "./assign.ts";
import { parseMainline } from "./parse.ts";

const who = "谁在什么时候用：你。";

/** 一份新写法的主线，场景清单里有写了编号的，也有没写的。 */
const mainline = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S2 看队列",
  who,
  "1. 点队列 → 看到看板",
  "",
  "### 看决定",
  who,
  "1. 点决定 → 看到表格",
  "",
  "### S1 看所有项目",
  who,
  "1. 打开工作台 → 看到看板",
  "",
  "### 在窄屏上看（第 16 轮）",
  who,
  "1. 窄屏打开 → 没有左边一栏",
  "",
  "## 不做什么和胃口",
  "",
  "### 不是场景",
  "1. 甲 → 乙",
  "",
].join("\n");

describe("给新场景补编号", () => {
  it("没写编号的按先后接着最大的编号往下编，已写的不动，别的字一个不改", () => {
    const { text, assigned } = assignSceneIds(mainline);
    expect(assigned).toEqual([
      { id: 3, name: "看决定", line: 9 },
      { id: 4, name: "在窄屏上看", line: 17 },
    ]);
    expect(text).toBe(
      mainline
        .replace("### 看决定", "### S3 看决定")
        .replace("### 在窄屏上看（第 16 轮）", "### S4 在窄屏上看（第 16 轮）"),
    );
  });

  it("删掉的场景的编号不再用：从项目用过的最大编号往后数", () => {
    const { assigned } = assignSceneIds(mainline, 21);
    expect(assigned.map((a) => a.id)).toEqual([22, 23]);
  });

  it("主线里已写的编号比用过的大时，从主线里最大的往后数", () => {
    const { assigned } = assignSceneIds(mainline.replace("### S2 看队列", "### S30 看队列"), 21);
    expect(assigned.map((a) => a.id)).toEqual([31, 32]);
  });

  it("补过一次以后再补，什么都不变", () => {
    const once = assignSceneIds(mainline, 5);
    const twice = assignSceneIds(once.text, 7);
    expect(twice).toEqual({ text: once.text, assigned: [] });
  });

  it("补好以后再解析，每个场景都有编号，名字和步骤不变", () => {
    const before = parseMainline(mainline);
    const after = parseMainline(assignSceneIds(mainline).text);
    expect(after.scenes.map((s) => s.id)).toEqual([2, 3, 1, 4]);
    expect(after.scenes.map(({ id, ...rest }) => rest)).toEqual(
      before.scenes.map(({ id, ...rest }) => rest),
    );
    expect(after.problems).toEqual(before.problems);
  });

  it("换行符、字节顺序标记和结尾的换行都原样留下", () => {
    const crlf = `\uFEFF${mainline.replaceAll("\n", "\r\n")}\r\n`;
    const { text, assigned } = assignSceneIds(crlf);
    expect(assigned.map((a) => [a.id, a.line])).toEqual([
      [3, 9],
      [4, 17],
    ]);
    expect(text).toBe(
      crlf
        .replace("### 看决定\r\n", "### S3 看决定\r\n")
        .replace("### 在窄屏上看", "### S4 在窄屏上看"),
    );
    const mixed = "## 场景清单\r### 看\r谁在什么时候用：你。\n1. 甲 → 乙";
    expect(assignSceneIds(mixed).text).toBe(
      "## 场景清单\r### S1 看\r谁在什么时候用：你。\n1. 甲 → 乙",
    );
  });

  it("标题结尾的一串 # 和多余的空白都留着", () => {
    const text = "## 场景清单\n###   看队列 ##\n1. 甲 → 乙";
    expect(assignSceneIds(text).text).toBe("## 场景清单\n###   S1 看队列 ##\n1. 甲 → 乙");
  });

  it("编号写错的、没有名字的、没有步骤的都不补，由解析报成问题", () => {
    const text = [
      "## 场景清单",
      "### S03 看队列",
      "1. 甲 → 乙",
      "### S5",
      "1. 甲 → 乙",
      "###",
      "1. 甲 → 乙",
      "### 说明",
      "这一节写场景的来历。",
      "### 看决定",
      "1. 甲 → 乙",
    ].join("\n");
    const { assigned } = assignSceneIds(text);
    expect(assigned).toEqual([{ id: 6, name: "看决定", line: 10 }]);
  });

  it("没有场景清单这一节时原样返回", () => {
    const text = "## 给谁用\n### 看队列\n1. 甲 → 乙\n";
    expect(assignSceneIds(text)).toEqual({ text, assigned: [] });
  });
});

describe("旧写法的场景补编号", () => {
  it("开头的一行字改成新写法的三级标题，说明留在括号里", () => {
    const text = [
      "## 场景清单",
      "场景「回答疑问」：",
      "1. 打开网页 → 看到页头",
      "",
      "场景「验收更改」（这一页不用点）：",
      "1. 打开网页 → 看到更改",
      "",
      "五条判据：都过。",
    ].join("\n");
    const { text: next, assigned } = assignSceneIds(text);
    expect(next).toBe(
      text
        .replace("场景「回答疑问」：", "### S1 回答疑问")
        .replace("场景「验收更改」（这一页不用点）：", "### S2 验收更改（这一页不用点）"),
    );
    expect(assigned).toEqual([
      { id: 1, name: "回答疑问", line: 2 },
      { id: 2, name: "验收更改", line: 5 },
    ]);
  });

  it("三级标题里的旧编号换成新编号", () => {
    const text = "## 场景清单\n### 场景 1　每月整理（产品卖的就是这条）\n1. 甲 → 乙";
    expect(assignSceneIds(text).text).toBe(
      "## 场景清单\n### S1 每月整理（产品卖的就是这条）\n1. 甲 → 乙",
    );
  });

  it("改完以后再解析，不再是旧写法，名字和说明不变", () => {
    const text = "## 场景清单\n场景 2（第一次进来、空项目）：\n1. 打开 → 看到引导";
    const after = parseMainline(assignSceneIds(text).text);
    expect(after.scenes).toEqual([
      {
        id: 1,
        name: "第一次进来、空项目",
        steps: [{ step: 1, do: "打开", expect: "看到引导", line: 3 }],
        line: 2,
        endLine: 3,
        legacy: false,
      },
    ]);
    expect(after.problems.map((p) => p.kind)).toEqual(["sceneWhoMissing"]);
  });
});
