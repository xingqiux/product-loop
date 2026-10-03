import { beijingDay } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { pushRevision } from "../mainline.ts";
import { addQueueItem, type QueueChange, transitionQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore, startAt, type TestCore } from "../testing.ts";
import { recordUseRun } from "../use/testing.ts";
import { fillPage, storedFill } from "./fill.ts";
import { presentPage } from "./present.ts";
import {
  deps,
  failure,
  hash,
  landRound,
  pageData,
  presentInput,
  registerBlobs,
  succeed,
} from "./testing.ts";
import { withdrawPage } from "./withdraw.ts";

// 后端填的部分：页头、窄带、队列看板、位置、原文摘录、这一轮开始时取消的事、更改的逐行对比。
// 给出时算好存下，之后不随队列和主线变化。读一页时另加状态和撤回的情况。

const dayMs = 24 * 60 * 60 * 1000;

/** 主线里的两个场景：S1 有两步，S2 有一步。 */
const mainline = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S1 看所有项目停在哪",
  "谁在什么时候用：你，每天打开工作台的第一眼。",
  "1. 打开工作台 → 看到每个项目一行。",
  "2. 点一个项目 → 看到它的版本进度。",
  "",
  "### S2 看队列",
  "谁在什么时候用：你，想知道还剩什么事的时候。",
  "1. 点队列 → 看到五列看板。",
  "",
].join("\n");

const move = (core: TestCore, id: string, change: QueueChange) =>
  succeed(transitionQueueItem(core.ctx, "app", id, change));

/**
 * 一轮落地做到一半：Q2 做完，Q3 开始时取消，另有一件在等的 Q4 和一件构思的 Q5。
 * Q4 放进来两天以后改成等待，Q5 放进来以后没动过。八天以后给出一页：疑问卡写了两个位置和一条文字来源，更改写的是文字的改前改后。
 */
async function halfway() {
  const core = await landRound();
  succeed(pushRevision(core.ctx, "app", { text: mainline, baseRevision: null, source: "cache" }));
  move(core, "Q2", { to: "done", evidence: "按钮下面写着已收到" });
  move(core, "Q3", { to: "dropped", reason: "Q2 已经顺带做了" });
  succeed(
    addQueueItem(core.ctx, "app", { content: "窄屏上的回复框", stage: "land", proposer: "ai" }),
  );
  succeed(
    addQueueItem(core.ctx, "app", { content: "看板要不要分组", stage: "think", proposer: "user" }),
  );
  core.setNow(new Date(startAt.getTime() + 2 * dayMs));
  move(core, "Q4", { to: "waiting", dependsOn: "等构思定下窄屏的布局" });
  core.setNow(new Date(startAt.getTime() + 8 * dayMs));

  const [ask] = pageData().asks;
  const data = {
    asks: [
      { ...ask, where: { scene: "S1", step: 2 } },
      {
        title: "规矩写在哪里",
        why: "规矩的说明散在几处。",
        sources: [{ name: "规矩的说明", file: "skill/SKILL.md", lines: "3-4", mark: [4] }],
        where: { scene: "S9", step: 1 },
      },
    ],
    changes: [
      {
        id: "change-wording",
        queue: ["Q2"],
        title: "说明改成一句话",
        problem: "说明写了两句。",
        fix: "合成一句。",
        textName: "说明",
        textBefore: "旧的说明\n不变的一行",
        textAfter: "新的说明\n不变的一行",
      },
    ],
  };
  const excerpt = {
    file: "skill/SKILL.md",
    lines: "3-4",
    text: "第三行\n第四行",
    fileHash: hash("f"),
  };
  const home = { path: "img/home.png", hash: hash("a") };
  const input = presentInput(data, { images: [home], excerpts: [excerpt] });
  const presented = succeed(presentPage(core.ctx, "app", input, deps));
  return { core, pageId: presented.page.id };
}

