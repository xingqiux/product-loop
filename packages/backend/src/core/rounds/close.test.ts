import {
  type ErrorBody,
  errorBodySchema,
  issuesOf,
  mainlinePart,
  type QueueItem,
  type QueueStatus,
  type Result,
  type RoundStatus,
  type Stage,
  stage,
} from "@product-loop/model";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  cards,
  events,
  pages,
  productVersions,
  projects,
  queueEvents,
  queueItems,
  roundItems,
  rounds,
} from "../../store/schema/index.ts";
import { recordLandSteps } from "../pages/testing.ts";
import { addQueueItem, getQueueItem, type QueueChange, transitionQueueItem } from "../queue.ts";
import {
  addProject,
  addRound,
  emptyCore,
  mainlineText,
  pushMainline,
  startAt,
  type TestCore,
} from "../testing.ts";
import type { WriteContext } from "../tx.ts";
import { recordUseRun } from "../use/testing.ts";
import { closeRound, type RoundCloseInput, roundCloseRules, thinkLeaveMinParts } from "./close.ts";
import { startRound } from "./start.ts";

const hour = 60 * 60 * 1000;
const later = (ms: number) => new Date(startAt.getTime() + ms);

/**
 * 登记项目 app，队列是空的，还没有轮次。默认主线十个部分写全了：
 * 构思阶段收尾要主线写好一半以上，见规矩 think.leave。写 false 是还没交过主线。
 */
async function oneProject(withMainline = true): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  if (withMainline) pushMainline(core, mainlineText());
  return core;
}

/** 成功时取出结果，失败时抛出，测试随之失败。 */
function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 落地轮收尾要带上工作区的状态，这里写成干净的，land.commit.clean 的用例另写。 */
const close = (core: TestCore, round: string, input: RoundCloseInput) =>
  closeRound(core.ctx, "app", round, round.includes("落地") ? { worktree: [], ...input } : input);
const closed = (core: TestCore, round: string, input: RoundCloseInput) =>
  succeed(close(core, round, input));

/**
 * 项目里唯一的一轮给用户看了一页，落地轮收尾以前要有，见规矩 land.page.shown。
 * 只看的页要有更改卡才算；withChanges 写 false 是一张空页。返回页的编号。
 */
function showPage(
  core: TestCore,
  state: "presented" | "withdrawn" = "presented",
  options: { withChanges?: boolean; purpose?: "ask" | "view"; seq?: number } = {},
): number {
  const roundId = core.ctx.db.select().from(rounds).get()?.id;
  if (roundId === undefined) throw new Error("还没有开始任何一轮");
  const { withChanges = true, purpose = "view", seq = 1 } = options;
  const page = core.ctx.db
    .insert(pages)
    .values({
      projectId: "app",
      roundId,
      seq,
      purpose,
      status: state,
      withdrawnAt: state === "withdrawn" ? startAt : null,
      formatVersion: 1,
      sections: {},
      images: [],
      fill: {},
      presentedAt: startAt,
    })
    .returning()
    .get();
  if (withChanges) {
    core.ctx.db
      .insert(cards)
      .values({
        pageId: page.id,
        section: "changes",
        cardId: "c1",
        position: 0,
        title: "保存按钮完整可见",
        queue: [1],
        scenes: [],
      })
      .run();
  }
  return page.id;
}

/** 开始一轮，拿出这个阶段全部待办的事。 */
function started(core: TestCore, key: Stage): string {
  return succeed(startRound(core.ctx, "app", { stage: key })).round.label;
}

/** 放进一件事，提出者是 AI。 */
function add(core: TestCore, content: string, key: Stage): QueueItem {
  const input = { content, stage: key, proposer: "ai" } as const;
  return succeed(addQueueItem(core.ctx, "app", input)).item;
}

/** 在开着的一轮里改一件事的状态，变动记在这一轮上。 */
function move(core: TestCore, id: string, change: QueueChange): void {
  succeed(transitionQueueItem(core.ctx, "app", id, change));
}

const detail = (core: TestCore, id: string) => succeed(getQueueItem(core.ctx.db, "app", id));
const status = (core: TestCore, id: string): QueueStatus => detail(core, id).item.status;

/** 直接改一轮的状态。给出信息和回复的用例在第 40、43 步。 */
function setRoundStatus(core: TestCore, roundStatus: RoundStatus): void {
  core.ctx.db.update(rounds).set({ status: roundStatus }).run();
}

