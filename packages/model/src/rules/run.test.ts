import { describe, expect, it } from "vitest";
import { copy } from "../copy/define.ts";
import { errorBody, errorBodySchema, issueSchema } from "../envelope.ts";
import type { Stage } from "../names.ts";
import { defineRule, type RuleContextOf, type RuleHit, sinceRelease } from "./rule.ts";
import { runRules, whereText } from "./run.ts";
import { type WritingSubject, writingRuleList } from "./writing.ts";

// 执行规则的测试。规则都是在这里现写的，只用来测执行的方式。登记的规则由 registry.test.ts 逐条查。

/** 一页假的数据：每一格写这一格要命中哪几条规则。 */
type Page = readonly (readonly string[])[];

const about = { summary: copy("示例"), basis: copy("示例") };
const noContext: RuleContextOf<never> = {};

type Options = {
  readonly level?: "block" | "warn";
  readonly since?: string;
  readonly stages?: readonly [Stage, ...Stage[]];
};

/** 一条示例规则：数据里哪一格写了它的名字，它就在哪一格命中一次。 */
function sampleRule(name: string, options: Options = {}) {
  const { level = "block", since = "2026-09-21", stages } = options;
  return defineRule({
    id: `demo.${name}`,
    level,
    scope: {
      subjects: ["page"],
      commands: ["page check"],
      ...(stages === undefined ? {} : { stages }),
    },
    since,
    needs: [],
    about,
    copy: {
      message: copy("第 {index} 格命中了 {name}。", { index: 1, name: "a" }),
      hint: copy("删掉第 {index} 格里的 {name}。", { index: 1, name: "a" }),
    },
    check: (page: Page): RuleHit<{ index: number; name: string }>[] =>
      page.flatMap((cell, index) =>
        cell.includes(name) ? [{ where: ["cells", index], params: { index, name } }] : [],
      ),
    samples: {
      base: { subject: [], context: noContext },
      hits: [
        {
          why: "第一格写了名字",
          subject: [[name]],
          expect: [{ where: ["cells", 0], params: { index: 0, name } }],
        },
      ],
    },
  });
}

const alpha = sampleRule("alpha");
const beta = sampleRule("beta", { level: "warn" });
const gamma = sampleRule("gamma");

describe("收齐全部命中", () => {
  const page: Page = [["alpha", "beta"], ["gamma"], ["alpha", "gamma", "beta"]];

  it("每条规则都跑完，一条规则的每一处都报，不在第一处停下", () => {
    const run = runRules([alpha, beta, gamma], page, noContext);
    expect(run.block.map((issue) => [issue.rule, issue.where])).toEqual([
      ["demo.alpha", "cells[0]"],
      ["demo.alpha", "cells[2]"],
      ["demo.gamma", "cells[1]"],
      ["demo.gamma", "cells[2]"],
    ]);
    expect(run.warn.map((issue) => [issue.rule, issue.where])).toEqual([
      ["demo.beta", "cells[0]"],
      ["demo.beta", "cells[2]"],
    ]);
    expect(run.skipped).toEqual([]);
  });

  it("顺序先按传进来的规则，同一条规则按检查函数给出的顺序", () => {
    const run = runRules([gamma, alpha], page, noContext);
    expect(run.block.map((issue) => [issue.rule, issue.where])).toEqual([
      ["demo.gamma", "cells[1]"],
      ["demo.gamma", "cells[2]"],
      ["demo.alpha", "cells[0]"],
      ["demo.alpha", "cells[2]"],
    ]);
  });

  it("同样的输入跑两次，结果相同", () => {
    const rules = [alpha, beta, gamma];
    expect(runRules(rules, page, noContext)).toEqual(runRules(rules, page, noContext));
  });

  it("没有命中时两组都是空的", () => {
    expect(runRules([alpha, beta], [["delta"]], noContext)).toEqual({
      block: [],
      warn: [],
      skipped: [],
    });
  });
});

describe("报错按文案表填好", () => {
  it("什么不对、怎么改、在哪里和规矩编号都带上", () => {
    expect(runRules([alpha], [[], ["alpha"]], noContext).block).toEqual([
      {
        rule: "demo.alpha",
        message: "第 1 格命中了 alpha。",
        hint: "删掉第 1 格里的 alpha。",
        where: "cells[1]",
      },
    ]);
  });

  it("文案没有怎么改、命中没写位置时，这两项不带", () => {
    const bare = defineRule({
      ...alpha,
      needs: [],
      copy: { message: copy("整页不对。") },
      check: (page: Page) => (page.length === 0 ? [{ params: {} }] : []),
    });
    expect(runRules([bare], [], noContext).block).toEqual([
      { rule: "demo.alpha", message: "整页不对。" },
    ]);
  });

  it("每条问题都合响应外壳的写法，拦截能直接拼成 RULE_BLOCKED 的报错", () => {
    const run = runRules([alpha, beta, gamma], [["alpha", "beta", "gamma"]], noContext);
    for (const issue of [...run.block, ...run.warn]) {
      expect(issueSchema.safeParse(issue).success).toBe(true);
    }
    const [first, ...rest] = run.block;
    if (first === undefined) throw new Error("应当有拦截");
    const body = errorBody("RULE_BLOCKED", [first, ...rest]);
    expect(errorBodySchema.safeParse(body).success).toBe(true);
    expect(body.total).toBe(2);
  });

  it("位置写成字段的路径，写好的位置原样用", () => {
    expect(whereText(["asks", 0, "sources", 1])).toBe("asks[0].sources[1]");
    expect(whereText(["rows", 0, 1])).toBe("rows[0][1]");
    expect(whereText([2, "title"])).toBe("[2].title");
    expect(whereText("Q12")).toBe("Q12");
  });
});

