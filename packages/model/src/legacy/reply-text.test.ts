import { describe, expect, it } from "vitest";
import { validPage } from "../page/page.samples.ts";
import { assignCardIds, pageSectionsSchema } from "../page/sections.ts";
import {
  describeLegacyReplyProblem,
  type LegacyReplyLine,
  type LegacyReplyPage,
  type LegacyReplyProblem,
  type LegacyReplyProblemKind,
  legacyQueueText,
  legacyReplyPage,
  legacySceneName,
  parseLegacyReply,
} from "./reply-text.ts";

// 旧模板复制出的回复文字，每一种行的写法照 10-app.js 的 compose()。
// 真实的回复和运行旧代码得到的样本见 reply-text.legacy.test.ts。

/** 构思第 3 轮的一页：各块都有，看板上两件事。 */
const page = legacyReplyPage({
  version: 1,
  stage: "think",
  round: 3,
  sections: {
    align: [
      { id: "delivery-line", name: "交付线" },
      { id: "appetite", name: "胃口" },
    ],
    scenes: [
      { id: "look-at-queue", scene: "S9", name: "看队列" },
      { id: "offline", name: "等待和出错（断网）" },
    ],
    spec: [
      { id: "colors", name: "配色" },
      { id: "type-scale", name: "字号" },
    ],
    asks: [
      { id: "queue-board", options: [{ key: "a" }, { key: "b" }] },
      { id: "follow-up" },
      { id: "self-review", only: true, options: [{ key: "a" }] },
    ],
    findings: [{ id: "block-hint", options: [{ key: "a" }, { key: "b" }, { key: "c" }] }],
    improvements: [{ id: "queue-filter", options: [{ key: "a" }, { key: "b" }] }],
  },
  queue: [
    { id: "Q5", content: "把「修复」改名成「落地」" },
    { id: "Q8", content: "窄屏上的回复框" },
  ],
  droppedAtStart: false,
});

/** 旧页面转过来的一页，带回到构思的卡。新格式的页面没有这一块。 */
const pageWithRethink: LegacyReplyPage = {
  ...page,
  cards: {
    ...page.cards,
    rethink: [{ section: "asks", card: "rethink-part", options: ["a", "b"], only: false }],
  },
};

/** 拆开回复文字，拆不开时让测试失败并打印问题。行号和回复文字里的行号去掉，只比内容。 */
function linesOf(text: string, target: LegacyReplyPage = page): Omit<LegacyReplyLine, "line">[] {
  const result = parseLegacyReply(text, target);
  if (!result.ok) throw new Error(`拆不开：${JSON.stringify(result.error)}`);
  result.value.forEach((line, i) => {
    expect(line.line).toBe(i + 1);
  });
  return result.value.map(({ line: _line, ...rest }) => rest);
}

function problemsOf(text: string, target: LegacyReplyPage = page): LegacyReplyProblem[] {
  const result = parseLegacyReply(text, target);
  if (result.ok) throw new Error(`应当有问题，却拆成了 ${result.value.length} 行`);
  return [...result.error];
}

