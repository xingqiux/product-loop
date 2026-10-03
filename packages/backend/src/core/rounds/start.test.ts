import {
  beijingMinute,
  designSpecItem,
  type ErrorBody,
  errorBodySchema,
  issuesOf,
  mainlinePart,
  type QueueItem,
  type QueueStatus,
  type Result,
  type RoundStatus,
  type Stage,
} from "@product-loop/model";
import { and, count, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  events,
  productVersions,
  projects,
  queueEvents,
  queueItems,
  roundItems,
  rounds,
} from "../../store/schema/index.ts";
import { openTempDatabase, tempHome } from "../../store/testing.ts";
import { createNotifier } from "../events.ts";
import { registerProject, updateProject } from "../projects.ts";
import { addQueueItem, getQueueItem, type QueueChange, transitionQueueItem } from "../queue.ts";
import {
  addProject,
  addRound,
  emptyCore,
  mainlineText,
  pushMainline,
  reservedDirs,
  startAt,
  type TestCore,
} from "../testing.ts";
import type { WriteContext } from "../tx.ts";
import { recordUseRun } from "../use/testing.ts";
import { nextVersion } from "../versions.ts";
import { closeRound } from "./close.ts";
import { type RoundStartInput, roundStartRules, startRound } from "./start.ts";

const hour = 60 * 60 * 1000;
const later = (ms: number) => new Date(startAt.getTime() + ms);

/** 两种长度的完整提交号。 */
const sha1 = "0123456789abcdef0123456789abcdef01234567";
const sha256 = "89abcdef".repeat(8);

/** 登记项目 app，根目录是 /work/app，队列是空的，还没有轮次和主线。 */
async function oneProject(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  return core;
}

/** 成功时取出结果，失败时抛出，测试随之失败。 */
function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const start = (core: TestCore, input: RoundStartInput) => startRound(core.ctx, "app", input);
const started = (core: TestCore, input: RoundStartInput) => succeed(start(core, input));

/** 放进一件事，提出者是 AI。 */
function add(core: TestCore, content: string, stage: Stage): QueueItem {
  const input = { content, stage, proposer: "ai" } as const;
  return succeed(addQueueItem(core.ctx, "app", input)).item;
}

/** 把一件待办的事改成等待或已取消，摆出开始以前就不是待办的事。 */
function setAside(core: TestCore, id: string, to: "waiting" | "dropped"): void {
  const change =
    to === "waiting"
      ? ({ to, dependsOn: "等用户定下给谁用" } as const)
      : ({ to, reason: "已经不需要了" } as const);
  succeed(transitionQueueItem(core.ctx, "app", id, change));
}

const status = (core: TestCore, id: string): QueueStatus =>
  succeed(getQueueItem(core.ctx.db, "app", id)).item.status;

/** 在开着的一轮里改一件事的状态，变动记在这一轮上。 */
function move(core: TestCore, id: string, change: QueueChange): void {
  succeed(transitionQueueItem(core.ctx, "app", id, change));
}

/** 直接改开着的一轮的状态。给出信息和回复的用例在第 40、43 步。 */
function setOpenStatus(core: TestCore, roundStatus: RoundStatus): void {
  core.ctx.db
    .update(rounds)
    .set({ status: roundStatus })
    .where(and(eq(rounds.projectId, "app"), ne(rounds.status, "closed")))
    .run();
}

/** 直接把开着的一轮改成已收尾，不记拿出的事的结果。收尾的用例见 close.test.ts。 */
function closeOpen(core: TestCore): void {
  core.ctx.db
    .update(rounds)
    .set({ status: "closed", closedAt: core.ctx.now() })
    .where(and(eq(rounds.projectId, "app"), ne(rounds.status, "closed")))
    .run();
}

/** 直接把第 n 版改成已结束，像迁移完成时那样。 */
function endVersion(core: TestCore, version: number): void {
  core.ctx.db
    .update(productVersions)
    .set({ status: "closed", endedAt: core.ctx.now() })
    .where(and(eq(productVersions.projectId, "app"), eq(productVersions.version, version)))
    .run();
}

/** 库里几张表的行数。被拦截、冲突以后它们都不该变。 */
function rowCounts(core: TestCore) {
  const { db } = core.ctx;
  return [rounds, roundItems, productVersions, queueEvents, events].map(
    (table) => db.select({ n: count() }).from(table).get()?.n,
  );
}

/** 拿出的事：队列编号、轮号、结果、退回的阶段、说明和拿出的时间，按编号排。 */
function roundItemRows(core: TestCore) {
  return core.ctx.db
    .select({
      seq: rounds.seq,
      number: queueItems.number,
      result: roundItems.result,
      returnedTo: roundItems.returnedTo,
      note: roundItems.note,
      takenAt: roundItems.takenAt,
    })
    .from(roundItems)
    .innerJoin(rounds, eq(rounds.id, roundItems.roundId))
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .orderBy(queueItems.number)
    .all()
    .map(({ number, ...rest }) => ({ id: `Q${number}`, ...rest }));
}

/** 写满十个部分和设计规范十二个部分的主线，开始检查不会被拦截。 */
const fullMainline = () => mainlineText();

