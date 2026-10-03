import { describe, expect, it } from "vitest";
import { noContext, pageWith } from "./cards.samples.ts";
import type { PageRule, PageSubject } from "./cards.ts";
import { runRules, whereText } from "./run.ts";
import { titleRuleList } from "./titles.ts";

// 标题写成名字：card.title.name 的边界。最典型的命中写在样本里，由 registry.test.ts 逐条查。
// 这里写样本以外的：十六个字怎么数，四个标点各自拦不拦，哪些标题要查，历史页面为什么不查。

function titleRule(): PageRule {
  const [first] = titleRuleList;
  if (first === undefined) throw new Error("没有规则 card.title.name");
  return first;
}

const rule = titleRule();

/** 命中的位置，写成「asks[0].title」。 */
function hits(page: PageSubject): string[] {
  return rule.check(page, noContext).map((hit) => whereText(hit.where ?? ""));
}

const ask = (title: string) => pageWith([["asks", 0, "title"], title]);

describe("不超过 16 个字", () => {
  it("十六个汉字不报，十七个报，报出写了几个字", () => {
    expect(hits(ask("字".repeat(16)))).toEqual([]);
    const found = rule.check(ask("字".repeat(17)), noContext);
    expect(found.map((hit) => hit.params.problem)).toEqual(["标题有 17 个字，超过 16 个字。"]);
  });

  it("按显示宽度算：两个英文字母或数字算一个字，标点和空白不算", () => {
    expect(hits(ask("abcdefghijklmnopqrstuvwxyz012345"))).toEqual([]);
    expect(hits(ask("abcdefghijklmnopqrstuvwxyz0123456"))).toEqual(["asks[0].title"]);
    expect(hits(ask("队列看板 与 主线 的 对 应 关 系 图"))).toEqual([]);
  });

  it("用户指出的那一条更改的标题，是十七个字", () => {
    const page = pageWith([["changes", 0, "title"], "队列看板下面横着列出这一轮做完的事"]);
    expect(hits(page)).toEqual(["changes[0].title"]);
  });

  it("例子里写的名字不拦", () => {
    const page = pageWith([["changes", 0, "title"], "看板下方的完成列表"]);
    expect(hits(page)).toEqual([]);
  });
});

describe("不带「，。；：」", () => {
  it("四个标点各拦一次，报出是哪个", () => {
    for (const mark of ["，", "。", "；", "："]) {
      const found = rule.check(ask(`看板${mark}筛选`), noContext);
      expect(found.map((hit) => hit.params.problem)).toEqual([`标题里有「${mark}」，是一句话。`]);
    }
  });

  it("别的标点不拦：顿号、括号、问号、引号、英文的冒号和逗号", () => {
    for (const title of [
      "看板、筛选",
      "看板（新）",
      "看板放哪里？",
      "「看板」",
      "ploop: 看板",
      "a,b",
    ]) {
      expect(hits(ask(title)), title).toEqual([]);
    }
  });

  it("又长又带标点时，两条原因写在同一处，只报一次", () => {
    const found = rule.check(ask("这是一个很长很长很长的标题，写成了一句话"), noContext);
    expect(found).toHaveLength(1);
    expect(found[0]?.params.problem).toBe(
      "标题有 19 个字，超过 16 个字。标题里有「，」，是一句话。",
    );
  });
});

describe("查哪些标题", () => {
  it("三种卡片、选项、更改、图表的标题都查，每个各报一处，按页面上的顺序", () => {
    const long = "字".repeat(17);
    const page = pageWith(
      [["asks", 0, "title"], long],
      [["findings", 0, "title"], long],
      [["improvements", 0, "title"], long],
      [["asks", 0, "options", 1, "title"], long],
      [["changes", 1, "title"], long],
      [["asks", 0, "shared", "diagrams", 0, "title"], long],
    );
    expect(hits(page)).toEqual([
      "asks[0].title",
      "asks[0].options[1].title",
      "findings[0].title",
      "improvements[0].title",
      "changes[1].title",
      "asks[0].shared.diagrams[0].title",
    ]);
  });

  it("报错里写明是疑问、发现问题、提升、选项、更改还是图表", () => {
    const long = "字".repeat(17);
    const page = pageWith(
      [["asks", 0, "title"], long],
      [["findings", 0, "title"], long],
      [["improvements", 0, "title"], long],
      [["asks", 0, "options", 1, "title"], long],
      [["changes", 1, "title"], long],
      [["asks", 0, "shared", "diagrams", 0, "title"], long],
    );
    expect(rule.check(page, noContext).map((hit) => hit.params.kind)).toEqual([
      "疑问",
      "选项",
      "发现问题",
      "提升",
      "更改",
      "图表",
    ]);
  });

  it("场景、设计规范、术语的名字不查，它们的名字不叫标题，长短由别处管", () => {
    const page = pageWith(
      [["scenes", 0, "name"], "字".repeat(30)],
      [["align", 0, "name"], "字".repeat(30)],
    );
    expect(hits(page)).toEqual([]);
  });
});

describe("历史页面不重新校验", () => {
  const long = pageWith([["changes", 0, "title"], "字".repeat(17)]);

  it("现在写的页面拦下，报错给出改法", () => {
    const run = runRules([rule], long, noContext, { mode: "current" });
    expect(run.block).toHaveLength(1);
    expect(run.block[0]?.rule).toBe("card.title.name");
    expect(run.block[0]?.hint).toContain("改成一个名字，例如「看板下方的完成列表」，解释放进正文");
    expect(run.warn).toEqual([]);
  });

  it("迁移旧页面用历史页面模式，起始写 2.0.0 的这一条跳过", () => {
    const run = runRules([rule], long, noContext, { mode: "history", pageDate: "2026-09-20" });
    expect(run.block).toEqual([]);
    expect(run.skipped).toContain("card.title.name");
  });
});