describe("后端填的部分", () => {
  it("使用阶段的页带着这个阶段最近一次运行，作为使用区块", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    succeed(pushRevision(core.ctx, "app", { text: mainline, baseRevision: null, source: "cache" }));
    succeed(addQueueItem(core.ctx, "app", { content: "走一遍看板", stage: "use", proposer: "ai" }));
    succeed(startRound(core.ctx, "app", { stage: "use" }));
    recordUseRun(core, { broken: true });
    registerBlobs(core);
    const ask = {
      queue: ["Q1"],
      title: "详情是空的",
      why: "点一件事以后右边没有东西。",
      sources: [{ name: "工作台首页", saw: "右边是空的。", img: "img/home.png" }],
    };
    const home = { path: "img/home.png", hash: hash("a") };
    const input = presentInput({ asks: [ask] }, { round: "v1-使用-1", images: [home] });
    const presented = succeed(presentPage(core.ctx, "app", input, deps));
    const { fill } = succeed(fillPage(core.ctx.db, presented.page.id));
    // 运行把主线里的每一步都走到：S1 两步、S2 一步，S1 的第 2 步断了。
    expect(fill.use).toMatchObject({
      round: "v1-使用-1",
      results: { pass: 2, broken: 1 },
      scenes: [
        { scene: "S1", steps: [{ result: "pass" }, { result: "broken" }] },
        { scene: "S2", steps: [{ result: "pass" }] },
      ],
    });
    expect(fill.landEvidence).toBeNull();
  });

  it("页头写项目的名称、阶段的标识、阶段和给出的那一天", async () => {
    const { core, pageId } = await halfway();
    const { fill } = succeed(fillPage(core.ctx.db, pageId));
    expect(fill.header).toEqual({
      system: "app",
      round: "v1-落地-1",
      legacyId: null,
      stage: "land",
      date: beijingDay(core.ctx.now()),
    });
  });

  it("阶段条列出五个阶段在这一版的次数和队列件数，不另写当前状态的一句话", async () => {
    const { core, pageId } = await halfway();
    const { fill } = succeed(fillPage(core.ctx.db, pageId));
    expect(fill.strip).toEqual({
      stages: [
        { stage: "think", rounds: [], queue: 1 },
        { stage: "use", rounds: [], queue: 0 },
        { stage: "check", rounds: [], queue: 0 },
        { stage: "land", rounds: [{ label: "v1-落地-1", status: "waiting" }], queue: 2 },
        { stage: "improve", rounds: [], queue: 0 },
      ],
    });
  });

  it("看板只摆没做完的事：在等的单独放，其余按阶段分列，停了七天的标出来", async () => {
    const { core, pageId } = await halfway();
    const { queue } = succeed(fillPage(core.ctx.db, pageId)).fill;
    const brief = (items: readonly { id: string; status: string; stale: boolean }[]) =>
      items.map((item) => `${item.id} ${item.status}${item.stale ? " 停得久" : ""}`);
    expect(brief(queue.waiting)).toEqual(["Q4 waiting"]);
    expect(queue.columns.map((column) => [column.stage, brief(column.items)])).toEqual([
      ["think", ["Q5 todo 停得久"]],
      ["use", []],
      ["check", []],
      ["land", ["Q1 doing"]],
      ["improve", []],
    ]);
    expect(queue.waiting[0]).toMatchObject({ dependsOn: "等构思定下窄屏的布局" });
    expect(queue.doneThisRound.map((item) => item.id)).toEqual(["Q1", "Q2"]);
  });

  it("落地阶段收尾以前，这个阶段做完的也列出先失败后通过的事，证据写改动的名字和提交", async () => {
    // 落地五步里那件改动对应 Q1，先失败后通过，还没改成已完成。
    const core = await landRound();
    move(core, "Q2", { to: "done", evidence: "按钮下面写着已收到" });
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const { queue } = succeed(fillPage(core.ctx.db, presented.page.id)).fill;
    expect(queue.doneThisRound).toEqual([
      { id: "Q1", content: "看板放到首页的第一屏", evidence: "看板放到首页，提交 2222222" },
      { id: "Q2", content: "提交以后写明回复被取走了", evidence: "按钮下面写着已收到" },
    ]);
  });

  it("停了七天按最近一次变动算：Q4 六天前改成等待，不算停得久，进行中的 Q1 也不算", async () => {
    const { core, pageId } = await halfway();
    const { queue } = succeed(fillPage(core.ctx.db, pageId)).fill;
    const all = [...queue.waiting, ...queue.columns.flatMap((column) => column.items)];
    expect(all.filter((item) => item.stale).map((item) => item.id)).toEqual(["Q5"]);
  });

  it("这个阶段开始时取消的事写编号、内容和原因", async () => {
    const { core, pageId } = await halfway();
    const { fill } = succeed(fillPage(core.ctx.db, pageId));
    expect(fill.droppedAtStart).toEqual([
      { id: "Q3", content: "场景的步骤写成动宾短语", reason: "Q2 已经顺带做了" },
    ]);
  });

  it("位置按场景编号从主线填场景名和这一步的文字，主线里没有的为空", async () => {
    const { core, pageId } = await halfway();
    const { where } = succeed(fillPage(core.ctx.db, pageId)).fill;
    expect(where.scenes).toEqual([
      { id: "S1", name: "看所有项目停在哪", steps: 2 },
      { id: "S2", name: "看队列", steps: 1 },
    ]);
    expect(where.places).toEqual([
      {
        scene: "S1",
        step: 2,
        name: "看所有项目停在哪",
        do: "点一个项目",
        expect: "看到它的版本进度。",
      },
      { scene: "S9", step: 1, name: null, do: null, expect: null },
    ]);
  });

  it("文字的更改算好逐行对比，按卡片编号对回更改", async () => {
    const { core, pageId } = await halfway();
    const { textDiffs } = succeed(fillPage(core.ctx.db, pageId)).fill;
    expect(textDiffs.map((diff) => diff.card)).toEqual(["change-wording"]);
    expect(textDiffs[0]?.rows.map((row) => row.k)).toEqual(["mix", "same"]);
  });

  it("原文摘录和截图随页面返回，使用区块先是空的", async () => {
    const { core, pageId } = await halfway();
    const page = succeed(fillPage(core.ctx.db, pageId));
    expect(page.excerpts).toEqual([
      {
        where: "asks[1].sources[0]",
        file: "skill/SKILL.md",
        lines: "3-4",
        start: 3,
        end: 4,
        mark: [4],
        text: "第三行\n第四行",
        fileHash: hash("f"),
      },
    ]);
    expect(page.images).toEqual([{ path: "img/home.png", hash: hash("a") }]);
    expect(page.fill).toMatchObject({ previousReplies: null, use: null });
    // 落地轮的页带着给出时落地五步的记录，作为工程证据。
    expect(page.fill.landEvidence).toMatchObject({ round: "v1-落地-1", complete: true });
    expect(page).toMatchObject({
      project: "app",
      round: "v1-落地-1",
      seq: 1,
      stage: "land",
      purpose: "ask",
      status: "presented",
      withdrawal: null,
    });
  });

  it("填的部分给出时存下，之后队列和主线再变，这一页看到的不变", async () => {
    const { core, pageId } = await halfway();
    const before = succeed(fillPage(core.ctx.db, pageId));
    move(core, "Q1", { to: "done", evidence: "看板在第一屏" });
    succeed(addQueueItem(core.ctx, "app", { content: "新的一件", stage: "check", proposer: "ai" }));
    const renamed = mainline.replace("S2 看队列", "S2 看队列看板");
    succeed(pushRevision(core.ctx, "app", { text: renamed, baseRevision: 1, source: "cache" }));
    expect(succeed(fillPage(core.ctx.db, pageId))).toEqual(before);
  });
});

