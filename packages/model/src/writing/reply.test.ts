import { describe, expect, it } from "vitest";
import { checkReply } from "./reply.ts";

// 会话回复自查的用例。check-reply.py 自带的十二条样本在 legacy.test.ts 里逐条对照。

const rulesOf = (text: string, exceptions: readonly string[] = []) => {
  const { block, warn } = checkReply(text, { project: { banned: [], exceptions } });
  return { block: block.map((x) => x.rule), warn: warn.map((x) => x.rule) };
};

describe("会话回复的自查", () => {
  it("首行写阶段和一句原因，才算合格", () => {
    expect(rulesOf("第 2 版的落地阶段：两件改完，等验收。")).toEqual({ block: [], warn: [] });
    expect(rulesOf("第 2 版的检查阶段：逐屏看完了，列出三处。")).toEqual({ block: [], warn: [] });
    expect(rulesOf("第 2 版的落地阶段（第 2 次）：两件改完。")).toEqual({ block: [], warn: [] });
    expect(rulesOf("落地：两件改完，等验收。")).toEqual({ block: [], warn: [] });
    // 内部编号不认，决定 211。
    expect(rulesOf("v2-检查-1：逐屏看完了，列出三处。").block).toEqual(["writing.reply.firstLine"]);
    expect(rulesOf("v2-落地-1：改完了").block).toEqual(["writing.reply.firstLine"]);
    expect(rulesOf("第 2 版的检查阶段").block).toEqual(["writing.reply.firstLine"]);
    expect(rulesOf("v2-检查-1").block).toEqual(["writing.reply.firstLine"]);
    expect(rulesOf("好的，我来处理。").block).toEqual(["writing.reply.firstLine"]);
    expect(rulesOf("第 2 版的落地阶段：   \n正文。").block).toEqual(["writing.reply.firstLine"]);
  });

  it("文件名、间隔号、链接后面还有字，各报一条", () => {
    expect(rulesOf("第 2 版的落地阶段：接着做。\n计划写在 计划.md 里。").block).toEqual([
      "writing.reply.fileName",
    ]);
    expect(rulesOf("第 2 版的落地阶段：接着做。\n状态 · 字段都定了。").block).toEqual([
      "writing.reply.interpunct",
    ]);
    expect(
      rulesOf("第 2 版的落地阶段：接着做。\nhttps://example.com/a\n另外还有一件事。").block,
    ).toEqual(["writing.reply.linkLast"]);
  });

  it("Node.js 这类库名不算文件名，别的 .js 算", () => {
    expect(rulesOf("第 2 版的落地阶段：页面是用 Node.js 生成的。").block).toEqual([]);
    const { block } = checkReply("第 2 版的落地阶段：图是用 Chart.js 画的。");
    expect(block.map((x) => x.message)).toEqual([
      "出现了文件名「Chart.js」。会话里说事情本身，不说它写在哪个文件里",
    ]);
  });

  it("表格和引用行里的字也跑写作校验，分隔行不跑", () => {
    expect(
      rulesOf("第 2 版的落地阶段：接着做。\n| 项 | 说明 |\n| --- | --- |\n| 一 | 收起来了 |").block,
    ).toEqual(["writing.term.banned"]);
    expect(rulesOf("第 2 版的落地阶段：接着做。\n> 替人用的脚本走完了。").block).toEqual([
      "writing.term.banned",
    ]);
  });

  it("措辞一类回复也查，只警告；间隔号回复自己拦截，不再重复警告（F07）", () => {
    expect(rulesOf("第 2 版的落地阶段：改了 7 处。")).toEqual({
      block: [],
      warn: ["writing.wording.statistics"],
    });
    expect(rulesOf("第 2 版的落地阶段：场景 3 的红方说法没改，接着跑。").warn).toEqual([
      "writing.wording.redBlue",
      "writing.wording.spoken",
      "writing.wording.numberRef",
    ]);
    expect(rulesOf("第 2 版的落地阶段：接着做。\n状态 · 字段都定了。")).toEqual({
      block: ["writing.reply.interpunct"],
      warn: [],
    });
  });

  it("首行的阶段叫法带着数字，不算统计数字", () => {
    expect(rulesOf("第 2 版的落地阶段（第 2 次）：两件改完。")).toEqual({ block: [], warn: [] });
  });

  it("项目列出的例外在回复里也不报", () => {
    const text = "第 2 版的落地阶段：接着做。\n图是用 Chart.js 画的，史蒂夫·乔布斯说过。";
    expect(rulesOf(text).block).toEqual(["writing.reply.fileName", "writing.reply.interpunct"]);
    expect(rulesOf(text, ["Chart.js", "史蒂夫·乔布斯"]).block).toEqual([]);
  });
});
