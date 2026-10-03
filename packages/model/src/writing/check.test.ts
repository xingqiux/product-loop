import { describe, expect, it } from "vitest";
import { checkWriting, type WritingOptions } from "./check.ts";
import { builtInGlossary, type ProjectWritingSpec } from "./glossary.ts";
import type { WritingResult } from "./rules.ts";

// 写作校验本身的用例。和旧脚本逐条对照的在 legacy.test.ts。

const han = (n: number) => "甲乙丙丁戊己庚辛壬癸".repeat(Math.ceil(n / 10)).slice(0, n);

/** 只看规矩的编号，按拦截和警告分开。 */
function rulesOf(text: string, options?: WritingOptions) {
  const { block, warn }: WritingResult = checkWriting(text, options);
  return { block: block.map((x) => x.rule), warn: warn.map((x) => x.rule) };
}

const project = (spec: Partial<ProjectWritingSpec>): WritingOptions => ({
  project: { banned: [], exceptions: [], ...spec },
});

describe("拦截五项和警告五项", () => {
  it("停用的说法出现即拦截，报错写明统一的术语", () => {
    const { block } = checkWriting("替人用的脚本走完了全部场景。");
    expect(block).toEqual([
      {
        rule: "writing.term.banned",
        message: "出现了术语表停用的说法「替人用的脚本」，统一的术语是「走查脚本」",
        hint: "改成术语表里的说法「走查脚本」，或者换一种说法。引号里的原话不用改",
      },
    ]);
  });

  it("超过六十字的句子拦截，四十到六十字的警告，正好四十字不报", () => {
    expect(rulesOf(`${han(61)}。`).block).toEqual(["writing.sentence.tooLong"]);
    expect(rulesOf(`${han(60)}。`)).toEqual({ block: [], warn: ["writing.sentence.long"] });
    expect(rulesOf(`${han(40)}。`)).toEqual({ block: [], warn: [] });
  });

  it("报错里截取句子的前二十个字，表情不拆开", () => {
    const [issue] = checkWriting(`${"👍".repeat(5)}${han(40)}。`).warn;
    expect(issue?.message).toBe(`这一句超过四十字，考虑拆开：「${"👍".repeat(5)}${han(15)}……」`);
  });

  it("一串英文、数字或路径算一个字，链接不参加校验", () => {
    expect(rulesOf(`${han(39)}packages/model/src/writing/check.ts。`)).toEqual({
      block: [],
      warn: [],
    });
    expect(rulesOf(`见 https://example.com/替人用的脚本 ${han(38)}。`)).toEqual({
      block: [],
      warn: [],
    });
  });

  it("一句里有两个以上的分号拦截，分在两句里不拦截", () => {
    expect(rulesOf("改了正文；改了脚本；改了模板。").block).toEqual([
      "writing.sentence.semicolons",
    ]);
    expect(rulesOf("改了正文；改了脚本。改了模板；改了参考文件。").block).toEqual([]);
  });

  it("括号里三项以上的并列：超过三十字拦截，不超过的警告", () => {
    expect(rulesOf("见（甲、乙、丙）。").warn).toEqual(["writing.paren.items"]);
    expect(rulesOf(`见（${han(15)}、${han(14)}、）。`).block).toEqual(["writing.paren.list"]);
    expect(rulesOf("见（甲、乙）。")).toEqual({ block: [], warn: [] });
  });

  it("指示词四个以上并且占比超过百分之三时警告", () => {
    expect(rulesOf("这个、那个、这些、那些都要写名称。").warn).toEqual([
      "writing.demonstrative.dense",
    ]);
    expect(rulesOf("这个、那个、这些都要写名称。").warn).toEqual([]);
  });

  it("语境相关的旧说法只警告", () => {
    expect(rulesOf("整理做完了。")).toEqual({ block: [], warn: ["writing.term.soft"] });
  });

  it("措辞一类只警告，每条只报第一处，引号里的也报", () => {
    expect(rulesOf("场景 3 和决定 12 都改了，状态·字段也定了。").warn).toEqual([
      "writing.wording.interpunct",
      "writing.wording.numberRef",
    ]);
    const [issue] = checkWriting("用户说「红方」。").warn;
    expect(issue?.message).toBe("出现「红方」。不写红方、蓝方，候选就叫候选");
    expect(issue?.hint).toBe("是引用就留着，是写错了就改");
  });
});