describe("读一页", () => {
  it("撤回的页写撤回的时间、原因和代替它的那一页", async () => {
    const core = await landRound();
    const first = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    core.setNow(new Date(startAt.getTime() + 60_000));
    succeed(withdrawPage(core.ctx, "app", first.page.id, "标题写错了"));
    const withdrawn = succeed(fillPage(core.ctx.db, first.page.id));
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      withdrawal: { at: "2026-09-28T08:01:00.000Z", reason: "标题写错了", replacedBy: null },
    });
    const second = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(succeed(fillPage(core.ctx.db, first.page.id)).withdrawal?.replacedBy).toBe(
      second.page.id,
    );
  });

  it("没有这一页时返回 NOT_FOUND", async () => {
    const core = await landRound();
    expect(failure(fillPage(core.ctx.db, 99))).toMatchObject({ code: "NOT_FOUND", where: "99" });
  });
});

describe("早先存下的填充部分", () => {
  it("阶段条里的 current 读的时候去掉，其余原样", () => {
    const old = { strip: { stages: [], current: "现在是 v1-落地-1，等用户回复。" }, other: 1 };
    const fill = storedFill(old) as unknown as Record<string, unknown>;
    expect(fill.strip).toEqual({ stages: [] });
    expect(fill.other).toBe(1);
  });
});