describe("历史页面模式", () => {
  const old = sampleRule("old", { since: "2026-09-20" });
  const current = sampleRule("current", { since: "2026-09-21" });
  const fresh = sampleRule("fresh", { since: sinceRelease });
  const rules = [old, current, fresh];
  const page: Page = [["old", "current", "fresh"]];
  const rulesOf = (run: ReturnType<typeof runRules>) => run.block.map((issue) => issue.rule);

  it("跳过起始日期晚于页面日期的规则，并列出跳过了哪几条", () => {
    const run = runRules(rules, page, noContext, { mode: "history", pageDate: "2026-09-21" });
    expect(rulesOf(run)).toEqual(["demo.old"]);
    expect(run.skipped).toEqual(["demo.current", "demo.fresh"]);
  });

  it("起始日期和页面日期是同一天的也跳过，那一页可能早于规则", () => {
    const run = runRules(rules, page, noContext, { mode: "history", pageDate: "2026-09-21" });
    expect(rulesOf(run)).toEqual(["demo.old"]);
    expect(run.skipped).toEqual(["demo.current", "demo.fresh"]);
  });

  it("起始日期之后生成的页面照常执行", () => {
    const run = runRules(rules, page, noContext, { mode: "history", pageDate: "2026-09-22" });
    expect(rulesOf(run)).toEqual(["demo.old", "demo.current"]);
    expect(run.skipped).toEqual(["demo.fresh"]);
  });

  it("2.0.0 还没发布，写 2.0.0 的规则对任何旧页面都跳过", () => {
    const run = runRules(rules, page, noContext, { mode: "history", pageDate: "2099-12-31" });
    expect(run.skipped).toEqual(["demo.fresh"]);
  });

  it("平时每条规则都执行，不看起始日期", () => {
    const run = runRules(rules, page, noContext);
    expect(rulesOf(run)).toEqual(["demo.old", "demo.current", "demo.fresh"]);
    expect(run.skipped).toEqual([]);
  });

  it("页面的日期写得不对时报错", () => {
    for (const pageDate of ["2026-9-20", "", "2026-02-30"]) {
      expect(() => runRules(rules, page, noContext, { mode: "history", pageDate })).toThrow(
        "历史页面模式要写页面的日期",
      );
    }
  });

  it("写作规则按页面的日期跳过：2026-09-21 的页面只查措辞", () => {
    const subject: WritingSubject = { kind: "text", text: "替人用的脚本走完了，红方的方案更好。" };
    const context = { writingSpec: { banned: [], exceptions: [] } };
    const history = runRules(writingRuleList, subject, context, {
      mode: "history",
      pageDate: "2026-09-21",
    });
    expect(history.block).toEqual([]);
    expect(history.warn.map((issue) => issue.rule)).toEqual(["writing.wording.redBlue"]);
    expect(history.skipped).toContain("writing.term.banned");
    expect(history.skipped).toContain("writing.term.quoted");
    const now = runRules(writingRuleList, subject, context);
    expect(now.block.map((issue) => issue.rule)).toEqual(["writing.term.banned"]);
  });
});

describe("只在某些阶段查的规则", () => {
  const thinkOnly = sampleRule("think", { stages: ["think"] });
  const page: Page = [["think"]];

  it("写明的阶段在范围里才执行，别的阶段不执行，也不算跳过", () => {
    expect(
      runRules([thinkOnly], page, noContext, { mode: "current", stage: "think" }).block,
    ).toHaveLength(1);
    expect(runRules([thinkOnly], page, noContext, { mode: "current", stage: "check" })).toEqual({
      block: [],
      warn: [],
      skipped: [],
    });
  });

  it("历史页面模式同样按阶段", () => {
    const options = { mode: "history", pageDate: "2026-09-21", stage: "land" } as const;
    expect(runRules([thinkOnly], page, noContext, options).block).toEqual([]);
  });

  it("没写阶段时报错，不猜", () => {
    expect(() => runRules([thinkOnly], page, noContext)).toThrow("规则 demo.think 只在构思查");
  });
});

describe("上下文", () => {
  it("少给了规则要的上下文时报错，写明是哪条规则", () => {
    const [banned] = writingRuleList;
    if (banned === undefined) throw new Error("写作规则是空的");
    const subject: WritingSubject = { kind: "text", text: "走查脚本走完了。" };
    expect(() => runRules([banned], subject, {} as never)).toThrow(
      "规则 writing.term.banned 要上下文 writingSpec",
    );
  });
});
