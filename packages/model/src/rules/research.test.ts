import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Stage } from "../names.ts";
import type { AskCard } from "../page/card.ts";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import {
  researchApprovedSamples,
  researchReasonSamples,
  researchTierSamples,
} from "./research.samples.ts";
import { researchRuleList } from "./research.ts";
import { type RunOptions, runRules } from "./run.ts";

// 调研分档三条规则在总测试以外的情况：只查构思里带着外面来源的疑问卡，以及历史页面模式。

type Research = NonNullable<AskCard["research"]>;

const outside = {
  name: "Linear 的队列页",
  saw: "筛选放在列表上方。",
  img: "img/linear-queue.png",
  outside: true,
} as const;

const own = { name: "现在的队列页", saw: "筛选藏在菜单里。", img: "img/queue-now.png" };

/** 一张疑问卡。research 不写时这张卡没有调研。 */
function ask(title: string, sources: AskCard["sources"], research?: Research): AskCard {
  const card: AskCard = { title, why: "看板上写什么还没定。", sources };
  return research === undefined ? card : { ...card, research };
}

/** 命中写成「编号 位置」。 */
function hits(page: PageSections, options: RunOptions = { mode: "current", stage: "think" }) {
  const run = runRules(researchRuleList, page, {}, options);
  return [...run.block, ...run.warn].map((issue) => `${issue.rule} ${issue.where ?? ""}`);
}

describe("样本都是合格的页面数据", () => {
  const samples = [researchTierSamples, researchReasonSamples, researchApprovedSamples].flatMap(
    ({ base, hits: list }) => [
      ["基础数据", base.subject] as const,
      ...list.map((sample) => [sample.why, sample.subject] as const),
    ],
  );
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("只查构思里带着外面来源的疑问卡", () => {
  const page: PageSections = {
    asks: [
      ask("参考哪几家", [own, outside]),
      ask("不查的理由", [outside], { tier: "none" }),
      ask("深查的计划", [outside], { tier: "deep" }),
    ],
  };

  it("构思页上每张卡各报一处", () => {
    expect(hits(page)).toEqual([
      "research.tier asks[0].research",
      "research.reason asks[1].research.reason",
      "research.approved asks[2].research.approved",
    ]);
  });

  it("别的阶段不查", () => {
    const others: Stage[] = ["use", "check", "land", "improve"];
    for (const stage of others) {
      expect(hits(page, { mode: "current", stage }), stage).toEqual([]);
    }
  });

  it("没有外面来源的卡不查，写了不查或深查也不查，和旧脚本相同", () => {
    const inside: PageSections = {
      asks: [
        ask("参考哪几家", [own]),
        ask("不查的理由", [own], { tier: "none" }),
        ask("深查的计划", [own], { tier: "deep" }),
      ],
    };
    expect(hits(inside)).toEqual([]);
  });

  it("快查不用写理由和批的计划", () => {
    expect(hits({ asks: [ask("参考哪几家", [outside], { tier: "quick" })] })).toEqual([]);
  });
});

describe("历史页面模式", () => {
  it("三条都从 2026-09-21 起查，2026-09-20 的页面跳过", () => {
    const history = (pageDate: string): RunOptions => ({
      mode: "history",
      pageDate,
      stage: "think",
    });
    const page: PageSections = { asks: [ask("参考哪几家", [outside])] };
    const early = runRules(researchRuleList, page, {}, history("2026-09-21"));
    expect(early.skipped).toEqual(["research.tier", "research.reason", "research.approved"]);
    expect(early.block).toEqual([]);
    expect(hits(page, history("2026-09-22"))).toEqual(["research.tier asks[0].research"]);
  });
});