describe("开始阶段：版本和次数", () => {
  it("编出 v1-构思-1，进行中，记下开始的时间、开它的会话和客户端", async () => {
    const core = await oneProject();
    core.setNow(later(hour));
    const result = started(core, { stage: "think" });
    expect(result.round).toEqual({
      label: "v1-构思-1",
      version: 1,
      stage: "think",
      seq: 1,
      status: "open",
      startedAt: later(hour).toISOString(),
      closedAt: null,
      legacyId: null,
      summary: null,
    });
    expect(result).toMatchObject({
      versionChange: null,
      autoClosed: null,
      taken: [],
      deferred: [],
      baseCommits: null,
    });
    expect(core.ctx.db.select().from(rounds).all()).toEqual([
      expect.objectContaining({
        ordinal: 1,
        openedBySession: "session-1",
        openedByClient: "cli/2.0.0",
        baseCommits: null,
      }),
    ]);
  });

  it("同一版同一阶段再开始一次，次数加一。别的阶段从 1 数，总序号接着往下编", async () => {
    const core = await oneProject();
    const stages: Stage[] = ["think", "think", "land", "think", "land", "use"];
    const labels = stages.map((stage) => {
      const { label } = started(core, { stage }).round;
      closeOpen(core);
      return label;
    });
    expect(labels).toEqual([
      "v1-构思-1",
      "v1-构思-2",
      "v1-落地-1",
      "v1-构思-3",
      "v1-落地-2",
      "v1-使用-1",
    ]);
    const ordinals = core.ctx.db.select({ n: rounds.ordinal }).from(rounds).orderBy(rounds.id);
    expect(ordinals.all().map((row) => row.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("当前的一版已经结束时，进入下一版，次数从 1 数，结果写明换了版", async () => {
    const core = await oneProject();
    started(core, { stage: "think" });
    closeOpen(core);
    core.setNow(later(hour));
    endVersion(core, 1);
    core.setNow(later(2 * hour));
    const before = core.received.length;
    const result = started(core, { stage: "think" });
    expect(result.round).toMatchObject({ label: "v2-构思-1", version: 2, seq: 1 });
    expect(result.versionChange).toEqual({
      ended: {
        version: 1,
        status: "closed",
        startedAt: startAt.toISOString(),
        endedAt: later(hour).toISOString(),
        summary: null,
        endReason: null,
      },
      started: {
        version: 2,
        status: "open",
        startedAt: later(2 * hour).toISOString(),
        endedAt: null,
        summary: null,
        endReason: null,
      },
    });
    const kinds = core.received.slice(before).map((event) => [event.kind, event.objectId]);
    expect(kinds).toEqual([
      ["version.started", "2"],
      ["round.started", "v2-构思-1"],
    ]);
    closeOpen(core);
    const next = started(core, { stage: "land" });
    expect([next.round.label, next.versionChange]).toEqual(["v2-落地-1", null]);
    const ordinals = core.ctx.db.select({ n: rounds.ordinal }).from(rounds).orderBy(rounds.id);
    expect(ordinals.all().map((row) => row.n)).toEqual([1, 2, 3]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(startRound(core.ctx, "ghost", { stage: "think" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });

  it.each<[string, string | null, string]>([
    ["迁移还没完成", null, "项目「app」的迁移还没完成，要先做迁移检查。"],
    [
      "停在旧版本的 skill",
      "v1-final",
      "项目「app」停在 skill v1-final，现在的软件要求 0.0.1 以上。",
    ],
  ])("%s的项目返回 NEEDS_DOCTOR，什么都不写", async (_case, skillVersion, message) => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    core.ctx.db.update(projects).set({ skillVersion }).where(eq(projects.id, "app")).run();
    const before = rowCounts(core);
    const received = core.received.length;
    expect(start(core, { stage: "think" })).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR", message },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(status(core, "Q1")).toBe("todo");
  });
});

describe("拿出这个阶段的事", () => {
  it("拿出这个阶段全部待办的事，改成进行中，记进拿出的事。别的阶段和别的状态的不动", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "保存按钮在窄屏被挡住", "land");
    add(core, "补上事前验尸", "think");
    add(core, "看板的颜色", "think");
    add(core, "换一套配色", "think");
    setAside(core, "Q4", "waiting");
    setAside(core, "Q5", "dropped");
    core.setNow(later(hour));
    const result = started(core, { stage: "think" });
    expect(result.taken.map((item) => [item.id, item.status])).toEqual([
      ["Q1", "doing"],
      ["Q3", "doing"],
    ]);
    expect(["Q2", "Q4", "Q5"].map((id) => status(core, id))).toEqual([
      "todo",
      "waiting",
      "dropped",
    ]);
    const blank = { result: null, returnedTo: null, note: null, takenAt: later(hour) };
    expect(roundItemRows(core)).toEqual([
      { id: "Q1", seq: 1, ...blank },
      { id: "Q3", seq: 1, ...blank },
    ]);
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q1")).events.at(-1)).toMatchObject({
      from: "todo",
      to: "doing",
      round: "v1-构思-1",
    });
  });

  it("落地阶段不写 --take 时，拿出落地全部待办的事", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    add(core, "理清给谁用", "think");
    add(core, "队列看板的等待行重复", "land");
    const result = started(core, { stage: "land" });
    expect(result.taken.map((item) => item.id)).toEqual(["Q1", "Q3"]);
    expect(status(core, "Q2")).toBe("todo");
  });

  it("落地阶段写了 --take 只拿这几件，重复写的只拿一次，其余落地的事留在队列里", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    add(core, "队列看板的等待行重复", "land");
    add(core, "设置页的标题太长", "land");
    const result = started(core, { stage: "land", take: ["Q3", "Q1", "Q3"] });
    expect(result.taken.map((item) => item.id)).toEqual(["Q1", "Q3"]);
    expect(status(core, "Q2")).toBe("todo");
    expect(roundItemRows(core).map((row) => row.id)).toEqual(["Q1", "Q3"]);
  });

  it("--take 和 --defer 写了找不到的编号时返回 NOT_FOUND，一次报齐，什么都不写", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    const before = rowCounts(core);
    const received = core.received.length;
    const result = start(core, {
      stage: "land",
      take: ["Q1", "Q7"],
      defer: [{ id: "Q9", dependsOn: "等构思定下场景 S4" }],
    });
    const hint = "运行 ploop queue list，查看这个项目的队列。";
    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」的队列里没有 Q7。",
        hint,
        where: "Q7",
        issues: [
          { message: "项目「app」的队列里没有 Q7。", hint, where: "Q7" },
          { message: "项目「app」的队列里没有 Q9。", hint, where: "Q9" },
        ],
        total: 2,
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(status(core, "Q1")).toBe("todo");
  });

  it("这一批里有别的阶段的事、不是待办的事时拦截，一次报齐，什么都不写", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    add(core, "逐屏看设置页", "check");
    add(core, "队列看板的等待行重复", "land");
    setAside(core, "Q3", "waiting");
    const before = rowCounts(core);
    const result = start(core, { stage: "land", take: ["Q1", "Q2", "Q3"] });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        issues: [
          {
            rule: "round.take.stage",
            message: "Q2 要在检查阶段做，不能拿进落地阶段。",
            hint: "从 --take 里去掉 Q2，它留到检查阶段再做。",
            where: "Q2",
          },
          {
            rule: "queue.status.graph",
            message: "Q3 现在是等待，不能改成进行中。",
            hint: "先运行 ploop queue reopen Q3，改回待办。",
            where: "Q3",
          },
        ],
        total: 2,
      },
    });
    expect(result.ok || errorBodySchema.safeParse(result.error).success).toBe(true);
    expect(rowCounts(core)).toEqual(before);
    expect(status(core, "Q1")).toBe("todo");
  });

  it("请求本身写错的地方返回 BAD_REQUEST，一次报齐，什么都不写", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    const before = rowCounts(core);
    const result = start(core, {
      stage: "land",
      take: ["Q1", "q2"],
      defer: [
        { id: "Q1", dependsOn: "等构思定下场景 S4" },
        { id: "Q3", dependsOn: "  " },
        { id: "Q4", dependsOn: "等构思定下场景 S4" },
        { id: "Q4", dependsOn: "等用户定下给谁用" },
      ],
      baseCommits: [
        { root: "/work/app", commit: "HEAD" },
        { root: "/work/app", commit: sha1 },
      ],
    });
    expect(result.ok ? [] : result.error.issues).toEqual([
      {
        message: "队列事项的编号「q2」写法不对。",
        hint: "写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。",
        where: "q2",
      },
      {
        message: "Q1 同时写在 --take 和 --defer 里。",
        hint: "这一批要做的写进 --take，要等别的事的写进 --defer，一件事只写一处。",
        where: "Q1",
      },
      {
        message: "Q3 改成等待要写明依赖。",
        hint: "写明在等什么，例如「等构思定下场景 S4」。",
        where: "Q3",
      },
      {
        message: "Q4 在 --defer 里写了不止一次。",
        hint: "每件事只写一次 --defer，依赖合成一句。",
        where: "Q4",
      },
      {
        message: "根目录「/work/app」的提交号「HEAD」写得不对。",
        hint: "写 git rev-parse HEAD 打印的完整提交号，是四十位或六十四位的小写十六进制。",
        where: "/work/app",
      },
      {
        message: "根目录「/work/app」的提交号交了不止一次。",
        hint: "每个根目录只交一个提交号。",
        where: "/work/app",
      },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST", total: 6 } });
    expect(rowCounts(core)).toEqual(before);
  });

  it.each<[string, RoundStartInput, string]>([
    [
      "构思轮写了 --take",
      { stage: "think", take: ["Q1"] },
      "只有落地阶段用 --take 定这一批，构思阶段拿出全部待办的事。",
    ],
    ["落地轮的 --take 是空的", { stage: "land", take: [] }, "--take 没有写编号。"],
    [
      "检查轮交了开始时的提交",
      { stage: "check", baseCommits: [{ root: "/work/app", commit: sha1 }] },
      "检查阶段不记开始时的提交，只有落地阶段记。",
    ],
  ])("%s时返回 BAD_REQUEST", async (_case, input, message) => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    expect(start(core, input)).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message },
    });
    expect(core.ctx.db.select().from(rounds).all()).toEqual([]);
  });
});

