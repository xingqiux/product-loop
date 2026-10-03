import { type ErrorBody, errorBody } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { cardLabels, lineText, type PollStep, pollUntil } from "./reply.ts";

// ploop reply wait 的长轮询：连不上时按一秒到五秒递增重试，到时返回还在等。时钟和等待是假的。

const down: ErrorBody = errorBody("INTERNAL", [{ message: "连不上", hint: "看日志" }]);

/** 按给定的顺序交回每次请求的结果，每次请求花掉挂起的秒数。 */
function scripted(steps: PollStep<string>[]) {
  let clock = 0;
  const slept: number[] = [];
  const asked: number[] = [];
  const poll = async (seconds: number) => {
    asked.push(seconds);
    const step = steps.shift() ?? { kind: "waiting" as const };
    if (step.kind === "waiting") clock += seconds * 1000;
    return step;
  };
  const options = (timeoutMs: number | undefined) => ({
    timeoutMs,
    now: () => clock,
    sleep: async (ms: number) => {
      slept.push(ms / 1000);
      clock += ms;
    },
    onRetry: () => {},
  });
  return { poll, options, slept, asked };
}

describe("等回复的长轮询", () => {
  it("连不上时按一到五秒递增重试，之后每五秒一次；接上以后重新从一秒算", async () => {
    const retry: PollStep<string> = { kind: "retry", error: down };
    const { poll, options, slept } = scripted([
      ...Array.from({ length: 7 }, () => retry),
      { kind: "waiting" },
      retry,
      { kind: "done", value: "回复" },
    ]);
    const result = await pollUntil(poll, options(undefined));
    expect(result).toEqual({ ok: true, value: "回复" });
    expect(slept).toEqual([1, 2, 3, 4, 5, 5, 5, 1]);
  });

  it("到时还没有回复，交回 undefined；每次挂起不超过五十秒，也不超过剩下的时间", async () => {
    const { poll, options, asked } = scripted([]);
    const result = await pollUntil(poll, options(120_000));
    expect(result).toEqual({ ok: true, value: undefined });
    expect(asked).toEqual([50, 50, 20]);
  });

  it("重试等不到时限就报出最后一次的失败；别的失败立即报出", async () => {
    const retry: PollStep<string> = { kind: "retry", error: down };
    const late = scripted([retry, retry, retry]);
    expect(await pollUntil(late.poll, late.options(4_000))).toEqual({ ok: false, error: down });
    expect(late.slept).toEqual([1, 2]);
    const gone = errorBody("PAGE_GONE", [{ message: "撤回了" }]);
    const failed = scripted([{ kind: "fail", error: gone }]);
    expect(await pollUntil(failed.poll, failed.options(undefined))).toEqual({
      ok: false,
      error: gone,
    });
  });
});

describe("回复的每一行写卡片的标题", () => {
  type Line = Parameters<typeof lineText>[0];
  const base = { submission: 1, images: [], imagesRead: false };
  const lines: [Line, Line, Line] = [
    {
      ...base,
      line: 1,
      section: "疑问",
      card: "ask-a",
      cardTitle: "存储方式",
      kind: "只写了备注",
      note: "用文件",
    },
    {
      ...base,
      line: 2,
      section: "疑问",
      card: "ask-b",
      cardTitle: "导出格式",
      kind: "只写了备注",
      note: "要 CSV",
    },
    { ...base, line: 3, kind: "想法", note: "加个搜索" },
  ];

  it("疑问写「标题」，自动生成的编号不写进文字（N02）", () => {
    const labels = cardLabels(lines);
    expect(lineText(lines[0], new Map(), labels)).toEqual([
      "第 1 行  疑问「存储方式」  只写了备注：用文件",
    ]);
    expect(lineText(lines[1], new Map(), labels)).toEqual([
      "第 2 行  疑问「导出格式」  只写了备注：要 CSV",
    ]);
    expect(lineText(lines[2], new Map(), labels)[0]).not.toContain("ask-");
  });

  it("同一区块里有两张卡标题相同，写第几张", () => {
    const twin = [lines[0], { ...lines[0], line: 2, card: "ask-a-2" }, { ...lines[0], line: 3 }];
    const labels = cardLabels(twin);
    expect(twin.map((line) => lineText(line, new Map(), labels)[0])).toEqual([
      "第 1 行  疑问「存储方式」（第 1 张）  只写了备注：用文件",
      "第 2 行  疑问「存储方式」（第 2 张）  只写了备注：用文件",
      "第 3 行  疑问「存储方式」（第 1 张）  只写了备注：用文件",
    ]);
  });

  it("旧页面的卡没有标题时只写区块名，不露出编号", () => {
    const old = { ...lines[0], cardTitle: undefined };
    const [text] = lineText(old, new Map(), cardLabels([old]));
    expect(text).toBe("第 1 行  疑问  只写了备注：用文件");
  });
});