/** 库里几张表的行数。被拦截、冲突以后它们都不该变。 */
function rowCounts(core: TestCore) {
  const { db } = core.ctx;
  return [rounds, roundItems, productVersions, queueEvents, events].map(
    (table) => db.select({ n: count() }).from(table).get()?.n,
  );
}

/** 拿出的事：队列编号、结果、退回的阶段和说明，按编号排。 */
function roundItemRows(core: TestCore) {
  return core.ctx.db
    .select({
      number: queueItems.number,
      result: roundItems.result,
      returnedTo: roundItems.returnedTo,
      note: roundItems.note,
    })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .orderBy(queueItems.number)
    .all()
    .map(({ number, ...rest }) => ({ id: `Q${number}`, ...rest }));
}

/** 轮次表里这一轮的状态、收尾时间和收尾说明。 */
function roundRow(core: TestCore) {
  return core.ctx.db
    .select({ status: rounds.status, closedAt: rounds.closedAt, closeNote: rounds.closeNote })
    .from(rounds)
    .get();
}

/** 主线里两个场景：S1 两步，S2 一步。 */
const twoScenes = [
  "# 主线",
  "",
  "## 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：你，想知道还有哪些事没做时。",
  "1. 点队列 → 看到五列看板。",
  "2. 点一件事 → 右边摆出这件事的详情。",
  "",
  "### S2 在窄屏上看",
  "谁在什么时候用：你，窗口拉窄的时候。",
  "1. 把窗口拉窄 → 左边一栏换成图标。",
  "",
].join("\n");

describe("收尾：拿出的每件事都有结果", () => {
  it("进行中的事按请求记做完或退回，改过状态的按现在的状态记，这个阶段改成已收尾", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "写好新闻稿", "think");
    add(core, "定下交付线", "think");
    add(core, "看板的颜色", "think");
    add(core, "列出风险", "think");
    started(core, "think");
    move(core, "Q2", { to: "dropped", reason: "已经写进主线" });
    move(core, "Q3", { to: "done", evidence: "主线第 2 版写了新闻稿" });
    move(core, "Q4", { to: "waiting", dependsOn: "等用户定下给谁用" });
    move(core, "Q6", { to: "todo", note: "这一轮来不及" });
    core.setNow(later(hour));
    const result = closed(core, "v1-构思-1", {
      results: [
        { id: "Q5", result: "returned", note: " 要逐屏看，属于检查 ", stage: "check" },
        { id: "Q1", result: "done", note: "主线第 2 版写了给谁用" },
      ],
      summary: " 定下了给谁用和新闻稿 ",
    });
    expect(result.round).toEqual({
      label: "v1-构思-1",
      version: 1,
      stage: "think",
      seq: 1,
      status: "closed",
      startedAt: startAt.toISOString(),
      closedAt: later(hour).toISOString(),
      legacyId: null,
      summary: "定下了给谁用和新闻稿",
    });
    expect(result.summary).toBe("定下了给谁用和新闻稿");
    const rows = [
      { id: "Q1", result: "done", returnedTo: null, note: "主线第 2 版写了给谁用" },
      { id: "Q2", result: "droppedAtStart", returnedTo: null, note: "已经写进主线" },
      { id: "Q3", result: "done", returnedTo: null, note: "主线第 2 版写了新闻稿" },
      { id: "Q4", result: "returned", returnedTo: null, note: "等用户定下给谁用" },
      { id: "Q5", result: "returned", returnedTo: "check", note: "要逐屏看，属于检查" },
      { id: "Q6", result: "returned", returnedTo: null, note: "这一轮来不及" },
    ];
    expect(roundItemRows(core)).toEqual(rows);
    expect(
      result.items.map(({ item, ...rest }) => ({ id: item.id, ...rest, now: item.status })),
    ).toEqual(
      rows.map((row, i) => ({
        ...row,
        now: (["done", "dropped", "done", "waiting", "todo", "todo"] as const)[i],
      })),
    );
    expect(roundRow(core)).toEqual({
      status: "closed",
      closedAt: later(hour),
      closeNote: "定下了给谁用和新闻稿",
    });
    expect(detail(core, "Q1").item).toMatchObject({
      status: "done",
      evidence: "主线第 2 版写了给谁用",
    });
    const q5 = detail(core, "Q5");
    expect(q5.item).toMatchObject({ status: "todo", stage: "check" });
    expect(q5.events.at(-1)).toMatchObject({
      from: "doing",
      to: "todo",
      note: "要逐屏看，属于检查",
      round: "v1-构思-1",
    });
  });

  it("没有拿出任何事的阶段直接收尾，不写收尾说明时为空", async () => {
    const core = await oneProject();
    started(core, "think");
    const result = closed(core, "v1-构思-1", {});
    expect(result).toMatchObject({ round: { status: "closed" }, summary: null, items: [] });
    expect(roundRow(core)).toMatchObject({ status: "closed", closeNote: null });
  });

  it("开始时取消、又在回复里捞回的事，收尾时记退回", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    started(core, "think");
    move(core, "Q1", { to: "dropped", reason: "看起来已经不需要" });
    const restore = { to: "todo", note: "用户在回复里要回来" } as const;
    const context = { droppedAtRoundStart: true, namedInReply: true };
    succeed(transitionQueueItem(core.ctx, "app", "Q1", restore, context));
    expect(closed(core, "v1-构思-1", {}).items).toMatchObject([
      { item: { id: "Q1", status: "todo" }, result: "returned", note: "用户在回复里要回来" },
    ]);
  });

  it.each<RoundStatus>(["open", "waiting", "replied"])(
    "状态是 %s 的阶段都能收尾，落地阶段也一样",
    async (roundStatus) => {
      const core = await oneProject();
      add(core, "保存按钮在窄屏被挡住", "land");
      started(core, "land");
      recordLandSteps(core);
      showPage(core);
      setRoundStatus(core, roundStatus);
      const result = closed(core, "v1-落地-1", {
        results: [{ id: "Q1", result: "done", note: "窄屏截图里按钮完整显示" }],
      });
      expect(result.round.status).toBe("closed");
      expect(status(core, "Q1")).toBe("done");
    },
  );
});