describe("开始时改成等待的事", () => {
  it("--defer 把事改成等待并写明依赖，变动记在这个阶段上，这件事不拿进这个阶段", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "保存按钮在窄屏被挡住", "land");
    const result = started(core, {
      stage: "think",
      defer: [
        { id: "Q3", dependsOn: " 等构思定下场景 S4 " },
        { id: "Q2", dependsOn: "等用户定下给谁用" },
      ],
    });
    expect(result.taken.map((item) => item.id)).toEqual(["Q1"]);
    expect(result.deferred.map((item) => [item.id, item.status, item.dependsOn])).toEqual([
      ["Q3", "waiting", "等构思定下场景 S4"],
      ["Q2", "waiting", "等用户定下给谁用"],
    ]);
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q2")).events.at(-1)).toMatchObject({
      from: "todo",
      to: "waiting",
      note: "等用户定下给谁用",
      round: "v1-构思-1",
    });
    expect(roundItemRows(core).map((row) => row.id)).toEqual(["Q1"]);
  });

  it("改不成等待的事和这一批的问题一起拦截，什么都不写", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    add(core, "逐屏看设置页", "check");
    setAside(core, "Q1", "waiting");
    const before = rowCounts(core);
    const result = start(core, {
      stage: "land",
      take: ["Q2"],
      defer: [{ id: "Q1", dependsOn: "等构思定下场景 S4" }],
    });
    expect(
      result.ok ? [] : result.error.issues?.map((issue) => [issue.rule, issue.message]),
    ).toEqual([
      ["round.take.stage", "Q2 要在检查阶段做，不能拿进落地阶段。"],
      ["queue.status.graph", "Q1 现在是等待，不能改成等待。"],
    ]);
    expect(rowCounts(core)).toEqual(before);
    expect(status(core, "Q1")).toBe("waiting");
  });
});

