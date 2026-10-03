import { describe, expect, it } from "vitest";
import { type Change, noContext, pageWith } from "./cards.samples.ts";
import { runRules } from "./run.ts";
import { sourceRuleList } from "./sources.ts";

// 来源要写三种写法之一：card.source.visual。三种写法各自写全了没有，由数据定义查。

/** 改几处以后，这条规则报在哪里。 */
const where = (changes: readonly Change[]) =>
  runRules(sourceRuleList, pageWith(...changes), noContext).block.map((issue) => issue.where);

describe("来源的三种写法：card.source.visual", () => {
  it("截图、文字、用户的原话，写了哪一种都不报", () => {
    const shot = { name: "队列看板", saw: "五列。", img: "img/board.png" };
    const text = { name: "正文第三节", saw: "五个阶段。", file: "skill/SKILL.md", lines: "12" };
    const quote = { name: "用户说的", saw: "「看板太挤」", quote: true };
    expect(
      where([
        [
          ["asks", 1, "sources"],
          [shot, text, quote],
        ],
      ]),
    ).toEqual([]);
  });

  it("一种写法都没有的来源，每条各报一次，按区块、卡片和来源的顺序", () => {
    const changes: readonly Change[] = [
      [["improvements", 0, "sources", 0, "img"], undefined],
      [["asks", 1, "sources", 0, "quote"], undefined],
      [["asks", 0, "sources", 2, "quote"], undefined],
      [["asks", 0, "sources", 0, "img"], undefined],
    ];
    expect(where(changes)).toEqual([
      "asks[0].sources[0]",
      "asks[0].sources[2]",
      "asks[1].sources[0]",
      "improvements[0].sources[0]",
    ]);
  });

  it("报错写明是哪张卡的哪条来源，怎么改写明三种写法", () => {
    const run = runRules(
      sourceRuleList,
      pageWith([["findings", 0, "sources", 0, "img"], undefined]),
      noContext,
    );
    expect(run.block).toEqual([
      {
        rule: "card.source.visual",
        message:
          "发现问题「每一块名字下面的说明没有必要」的来源「报告网页现在的样子」没有写 img、file 或 quote。",
        hint: "界面的来源写 img，值是截图的路径。文字的来源写 file 和 lines，原文由命令摘录。用户的原话写 quote: true，原话写在 saw 里。",
        where: "findings[0].sources[0]",
      },
    ]);
  });
});
