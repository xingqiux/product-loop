import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { runRules } from "./run.ts";
import { scenesNameNumberSamples } from "./scenes.samples.ts";
import { scenesRuleList } from "./scenes.ts";

// 场景清单的规则在总测试以外的情况：哪些名字算写了编号，以及历史页面模式。

type SceneDraft = NonNullable<PageSections["scenes"]>[number];

const steps: SceneDraft["steps"] = [{ do: "打开工作台", expect: "每个项目一行" }];

/** 报了编号的名字。每个名字单独放进一页的场景清单里查。 */
function numbered(names: readonly string[]): string[] {
  return names.filter((name) => {
    const page: PageSections = { scenes: [{ name, steps }] };
    return runRules(scenesRuleList, page, {}).block.length > 0;
  });
}

describe("样本都是合格的页面数据", () => {
  const { base, hits } = scenesNameNumberSamples;
  const samples = [
    ["基础数据", base.subject] as const,
    ...hits.map((sample) => [sample.why, sample.subject] as const),
  ];
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("名字里写了编号", () => {
  it("S 加数字开头的都算，编号写错了也算", () => {
    const names = ["S12 看队列", "S1看队列", "S2：看队列", "s3 看队列", "S03 看队列"];
    expect(numbered(names)).toEqual(names);
  });

  it("旧主线的场景加编号、场景加书名号都算", () => {
    const names = ["场景二　讲师看分数", "场景 2：看队列", "场景「看队列」（新）"];
    expect(numbered(names)).toEqual(names);
  });

  it("只是以 S 或场景开头的词不算，编号写在名字中间也不算", () => {
    const names = [
      "SaaS 后台的首页",
      "SQL 查询页",
      "场景清单怎么排",
      "场景化的首页",
      "看 S1 的进度",
    ];
    expect(numbered(names)).toEqual([]);
  });

  it("每个带编号的场景各报一处，报在名字上", () => {
    const page: PageSections = {
      scenes: [
        { name: "S1 看队列", steps },
        { scene: "S2", name: "看主线", steps },
        { name: "场景三 看进度", steps },
      ],
    };
    const run = runRules(scenesRuleList, page, {});
    expect(run.block.map((issue) => issue.where)).toEqual(["scenes[0].name", "scenes[2].name"]);
  });
});

describe("历史页面模式", () => {
  it("起始写 2.0.0，旧页面的名字带着编号也跳过", () => {
    const page: PageSections = { scenes: [{ name: "S1 看所有项目停在哪", steps }] };
    const run = runRules(scenesRuleList, page, {}, { mode: "history", pageDate: "2026-09-28" });
    expect(run.block).toEqual([]);
    expect(run.skipped).toEqual(["scenes.name.number"]);
  });
});
