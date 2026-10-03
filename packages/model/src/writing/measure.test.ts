import { describe, expect, it } from "vitest";
import { displayWidth, readingLength, splitSentences } from "./measure.ts";
import { head, len, splitLines, strip } from "./python.ts";

// 度量和断句的用例。和旧脚本逐个对照的在 legacy.test.ts。

describe("读起来的长度", () => {
  it("一串英文、数字、路径算一个字，标点和空白不算", () => {
    expect(readingLength("本轮把 Electron 换成 WebContentsView。")).toBe(7);
    expect(readingLength("见 v1-final:scripts/writing.py，")).toBe(2);
  });

  it("半角的逗号和分号算作一个字", () => {
    expect(readingLength("甲,乙;丙")).toBe(5);
  });
});

describe("显示的宽度", () => {
  it("两个英文字母或数字算一个字，单出的一个也算一个字", () => {
    expect(displayWidth("行名")).toBe(2);
    expect(displayWidth("v2 行名")).toBe(3);
    expect(displayWidth("abc")).toBe(2);
  });
});

describe("断句", () => {
  it("按句号、问号、叹号和换行断开，去掉两头的空白，空的句子不算", () => {
    expect(splitSentences("第一句。第二句？ 第三句！\n\n  第四句")).toEqual([
      "第一句。",
      "第二句？",
      "第三句！",
      "第四句",
    ]);
  });

  it("半角的问号和叹号不断句", () => {
    expect(splitSentences("是吗?好!")).toEqual(["是吗?好!"]);
  });
});

describe("按 Python 的做法处理字符串", () => {
  it("断行认十种，末尾的断行后面不多出一行", () => {
    expect(splitLines("甲\r\n乙 丙\x1c丁\n")).toEqual(["甲", "乙", "丙", "丁"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n")).toEqual([""]);
  });

  it("空白包括 0x1c 到 0x1f 和 0x85，不包括 0xfeff", () => {
    expect(strip("\x1f\x85 甲　")).toBe("甲");
    expect(strip("﻿甲")).toBe("﻿甲");
  });

  it("长度和截取按码位，一个表情算一个字", () => {
    expect(len("👍好")).toBe(2);
    expect(head("👍👍好", 2)).toBe("👍👍");
  });
});
