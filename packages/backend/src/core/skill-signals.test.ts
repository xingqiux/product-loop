import { describe, expect, it } from "vitest";
import { ruleHits } from "../store/schema/index.ts";
import { addQueueItem } from "./queue.ts";
import { skillSignals } from "./skill-signals.ts";
import { addProject, addRound, emptyCore, startAt, type TestCore } from "./testing.ts";

// 三类信号，时钟是假的：数据摆在假时钟的某一刻，再把「现在」拨到几天以后算。

const day = 24 * 60 * 60 * 1000;
const after = (days: number) => new Date(startAt.getTime() + days * day);

/** 记一条拦截。 */
function block(core: TestCore, project: string, rule: string, message: string, at: Date): void {
  core.ctx.db
    .insert(ruleHits)
    .values({
      createdAt: at,
      projectId: project,
      command: "page present",
      mode: "current",
      layer: "writing",
      rule,
      level: "block",
      message,
    })
    .run();
}

/** 两个项目：app 和 shop，都是新登记的。 */
async function twoProjects(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  addProject(core, "/work/shop");
  return core;
}

describe("反复被拦截的规矩", () => {
  it("只数十四天内的拦截，按次数排，写次数、项目数和最近一次的原文", async () => {
    const core = await twoProjects();
    block(core, "app", "writing.sentence.tooLong", "太早了，已过十四天。", after(-1));
    block(core, "app", "writing.sentence.tooLong", "一句超过六十字。", after(1));
    block(core, "shop", "writing.sentence.tooLong", "这句有七十字。", after(2));
    block(core, "shop", "writing.sentence.tooLong", "这句有八十字。", after(3));
    block(core, "app", "card.only.one", "只放一个选项。", after(4));
    block(core, "app", "card.only.one", "还是只放一个选项。", after(5));
    block(core, "app", "old.rule.gone", "旧版本的规矩。", after(6));
    block(core, "app", "old.rule.gone", "旧版本的规矩又拦了。", after(6.5));
    const now = after(14.5);
    const { blockedRules } = skillSignals(core.ctx.db, now);
    expect(blockedRules).toEqual([
      {
        rule: "writing.sentence.tooLong",
        // 规则登记表里有的，写它查什么的一句话；没有的（旧版本留下的记录）为空。
        summary: expect.stringMatching(/\S/u),
        count: 3,
        projects: 2,
        projectIds: ["shop", "app"],
        latestMessage: "这句有八十字。",
        latestAt: after(3).toISOString(),
      },
      {
        rule: "old.rule.gone",
        summary: null,
        count: 2,
        projects: 1,
        projectIds: ["app"],
        latestMessage: "旧版本的规矩又拦了。",
        latestAt: after(6.5).toISOString(),
      },
      {
        rule: "card.only.one",
        summary: expect.stringMatching(/\S/u),
        count: 2,
        projects: 1,
        projectIds: ["app"],
        latestMessage: "还是只放一个选项。",
        latestAt: after(5).toISOString(),
      },
    ]);
  });

  it("只拦截过一次的不叫反复，不列", async () => {
    const core = await twoProjects();
    block(core, "app", "writing.sentence.tooLong", "一句超过六十字。", after(1));
    block(core, "app", "writing.sentence.tooLong", "又一句超过六十字。", after(2));
    block(core, "shop", "card.only.one", "只放一个选项。", after(3));
    const { blockedRules } = skillSignals(core.ctx.db, after(4));
    expect(blockedRules.map((item) => item.rule)).toEqual(["writing.sentence.tooLong"]);
  });

  it("警告不算，最多列五条", async () => {
    const core = await twoProjects();
    core.ctx.db
      .insert(ruleHits)
      .values({
        createdAt: startAt,
        projectId: "app",
        command: "page present",
        mode: "current",
        layer: "writing",
        rule: "writing.sentence.long",
        level: "warn",
        message: "一句超过四十字。",
      })
      .run();
    for (const n of [1, 2, 3, 4, 5, 6]) {
      block(core, "app", `card.rule${n}`, "拦下了。", startAt);
      block(core, "app", `card.rule${n}`, "又拦下了。", after(0.5));
    }
    const { blockedRules } = skillSignals(core.ctx.db, after(1));
    expect(blockedRules).toHaveLength(5);
    expect(blockedRules.some((item) => item.rule === "writing.sentence.long")).toBe(false);
  });
});