describe("一页在旧模板上的样子", () => {
  it("四块卡按页面数据的顺序，卡片编号和选项照抄，回到构思是空的", () => {
    expect(page.cards).toEqual({
      asks: [
        { section: "asks", card: "queue-board", options: ["a", "b"], only: false },
        { section: "asks", card: "follow-up", options: [], only: false },
        { section: "asks", card: "self-review", options: ["a"], only: true },
      ],
      findings: [
        { section: "findings", card: "block-hint", options: ["a", "b", "c"], only: false },
      ],
      improvements: [
        { section: "improvements", card: "queue-filter", options: ["a", "b"], only: false },
      ],
      rethink: [],
    });
  });

  it("场景的编号和看板上的编号写在名字前面，不带编号的写法也认", () => {
    expect(page.items.scenes).toEqual([
      { id: "look-at-queue", names: ["S9 看队列", "看队列"] },
      { id: "offline", names: ["等待和出错（断网）"] },
    ]);
    expect(page.items.queue).toEqual([
      { id: "Q5", names: ["Q5 把「修复」改名成「落地」", "把「修复」改名成「落地」"] },
      { id: "Q8", names: ["Q8 窄屏上的回复框", "窄屏上的回复框"] },
    ]);
    expect(legacySceneName({ scene: "S9", name: "看队列" })).toBe("S9 看队列");
    expect(legacyQueueText({ id: "Q8", content: "窄屏上的回复框" })).toBe("Q8 窄屏上的回复框");
  });

  it("这一轮开始时有取消的事，疑问的第一张是只有备注框的卡，别的卡往后数", () => {
    const withDropped = legacyReplyPage({
      version: 1,
      stage: "check",
      round: 1,
      sections: { asks: [{ id: "queue-board", options: [{ key: "a" }] }] },
      queue: [],
      droppedAtStart: true,
    });
    expect(withDropped.cards.asks).toEqual([
      { section: "droppedAtStart", options: [], only: false },
      { section: "asks", card: "queue-board", options: ["a"], only: false },
    ]);
    expect(linesOf("检查第 1 轮\n疑问 1（Q15 还要做）  2a", withDropped)).toEqual([
      { textLine: 2, section: "droppedAtStart", kind: "noteOnly", note: "Q15 还要做", images: [] },
      {
        textLine: 2,
        section: "asks",
        card: "queue-board",
        kind: "option",
        option: "a",
        images: [],
      },
    ]);
  });

  it("新格式的页面数据填好卡片编号以后直接拿来算，回复对得回编号", () => {
    const sections = assignCardIds(pageSectionsSchema.parse(validPage));
    const target = legacyReplyPage({
      version: 1,
      stage: "think",
      round: 2,
      sections,
      queue: [{ id: "Q12", content: "队列看板的等待列" }],
      droppedAtStart: false,
    });
    const text = [
      "构思第 2 轮",
      "场景 保留：「S9 看队列」",
      "规范 删除：「状态标签」",
      "对齐 明白：「信息结构」",
      "队列 不做了：「Q12 队列看板的等待列」",
      "疑问 1a  2（去年十月）",
      "发现 1b",
      "提升 1a",
    ].join("\n");
    const lines = linesOf(text, target);
    expect(lines.map((line) => [line.section, line.card ?? line.queue, line.kind])).toEqual([
      ["scenes", "look-at-queue", "keep"],
      ["spec", sections.spec?.[1]?.id, "remove"],
      ["align", sections.align?.[0]?.id, "understood"],
      ["queue", "Q12", "queueDrop"],
      ["asks", "queue-board", "option"],
      ["asks", sections.asks?.[1]?.id, "noteOnly"],
      ["findings", sections.findings?.[0]?.id, "option"],
      // 提升卡只有一个方向，点了那个方向就是同意
      ["improvements", sections.improvements?.[0]?.id, "agree"],
    ]);
  });
});

