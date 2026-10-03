import { describe, expect, it } from "vitest";
import { allCopy, renderCopy } from "../copy/index.ts";
import { checkWriting } from "./check.ts";
import { writingRules } from "./rules.ts";

// 文案表也守写作规范，持续检查里跑一遍写作校验，见「10 工程规范与流程」第二节。

describe("文案表和写作校验", () => {
  it("每条文案用样例渲染以后，写作校验没有拦截", () => {
    const blocked = allCopy().flatMap(({ key, entry }) =>
      checkWriting(renderCopy(entry, entry.sample)).block.map((x) => `${key}：${x.message}`),
    );
    expect(blocked).toEqual([]);
  });

  it("规矩的编号就是报错在文案表里的键", () => {
    const writing = allCopy().filter((item) => item.key.startsWith("writing."));
    expect(writing.map((item) => item.key).sort()).toEqual(Object.keys(writingRules).sort());
    for (const { key, entry } of writing) {
      expect(writingRules[key as keyof typeof writingRules].copy).toBe(entry);
    }
  });

  it("级别和「07 校验」第五节相同，「露出来」归入语境相关的旧说法", () => {
    const levelOf = (level: "block" | "warn") =>
      Object.entries(writingRules)
        .filter(([, def]) => def.level === level)
        .map(([rule]) => rule);
    expect(levelOf("block")).toEqual([
      "writing.term.banned",
      "writing.sentence.tooLong",
      "writing.sentence.semicolons",
      "writing.paren.list",
      "writing.reply.firstLine",
      "writing.reply.fileName",
      "writing.reply.interpunct",
      "writing.reply.linkLast",
    ]);
    expect(levelOf("warn")).toEqual([
      "writing.term.quoted",
      "writing.term.soft",
      "writing.sentence.long",
      "writing.paren.items",
      "writing.demonstrative.dense",
      "writing.wording.redBlue",
      "writing.wording.interpunct",
      "writing.wording.spoken",
      "writing.wording.numberRef",
      "writing.wording.statistics",
    ]);
  });
});