describe("已有一个阶段开着", () => {
  it("返回 CONFLICT，写明是哪个阶段、什么时候、哪个会话开的，什么都不写", async () => {
    const core = await oneProject();
    add(core, "保存按钮在窄屏被挡住", "land");
    core.setNow(later(hour));
    started(core, { stage: "think" });
    core.setNow(later(2 * hour));
    const before = rowCounts(core);
    const received = core.received.length;
    const other: WriteContext = {
      ...core.ctx,
      actor: { client: "cli/2.0.0", session: "session-2" },
    };
    expect(startRound(other, "app", { stage: "land" })).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: `第 1 版的构思阶段还没收尾，是会话 session-1 在 ${beijingMinute(later(hour))} 开始的。`,
        hint: '怕别的会话在做，先运行 ploop round show "第 1 版的构思阶段"。没人在做，运行 ploop round close 收尾，再开始新的阶段。',
        where: "第 1 版的构思阶段",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(status(core, "Q1")).toBe("todo");
  });

  it.each<RoundStatus>(["open", "waiting"])(
    "状态是 %s 的阶段还开着，不自动收尾。没有会话标识时，报错不提会话",
    async (roundStatus) => {
      const core = await oneProject();
      addRound(core, "app", { version: 1, stage: "check", seq: 1, status: roundStatus });
      const at = beijingMinute(startAt);
      expect(start(core, { stage: "think" })).toMatchObject({
        ok: false,
        error: {
          code: "CONFLICT",
          message: `第 1 版的检查阶段还没收尾，它在 ${at} 开始。`,
          where: "第 1 版的检查阶段",
        },
      });
    },
  );

  it("开着的阶段挂在已结束的一版上时，也不会建出下一版", async () => {
    const core = await oneProject();
    started(core, { stage: "improve" });
    endVersion(core, 1);
    expect(start(core, { stage: "think" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    const versions = core.ctx.db.select({ v: productVersions.version }).from(productVersions);
    expect(versions.all()).toEqual([{ v: 1 }]);
  });

  it("两个连接同时开始阶段，只有一个成功，另一个写明是哪个会话开的", async () => {
    const home = tempHome();
    const [a, b] = [await openTempDatabase(home), await openTempDatabase(home)];
    const context = (db: WriteContext["db"], session: string): WriteContext => ({
      db,
      notifier: createNotifier(() => {}),
      now: () => startAt,
      actor: { client: "cli/2.0.0", session },
    });
    const first = context(a.db, "session-a");
    const second = context(b.db, "session-b");
    succeed(registerProject(first, reservedDirs, { root: "/work/app", repoKind: "own" }));
    const results = [
      startRound(first, "app", { stage: "think" }),
      startRound(second, "app", { stage: "check" }),
    ];
    expect(results.map((result) => result.ok)).toEqual([true, false]);
    expect(results[1]).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: `第 1 版的构思阶段还没收尾，是会话 session-a 在 ${beijingMinute(startAt)} 开始的。`,
      },
    });
    const open = b.db.select().from(rounds).where(ne(rounds.status, "closed")).all();
    expect(open.map((row) => [row.stage, row.openedBySession])).toEqual([["think", "session-a"]]);
  });
});