describe("拆成一行一件事", () => {
  it("每一种行都对回区块和卡片编号，备注和图原样带着", () => {
    const text = [
      "构思第 3 轮",
      "场景 保留：「S9 看队列」",
      "场景 修改：「等待和出错（断网）」（第 2 步改成先断网〔图 1〕）",
      "规范 保留：「字号」",
      "规范 删除：「配色」",
      "对齐 明白：「交付线」（这一版做到哪里）",
      "对齐 不明白：「胃口」",
      "队列 不做了：「Q8 窄屏上的回复框」",
      "疑问 1b（两套都留着）  2（上周，用的是 Keynote）  3a",
      "发现 1c",
      "提升 1a",
      "想法：看板上等待的事单独放一列",
      "图：图 1=2e8f4d",
    ].join("\n");
    expect(linesOf(text)).toEqual([
      { textLine: 2, section: "scenes", card: "look-at-queue", kind: "keep", images: [] },
      {
        textLine: 3,
        section: "scenes",
        card: "offline",
        kind: "modify",
        note: "第 2 步改成先断网〔图 1〕",
        images: [{ n: 1, id: "2e8f4d" }],
      },
      { textLine: 4, section: "spec", card: "type-scale", kind: "keep", images: [] },
      { textLine: 5, section: "spec", card: "colors", kind: "remove", images: [] },
      {
        textLine: 6,
        section: "align",
        card: "delivery-line",
        kind: "understood",
        note: "这一版做到哪里",
        images: [],
      },
      { textLine: 7, section: "align", card: "appetite", kind: "notUnderstood", images: [] },
      { textLine: 8, section: "queue", kind: "queueDrop", queue: "Q8", images: [] },
      {
        textLine: 9,
        section: "asks",
        card: "queue-board",
        kind: "option",
        option: "b",
        note: "两套都留着",
        images: [],
      },
      {
        textLine: 9,
        section: "asks",
        card: "follow-up",
        kind: "noteOnly",
        note: "上周，用的是 Keynote",
        images: [],
      },
      { textLine: 9, section: "asks", card: "self-review", kind: "agree", images: [] },
      {
        textLine: 10,
        section: "findings",
        card: "block-hint",
        kind: "option",
        option: "c",
        images: [],
      },
      {
        textLine: 11,
        section: "improvements",
        card: "queue-filter",
        kind: "option",
        option: "a",
        images: [],
      },
      { textLine: 12, kind: "idea", note: "看板上等待的事单独放一列", images: [] },
    ]);
  });

  it("有选项的卡只写了备注，算只写了备注", () => {
    expect(linesOf("构思第 3 轮\n疑问 1（两个都不对）")).toEqual([
      {
        textLine: 2,
        section: "asks",
        card: "queue-board",
        kind: "noteOnly",
        note: "两个都不对",
        images: [],
      },
    ]);
  });

  it("只有一个方向的卡：点那个方向和写「同意」都算同意，写「否决」算否决", () => {
    const kinds = (text: string) => linesOf(text).map((line) => [line.kind, line.note]);
    expect(kinds("构思第 3 轮\n疑问 3a")).toEqual([["agree", undefined]]);
    // 更早的模板在这种卡上画的是同意和否决两个按钮
    expect(kinds("构思第 3 轮\n疑问 3同意")).toEqual([["agree", undefined]]);
    expect(kinds("构思第 3 轮\n疑问 3否决（挑刺交给评审）")).toEqual([["reject", "挑刺交给评审"]]);
  });

  it("场景和规范点了修改没写怎么改，模板替用户写的那一句不算备注", () => {
    const text =
      "构思第 3 轮\n场景 修改：「S9 看队列」（没写怎么改）  「等待和出错（断网）」（没写怎么改）";
    expect(linesOf(text).map((line) => [line.card, line.kind, line.note])).toEqual([
      ["look-at-queue", "modify", undefined],
      ["offline", "modify", undefined],
    ]);
  });

  it("取消队列事项对回队列编号：看板上的文字、不带编号的文字、开头的编号都认", () => {
    const queueOf = (name: string) => linesOf(`构思第 3 轮\n队列 不做了：「${name}」`)[0]?.queue;
    expect(queueOf("Q5 把「修复」改名成「落地」")).toBe("Q5");
    expect(queueOf("把「修复」改名成「落地」")).toBe("Q5");
    // 给出这一页以后内容改过，开头的编号还对得上
    expect(queueOf("Q8 窄屏上的回复框太小")).toBe("Q8");
    // 取消的先后照用户点的先后，和看板上的顺序无关
    const text = "构思第 3 轮\n队列 不做了：「Q8 窄屏上的回复框」  「Q5 把「修复」改名成「落地」」";
    expect(linesOf(text).map((line) => line.queue)).toEqual(["Q8", "Q5"]);
  });

  it("回到构思的卡按这一块自己的序号数，对回转成疑问以后的编号", () => {
    expect(linesOf("构思第 3 轮\n疑问 1a\n回到构思 1b", pageWithRethink)).toEqual([
      {
        textLine: 2,
        section: "asks",
        card: "queue-board",
        kind: "option",
        option: "a",
        images: [],
      },
      {
        textLine: 3,
        section: "asks",
        card: "rethink-part",
        kind: "option",
        option: "b",
        images: [],
      },
    ]);
  });

  it("想法从「想法：」到末尾，可以有几行和空行，最后一行「图：」不算在里面", () => {
    const text = "构思第 3 轮\n疑问 1a\n想法：第一件\n\n第二件〔图 2〕\n图：图 2=92c9d4";
    expect(linesOf(text).at(-1)).toEqual({
      textLine: 3,
      kind: "idea",
      note: "第一件\n\n第二件〔图 2〕",
      images: [{ n: 2, id: "92c9d4" }],
    });
  });
});