describe("落地阶段收尾的检查", () => {
  /** 开着第一轮落地，拿出了 Q1。 */
  async function landOpen(): Promise<TestCore> {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    started(core, "land");
    return core;
  }
  const doneQ1 = { id: "Q1", result: "done" as const, note: "提交 3f2a9c1" };

  it("land.commit.clean：有没提交的文件时拦截并列出文件，什么都不写", async () => {
    const core = await landOpen();
    recordLandSteps(core);
    showPage(core);
    const worktree = [
      { root: "/work/app", files: ["src/app.ts", "README.md"] },
      { root: "/work/lib", files: [] },
    ];
    const result = closeRound(core.ctx, "app", "v1-落地-1", { results: [doneQ1], worktree });
    expect(result.ok ? [] : issuesOf(result.error)).toEqual([
      {
        rule: "land.commit.clean",
        message: "/work/app 里有 2 个文件没有提交：src/app.ts、README.md。",
        hint: "提交或还原这些改动，再收尾。",
        where: "/work/app",
      },
    ]);
    expect(status(core, "Q1")).toBe("doing");
  });

  it("land.commit.clean：没带工作区的状态时拦截；退回的事要写明退回哪个阶段", async () => {
    const core = await landOpen();
    showPage(core);
    const back = { id: "Q1", result: "returned" as const, note: "要先改定义" };
    const result = closeRound(core.ctx, "app", "v1-落地-1", { results: [back] });
    expect(result.ok ? [] : issuesOf(result.error).map((issue) => issue.message)).toEqual([
      "落地阶段收尾要带上工作区的状态。",
      "落地阶段退回的 Q1 没写退回哪个阶段。",
    ]);
    const again = { results: [{ ...back, stage: "think" as const }], worktree: [] };
    expect(closed(core, "v1-落地-1", again).round.status).toBe("closed");
  });

  it("land.steps：有做完的事时，五步缺的地方一次列出", async () => {
    const core = await landOpen();
    showPage(core);
    const result = closeRound(core.ctx, "app", "v1-落地-1", { results: [doneQ1], worktree: [] });
    expect(result.ok ? [] : issuesOf(result.error).map((issue) => issue.rule)).toEqual([
      "land.steps",
    ]);
    recordLandSteps(core);
    expect(closed(core, "v1-落地-1", { results: [doneQ1] }).round.status).toBe("closed");
  });

  it("land.page.shown：一页都没给用户看过时拦截，说明先运行 ploop page present，什么都不写", async () => {
    const core = await landOpen();
    recordLandSteps(core);
    const before = rowCounts(core);
    const result = closeRound(core.ctx, "app", "v1-落地-1", { results: [doneQ1], worktree: [] });
    expect(result.ok ? [] : issuesOf(result.error)).toEqual([
      {
        rule: "land.page.shown",
        message: "第 1 版的落地阶段还没有给用户看过要点的页，也没有给看过更改，不能收尾。",
        hint: "运行 ploop page present 给出验收页，用户看过以后再收尾。这个阶段不做了，运行 ploop round close --abort <原因>。",
        where: "第 1 版的落地阶段",
      },
    ]);
    expect(rowCounts(core)).toEqual(before);
    expect(roundRow(core)?.status).toBe("open");
  });

  it("land.page.shown：撤回的页不算给用户看过", async () => {
    const core = await landOpen();
    recordLandSteps(core);
    showPage(core, "withdrawn");
    const result = closeRound(core.ctx, "app", "v1-落地-1", { results: [doneQ1], worktree: [] });
    expect(result.ok ? [] : issuesOf(result.error).map((issue) => issue.rule)).toEqual([
      "land.page.shown",
    ]);
  });

  it("land.page.shown：空的只看页不算，带更改卡的只看页才算；全部退回时同样要看过一页", async () => {
    const core = await landOpen();
    const back = {
      id: "Q1",
      result: "returned" as const,
      note: "要先改定义",
      stage: "think" as const,
    };
    const blocked = closeRound(core.ctx, "app", "v1-落地-1", { results: [back], worktree: [] });
    expect(blocked.ok ? [] : issuesOf(blocked.error).map((issue) => issue.rule)).toEqual([
      "land.page.shown",
    ]);
    showPage(core, "presented", { withChanges: false });
    const empty = closeRound(core.ctx, "app", "v1-落地-1", { results: [back], worktree: [] });
    expect(empty.ok ? [] : issuesOf(empty.error).map((issue) => issue.rule)).toEqual([
      "land.page.shown",
    ]);
    showPage(core, "presented", { seq: 2 });
    expect(closed(core, "v1-落地-1", { results: [back] }).round.status).toBe("closed");
  });

  it.each<Stage>(["think", "improve"])("%s 阶段没给用户看过页也能收尾", async (key) => {
    const core = await oneProject();
    add(core, "有一件事", key);
    const round = started(core, key);
    const result = closed(core, round, { results: [{ id: "Q1", result: "done", note: "做完了" }] });
    expect(result.round.status).toBe("closed");
  });
});

