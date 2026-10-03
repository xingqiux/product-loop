import { describe, expect, it } from "vitest";
import { noContext, pageWith } from "./cards.samples.ts";
import type { PageSubject } from "./cards.ts";
import { optionRuleList } from "./options.ts";
import { runRules, whereText } from "./run.ts";

// 选项一级规则的边界：一格的长度怎么算，理由、代价、适用场景什么时候可以不写，选项长短怎么比。

function rule(id: string) {
  const found = optionRuleList.find((item) => item.id === id);
  if (found === undefined) throw new Error(`没有规则 ${id}`);
  return found;
}

/** 几条规则在一页上的命中，写成「编号 位置」。 */
function hits(ids: readonly string[], page: PageSubject): string[] {
  return ids.flatMap((id) =>
    rule(id)
      .check(page, noContext)
      .map((hit) => `${id} ${hit.where === undefined ? "" : whereText(hit.where)}`),
  );
}

describe("一格不超过六十字：card.cell.length", () => {
  const length = ["card.cell.length"];
  const cell = (text: string) => pageWith([["asks", 0, "options", 0, "diffs", 0], text]);

  it("六十个字不报，六十一个字报，报出写了几个字", () => {
    expect(hits(length, cell("字".repeat(60)))).toEqual([]);
    const found = rule("card.cell.length").check(cell("字".repeat(61)), noContext);
    expect(found.map((hit) => hit.params.length)).toEqual([61]);
  });

  it("一串英文、数字或路径算一个字，标点和空白不算，和句子的长度同一种算法", () => {
    expect(hits(length, cell(`见 v1-final:scripts/writing.py ${"字".repeat(58)}`))).toEqual([]);
    expect(hits(length, cell(`${"字".repeat(60)}${"，、。".repeat(10)}`))).toEqual([]);
    expect(hits(length, cell(`Electron ${"字".repeat(60)}`))).toEqual([
      "card.cell.length asks[0].options[0].diffs[0]",
    ]);
  });

  it("每个选项的每一格都查，超过的各报一次，按选项和格的顺序", () => {
    const long = "字".repeat(61);
    const page = pageWith(
      [
        ["asks", 0, "rows"],
        ["放在哪里", "要点几下"],
      ],
      [
        ["asks", 0, "options", 0, "diffs"],
        ["最下面一组。", long],
      ],
      [
        ["asks", 0, "options", 1, "diffs"],
        [long, "点一下。"],
      ],
    );
    expect(hits(length, page)).toEqual([
      "card.cell.length asks[0].options[0].diffs[1]",
      "card.cell.length asks[0].options[1].diffs[0]",
    ]);
  });
});

