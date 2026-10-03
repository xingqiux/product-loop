import { describe, expect, it } from "vitest";
import { writingLength } from "../writing/check.ts";
import {
  checkDecisionLength,
  checkQueueContentLength,
  decisionTooLong,
  lengthRuleList,
  queueContentTooLong,
  shortTextLimit,
} from "./length.ts";
import { ruleCommands } from "./rule.ts";

// 内容和「决定」一项不超过 40 个字：边界、字数怎么数、报错怎么写。最典型的命中写在样本里，由 registry.test.ts 逐条查。
// 这里写样本以外的：40 和 41 的界线，标点、英文、链接、换行怎么数，两条规矩各自的报错，以及不限长度的字段。

const chars = (n: number) => "字".repeat(n);

describe("字数的算法和写作校验量一句话的相同", () => {
  it("汉字一个算一个，标点和空白不算", () => {
    expect(writingLength("设置页，保存按钮。")).toBe(7);
    expect(writingLength("设 置 页\n保存　按钮")).toBe(7);
  });

  it("一串英文或数字算一个字，链接不算", () => {
    expect(writingLength("把 board.tsx 改成 12 列")).toBe(6);
    expect(writingLength("照 https://example.com/a/b?x=1 的做法")).toBe(4);
  });
});

describe("规矩 queue.content.tooLong", () => {
  it("40 个字放得进去，41 个字拦下，报出现在几个字", () => {
    expect(checkQueueContentLength(chars(shortTextLimit))).toEqual([]);
    expect(checkQueueContentLength(chars(41))).toEqual([
      {
        rule: "queue.content.tooLong",
        message: "内容有 41 个字，超过 40 个字。",
        hint: "缩短到 40 个字以内，细节写进备注。",
        where: "content",
      },
    ]);
  });

  it("标点、空白和换行不算字：一行 40 个字加一堆标点也放得进去", () => {
    expect(checkQueueContentLength(`${chars(20)}，、；：。！？\n${chars(20)}  （）`)).toEqual([]);
  });

  it("一串英文或数字只算一个字", () => {
    const path = "packages/web/src/features/queue/board.tsx";
    expect(checkQueueContentLength(`${chars(39)}${path}`)).toEqual([]);
    expect(checkQueueContentLength(`${chars(40)}${path}`)).toHaveLength(1);
  });

  it("链接不算字", () => {
    expect(checkQueueContentLength(`${chars(40)} https://example.com/${chars(30)}`)).toEqual([]);
  });

  it("范围是队列事项，放进、修改和处理回复时查，级别是拦截", () => {
    expect(queueContentTooLong.level).toBe("block");
    expect(queueContentTooLong.scope.subjects).toEqual(["queue"]);
    expect(queueContentTooLong.scope.commands).toEqual(["queue add", "queue edit", "reply handle"]);
  });
});

describe("规矩 decision.decision.tooLong", () => {
  it("40 个字放得进去，41 个字拦下，怎么改是把细节写进原因", () => {
    expect(checkDecisionLength(chars(shortTextLimit))).toEqual([]);
    expect(checkDecisionLength(chars(41))).toEqual([
      {
        rule: "decision.decision.tooLong",
        message: "「决定」一项有 41 个字，超过 40 个字。",
        hint: "缩短到 40 个字以内，细节写进原因。",
        where: "decision",
      },
    ]);
  });

  it("范围是决定，新增、修改和处理回复时查，级别是拦截", () => {
    expect(decisionTooLong.level).toBe("block");
    expect(decisionTooLong.scope.subjects).toEqual(["decision"]);
    expect(decisionTooLong.scope.commands).toEqual([
      "decision add",
      "decision edit",
      "reply handle",
    ]);
  });
});

describe("两条规矩", () => {
  it("命令都在规矩表认得的命令里，两条起始都是发布那天", () => {
    for (const rule of lengthRuleList) {
      for (const command of rule.scope.commands) expect(ruleCommands).toContain(command);
      expect(rule.since).toBe("2.0.0");
    }
  });

  it("上限只有一处写着，报错和文案表里的参数都取它", () => {
    expect(shortTextLimit).toBe(40);
    expect(queueContentTooLong.copy.hint?.sample).toEqual({ limit: shortTextLimit });
    expect(decisionTooLong.copy.hint?.sample).toEqual({ limit: shortTextLimit });
  });
});