describe("有意改动 1：引号里的字照常算", () => {
  it("引号里的字算进句子的长度", () => {
    expect(rulesOf(`${han(30)}「${han(20)}」。`).warn).toEqual(["writing.sentence.long"]);
  });

  it("引号里的分号算进所在的句子", () => {
    expect(rulesOf("用户写的是「甲；乙；丙」。").block).toEqual(["writing.sentence.semicolons"]);
  });

  it("停用的说法只出现在引号里时只警告，引号外也有时照样拦截", () => {
    const quoted = checkWriting("用户的原话是「替人用的脚本」。");
    expect(quoted.block).toEqual([]);
    expect(quoted.warn).toEqual([
      {
        rule: "writing.term.quoted",
        message:
          "引号里出现了术语表停用的说法「替人用的脚本」，统一的术语是「走查脚本」。如果是照录的原话，可以保留",
      },
    ]);
    expect(rulesOf("“收起来”以后又收起来了。").block).toEqual(["writing.term.banned"]);
  });

  it("没有配对的引号不算引号", () => {
    expect(rulesOf("用户的原话是「替人用的脚本。").block).toEqual(["writing.term.banned"]);
  });
});

describe("有意改动 3：「露出来」只警告", () => {
  it("「露出来」按语境相关的旧说法警告", () => {
    expect(checkWriting("按钮露出来了。")).toEqual({
      block: [],
      warn: [
        {
          rule: "writing.term.soft",
          message: "出现了「露出来」。如果指的是术语表里的那个意思，统一写「显示」",
        },
      ],
    });
  });

  it("「暴露出来」不报", () => {
    expect(rulesOf("问题暴露出来了。")).toEqual({ block: [], warn: [] });
  });
});

describe("有意改动 2：术语表分两层", () => {
  it("项目那一层是空的时，skill 自带的每一条照常报", () => {
    const options = project({});
    for (const { phrase, level } of builtInGlossary) {
      const found = rulesOf(`${phrase}。`, options);
      expect(level === "block" ? found.block : found.warn).toContain(
        level === "block" ? "writing.term.banned" : "writing.term.soft",
      );
    }
  });

  it("项目加的停用说法出现即拦截，写在引号里只警告", () => {
    const options = project({ banned: [{ phrase: "工作流", replacement: "流程" }] });
    expect(checkWriting("工作流跑完了。", options).block).toEqual([
      {
        rule: "writing.term.banned",
        message: "出现了术语表停用的说法「工作流」，统一的术语是「流程」",
        hint: "改成术语表里的说法「流程」，或者换一种说法。引号里的原话不用改",
      },
    ]);
    expect(rulesOf("用户说「工作流」。", options).warn).toEqual(["writing.term.quoted"]);
    expect(rulesOf("工作流跑完了。").block).toEqual([]);
  });

  it("项目写了和 skill 相同的说法时，以项目的为准", () => {
    const options = project({ banned: [{ phrase: "整理", replacement: "重写" }] });
    expect(checkWriting("整理做完了。", options)).toEqual({
      block: [
        {
          rule: "writing.term.banned",
          message: "出现了术语表停用的说法「整理」，统一的术语是「重写」",
          hint: "改成术语表里的说法「重写」，或者换一种说法。引号里的原话不用改",
        },
      ],
      warn: [],
    });
  });

  it("例外的写法不再报，例如带间隔号的外国人名", () => {
    const options = project({ exceptions: ["史蒂夫·乔布斯"] });
    expect(rulesOf("史蒂夫·乔布斯说过这句话。", options)).toEqual({ block: [], warn: [] });
    expect(rulesOf("史蒂夫·乔布斯说过，状态·字段都要写。", options).warn).toEqual([
      "writing.wording.interpunct",
    ]);
  });

  it("例外能关掉 skill 自带的一条", () => {
    expect(rulesOf("收起来以后再整理。", project({ exceptions: ["收起来", "整理"] }))).toEqual({
      block: [],
      warn: [],
    });
  });

  it("例外只盖住列出的写法，旁边的字照常查", () => {
    const options = project({ exceptions: ["整理数据"] });
    expect(rulesOf("整理数据以后再部署。", options).warn).toEqual([]);
    expect(rulesOf("整理数据以后再整理代码。", options).warn).toEqual(["writing.term.soft"]);
  });

  it("例外不改变句子的长度", () => {
    const options = project({ exceptions: [han(10)] });
    expect(rulesOf(`${han(61)}。`, options).block).toEqual(["writing.sentence.tooLong"]);
  });

  it("空的说法和空的例外不收", () => {
    const options = project({ banned: [{ phrase: "", replacement: "流程" }], exceptions: [""] });
    expect(rulesOf("整理做完了。", options)).toEqual({ block: [], warn: ["writing.term.soft"] });
  });
});
