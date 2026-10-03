import {
  designSpecItem,
  mainlinePart,
  type RoundStatus,
  roundStatus as roundStatuses,
  type Stage,
  stage as stages,
} from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  productVersions,
  projects,
  queueItems,
  roundItems,
  rounds,
} from "../store/schema/index.ts";
import { mainlineStatus, pushRevision } from "./mainline.ts";
import { appSkillVersion, updateProject } from "./projects.ts";
import { addQueueItem, takeOutForRound, transitionQueueItem } from "./queue.ts";
import { allProjectStatuses, projectStatus, type StatusSources } from "./status.ts";
import {
  addProject,
  addRound,
  emptyCore,
  reservedDirs,
  startAt,
  type TestCore,
} from "./testing.ts";
import { writeTx } from "./tx.ts";
import { nextVersion } from "./versions.ts";

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const later = (ms: number) => new Date(startAt.getTime() + ms);

/** 查一个项目的状态，现在是假时钟的时间。 */
function status(core: TestCore, projectId: string, sources?: StatusSources) {
  const result = projectStatus(core.ctx.db, projectId, { now: core.ctx.now(), sources });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const zeroQueue = [
  { stage: "think", count: 0, stale: 0 },
  { stage: "use", count: 0, stale: 0 },
  { stage: "check", count: 0, stale: 0 },
  { stage: "land", count: 0, stale: 0 },
  { stage: "improve", count: 0, stale: 0 },
];

describe("一个项目的状态", () => {
  it("刚登记的项目：第 1 版，还没开始任何阶段，主线十个部分都缺，下一步是 ploop round start 构思", async () => {
    const core = await emptyCore();
    const project = addProject(core, "/work/app");
    expect(status(core, "app")).toEqual({
      project,
      version: {
        version: 1,
        status: "open",
        startedAt: startAt.toISOString(),
        endedAt: null,
        summary: null,
        endReason: null,
      },
      round: null,
      waitingPages: [],
      queue: zeroQueue,
      mainline: {
        revision: null,
        missingParts: mainlinePart.keys,
        missingDesignSpec: designSpecItem.keys,
      },
      skill: {
        version: appSkillVersion,
        current: appSkillVersion,
        doctor: null,
        newerRules: false,
      },
      lastChangedAt: startAt.toISOString(),
      idleDays: 0,
      next: ["ploop round start 构思"],
      warnings: [],
    });
  });

  it("阶段和标识取自当前这一版最近的一个阶段，标识写成 v2-落地-3", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "improve", seq: 1 });
    nextVersion(core.ctx, "app", "提升做完了");
    addRound(core, "app", { version: 2, stage: "land", seq: 1 });
    addRound(core, "app", { version: 2, stage: "check", seq: 1 });
    addRound(core, "app", { version: 2, stage: "land", seq: 2 });
    core.setNow(later(hour));
    addRound(core, "app", { version: 2, stage: "land", seq: 3, status: "open" });
    const got = status(core, "app");
    expect(got.version).toMatchObject({ version: 2, status: "open" });
    expect(got.round).toEqual({
      label: "v2-落地-3",
      version: 2,
      stage: "land",
      seq: 3,
      status: "open",
      startedAt: later(hour).toISOString(),
      closedAt: null,
      legacyId: null,
      summary: null,
    });
    // 落地阶段还没交计划，下一步就是交计划，「先做」里写了计划怎么写。
    expect(got.next).toEqual(["ploop land plan"]);
  });

  it.each<[Stage, RoundStatus, string[]]>([
    ["think", "open", ["ploop mainline check"]],
    ["use", "open", ["ploop use schema"]],
    ["check", "open", ["ploop page example --stage 检查"]],
    ["improve", "open", ["ploop page example --stage 提升"]],
    ["land", "open", ["ploop land plan"]],
    ["check", "waiting", ["ploop reply wait"]],
    // 回复处理完、拿出的事都有结果：开始下一个阶段时自动收尾。
    ["think", "replied", ["ploop round start 使用"]],
    ["land", "replied", ["ploop round close"]],
    ["think", "closed", ["ploop round start 使用"]],
    ["land", "closed", ["ploop round start 提升"]],
    ["improve", "closed", ["ploop round start 构思"]],
  ])("最近的一轮是 %s、状态是 %s 时，下一步是 %j", async (stage, roundStatus, next) => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage, seq: 1, status: roundStatus });
    const got = status(core, "app");
    expect(got.round).toMatchObject({ stage, status: roundStatus });
    expect(got.next).toEqual(next);
  });

  it.each(stages.keys.flatMap((key) => roundStatuses.keys.map((state) => [key, state] as const)))(
    "最近的阶段是 %s、%s 时，下一步是现在敲了就能成功的完整命令，没有占位符",
    async (key, state) => {
      const core = await emptyCore();
      addProject(core, "/work/app");
      addRound(core, "app", { version: 1, stage: key, seq: 1, status: state });
      const { next } = status(core, "app");
      expect(next.length).toBeGreaterThan(0);
      expect(next.join("\n")).not.toMatch(/[<>{}]/u);
    },
  );

  it("已回复的阶段没有没处理的回复行、拿出的事都有结果时，下一步直接开下一个阶段，落地除外", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "check", seq: 1, status: "replied" });
    // 落地队列里没有事，往下走就是提升。
    expect(status(core, "app").next).toEqual(["ploop round start 提升"]);
  });

  it("已回复的阶段还有进行中的事时，下一步是收尾：要先写结果", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addQueueItem(core.ctx, "app", { content: "检查里的事", stage: "check", proposer: "ai" });
    addRound(core, "app", { version: 1, stage: "check", seq: 1, status: "open" });
    const round = core.ctx.db.select({ id: rounds.id }).from(rounds).get()?.id ?? 0;
    expect(writeTx(core.ctx, (w) => takeOutForRound(w, round)).ok).toBe(true);
    const item = core.ctx.db.select({ id: queueItems.id }).from(queueItems).get()?.id ?? 0;
    core.ctx.db
      .insert(roundItems)
      .values({ roundId: round, queueItemId: item, takenAt: core.ctx.now() })
      .run();
    core.ctx.db.update(rounds).set({ status: "replied" }).run();
    expect(status(core, "app").next).toEqual(["ploop round close"]);
  });

  it("这个阶段的队列里还有待办的事，收尾以后先写再开一次同一个阶段，再写下一个阶段", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const put = (content: string, key: Stage) =>
      addQueueItem(core.ctx, "app", { content, stage: key, proposer: "ai" });
    put("检查里还有的事", "check");
    put("落地里的事", "land");
    addRound(core, "app", { version: 1, stage: "check", seq: 1, status: "closed" });
    // 进入落地不要设计规范，先做完检查的事，落地队列里有事，往下走就是落地。
    expect(status(core, "app").next).toEqual(["ploop round start 检查", "ploop round start 落地"]);
  });

  it("提升收尾以后到构思，队列里还有提升的事也一样：那时换新的一版，提升的事留到下一版", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addQueueItem(core.ctx, "app", { content: "还想加的功能", stage: "improve", proposer: "ai" });
    addRound(core, "app", { version: 1, stage: "improve", seq: 1, status: "closed" });
    expect(status(core, "app").next).toEqual(["ploop round start 构思"]);
  });

  it("使用阶段收尾以后进检查，设计规范没补齐时先看主线，不叫人去撞拦截", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "use", seq: 1, status: "closed" });
    const got = status(core, "app");
    expect(got.mainline.missingDesignSpec.length).toBeGreaterThan(0);
    expect(got.next).toEqual(["ploop mainline check"]);
  });

  it("结束一版以后，新的一版还没开始任何阶段", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "check", seq: 1 });
    nextVersion(core.ctx, "app", "跳过落地和提升");
    const got = status(core, "app");
    expect(got.version).toMatchObject({ version: 2, status: "open" });
    expect(got.round).toBeNull();
    expect(got.next).toEqual(["ploop round start 构思"]);
  });

  it("当前的一版已经结束时，下一步是开始构思阶段，那时自动进入下一版", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "land", seq: 13 });
    core.ctx.db
      .update(productVersions)
      .set({ status: "closed", endedAt: startAt })
      .where(and(eq(productVersions.projectId, "app"), eq(productVersions.version, 1)))
      .run();
    const got = status(core, "app");
    expect(got.version).toMatchObject({ version: 1, status: "closed" });
    expect(got.round).toMatchObject({ label: "v1-落地-13" });
    expect(got.next).toEqual(["ploop round start 构思"]);
  });

  it("迁移没完成的项目照常能查状态，下一步是 ploop doctor，警告里写明原因", async () => {
    const core = await emptyCore();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    addRound(core, "abei", { version: 1, stage: "land", seq: 1, status: "open" });
    const got = status(core, "abei");
    expect(got.skill).toEqual({
      version: null,
      current: appSkillVersion,
      doctor: "migrationIncomplete",
      newerRules: false,
    });
    expect(got.round).toMatchObject({ label: "v1-落地-1" });
    expect(got.next).toEqual(["ploop doctor"]);
    expect(got.warnings).toEqual([
      {
        message: "项目「abei」的迁移还没完成，要先做迁移检查。",
        hint: "运行 ploop doctor，按报告做完迁移。迁移完成以前，这个项目的旧文件仍可以用旧的脚本处理。",
      },
    ]);
  });

  it("停在旧版本 skill 的项目，状态的警告和改数据时的报错说法相同", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    core.ctx.db.update(projects).set({ skillVersion: "v1-final" }).run();
    const got = status(core, "app");
    expect(got.skill).toEqual({
      version: "v1-final",
      current: appSkillVersion,
      doctor: "skillOutdated",
      newerRules: false,
    });
    expect(got.next).toEqual(["ploop doctor"]);
    const write = updateProject(core.ctx, reservedDirs, "app", { name: "新名字" });
    expect(write.ok ? [] : [write.error]).toEqual(
      got.warnings.map((issue) => ({ code: "NEEDS_DOCTOR", ...issue })),
    );
    expect(got.warnings[0]?.message).toBe(
      "项目「app」停在 skill v1-final，现在的软件要求 0.0.1 以上。",
    );
  });

  it("在等的页和队列的件数由 StatusSources 给出，没给的阶段按 0 件算", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addRound(core, "app", { version: 1, stage: "check", seq: 1, status: "waiting" });
    const page = {
      id: 7,
      seq: 1,
      round: "v1-检查-1",
      purpose: "ask",
      presentedAt: startAt.toISOString(),
    } as const;
    const asked: string[] = [];
    const sources: StatusSources = {
      waitingPages: (_db, projectId) => {
        asked.push(projectId);
        return [page];
      },
      queueCounts: () => ({ check: 2, land: 5 }),
      staleCounts: () => ({ land: 2 }),
      mainline: mainlineStatus,
    };
    const got = status(core, "app", sources);
    expect(asked).toEqual(["app"]);
    expect(got.waitingPages).toEqual([page]);
    expect(got.queue).toEqual([
      { stage: "think", count: 0, stale: 0 },
      { stage: "use", count: 0, stale: 0 },
      { stage: "check", count: 2, stale: 0 },
      { stage: "land", count: 5, stale: 2 },
      { stage: "improve", count: 0, stale: 0 },
    ]);
    expect(got.next).toEqual(["ploop reply wait"]);
  });

  it("队列的件数默认从队列表取，每个阶段数待办、进行中、等待三种", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const put = (content: string, stage: Stage) => {
      const result = addQueueItem(core.ctx, "app", { content, stage, proposer: "ai" });
      if (!result.ok) throw new Error(result.error.message);
    };
    const move = (qid: string, change: Parameters<typeof transitionQueueItem>[3]) => {
      const result = transitionQueueItem(core.ctx, "app", qid, change);
      if (!result.ok) throw new Error(result.error.message);
    };
    put("构思里待办的事", "think");
    put("构思里取消的事", "think");
    put("检查里等待的事", "check");
    put("落地里待办的事", "land");
    put("落地里进行中的事", "land");
    put("落地里做完的事", "land");
    move("Q2", { to: "dropped", reason: "已经不成立" });
    move("Q3", { to: "waiting", dependsOn: "等构思定下场景" });
    addRound(core, "app", { version: 1, stage: "land", seq: 1, status: "open" });
    const round = core.ctx.db.select({ id: rounds.id }).from(rounds).get()?.id ?? 0;
    const taken = writeTx(core.ctx, (w) => takeOutForRound(w, round, [5, 6]));
    expect(taken.ok).toBe(true);
    move("Q6", { to: "done", evidence: "落地的改后截图" });
    // 八天以后：待办和等待的事停得久，进行中的不算。
    core.setNow(later(8 * day));
    expect(status(core, "app").queue).toEqual([
      { stage: "think", count: 1, stale: 1 },
      { stage: "use", count: 0, stale: 0 },
      { stage: "check", count: 1, stale: 1 },
      { stage: "land", count: 2, stale: 1 },
      { stage: "improve", count: 0, stale: 0 },
    ]);
  });

  it("主线缺哪几样默认取自最新的一版主线，标题下面是空的也算缺", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const text = [
      "## 一句话新闻稿",
      "给用 AI 写软件的人用的产品循环。",
      "",
      "## 给谁用",
      "",
      "## 场景清单",
      "",
      "### 看所有项目停在哪",
      "谁在什么时候用：你，每天打开工作台的第一眼。",
      "1. 打开工作台 → 看到每个项目停在哪一轮。",
      "",
      "## 设计规范",
      "",
      "### 配色",
      "蓝色表示能点。",
      "",
      "### 动效",
      "无，这是命令行产品。",
      "",
    ].join("\n");
    expect(pushRevision(core.ctx, "app", { text, baseRevision: null, source: "cache" }).ok).toBe(
      true,
    );
    const got = status(core, "app");
    expect(got.mainline).toEqual({
      revision: 1,
      missingParts: ["audience", "jobs", "nonGoals", "deliveryLine", "risks", "faq", "preMortem"],
      missingDesignSpec: designSpecItem.keys.filter(
        (item) => item !== "color" && item !== "motion",
      ),
    });
    expect(got.next).toEqual(["ploop round start 构思"]);
  });

  it("主线缺哪几样也由 StatusSources 给出", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const gaps = { revision: 4, missingParts: ["preMortem" as const], missingDesignSpec: [] };
    const asked: string[] = [];
    const got = status(core, "app", {
      waitingPages: () => [],
      queueCounts: () => ({}),
      staleCounts: () => ({}),
      mainline: (_db, projectId) => {
        asked.push(projectId);
        return gaps;
      },
    });
    expect(asked).toEqual(["app"]);
    expect(got.mainline).toEqual(gaps);
  });

  it("停了几天按事件表里最近一次改动算，改动以后从 0 算起", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    core.setNow(later(3 * day + 12 * hour));
    expect(status(core, "app")).toMatchObject({
      lastChangedAt: startAt.toISOString(),
      idleDays: 3,
    });
    updateProject(core.ctx, reservedDirs, "app", { name: "阿贝记账" });
    expect(status(core, "app")).toMatchObject({
      lastChangedAt: later(3 * day + 12 * hour).toISOString(),
      idleDays: 0,
    });
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(projectStatus(core.ctx.db, "ghost", { now: startAt })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });
});

describe("所有项目的状态", () => {
  it("有页在等的排在最前，其余按最近的改动排，新的在前", async () => {
    const core = await emptyCore();
    addProject(core, "/work/old");
    core.setNow(later(day));
    addProject(core, "/work/waiting");
    core.setNow(later(2 * day));
    addProject(core, "/work/recent");
    const sources: StatusSources = {
      waitingPages: (_db, projectId) =>
        projectId === "waiting"
          ? [
              {
                id: 1,
                seq: 1,
                round: "v1-构思-1",
                purpose: "ask",
                presentedAt: later(day).toISOString(),
              },
            ]
          : [],
      queueCounts: () => ({}),
      staleCounts: () => ({}),
      mainline: mainlineStatus,
    };
    const all = allProjectStatuses(core.ctx.db, { now: later(3 * day), sources });
    expect(all.map((row) => [row.project.id, row.idleDays])).toEqual([
      ["waiting", 2],
      ["recent", 1],
      ["old", 3],
    ]);
  });

  it("没有项目时是空的", async () => {
    const core = await emptyCore();
    expect(allProjectStatuses(core.ctx.db, { now: startAt })).toEqual([]);
  });
});