describe("备注", () => {
  it("备注可以有几行，里面可以有成对的括号，也可以有两个空格", () => {
    const text = [
      "构思第 3 轮",
      "疑问 1a（导出 pptx（可编辑）和 pdf",
      "2. 下一轮再说  还有 2b 那件事）  2（去年）",
      "发现 1a",
    ].join("\n");
    expect(linesOf(text).map((line) => [line.textLine, line.card, line.note])).toEqual([
      [2, "queue-board", "导出 pptx（可编辑）和 pdf\n2. 下一轮再说  还有 2b 那件事"],
      [3, "follow-up", "去年"],
      [4, "block-hint", undefined],
    ]);
  });

  it("备注里多写了半个右括号，取第一个后面接得上的右括号", () => {
    const text = "构思第 3 轮\n疑问 2（1）先改首页 2）再改列表）  3a";
    expect(linesOf(text).map((line) => [line.card, line.kind, line.note])).toEqual([
      ["follow-up", "noteOnly", "1）先改首页 2）再改列表"],
      ["self-review", "agree", undefined],
    ]);
  });

  it("备注里多写了半个左括号，也能找到结尾", () => {
    const text = "构思第 3 轮\n疑问 1b（我觉得（大概）  2（嗯）";
    expect(linesOf(text).map((line) => line.note)).toEqual(["我觉得（大概", "嗯"]);
  });

  it("备注没有右括号时报出来，不吞掉后面的行", () => {
    const text = "构思第 3 轮\n疑问 1a（先不改\n想法：列表视图（以后再说）";
    expect(problemsOf(text)).toEqual([{ kind: "noteUnclosed", line: 2, text: "1a（先不改" }]);
  });

  it("名字里带书名号和括号时，按这一页上的名字切开", () => {
    const text =
      "构思第 3 轮\n场景 修改：「等待和出错（断网）」（先断网）\n队列 不做了：「Q5 把「修复」改名成「落地」」";
    expect(linesOf(text).map((line) => [line.card ?? line.queue, line.note])).toEqual([
      ["offline", "先断网"],
      ["Q5", undefined],
    ]);
  });
});

describe("图", () => {
  it("〔图 N〕对上最后一行的标识，同一张在一行里只记一次，没提到的图不管", () => {
    const text =
      "构思第 3 轮\n疑问 1a（〔图 2〕和〔图 1〕，还是〔图 2〕）\n图：图 1=2e8f4d  图 2=92c9d4  图 3=3f68d3";
    expect(linesOf(text)[0]?.images).toEqual([
      { n: 2, id: "92c9d4" },
      { n: 1, id: "2e8f4d" },
    ]);
  });

  it("标识照最后一行写的收下，更早的模板写的是完整的三十二位", () => {
    const id = "c54a7437aeef357f9ddb8c709508f55d";
    expect(linesOf(`构思第 3 轮\n想法：这里〔图 1〕\n图：图 1=${id}`)[0]?.images).toEqual([
      { n: 1, id },
    ]);
  });

  it("〔图 N〕在最后一行没有标识时，报在〔图 N〕所在的行", () => {
    const text = "构思第 3 轮\n疑问 1a（第一行\n第二行〔图 3〕）\n图：图 1=2e8f4d";
    expect(problemsOf(text)).toEqual([{ kind: "imageUnknown", line: 3, n: 3 }]);
  });

  it("最后一行「图：」写法不对，或者同一个序号写了两次，都报出来", () => {
    expect(problemsOf("构思第 3 轮\n疑问 1a\n图：图1 2e8f4d")).toEqual([
      { kind: "imageLine", line: 3, text: "图：图1 2e8f4d" },
    ]);
    expect(problemsOf("构思第 3 轮\n疑问 1a\n图：图 1=2e8f4d  图 1=92c9d4")).toEqual([
      { kind: "imageLine", line: 3, text: "图：图 1=2e8f4d  图 1=92……" },
    ]);
  });
});