describe("停在旧版本的项目", () => {
  it("版本为空是迁移未完成，第一段比软件小是停在旧版本，同一段的不算", async () => {
    const core = await emptyCore();
    addProject(core, "/work/new");
    addProject(core, "/work/legacy", { legacySource: "docs/" });
    core.sqlite.prepare("update projects set skill_version = '1.4.0' where id = 'new'").run();
    const { outdatedProjects } = skillSignals(core.ctx.db, startAt, "2.0.0");
    expect(outdatedProjects).toEqual([
      { project: "new", name: "new", skillVersion: "1.4.0", reason: "skillOutdated" },
      { project: "legacy", name: "legacy", skillVersion: null, reason: "migrationIncomplete" },
    ]);
    expect(
      skillSignals(core.ctx.db, startAt, "1.9.0").outdatedProjects.map((p) => p.project),
    ).toEqual(["legacy"]);
  });
});

describe("停了很多天的事", () => {
  it("进行中的阶段超过三天没有变化才算，项目里有新改动就重新算", async () => {
    const core = await twoProjects();
    addRound(core, "app", { version: 1, stage: "think", seq: 1, status: "open" });
    addRound(core, "shop", { version: 1, stage: "use", seq: 1, status: "waiting" });
    addRound(core, "shop", { version: 1, stage: "think", seq: 1, status: "closed" });
    expect(skillSignals(core.ctx.db, after(3)).stalledRounds).toEqual([]);
    const four = skillSignals(core.ctx.db, after(4.5)).stalledRounds;
    expect(four.map((item) => [item.project, item.round, item.status, item.days])).toEqual([
      ["app", "v1-构思-1", "open", 4],
      ["shop", "v1-使用-1", "waiting", 4],
    ]);
    // app 在第三天放进一件事，它的轮次就从这一刻重新算。
    core.setNow(after(3));
    addQueueItem(core.ctx, "app", { content: "补一张图", stage: "think", proposer: "ai" });
    const later = skillSignals(core.ctx.db, after(4.5)).stalledRounds;
    expect(later.map((item) => item.project)).toEqual(["shop"]);
  });

  it("队列事项待办或进行中超过七天没有变化才算，已完成的不算", async () => {
    const core = await twoProjects();
    addQueueItem(core.ctx, "app", { content: "老事", stage: "land", proposer: "ai" });
    core.setNow(after(5));
    addQueueItem(core.ctx, "app", { content: "较新的事", stage: "land", proposer: "ai" });
    core.sqlite.prepare("update queue_items set status = 'doing' where number = 2").run();
    addQueueItem(core.ctx, "shop", { content: "已经做完", stage: "land", proposer: "ai" });
    core.sqlite
      .prepare(
        "update queue_items set status = 'dropped', status_note = '不做' where project_id = 'shop'",
      )
      .run();
    expect(skillSignals(core.ctx.db, after(7)).stalledQueueItems).toEqual([]);
    const { stalledQueueItems } = skillSignals(core.ctx.db, after(8.5));
    expect(stalledQueueItems).toEqual([
      {
        project: "app",
        name: "app",
        item: "Q1",
        content: "老事",
        status: "todo",
        lastChangedAt: startAt.toISOString(),
        days: 8,
      },
    ]);
    const twelve = skillSignals(core.ctx.db, after(12.5)).stalledQueueItems;
    expect(twelve.map((item) => [item.item, item.status, item.days])).toEqual([
      ["Q1", "todo", 12],
      ["Q2", "doing", 7],
    ]);
  });
});