describe("开始时替上一个阶段收尾", () => {
  it("已回复的非落地阶段，拿出的事都有结果时先替它收尾，结果按现在的状态记，输出里写明", async () => {
    const core = await oneProject();
    // 构思阶段收尾要主线写好一半以上，见规矩 think.leave。
    pushMainline(core, fullMainline());
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "写好新闻稿", "think");
    add(core, "逐个场景跑一遍", "use");
    started(core, { stage: "think" });
    move(core, "Q1", { to: "dropped", reason: "已经写进主线" });
    move(core, "Q2", { to: "done", evidence: "主线第 2 版写了事前验尸" });
    move(core, "Q3", { to: "waiting", dependsOn: "等用户定下给谁用" });
    setOpenStatus(core, "replied");
    core.setNow(later(hour));
    const before = core.received.length;
    const result = started(core, { stage: "use" });
    expect(result.autoClosed).toEqual({
      label: "v1-构思-1",
      version: 1,
      stage: "think",
      seq: 1,
      status: "closed",
      startedAt: startAt.toISOString(),
      closedAt: later(hour).toISOString(),
      legacyId: null,
      summary: null,
    });
    expect([result.round.label, result.taken.map((item) => item.id)]).toEqual([
      "v1-使用-1",
      ["Q4"],
    ]);
    expect(roundItemRows(core).map(({ id, result, note }) => [id, result, note])).toEqual([
      ["Q1", "droppedAtStart", "已经写进主线"],
      ["Q2", "done", "主线第 2 版写了事前验尸"],
      ["Q3", "returned", "等用户定下给谁用"],
      ["Q4", null, null],
    ]);
    const sent = core.received.slice(before);
    expect(sent.map((event) => [event.kind, event.objectId])).toEqual([
      ["round.closed", "v1-构思-1"],
      ["queue.moved", "Q4"],
      ["round.started", "v1-使用-1"],
    ]);
    expect(sent[0]?.detail).toEqual({
      done: ["Q2"],
      returned: ["Q3"],
      droppedAtStart: ["Q1"],
      auto: true,
    });
  });

  it("使用阶段的运行没有断点和缺口：自动给出了一页，开始下一个阶段时替它收尾（D02）", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core);
    const result = started(core, { stage: "think" });
    expect([result.autoClosed?.label, result.autoClosed?.status]).toEqual(["v1-使用-1", "closed"]);
    expect(result.round.label).toBe("v1-构思-1");
  });

  it("使用阶段最近一次运行有断点：开始下一个阶段被 use.leave 拦下，什么都不写", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core);
    recordUseRun(core, { broken: true });
    const before = rowCounts(core);
    expect(start(core, { stage: "think" })).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "use.leave" },
    });
    expect(rowCounts(core)).toEqual(before);
  });

  it("使用阶段第一次运行就有断点：没有给出页，开始下一个阶段拦下的是 use.leave，写明断了哪一步", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core, { broken: true });
    const before = rowCounts(core);
    const refused = start(core, { stage: "check" });
    expect(refused).toMatchObject({ ok: false, error: { code: "RULE_BLOCKED" } });
    if (refused.ok) throw new Error("应当拦下");
    expect(issuesOf(refused.error).map((issue) => [issue.rule, issue.message])).toEqual([
      ["use.leave", expect.stringContaining("这个阶段最近一次运行有 1 步断了：")],
    ]);
    expect(rowCounts(core)).toEqual(before);
  });

  it("使用阶段还没给出页（没有运行）：不自动收尾，新的阶段开不了，写明这个阶段还开着", async () => {
    const core = await oneProject();
    started(core, { stage: "use" });
    const refused = start(core, { stage: "think" });
    expect(refused).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
  });

  it("没有拿出任何事、已回复的阶段也替它收尾", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "check", seq: 1, status: "replied" });
    const result = started(core, { stage: "think" });
    expect([result.autoClosed?.label, result.autoClosed?.status]).toEqual(["v1-检查-1", "closed"]);
    expect(result.round.label).toBe("v1-构思-1");
  });

  it("已回复的阶段还有进行中的事时不自动收尾，返回 CONFLICT 写明是哪几件，什么都不写", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    add(core, "写好新闻稿", "think");
    started(core, { stage: "think" });
    move(core, "Q2", { to: "dropped", reason: "已经写进主线" });
    setOpenStatus(core, "replied");
    const before = rowCounts(core);
    const received = core.received.length;
    expect(start(core, { stage: "use" })).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "第 1 版的构思阶段还没收尾，Q1、Q3 还没有结果，不能自动收尾。",
        hint: "先运行 ploop round close，Q1、Q3 每件写一个结果。做完写 --done Q1=<证据>。退回写 --return Q1=<原因>。",
        where: "第 1 版的构思阶段",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(roundItemRows(core).map((row) => row.result)).toEqual([null, null, null]);

    const results = [
      { id: "Q1", result: "done", note: "主线第 2 版写了给谁用" },
      { id: "Q3", result: "returned", note: "等用户先看过新闻稿的草稿" },
    ] as const;
    succeed(closeRound(core.ctx, "app", "v1-构思-1", { results }));
    const next = started(core, { stage: "use" });
    expect([next.round.label, next.autoClosed]).toEqual(["v1-使用-1", null]);
  });

  it("构思阶段自动收尾也查主线：十个部分写好的不到一半，被 think.leave 拦下，什么都不写（F20）", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    started(core, { stage: "think" });
    move(core, "Q1", { to: "done", evidence: "主线写了给谁用" });
    setOpenStatus(core, "replied");
    const before = rowCounts(core);
    const result = start(core, { stage: "use" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "think.leave" },
    });
    expect(rowCounts(core)).toEqual(before);
    // 补到一半以上就能开下一个阶段。
    pushMainline(core, fullMainline());
    expect(started(core, { stage: "use" }).autoClosed?.stage).toBe("think");
  });

  it("新的阶段被拦截时，替上一个阶段的收尾一起撤回", async () => {
    const core = await oneProject();
    // 主线十个部分在，设计规范只写了一样：构思能收尾，进入检查被 mainline.spec.twelve 拦下。
    pushMainline(core, mainlineText([], ["color"]));
    add(core, "理清给谁用", "think");
    started(core, { stage: "think" });
    move(core, "Q1", { to: "done", evidence: "主线第 2 版写了给谁用" });
    setOpenStatus(core, "replied");
    const before = rowCounts(core);
    const received = core.received.length;
    expect(start(core, { stage: "check" })).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "mainline.spec.twelve" },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    const statuses = core.ctx.db.select({ status: rounds.status }).from(rounds).all();
    expect(statuses).toEqual([{ status: "replied" }]);
    expect(roundItemRows(core).map((row) => row.result)).toEqual([null]);
  });

  it.each<RoundStatus>(["open", "waiting", "replied"])(
    "落地阶段不自动收尾：状态是 %s、这一批都有结果，也返回 CONFLICT",
    async (roundStatus) => {
      const core = await oneProject();
      add(core, "保存按钮在窄屏被挡住", "land");
      started(core, { stage: "land" });
      move(core, "Q1", { to: "done", evidence: "窄屏截图里按钮完整显示" });
      setOpenStatus(core, roundStatus);
      const before = rowCounts(core);
      expect(start(core, { stage: "improve" })).toMatchObject({
        ok: false,
        error: {
          code: "CONFLICT",
          message: `第 1 版的落地阶段还没收尾，是会话 session-1 在 ${beijingMinute(startAt)} 开始的。`,
          where: "第 1 版的落地阶段",
        },
      });
      expect(rowCounts(core)).toEqual(before);
      expect(roundItemRows(core).map((row) => row.result)).toEqual([null]);
    },
  );
});