describe("对不上的地方", () => {
  it("卡号超出这一块的张数时，报出这一块有几张", () => {
    expect(problemsOf("构思第 3 轮\n疑问 1a  5b")).toEqual([
      { kind: "cardNumber", line: 2, block: "asks", n: 5, count: 3 },
    ]);
    expect(problemsOf("构思第 3 轮\n发现 0a")).toEqual([
      { kind: "cardNumber", line: 2, block: "findings", n: 0, count: 1 },
    ]);
  });

  it("这一页没有这一块的卡", () => {
    expect(problemsOf("构思第 3 轮\n回到构思 1a")).toEqual([
      { kind: "blockEmpty", line: 2, block: "rethink", n: 1 },
    ]);
  });

  it("选项不在卡上、卡上没有选项、普通的卡写了同意或否决、序号后面什么都没有", () => {
    expect(problemsOf("构思第 3 轮\n疑问 1d  2a  1否决  3b  3\n发现 1同意")).toEqual([
      { kind: "optionUnknown", line: 2, block: "asks", n: 1, option: "d", options: ["a", "b"] },
      { kind: "optionNone", line: 2, block: "asks", n: 2, option: "a" },
      { kind: "onlyWord", line: 2, block: "asks", n: 1, word: "否决" },
      { kind: "optionUnknown", line: 2, block: "asks", n: 3, option: "b", options: ["a"] },
      { kind: "itemEmpty", line: 2, block: "asks", n: 3 },
      { kind: "onlyWord", line: 3, block: "findings", n: 1, word: "同意" },
    ]);
  });

  it("名字在这一页上找不到，看板上没有这件事", () => {
    const text = [
      "构思第 3 轮",
      "场景 保留：「看主线」",
      "规范 修改：「动效」（快一点）",
      "对齐 明白：「交付」",
      "队列 不做了：「Q9 另一件事」",
    ].join("\n");
    expect(problemsOf(text)).toEqual([
      { kind: "nameUnknown", line: 2, block: "scenes", name: "看主线" },
      { kind: "nameUnknown", line: 3, block: "spec", name: "动效" },
      { kind: "nameUnknown", line: 4, block: "align", name: "交付" },
      { kind: "queueUnknown", line: 5, text: "Q9 另一件事" },
    ]);
  });

  it("同一张卡、同一项回复了两次，报在第二次，并写明第一次在哪一行", () => {
    const text = "构思第 3 轮\n场景 保留：「S9 看队列」\n场景 删除：「看队列」\n疑问 1a  1b";
    expect(problemsOf(text)).toEqual([
      { kind: "nameDuplicate", line: 3, block: "scenes", name: "看队列", first: 2 },
      { kind: "cardDuplicate", line: 4, block: "asks", n: 1, first: 4 },
    ]);
  });

  it("认不出来的行、按钮和项，报出原文，最多二十个字", () => {
    const text = [
      "构思第 3 轮",
      "好的，就按这个做，另外还有一件事想和你商量一下",
      "场景 留：「S9 看队列」",
      "提升 1a ，现在进入构思",
      "规范 保留：配色",
      "疑问 ",
    ].join("\n");
    expect(problemsOf(text)).toEqual([
      { kind: "lineUnknown", line: 2, text: "好的，就按这个做，另外还有一件事想和你商……" },
      { kind: "verdictUnknown", line: 3, block: "scenes", verdict: "留" },
      { kind: "cardItemUnknown", line: 4, block: "improvements", text: "，现在进入构思" },
      { kind: "nameItemUnknown", line: 5, block: "spec", text: "配色" },
      { kind: "lineUnknown", line: 6, text: "疑问" },
    ]);
  });

  it("「想法：」后面是空的", () => {
    expect(problemsOf("构思第 3 轮\n疑问 1a\n想法：\n图：图 1=2e8f4d")).toEqual([
      { kind: "ideaEmpty", line: 3 },
    ]);
  });

  it("所有的问题一次报出，按行号排，同一行按读到的先后", () => {
    const text = "检查第 2 轮\n疑问 9a\n想法：见〔图 4〕\n发现 1z";
    expect(problemsOf(text).map((problem) => [problem.line, problem.kind])).toEqual([
      [1, "headerMismatch"],
      [2, "cardNumber"],
      [3, "imageUnknown"],
    ]);
  });
});

