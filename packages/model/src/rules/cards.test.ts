import { describe, expect, it } from "vitest";
import { basePage, noContext, pageWith } from "./cards.samples.ts";
import { cardRuleList, type PageRule, type PageSubject } from "./cards.ts";
import { optionRuleList } from "./options.ts";
import { allRules } from "./registry.ts";
import { sinceRelease } from "./rule.ts";
import { runRules, whereText } from "./run.ts";
import { sourceRuleList } from "./sources.ts";

// 卡片一级规则的边界，以及这一批十二条规则一起跑的情况。
// 每条规则最典型的命中写在样本里，由 registry.test.ts 逐条查。这里写样本以外的边界。

const batch: readonly PageRule[] = [...sourceRuleList, ...cardRuleList, ...optionRuleList];

function rule(id: string): PageRule {
  const found = batch.find((item) => item.id === id);
  if (found === undefined) throw new Error(`这一批没有规则 ${id}`);
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

/** 疑问卡第一个行名改成这样。 */
const rowName = (name: string) => pageWith([["asks", 0, "rows", 0], name]);

describe("行名不超过八个字：card.row.width", () => {
  const width = ["card.row.width"];

  it("八个汉字不报，九个报，和旧脚本的上限相同", () => {
    expect(hits(width, rowName("页面上出现的变化"))).toEqual([]);
    expect(hits(width, rowName("页面上会出现的变化"))).toEqual(["card.row.width asks[0].rows[0]"]);
  });

  it("两个英文字母或数字算一个字，单出的一个也算一个字", () => {
    expect(hits(width, rowName("支持 markdown 渲染"))).toEqual([]);
    expect(hits(width, rowName("abcdefghijklmnop"))).toEqual([]);
    const odd = rule("card.row.width").check(rowName("abcdefghijklmnopq"), noContext);
    expect(odd.map((hit) => hit.params.width)).toEqual([9]);
  });

  it("标点和空白不算", () => {
    expect(hits(width, rowName("页面上的变化（新的）"))).toEqual([]);
    expect(hits(width, rowName("页面 上的 变化 新的"))).toEqual([]);
  });

  it("没有选项的卡不查行名，旧脚本也只查带选项的卡", () => {
    const page = pageWith([["asks", 1, "rows"], ["一个超过八个字的行名写在这里"]]);
    expect(hits(width, page)).toEqual([]);
  });

  it("一张卡上几个行名超长，每个都报，按行的顺序", () => {
    const page = pageWith(
      [
        ["asks", 0, "rows"],
        ["页面上会出现的变化", "位置", "脚本会不会拦截这一页"],
      ],
      [
        ["asks", 0, "options", 0, "diffs"],
        ["最下面一组。", "左边。", "拦截。"],
      ],
      [
        ["asks", 0, "options", 1, "diffs"],
        ["一个入口。", "项目页。", "不拦截。"],
      ],
    );
    expect(hits(width, page)).toEqual([
      "card.row.width asks[0].rows[0]",
      "card.row.width asks[0].rows[2]",
    ]);
  });
});

describe("only 和 dropped：card.only.one、card.only.dropped、card.only.needed", () => {
  const only = ["card.only.one", "card.only.dropped", "card.only.needed"];
  const secondOption = {
    key: "b",
    title: "按提出者筛选",
    diffs: ["看板上方一个下拉框。"],
    why: "提出者多的项目好找。",
    cost: "多一个下拉框。",
  };
  const twoOptions = [
    [["improvements", 0, "options", 1], secondOption],
    [["improvements", 0, "shared"], { text: "筛选都放在看板上方。" }],
  ] as const;
  const dropped = [{ name: "按日期筛选", because: "用户按阶段找事。" }];

  it.each([
    ["一个选项，写了 only 和 dropped", basePage, []],
    [
      "写了 only，两个选项，没有 dropped，两条各报一次",
      pageWith(...twoOptions, [["improvements", 0, "dropped"], undefined]),
      ["card.only.one improvements[0].options", "card.only.dropped improvements[0].dropped"],
    ],
    [
      "一个选项，只写了 dropped",
      pageWith([["improvements", 0, "only"], undefined]),
      ["card.only.needed improvements[0].only"],
    ],
    [
      "一个选项，only 和 dropped 都没写，只报没写 only",
      pageWith(
        [["improvements", 0, "only"], undefined],
        [["improvements", 0, "dropped"], undefined],
      ),
      ["card.only.needed improvements[0].only"],
    ],
    ["两个选项，另外列出了排除掉的方向", pageWith([["asks", 0, "dropped"], dropped]), []],
    ["疑问卡删掉了全部选项，不报", pageWith([["asks", 0, "options"], undefined]), []],
  ] as const)("%s", (_why, page, expected) => {
    expect(hits(only, page)).toEqual(expected);
  });
});

describe("看法选的是卡上有的选项：card.stance.pick", () => {
  const pick = ["card.stance.pick"];

  it("选卡上的哪一个选项都可以", () => {
    expect(hits(pick, pageWith([["asks", 0, "stance", "pick"], "b"]))).toEqual([]);
  });

  it("写了 only 的卡，看法选的是那一个选项", () => {
    const page = pageWith([["improvements", 0, "stance"], { pick: "a", because: "阶段最常用。" }]);
    expect(hits(pick, page)).toEqual([]);
  });

  it("几张卡的看法都选错时，每张各报一次，按页面上的顺序", () => {
    const page = pageWith(
      [["improvements", 0, "stance"], { pick: "b", because: "阶段最常用。" }],
      [["asks", 0, "stance", "pick"], "c"],
    );
    expect(hits(pick, page)).toEqual([
      "card.stance.pick asks[0].stance.pick",
      "card.stance.pick improvements[0].stance.pick",
    ]);
  });
});

describe("这一批的十二条规则", () => {
  const ids = [
    "card.source.visual",
    "card.only.one",
    "card.only.dropped",
    "card.only.needed",
    "card.row.width",
    "card.shared.required",
    "card.stance.pick",
    "card.cell.length",
    "card.option.why",
    "card.option.cost",
    "card.option.when",
    "card.options.balance",
  ];

  it("都登记了，顺序是维护说明里的顺序", () => {
    expect(batch.map((item) => item.id)).toEqual(ids);
    const registered = allRules().filter((item) => ids.includes(item.id));
    expect(registered).toEqual(batch);
  });

  it("起始日期取旧脚本加上这一行的那一天，看法是新规则", () => {
    expect(Object.fromEntries(batch.map((item) => [item.id, item.since]))).toEqual({
      "card.source.visual": "2026-09-20",
      "card.only.one": "2026-09-20",
      "card.only.dropped": "2026-09-20",
      "card.only.needed": "2026-09-20",
      "card.row.width": "2026-09-21",
      "card.shared.required": "2026-09-21",
      "card.stance.pick": sinceRelease,
      "card.cell.length": "2026-09-21",
      "card.option.why": "2026-09-20",
      "card.option.cost": "2026-09-20",
      "card.option.when": "2026-09-20",
      "card.options.balance": "2026-09-20",
    });
  });

  /** 一页上改了好几处，这一批的规则各有命中。 */
  const messy = pageWith(
    [["findings", 0, "sources", 0, "img"], undefined],
    [["asks", 0, "sources", 0, "img"], undefined],
    [["asks", 0, "rows", 0], "页面上会出现的变化"],
    [["asks", 0, "options", 1, "when"], undefined],
    [["asks", 0, "options", 0, "why"], "去掉的是哪个根因。".repeat(12)],
    [["asks", 0, "stance", "pick"], "c"],
    [["findings", 0, "options", 0, "cost"], undefined],
    [["improvements", 0, "dropped"], undefined],
  );

  it("一页上的问题全部收齐，先按规则的顺序，同一条规则按页面上的顺序", () => {
    const run = runRules(batch, messy, noContext);
    expect(run.block.map((issue) => `${issue.rule} ${issue.where}`)).toEqual([
      "card.source.visual asks[0].sources[0]",
      "card.source.visual findings[0].sources[0]",
      "card.only.dropped improvements[0].dropped",
      "card.row.width asks[0].rows[0]",
      "card.stance.pick asks[0].stance.pick",
      "card.option.cost findings[0].options[0].cost",
      "card.option.when asks[0].options[1].when",
    ]);
    expect(run.warn.map((issue) => `${issue.rule} ${issue.where}`)).toEqual([
      "card.options.balance asks[0].options",
    ]);
  });

  it("报错按文案表填好：什么不对、怎么改和在哪里", () => {
    const [first] = runRules(batch, messy, noContext).block;
    expect(first).toEqual({
      rule: "card.source.visual",
      message: "疑问「队列看板放在哪里」的来源「报告网页现在的样子」没有写 img、file 或 quote。",
      hint: "界面的来源写 img，值是截图的路径。文字的来源写 file 和 lines，原文由命令摘录。用户的原话写 quote: true，原话写在 saw 里。",
      where: "asks[0].sources[0]",
    });
  });

  it("迁移旧页面时按页面的日期跳过当时还没有的规则", () => {
    const skipped = (pageDate: string) =>
      runRules(batch, messy, noContext, { mode: "history", pageDate }).skipped;
    expect(skipped("2026-09-19")).toEqual(ids);
    expect(skipped("2026-09-21")).toEqual([
      "card.row.width",
      "card.shared.required",
      "card.stance.pick",
      "card.cell.length",
    ]);
    // 看法是新规则，2.0.0 发布以前对任何旧页面都跳过
    expect(skipped("2026-09-22")).toEqual(["card.stance.pick"]);
  });
});