describe("提升阶段收尾以后进入下一版", () => {
  const versionRows = (core: TestCore) =>
    core.ctx.db
      .select({ v: productVersions.version, status: productVersions.status })
      .from(productVersions)
      .all();

  it("下一次开始阶段时结束这一版并写明原因，再开始下一版，各阶段的次数从 1 数", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    for (const stage of ["think", "think", "improve"] as const) {
      const { label } = started(core, { stage }).round;
      succeed(closeRound(core.ctx, "app", label, {}));
    }
    expect(versionRows(core)).toEqual([{ v: 1, status: "open" }]);
    core.setNow(later(hour));
    const before = core.received.length;
    const result = started(core, { stage: "think" });
    expect(result.round).toMatchObject({ label: "v2-构思-1", version: 2, seq: 1 });
    const reason = "第 1 版的提升阶段已收尾。";
    expect(result.versionChange).toEqual({
      ended: {
        version: 1,
        status: "closed",
        startedAt: startAt.toISOString(),
        endedAt: later(hour).toISOString(),
        summary: null,
        endReason: reason,
      },
      started: {
        version: 2,
        status: "open",
        startedAt: later(hour).toISOString(),
        endedAt: null,
        summary: null,
        endReason: null,
      },
    });
    const sent = core.received.slice(before);
    expect(sent.map((event) => [event.kind, event.objectId, event.detail])).toEqual([
      ["version.ended", "1", { reason }],
      ["version.started", "2", {}],
      ["round.started", "v2-构思-1", { taken: [], deferred: [] }],
    ]);

    succeed(closeRound(core.ctx, "app", "v2-构思-1", {}));
    const next = started(core, { stage: "improve" });
    expect([next.round.label, next.versionChange]).toEqual(["v2-提升-1", null]);
    const ordinals = core.ctx.db.select({ n: rounds.ordinal }).from(rounds).orderBy(rounds.id);
    expect(ordinals.all().map((row) => row.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("已回复的提升阶段在下一个阶段开始时自动收尾，在同一个事务里进入下一版", async () => {
    const core = await oneProject();
    add(core, "加一个导出按钮", "improve");
    started(core, { stage: "improve" });
    move(core, "Q1", { to: "done", evidence: "放进了下一版的构思" });
    setOpenStatus(core, "replied");
    const before = core.received.length;
    const result = started(core, { stage: "think" });
    expect([result.autoClosed?.label, result.round.label]).toEqual(["v1-提升-1", "v2-构思-1"]);
    expect(result.versionChange?.ended).toMatchObject({
      version: 1,
      status: "closed",
      endReason: "第 1 版的提升阶段已收尾。",
    });
    expect(core.received.slice(before).map((event) => [event.kind, event.objectId])).toEqual([
      ["round.closed", "v1-提升-1"],
      ["version.ended", "1"],
      ["version.started", "2"],
      ["round.started", "v2-构思-1"],
    ]);
  });

  it("替提升阶段收尾不成时也不换版，什么都不写", async () => {
    const core = await oneProject();
    add(core, "加一个导出按钮", "improve");
    started(core, { stage: "improve" });
    setOpenStatus(core, "replied");
    const before = rowCounts(core);
    expect(start(core, { stage: "think" })).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "第 1 版的提升阶段还没收尾，Q1 还没有结果，不能自动收尾。",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(versionRows(core)).toEqual([{ v: 1, status: "open" }]);
  });

  it("提升阶段收尾以后已经用 ploop version next 换了版，开始阶段时不再换版", async () => {
    const core = await oneProject();
    started(core, { stage: "improve" });
    succeed(closeRound(core.ctx, "app", "v1-提升-1", {}));
    succeed(nextVersion(core.ctx, "app", "这一版先到这里"));
    const result = started(core, { stage: "think" });
    expect([result.round.label, result.versionChange]).toEqual(["v2-构思-1", null]);
    expect(versionRows(core)).toEqual([
      { v: 1, status: "closed" },
      { v: 2, status: "open" },
    ]);
  });
});

describe("主线缺哪几样", () => {
  it("还没有主线时出 mainline.ten 警告，写明十个部分都缺", async () => {
    const core = await oneProject();
    const result = started(core, { stage: "think" });
    expect(result.warnings).toEqual([
      {
        rule: roundStartRules.mainlineTen,
        message: "项目还没有主线，10 个部分都缺。",
        hint: "在项目缓存的主线.md 里写主线，缺哪个部分补哪个。",
        where: "主线.md",
      },
    ]);
    expect(result.mainline).toEqual({
      revision: null,
      missingParts: mainlinePart.keys,
      missingDesignSpec: designSpecItem.keys,
    });
  });

  it("十个部分有缺时警告列出缺的几个部分，写齐以后不再警告", async () => {
    const core = await oneProject();
    pushMainline(core, mainlineText(["audience", "preMortem"]));
    expect(started(core, { stage: "use" }).warnings).toEqual([
      {
        rule: "mainline.ten",
        message: "主线缺 2 个部分。",
        hint: "运行 ploop mainline check，看缺哪几个；已经写好的不用重写。",
        where: "主线.md",
      },
    ]);
    closeOpen(core);
    pushMainline(core, fullMainline());
    const result = started(core, { stage: "use" });
    expect(result.warnings).toEqual([]);
    expect(result.mainline).toEqual({ revision: 2, missingParts: [], missingDesignSpec: [] });
  });

  it("进入检查时设计规范十二个部分有缺的就拦截，列出缺的几个部分，什么都不写", async () => {
    const core = await oneProject();
    add(core, "逐屏看设置页", "check");
    pushMainline(core, mainlineText([], ["color", "motion"]));
    const before = rowCounts(core);
    const received = core.received.length;
    const missing = designSpecItem.keys.filter((item) => item !== "color" && item !== "motion");
    expect(start(core, { stage: "check" })).toEqual({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: "mainline.spec.twelve",
        message: `设计规范缺 ${missing.length} 个部分，进入检查阶段前要补上。`,
        hint: "运行 ploop mainline check 看缺哪几个。每个部分一个三级标题，这个产品没有的写「无」和原因。",
        where: "主线.md",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(core.received).toHaveLength(received);
    expect(status(core, "Q1")).toBe("todo");
  });

  it("N08 构思阶段主线有缺时下一步先看主线，写齐以后才看页面怎么写", async () => {
    const core = await oneProject();
    expect(started(core, { stage: "think" }).next).toEqual(["ploop mainline check"]);
    closeOpen(core);
    pushMainline(core, fullMainline());
    expect(started(core, { stage: "think" }).next).toEqual(["ploop page example --stage 构思"]);
  });

  it("别的阶段不查十二个部分。十二个部分写齐以后可以开始检查", async () => {
    const core = await oneProject();
    pushMainline(core, mainlineText([], ["color"]));
    for (const stage of ["think", "use", "land", "improve"] as const) {
      expect(started(core, { stage }).warnings).toEqual([]);
      closeOpen(core);
    }
    pushMainline(core, fullMainline());
    // 提升轮已经收尾，所以进入第 2 版。
    expect(started(core, { stage: "check" }).round.label).toBe("v2-检查-1");
  });

  it("没有主线时进入检查也拦截，和开始时改成等待的问题一起报齐", async () => {
    const core = await oneProject();
    add(core, "逐屏看设置页", "check");
    setAside(core, "Q1", "dropped");
    const result = start(core, {
      stage: "check",
      defer: [{ id: "Q1", dependsOn: "等构思定下场景 S4" }],
    });
    expect(result.ok ? [] : result.error.issues?.map((issue) => issue.rule)).toEqual([
      "mainline.spec.twelve",
      "queue.status.graph",
    ]);
  });
});

describe("落地阶段开始时的提交", () => {
  it("记下各个根目录的提交，随结果和事件返回", async () => {
    const core = await oneProject();
    succeed(updateProject(core.ctx, reservedDirs, "app", { addRoots: ["/work/app-review"] }));
    const baseCommits = [
      { root: "/work/app-review", commit: sha256 },
      { root: "/work/app", commit: sha1 },
    ];
    const result = started(core, { stage: "land", baseCommits });
    expect(result.baseCommits).toEqual(baseCommits);
    expect(core.ctx.db.select({ base: rounds.baseCommits }).from(rounds).get()).toEqual({
      base: baseCommits,
    });
    expect(core.received.at(-1)?.detail).toEqual({ taken: [], deferred: [], baseCommits });
  });

  it("根目录没登记时返回 NOT_FOUND，和找不到的编号一起报齐", async () => {
    const core = await oneProject();
    const result = start(core, {
      stage: "land",
      take: ["Q5"],
      baseCommits: [{ root: "/work/other", commit: sha1 }],
    });
    expect(result.ok ? [] : result.error.issues).toEqual([
      {
        message: "项目「app」的队列里没有 Q5。",
        hint: "运行 ploop queue list，查看这个项目的队列。",
        where: "Q5",
      },
      {
        message: "项目「app」没有登记根目录「/work/other」。",
        hint: "运行 ploop status，查看这个项目登记了哪些根目录。",
        where: "/work/other",
      },
    ]);
    expect(core.ctx.db.select().from(rounds).all()).toEqual([]);
  });
});

describe("事件、下一步和请求编号", () => {
  it("提交以后依次发出队列变动和 round.started，写明拿出和改成等待的事", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    add(core, "补上事前验尸", "think");
    const before = core.received.length;
    started(core, { stage: "think", defer: [{ id: "Q2", dependsOn: "等用户定下给谁用" }] });
    const sent = core.received.slice(before);
    expect(sent.map((event) => [event.kind, event.objectType, event.objectId])).toEqual([
      ["queue.moved", "queueItem", "Q2"],
      ["queue.moved", "queueItem", "Q1"],
      ["round.started", "round", "v1-构思-1"],
    ]);
    expect(sent.at(-1)).toMatchObject({
      session: "session-1",
      client: "cli/2.0.0",
      detail: { taken: ["Q1"], deferred: ["Q2"] },
    });
    expect(core.ctx.db.select({ n: count() }).from(events).get()?.n).toBe(core.received.length);
  });

  it.each<[Stage, string[]]>([
    ["think", ["ploop page example --stage 构思"]],
    ["use", ["ploop use schema"]],
    ["check", ["ploop page example --stage 检查"]],
    ["land", ["ploop land plan"]],
    ["improve", ["ploop page example --stage 提升"]],
  ])("开始%s以后的下一步：现在敲了就能成功，不叫人去撞还没写好的页面数据", async (stage, next) => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    expect(started(core, { stage }).next).toEqual(next);
    closeOpen(core);
    // 拿出了事也一样：判断哪件不成立由输出的正文写明，下一步里只放能直接运行的命令。
    add(core, "这一阶段要做的事", stage);
    expect(started(core, { stage }).next).toEqual(next);
  });

  it("开始使用以后，项目里运行过使用代码就把那条命令直接写进下一步", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core, { command: ["node", "scripts/use/run.mjs"] });
    closeOpen(core);
    expect(started(core, { stage: "use" }).next).toEqual([
      "ploop use run -- node scripts/use/run.mjs",
    ]);
  });

  it("下一步写的重跑命令取使用阶段里那一次，不取落地时只重跑几个场景的那条", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core, { command: ["node", "scripts/use/run.mjs"] });
    closeOpen(core);
    started(core, { stage: "land" });
    recordUseRun(core, { command: ["node", "scripts/use/run.mjs", "S1"] });
    closeOpen(core);
    expect(started(core, { stage: "use" }).next).toEqual([
      "ploop use run -- node scripts/use/run.mjs",
    ]);
  });

  it("使用阶段还没运行过：下一步取别的阶段最近用的命令", async () => {
    const core = await oneProject();
    pushMainline(core, fullMainline());
    started(core, { stage: "land" });
    recordUseRun(core, { command: ["node", "scripts/use/run.mjs", "S1"] });
    closeOpen(core);
    expect(started(core, { stage: "use" }).next).toEqual([
      "ploop use run -- node scripts/use/run.mjs S1",
    ]);
  });

  it("使用阶段收尾以后，设计规范齐了才建议开始检查；没齐先看主线", async () => {
    const core = await oneProject();
    pushMainline(core, mainlineText([], ["color"]));
    started(core, { stage: "use" });
    recordUseRun(core);
    const missing = closeRound(core.ctx, "app", "v1-使用-1", {});
    expect(missing.ok && missing.value.next).toEqual(["ploop mainline check"]);
    closeOpen(core);
    pushMainline(core, fullMainline());
    started(core, { stage: "use" });
    recordUseRun(core);
    const full = closeRound(core.ctx, "app", "v1-使用-2", {});
    expect(full.ok && full.value.next).toEqual(["ploop round start 检查"]);
  });

  it("带着请求编号重发时，返回第一次的结果，不再开一个阶段", async () => {
    const core = await oneProject();
    add(core, "理清给谁用", "think");
    const idempotency = { key: "7f3a9c2e", operation: "POST /api/v1/projects/:pid/rounds" };
    const ctx: WriteContext = { ...core.ctx, idempotency };
    const first = startRound(ctx, "app", { stage: "think" });
    expect(first.ok).toBe(true);
    expect(startRound(ctx, "app", { stage: "think" })).toEqual(first);
    expect(core.ctx.db.select({ n: count() }).from(rounds).get()?.n).toBe(1);
  });
});