describe("第一行", () => {
  it("阶段和轮号都对得上，才算这一页的回复", () => {
    const expected = "第 1 版的构思阶段（第 3 次）";
    expect(problemsOf("检查第 3 轮\n疑问 1a")).toEqual([
      { kind: "headerMismatch", line: 1, written: "检查第 3 轮", expected },
    ]);
    expect(problemsOf("构思第 2 轮\n疑问 1a")).toEqual([
      { kind: "headerMismatch", line: 1, written: "构思第 2 轮", expected },
    ]);
  });

  it("新的写法「第 1 版的构思阶段（第 3 次）」和旧的「构思第 3 轮」都认", () => {
    expect(linesOf("第 1 版的构思阶段（第 3 次）\n疑问 1a")).toHaveLength(1);
    expect(linesOf("第 1 版的构思阶段（第3次）\n疑问 1a")).toHaveLength(1);
    expect(linesOf("构思第 3 轮\n疑问 1a")).toHaveLength(1);
    const second = { ...page, version: 2, round: 1 };
    expect(linesOf("第 2 版的构思阶段\n疑问 1a", second)).toHaveLength(1);
  });

  it("新的写法里版本、阶段、次数有一样对不上，就报和这一页的不同", () => {
    const expected = "第 1 版的构思阶段（第 3 次）";
    for (const written of [
      "第 2 版的构思阶段（第 3 次）",
      "第 1 版的检查阶段（第 3 次）",
      "第 1 版的构思阶段",
    ]) {
      expect(problemsOf(`${written}\n疑问 1a`)).toEqual([
        { kind: "headerMismatch", line: 1, written, expected },
      ]);
    }
  });

  it("改名以前的「修复」当作落地", () => {
    const land = { ...page, stage: "land" as const, round: 13 };
    expect(linesOf("修复第 13 轮\n疑问 1a", land)).toHaveLength(1);
    expect(linesOf("落地第 13 轮\n疑问 1a", land)).toHaveLength(1);
  });

  it("没写第一行时的报错不写「轮」，写新的写法", () => {
    const issue = describeLegacyReplyProblem({
      kind: "headerMissing",
      line: 1,
      expected: "第 1 版的构思阶段",
    });
    expect(`${issue.message}${issue.hint}`).not.toMatch(/轮/u);
    expect(issue.hint).toBe("第一行写「第 1 版的构思阶段」，和这一页所在的阶段相同。");
  });

  it("没写第一行时照常拆后面的行，另报缺了第一行", () => {
    expect(problemsOf("疑问 1a  7b")).toEqual([
      { kind: "headerMissing", line: 1, expected: "第 1 版的构思阶段（第 3 次）" },
      { kind: "cardNumber", line: 1, block: "asks", n: 7, count: 3 },
    ]);
  });
});

describe("空的回复和写法上的出入", () => {
  it("什么都没点时复制出的那一句，和空的文字一样，得到零行", () => {
    expect(parseLegacyReply("还没有要复制的内容", page)).toEqual({ ok: true, value: [] });
    expect(parseLegacyReply(" \n", page)).toEqual({ ok: true, value: [] });
    expect(parseLegacyReply("构思第 3 轮", page)).toEqual({ ok: true, value: [] });
  });

  it("回车换行统一成换行，开头的字节顺序标记和首尾的空白去掉，中间的空行跳过", () => {
    const text = "\uFEFF构思第 3 轮\r\n疑问 1a（第一行\r\n第二行）\r\n\r\n发现 1b\r\n";
    expect(linesOf(text).map((line) => [line.textLine, line.note])).toEqual([
      [2, "第一行\n第二行"],
      [5, undefined],
    ]);
  });

  it("项与项之间空一格、行尾多几个空格也认", () => {
    expect(
      linesOf("构思第 3 轮\n疑问 1a 2（去年） 3a  \n发现 1b").map((line) => line.card),
    ).toEqual(["queue-board", "follow-up", "self-review", "block-hint"]);
  });

  it("项与项之间用全角空格或制表符隔开也认", () => {
    const text =
      "构思第 3 轮\n疑问 1a\u30002（去年）\t3a\n场景 保留：「S9 看队列」\u3000「等待和出错（断网）」";
    expect(linesOf(text).map((line) => [line.card, line.kind])).toEqual([
      ["queue-board", "option"],
      ["follow-up", "noteOnly"],
      ["self-review", "agree"],
      ["look-at-queue", "keep"],
      ["offline", "keep"],
    ]);
  });
});