describe("收尾不成", () => {
  it("进行中的事没写结果时拦截，一次列出每一件，什么都不写", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "写好新闻稿", "think");
    started(core, "think");
    const before = rowCounts(core);
    const received = core.received.length;
    const result = close(core, "v1-构思-1", {
      results: [{ id: "Q2", result: "done", note: "主线第 2 版写了事前验尸" }],
    });
    const issue = (id: string) => ({
      rule: roundCloseRules.result,
      message: `${id} 还没有结果，第 1 版的构思阶段不能收尾。`,
      hint: `写明 ${id} 做完还是退回。做完运行 ploop round close --done ${id}=<证据>。退回运行 ploop round close --return ${id}=<原因>。`,
      where: id,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "RULE_BLOCKED", ...issue("Q1"), issues: [issue("Q1"), issue("Q3")], total: 2 },
    });
    expect(result.ok || errorBodySchema.safeParse(result.error).success).toBe(true);
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(["Q1", "Q2", "Q3"].map((id) => status(core, id))).toEqual(["doing", "doing", "doing"]);
    expect(roundRow(core)).toEqual({ status: "open", closedAt: null, closeNote: null });
    expect(roundItemRows(core).map((row) => row.result)).toEqual([null, null, null]);
  });

  it("这个阶段里已经有结果的事又写了结果时拦截，和没有结果的事一起按编号报齐", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    started(core, "think");
    move(core, "Q1", { to: "dropped", reason: "已经写进主线" });
    const result = close(core, "v1-构思-1", {
      results: [{ id: "Q1", result: "done", note: "主线第 2 版写了给谁用" }],
    });
    expect(result.ok ? [] : result.error.issues).toEqual([
      {
        rule: "round.close.result",
        message: "Q1 在这个阶段里已经有了结果：开始时取消。",
        hint: "从请求里去掉 Q1，收尾时照已有的结果记下。",
        where: "Q1",
      },
      {
        rule: "round.close.result",
        message: "Q2 还没有结果，第 1 版的构思阶段不能收尾。",
        hint: "写明 Q2 做完还是退回。做完运行 ploop round close --done Q2=<证据>。退回运行 ploop round close --return Q2=<原因>。",
        where: "Q2",
      },
    ]);
    expect(status(core, "Q1")).toBe("dropped");
  });

  it("退回要写原因，没写时返回 BAD_REQUEST，什么都不写", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    started(core, "think");
    const before = rowCounts(core);
    expect(close(core, "v1-构思-1", { results: [{ id: "Q1", result: "returned" }] })).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "退回 Q1 要写原因。",
        hint: "写明为什么退回，例如「定义不对，先回到构思」。",
        where: "Q1",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(status(core, "Q1")).toBe("doing");
  });

  it("请求本身写错的地方返回 BAD_REQUEST，一次报齐", async () => {
    const core = await oneProject();
    const result = close(core, "v1-构思-1", {
      results: [
        { id: "q1", result: "done", note: "主线第 2 版写了给谁用" },
        { id: "Q1", result: "done", note: " " },
        { id: "Q1", result: "returned", note: "定义不对" },
        { id: "Q1", result: "returned", note: "定义还是不对" },
        { id: "Q2", result: "returned", note: "\n" },
        { id: "Q3", result: "done", note: "看过了", stage: "check" },
      ],
      summary: "  ",
    });
    expect(result.ok ? [] : result.error.issues).toEqual([
      {
        message: "队列事项的编号「q1」写法不对。",
        hint: "写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。",
        where: "q1",
      },
      {
        message: "Q1 做完要写完成证据。",
        hint: "写明看得见的证据，例如改后的截图或验收页所在的阶段。",
        where: "Q1",
      },
      { message: "Q1 的结果写了不止一次。", hint: "每件事只写一个结果：做完或退回。", where: "Q1" },
      {
        message: "退回 Q2 要写原因。",
        hint: "写明为什么退回，例如「定义不对，先回到构思」。",
        where: "Q2",
      },
      {
        message: "Q3 是做完的事，不写退回到哪个阶段。",
        hint: "去掉 Q3 的阶段再重跑。只有退回的事可以写阶段。",
        where: "Q3",
      },
      {
        message: "收尾说明是空的。",
        hint: "写一句这个阶段做了什么，或者不写收尾说明。",
        where: "summary",
      },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST", total: 6 } });
  });

  it("阶段的写法不对时返回 BAD_REQUEST，排在请求里别的问题前面", async () => {
    const core = await oneProject();
    const result = close(core, "v1-修复-1", {
      results: [{ id: "Q0", result: "done", note: "看过了" }],
    });
    expect(result.ok ? [] : result.error.issues).toEqual([
      {
        message: "阶段「v1-修复-1」用了改过名的阶段名「修复」。",
        hint: "「修复」现在叫「落地」，按新名字写。",
        where: "v1-修复-1",
      },
      { message: "队列事项的编号「Q0」写了 0。", hint: "队列事项从 Q1 起编号。", where: "Q0" },
    ]);
    expect(close(core, "v1-构思", {})).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "阶段「v1-构思」的写法不对。", where: "v1-构思" },
    });
  });

  it("请求里的事队列里没有、不是这个阶段拿出的，返回 NOT_FOUND，一次报齐", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "保存按钮在窄屏被挡住", "land");
    started(core, "think");
    const result = close(core, "v1-构思-1", {
      results: [
        { id: "Q9", result: "done", note: "看过了" },
        { id: "Q2", result: "returned", note: "留到落地" },
        { id: "Q1", result: "done", note: "主线第 2 版写了给谁用" },
      ],
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」的队列里没有 Q9。",
        hint: "运行 ploop queue list，查看这个项目的队列。",
        where: "Q9",
        issues: [
          {
            message: "项目「app」的队列里没有 Q9。",
            hint: "运行 ploop queue list，查看这个项目的队列。",
            where: "Q9",
          },
          {
            message: "第 1 版的构思阶段拿出的事里没有 Q2。",
            hint: '运行 ploop round show "第 1 版的构思阶段"，查看这个阶段拿出了哪几件。',
            where: "Q2",
          },
        ],
        total: 2,
      },
    });
    expect(status(core, "Q1")).toBe("doing");
  });

  it("找不到这个阶段返回 NOT_FOUND，已经收尾的返回 CONFLICT", async () => {
    const core = await oneProject();
    expect(close(core, "v1-构思-1", {})).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」没有第 1 版的构思阶段。",
        hint: "运行 ploop round list，查看这一版有哪几个阶段。",
        where: "第 1 版的构思阶段",
      },
    });
    started(core, "think");
    closed(core, "v1-构思-1", {});
    const before = rowCounts(core);
    expect(close(core, "v1-构思-1", { summary: "再收一次" })).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "第 1 版的构思阶段已经收尾了。",
        hint: "不用再收尾。运行 ploop status，查看下一步。",
        where: "第 1 版的构思阶段",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(roundRow(core)).toMatchObject({ closeNote: null });
  });

  it("项目不存在返回 NOT_FOUND，要先做迁移检查的返回 NEEDS_DOCTOR，什么都不写", async () => {
    const core = await oneProject();
    expect(closeRound(core.ctx, "ghost", "v1-构思-1", {})).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
    started(core, "think");
    core.ctx.db.update(projects).set({ skillVersion: null }).where(eq(projects.id, "app")).run();
    expect(close(core, "v1-构思-1", {})).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR", message: "项目「app」的迁移还没完成，要先做迁移检查。" },
    });
    expect(roundRow(core)).toMatchObject({ status: "open" });
  });

  it("带着请求编号重发时，返回第一次的结果，不报已经收尾", async () => {
    const core = await oneProject();
    started(core, "think");
    const idempotency = { key: "k1", operation: "POST /projects/:pid/rounds/:rid/close" };
    const ctx: WriteContext = { ...core.ctx, idempotency };
    const first = closeRound(ctx, "app", "v1-构思-1", { summary: "没有要做的事" });
    expect(first.ok).toBe(true);
    const received = core.received.length;
    expect(closeRound(ctx, "app", "v1-构思-1", { summary: "没有要做的事" })).toEqual(first);
    expect(core.received).toHaveLength(received);
  });
});