describe("理由、代价和适用场景：card.option.why、card.option.cost、card.option.when", () => {
  const three = ["card.option.why", "card.option.cost", "card.option.when"];
  /** 只写了差别的「不改」。 */
  const noChange = { key: "b", title: "不改", diffs: ["照旧。"] };

  it("发现卡的最后一个选项是「不改」，三格都可以不写", () => {
    // 基础数据里发现卡的选项 b 就是只写了差别的「不改」
    expect(hits(three, pageWith())).toEqual([]);
  });

  it("提升卡的最后一个选项也可以不写", () => {
    const page = pageWith(
      [["improvements", 0, "only"], undefined],
      [["improvements", 0, "options", 0, "when"], "事多的时候。"],
      [["improvements", 0, "options", 1], noChange],
      [["improvements", 0, "shared"], { text: "看板不变。" }],
    );
    expect(hits(three, page)).toEqual([]);
  });

  it("疑问卡的最后一个选项不能省，三格各报一次", () => {
    const page = pageWith([["asks", 0, "options", 1], noChange]);
    expect(hits(three, page)).toEqual([
      "card.option.why asks[0].options[1].why",
      "card.option.cost asks[0].options[1].cost",
      "card.option.when asks[0].options[1].when",
    ]);
  });

  it("迁移时挪进疑问的发现和提升，最后一个选项照旧可以不写（决定 189）", () => {
    for (const tag of ["发现问题", "提升"]) {
      const page = pageWith([["asks", 0, "options", 1], noChange], [["asks", 0, "tag"], tag]);
      expect(hits(three, page)).toEqual([]);
    }
  });

  it("发现卡不是最后一个的选项不能省", () => {
    const page = pageWith([["findings", 0, "options", 0], { ...noChange, key: "a" }]);
    expect(hits(three, page)).toEqual([
      "card.option.why findings[0].options[0].why",
      "card.option.cost findings[0].options[0].cost",
      "card.option.when findings[0].options[0].when",
    ]);
  });

  it("写了 only 的卡不用写适用场景，理由和代价照样要写", () => {
    const page = pageWith(
      [["asks", 0, "options", 1], undefined],
      [["asks", 0, "only"], true],
      [["asks", 0, "dropped"], [{ name: "单独一页", because: "用户每一页都要看队列。" }]],
      [["asks", 0, "options", 0, "when"], undefined],
      [["asks", 0, "options", 0, "cost"], undefined],
    );
    expect(hits(three, page)).toEqual(["card.option.cost asks[0].options[0].cost"]);
  });

  it("报错写明是哪张卡的哪个选项", () => {
    const page = pageWith([["asks", 0, "options", 1, "when"], undefined]);
    const run = runRules(optionRuleList, page, noContext);
    expect(run.block).toEqual([
      {
        rule: "card.option.when",
        message: "疑问「队列看板放在哪里」选项 b 没有写适用场景 when。",
        hint: "when 写什么情况下该选它。说不出来的选项是凑数的，删掉。只剩一个方向时，写 only 和 dropped。",
        where: "asks[0].options[1].when",
      },
    ]);
  });
});

describe("选项长短相差太多：card.options.balance", () => {
  const balance = ["card.options.balance"];

  /** 一个选项，篇幅正好是 size 个字，分在差别和代价两格里。 */
  function optionOf(key: string, size: number, char = "字") {
    const half = Math.ceil(size / 2);
    return { key, title: key, diffs: [char.repeat(half)], cost: char.repeat(size - half) };
  }

  /** 疑问卡换成篇幅分别是 a 和 b 个字的两个选项。 */
  function sized(a: number, b: number, char = "字"): PageSubject {
    return pageWith([
      ["asks", 0, "options"],
      [optionOf("a", a), optionOf("b", b, char)],
    ]);
  }

  it("最长的正好是最短的 2.2 倍时不提醒，再多一个字就提醒", () => {
    expect(hits(balance, sized(10, 22))).toEqual([]);
    expect(hits(balance, sized(10, 23))).toEqual(["card.options.balance asks[0].options"]);
  });

  it("理由、代价、适用场景和每一格差别都算进篇幅，标点也算", () => {
    const page = pageWith([["asks", 0, "options", 1, "when"], "。".repeat(80)]);
    expect(hits(balance, page)).toEqual(["card.options.balance asks[0].options"]);
  });

  it("字数按码位数，一个表情算一个字，和旧脚本相同", () => {
    expect(hits(balance, sized(10, 22, "👍"))).toEqual([]);
  });

  it("只比写了代价的选项，只剩一个时不比", () => {
    // 基础数据里发现卡的「不改」没有写代价，第一个选项写得再长也不提醒
    const page = pageWith([["findings", 0, "options", 0, "why"], "说明是多余的。".repeat(20)]);
    expect(hits(balance, page)).toEqual([]);
  });

  it("级别是警告，不拦截", () => {
    const page = sized(10, 23);
    const run = runRules(optionRuleList, page, noContext);
    expect(run.warn.map((issue) => issue.message)).toEqual([
      "疑问「队列看板放在哪里」的几个选项长短相差太多。",
    ]);
    expect(run.block.filter((issue) => issue.rule === "card.options.balance")).toEqual([]);
  });
});