describe("报错的文字", () => {
  const samples: Record<LegacyReplyProblemKind, LegacyReplyProblem> = {
    headerMissing: { kind: "headerMissing", line: 1, expected: "第 2 版的检查阶段" },
    headerMismatch: {
      kind: "headerMismatch",
      line: 1,
      written: "第 2 版的检查阶段",
      expected: "第 2 版的检查阶段（第 2 次）",
    },
    lineUnknown: { kind: "lineUnknown", line: 4, text: "好的" },
    verdictUnknown: { kind: "verdictUnknown", line: 2, block: "scenes", verdict: "留" },
    cardItemUnknown: { kind: "cardItemUnknown", line: 2, block: "improvements", text: "，接着做" },
    nameItemUnknown: { kind: "nameItemUnknown", line: 2, block: "spec", text: "配色" },
    blockEmpty: { kind: "blockEmpty", line: 2, block: "findings", n: 2 },
    cardNumber: { kind: "cardNumber", line: 3, block: "asks", n: 5, count: 3 },
    optionUnknown: {
      kind: "optionUnknown",
      line: 2,
      block: "asks",
      n: 2,
      option: "d",
      options: ["a", "b", "c"],
    },
    optionNone: { kind: "optionNone", line: 2, block: "asks", n: 2, option: "a" },
    onlyWord: { kind: "onlyWord", line: 2, block: "asks", n: 1, word: "否决" },
    itemEmpty: { kind: "itemEmpty", line: 2, block: "asks", n: 3 },
    nameUnknown: { kind: "nameUnknown", line: 2, block: "align", name: "交付" },
    queueUnknown: { kind: "queueUnknown", line: 2, text: "Q9 另一件事" },
    cardDuplicate: { kind: "cardDuplicate", line: 4, block: "asks", n: 1, first: 3 },
    nameDuplicate: { kind: "nameDuplicate", line: 3, block: "scenes", name: "看队列", first: 2 },
    noteUnclosed: { kind: "noteUnclosed", line: 2, text: "1a（先不改" },
    ideaEmpty: { kind: "ideaEmpty", line: 5 },
    imageUnknown: { kind: "imageUnknown", line: 3, n: 3 },
    imageLine: { kind: "imageLine", line: 6, text: "图：图1 2e8f4d" },
  };

  it.each(Object.values(samples))("$kind：写明什么不对、怎么改、在第几行", (problem) => {
    const issue = describeLegacyReplyProblem(problem);
    expect(issue.message).toMatch(/。$/u);
    expect(issue.hint).toMatch(/。$/u);
    expect(`${issue.message}${issue.hint}`).not.toMatch(/[{}]/u);
    expect(issue.where).toBe(`回复文字第 ${problem.line} 行`);
  });

  it("卡号对不上时写明这一块有几张、回复里写的是哪一张", () => {
    expect(describeLegacyReplyProblem(samples.cardNumber)).toEqual({
      message: "疑问只有 3 张卡，回复里写的是疑问 5。",
      hint: "疑问的序号是 1 到 3，按页面上的顺序数。",
      where: "回复文字第 3 行",
    });
  });

  it("按钮写错时列出这一块有的按钮", () => {
    expect(describeLegacyReplyProblem(samples.verdictUnknown).hint).toBe(
      "场景后面写保留、修改或删除，再加冒号。",
    );
    const align = { kind: "verdictUnknown", line: 2, block: "align", verdict: "懂了" } as const;
    expect(describeLegacyReplyProblem(align).hint).toBe("对齐后面写明白或不明白，再加冒号。");
  });

  it("给了文件时，在哪里写文件和行号", () => {
    const issue = describeLegacyReplyProblem(samples.headerMismatch, "rounds/v2-检查-3/reply.txt");
    expect(issue).toEqual({
      message: "回复写的是「第 2 版的检查阶段」，这一页是「第 2 版的检查阶段（第 2 次）」。",
      hint: "先确认贴的是这一页的回复。是的话，第一行改成「第 2 版的检查阶段（第 2 次）」。",
      where: "rounds/v2-检查-3/reply.txt 第 1 行",
    });
  });
});