describe("事件和下一步", () => {
  it("提交以后按编号发出队列变动，再发出 round.closed，写明每种结果的事和收尾说明", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "写好新闻稿", "think");
    started(core, "think");
    move(core, "Q3", { to: "dropped", reason: "已经写进主线" });
    const before = core.received.length;
    closed(core, "v1-构思-1", {
      results: [
        { id: "Q2", result: "returned", note: "等用户先定下给谁用" },
        { id: "Q1", result: "done", note: "主线第 2 版写了给谁用" },
      ],
      summary: "定下了给谁用",
    });
    const sent = core.received.slice(before);
    expect(sent.map((event) => [event.kind, event.objectType, event.objectId])).toEqual([
      ["queue.moved", "queueItem", "Q1"],
      ["queue.moved", "queueItem", "Q2"],
      ["round.closed", "round", "v1-构思-1"],
    ]);
    expect(sent.at(-1)).toMatchObject({
      session: "session-1",
      client: "cli/2.0.0",
      detail: { done: ["Q1"], returned: ["Q2"], droppedAtStart: ["Q3"], summary: "定下了给谁用" },
    });
    expect(sent.at(-1)?.detail).not.toHaveProperty("auto");
    expect(core.ctx.db.select({ n: count() }).from(events).get()?.n).toBe(core.received.length);
  });

  it.each<[Stage, string[]]>([
    ["think", ["ploop round start 使用"]],
    // 设计规范还没补齐，进入检查会被拦下，所以先看主线。
    ["use", ["ploop mainline check"]],
    // 落地队列里没有事，不开落地，直接到提升。
    ["check", ["ploop round start 提升"]],
    ["land", ["ploop round start 提升"]],
    // 主线还没写全，新的一版先从构思开始。
    ["improve", ["ploop round start 构思"]],
  ])("%s轮收尾以后的下一步：队列里没有这个阶段的事，就进下一个阶段", async (key, next) => {
    // 下一步取决于主线有没有写全，这里要还没交过主线的项目。
    const core = await oneProject(key === "think");
    addRound(core, "app", { version: 1, stage: key, seq: 1, status: "open" });
    if (key === "use") recordUseRun(core);
    if (key === "land") showPage(core);
    expect(closed(core, `v1-${stage.label(key)}-1`, {}).next).toEqual(next);
  });

  it("队列里还有这个阶段的待办事项时，先写再开一次这个阶段，再写往下走的阶段（R02）", async () => {
    const core = await oneProject();
    started(core, "think");
    add(core, "还没想清楚的场景", "think");
    expect(closed(core, "v1-构思-1", {}).next).toEqual([
      "ploop round start 构思",
      "ploop round start 使用",
    ]);
  });

  it("检查收尾以后落地队列里有事，下一步是落地，没有事就跳过落地", async () => {
    const core = await oneProject();
    pushMainline(core, mainlineText());
    started(core, "check");
    add(core, "要改的按钮", "land");
    expect(closed(core, "v1-检查-1", {}).next).toEqual(["ploop round start 落地"]);
  });

  it("提升收尾以后开新的一版：主线齐全、构思队列没有事，从使用开始；构思队列有事，从构思开始", async () => {
    const core = await oneProject();
    pushMainline(core, mainlineText());
    started(core, "improve");
    expect(closed(core, "v1-提升-1", {}).next).toEqual(["ploop round start 使用"]);
    const other = await oneProject();
    pushMainline(other, mainlineText());
    started(other, "improve");
    add(other, "还没想清楚的场景", "think");
    expect(closed(other, "v1-提升-1", {}).next).toEqual(["ploop round start 构思"]);
  });

  it("提升收尾以后到构思，队列里还有提升的事也一样，开始构思时换新的一版（决定 205）", async () => {
    const core = await oneProject(false);
    started(core, "improve");
    add(core, "还想加的功能", "improve");
    const result = closed(core, "v1-提升-1", {});
    expect(result.next).toEqual(["ploop round start 构思"]);
    const next = succeed(startRound(core.ctx, "app", { stage: "think" }));
    expect(next.round.label).toBe("v2-构思-1");
    expect(next.versionChange).toMatchObject({
      ended: { version: 1, status: "closed" },
      started: { version: 2 },
    });
  });

  describe("构思阶段收尾：主线十个部分至少写好一半（think.leave）", () => {
    const parts = mainlinePart.keys;

    it("还没交过主线：拦截，写明先写主线再 push", async () => {
      const core = await oneProject(false);
      started(core, "think");
      const result = close(core, "v1-构思-1", {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("RULE_BLOCKED");
      expect(issuesOf(result.error)).toMatchObject([
        {
          rule: roundCloseRules.thinkLeave,
          message: "还没有交过主线，第 1 版的构思阶段不能收尾。",
          hint: "写好项目缓存里的主线.md，运行 ploop mainline push。至少要写到十个部分里的 5 个。",
        },
      ]);
    });

    it("只写了 4 个部分：拦截，写明有几个、缺几个和至少要几个；写到 5 个就放行", async () => {
      const core = await oneProject(false);
      pushMainline(core, mainlineText(parts.slice(4)));
      started(core, "think");
      const blocked = close(core, "v1-构思-1", {});
      expect(blocked.ok).toBe(false);
      if (blocked.ok) return;
      expect(issuesOf(blocked.error)).toMatchObject([
        {
          rule: "think.leave",
          message: "主线十个部分只写了 4 个，缺 6 个，第 1 版的构思阶段不能收尾。",
          // 写明缺哪几个部分：写了前 4 个，缺后 6 个。
          hint: `缺的部分：${parts
            .slice(4)
            .map((part) => mainlinePart.label(part))
            .join(
              "、",
            )}。先把主线补到至少 5 个部分，改完运行 ploop mainline push。还不想收尾，就不必收尾，接着做这个阶段。`,
          where: "主线.md",
        },
      ]);
      // 阶段没有被收尾。
      expect(core.ctx.db.select().from(rounds).get()?.status).not.toBe("closed");
      pushMainline(core, mainlineText(parts.slice(5)));
      expect(closed(core, "v1-构思-1", {}).round.status).toBe("closed");
    });

    it("阈值是一半：缺 5 个、写了 5 个放行；上限写在 thinkLeaveMinParts", async () => {
      expect(thinkLeaveMinParts).toBe(5);
      const core = await oneProject(false);
      pushMainline(core, mainlineText(parts.slice(0, 5)));
      started(core, "think");
      expect(closed(core, "v1-构思-1", {}).round.status).toBe("closed");
    });

    it("放弃这个阶段不查：主线没写也能 --abort", async () => {
      const core = await oneProject(false);
      started(core, "think");
      expect(closed(core, "v1-构思-1", { abort: "先不做" }).round.status).toBe("closed");
    });

    it("别的阶段收尾不查主线", async () => {
      const core = await oneProject(false);
      addRound(core, "app", { version: 1, stage: "improve", seq: 1, status: "open" });
      expect(closed(core, "v1-提升-1", {}).round.status).toBe("closed");
    });
  });

  it("使用阶段还没有运行：拦截，规矩是 use.leave", async () => {
    const core = await oneProject();
    started(core, "use");
    const result = closeRound(core.ctx, "app", "v1-使用-1", {});
    if (result.ok) throw new Error("应当拦截");
    expect(issuesOf(result.error).map((issue) => [issue.rule, issue.message])).toEqual([
      [roundCloseRules.useLeave, "第 1 版的使用阶段还没有收进使用代码的运行，看不出有没有断点。"],
    ]);
  });

  it("使用阶段最近一次运行有断点、覆盖表有缺口：各报一处", async () => {
    const core = await oneProject();
    started(core, "use");
    recordUseRun(core);
    const gap = "| 东西 | 场景 |\n| --- | --- |\n| 队列看板 | S1 |\n| 导出按钮 | |";
    recordUseRun(core, { broken: true, coverage: gap });
    const result = closeRound(core.ctx, "app", "v1-使用-1", {});
    if (result.ok) throw new Error("应当拦截");
    expect(issuesOf(result.error).map((issue) => issue.message)).toEqual([
      "这个阶段最近一次运行有 1 步断了：S1 第 2 步。",
      "覆盖表有 1 行没有场景用到：导出按钮。",
    ]);
  });

  it("使用阶段最近一次运行没走到主线里的步：拦截，写明哪几步（A03，决定 215）", async () => {
    const core = await oneProject();
    pushMainline(core, twoScenes);
    started(core, "use");
    recordUseRun(core, { skipScenes: [2] });
    const result = closeRound(core.ctx, "app", "v1-使用-1", {});
    if (result.ok) throw new Error("应当拦截");
    expect(issuesOf(result.error)).toEqual([
      {
        rule: roundCloseRules.useLeave,
        message: "主线里有 1 步最近一次运行没走到：S2 第 1 步。",
        hint: "让使用代码把这几步走到，再运行一次。主线里已经不用的步，先改主线。",
        where: "第 1 版的使用阶段",
      },
    ]);
    // 补上没走到的场景重新运行，就能收尾。
    recordUseRun(core);
    expect(closeRound(core.ctx, "app", "v1-使用-1", {}).ok).toBe(true);
  });

  it("使用阶段最近一次运行没带覆盖表：拦截", async () => {
    const core = await oneProject();
    started(core, "use");
    recordUseRun(core, { coverage: null });
    const result = closeRound(core.ctx, "app", "v1-使用-1", {});
    if (result.ok) throw new Error("应当拦截");
    expect(issuesOf(result.error).map((issue) => issue.rule)).toEqual([roundCloseRules.useLeave]);
  });

  it.each([
    ["own", "写好 scripts/use/覆盖表.md，再运行一次使用代码。"],
    ["shared", "写好 .product-loop/use-code/覆盖表.md，再运行一次使用代码。"],
  ] as const)(
    "使用阶段没带覆盖表：%s的仓库，提示写这个仓库放覆盖表的位置（决定 107）",
    async (repoKind, hint) => {
      const core = await emptyCore();
      addProject(core, "/work/app", { repoKind });
      started(core, "use");
      recordUseRun(core, { coverage: null });
      const result = closeRound(core.ctx, "app", "v1-使用-1", {});
      if (result.ok) throw new Error("应当拦截");
      expect(issuesOf(result.error).map((issue) => issue.hint)).toEqual([hint]);
    },
  );

  it("提升阶段收尾时不换版，这一版等下一次开始阶段时才结束", async () => {
    const core = await oneProject();
    started(core, "improve");
    closed(core, "v1-提升-1", {});
    expect(
      core.ctx.db.select({ status: productVersions.status }).from(productVersions).all(),
    ).toEqual([{ status: "open" }]);
    expect(core.received.at(-1)?.kind).toBe("round.closed");
  });
});
