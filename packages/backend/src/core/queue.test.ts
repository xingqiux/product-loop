import {
  type ErrorBody,
  type QueueItem,
  type QueueItemCreate,
  type QueueStatus,
  type QueueTransitionContext,
  queueEventSchema,
  queueItemCreateSchema,
  queueItemSchema,
  queueItemUpdateSchema,
  queueStatus,
  type Result,
  type Stage,
} from "@product-loop/model";
import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { events, projects, queueEvents, queueItems, rounds } from "../store/schema/index.ts";
import {
  addQueueItem,
  editQueueItem,
  getQueueItem,
  listQueueItems,
  moveQueueItem,
  putQueueItem,
  type QueueChange,
  queueRules,
  reopenQueueItem,
  restageQueueItem,
  returnFromRound,
  takeOutForRound,
  transitionQueueItem,
} from "./queue.ts";
import { addProject, addRound, emptyCore, startAt, type TestCore } from "./testing.ts";
import { writeTx } from "./tx.ts";

const hour = 60 * 60 * 1000;
const later = (ms: number) => new Date(startAt.getTime() + ms);

/** 登记项目 app，队列是空的，还没有轮次。 */
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

/** 放进一件事，阶段默认是落地，提出者是 AI。 */
function add(core: TestCore, content: string, extra: Partial<QueueItemCreate> = {}): QueueItem {
  const input = { content, stage: "land", proposer: "ai", ...extra } as const;
  return succeed(addQueueItem(core.ctx, "app", input)).item;
}

/** 在项目 app 里开一轮，返回它在轮次表里的编号。 */
function openRound(core: TestCore, stage: Stage = "land", seq = 1): number {
  addRound(core, "app", { version: 1, stage, seq, status: "open" });
  const row = core.ctx.db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(eq(rounds.projectId, "app"), eq(rounds.stage, stage), eq(rounds.seq, seq)))
    .get();
  if (row === undefined) throw new Error("没有开出这一轮。");
  return row.id;
}

function closeRound(core: TestCore, roundId: number): void {
  core.ctx.db
    .update(rounds)
    .set({ status: "closed", closedAt: core.ctx.now() })
    .where(eq(rounds.id, roundId))
    .run();
}

function take(core: TestCore, roundId: number, numbers?: number[]) {
  return writeTx(core.ctx, (w) => takeOutForRound(w, roundId, numbers));
}

function move(core: TestCore, qid: string, change: QueueChange, context?: QueueTransitionContext) {
  return transitionQueueItem(core.ctx, "app", qid, change, context);
}

function detail(core: TestCore, qid: string) {
  return succeed(getQueueItem(core.ctx.db, "app", qid));
}

function list(core: TestCore) {
  return succeed(listQueueItems(core.ctx.db, "app"));
}

const ids = (items: readonly QueueItem[]) => items.map((item) => item.id);

/** 库里三张表的行数：队列事项、队列变动、事件。拦截以后它们都不该变。 */
function rowCounts(core: TestCore) {
  const { db } = core.ctx;
  return [queueItems, queueEvents, events].map(
    (table) => db.select({ n: count() }).from(table).get()?.n,
  );
}

/** 改成某个状态的请求，带上这个状态要写的字。 */
function changeTo(to: Exclude<QueueStatus, "doing">): QueueChange {
  switch (to) {
    case "waiting":
      return { to, dependsOn: "等构思定下场景 S4" };
    case "done":
      return { to, evidence: "v1-落地-1 的改后截图" };
    case "dropped":
      return { to, reason: "已在 v1-落地-1 修掉" };
    case "todo":
      return { to };
  }
}

/** 放进一件事，再经用例改到某个状态，返回它的编号。拿出来用 round 这一轮。 */
function itemIn(core: TestCore, round: number, status: QueueStatus): string {
  const { id } = add(core, "设置页的保存按钮在窄屏被挡住");
  const number = Number(id.slice(1));
  if (status === "doing" || status === "done") succeed(take(core, round, [number]));
  if (status === "waiting" || status === "done" || status === "dropped") {
    succeed(move(core, id, changeTo(status)));
  }
  return id;
}

describe("放进一件事", () => {
  it("编号从 Q1 起连续，状态是待办，创建时间是事务的时间，没有的格不写", async () => {
    const core = await oneProject();
    core.setNow(later(hour));
    const result = addQueueItem(core.ctx, "app", {
      content: "队列看板",
      stage: "land",
      proposer: "user",
      acceptance: "五列看板点一张出展示卡片",
      source: "构思第 17 轮的想法",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        item: {
          id: "Q1",
          content: "队列看板",
          stage: "land",
          proposer: "user",
          createdAt: later(hour).toISOString(),
          status: "todo",
          acceptance: "五列看板点一张出展示卡片",
          subItems: [],
          source: "构思第 17 轮的想法",
          editCount: 0,
        },
        warnings: [],
      },
    });
    expect(ids([add(core, "换一套配色"), add(core, "看板要变淡")])).toEqual(["Q2", "Q3"]);
  });

  it("备注是多行文字，原样存下，只去掉首尾的空白，不限长度，不做写作校验", async () => {
    const core = await oneProject();
    // 一句超过六十个字也放得进去：内容放不下的细节就是写在这里。
    const long =
      "先在列头写数量，再逐个验证每一列的数量和看板上摆出来的件数是不是相同，不同就查是哪一步丢了。";
    const note = `第一行\n\n第二行  有两个空格\n${long}`;
    const item = add(core, "看板加列头数量", { note: `\n ${note} \n` });
    expect(item.note).toBe(note);
    expect(detail(core, "Q1").item.note).toBe(note);
    expect(core.received.at(-1)).toMatchObject({ kind: "queue.added", detail: { note } });
  });

  it("没写备注的事，读出来没有 note 这一项，不写成空字符串", async () => {
    const core = await oneProject();
    expect(add(core, "看板加列头数量")).not.toHaveProperty("note");
    const row = core.ctx.db.select().from(queueItems).get();
    expect(row?.note).toBeNull();
  });

  it("备注只写了空白时，请求的格式不合定义", () => {
    expect(
      queueItemCreateSchema.safeParse({
        content: "看板加列头数量",
        stage: "落地",
        proposer: "AI",
        note: "  \n ",
      }).success,
    ).toBe(false);
  });

  it("每个项目各自从 Q1 编", async () => {
    const core = await oneProject();
    addProject(core, "/work/other");
    add(core, "队列看板");
    const other = addQueueItem(core.ctx, "other", {
      content: "队列看板",
      stage: "think",
      proposer: "ai",
    });
    expect(other).toMatchObject({ ok: true, value: { item: { id: "Q1" } } });
    expect(add(core, "换一套配色").id).toBe("Q2");
  });

  it("取消和做完以后编号不空出来，也不重复用", async () => {
    const core = await oneProject();
    const round = openRound(core);
    add(core, "队列看板");
    add(core, "换一套配色");
    add(core, "看板要变淡");
    succeed(move(core, "Q2", changeTo("dropped")));
    succeed(take(core, round, [3]));
    succeed(move(core, "Q3", changeTo("done")));
    expect(add(core, "设置页的保存按钮在窄屏被挡住").id).toBe("Q4");
    expect(ids(list(core))).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("被拦截的一次什么都不写，也不占编号", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const before = rowCounts(core);
    const blocked = addQueueItem(core.ctx, "app", {
      content: "替人用的脚本要改",
      stage: "land",
      proposer: "ai",
    });
    expect(blocked).toMatchObject({ ok: false, error: { code: "RULE_BLOCKED" } });
    expect(rowCounts(core)).toEqual(before);
    expect(add(core, "换一套配色").id).toBe("Q2");
  });

  it("提出时的阶段取项目开着的阶段，两个阶段之间放进来的没有", async () => {
    const core = await oneProject();
    const round = openRound(core, "check", 1);
    expect(add(core, "队列看板").proposedIn).toBe("v1-检查-1");
    closeRound(core, round);
    expect(add(core, "换一套配色")).not.toHaveProperty("proposedIn");
  });

  it("记一条从无到待办的队列变动，和一条 queue.changed 事件", async () => {
    const core = await oneProject();
    openRound(core, "think", 2);
    add(core, "队列看板", { proposer: "user" });
    expect(detail(core, "Q1").events).toEqual([
      { item: "Q1", at: startAt.toISOString(), to: "todo", round: "v1-构思-2", actor: "cli/2.0.0" },
    ]);
    expect(core.received.map((event) => [event.kind, event.objectType, event.objectId])).toEqual([
      ["project.registered", "project", "app"],
      ["version.started", "productVersion", "1"],
      ["queue.added", "queueItem", "Q1"],
    ]);
    expect(core.received.at(-1)?.detail).toEqual({
      content: "队列看板",
      stage: "land",
      proposer: "user",
      proposedIn: "v1-构思-2",
    });
    const stored = core.ctx.db.select().from(queueEvents).get();
    expect(stored).toMatchObject({ actor: "cli/2.0.0", session: "session-1", fromStatus: null });
  });

  it("文字去掉首尾的空白，写成空白的返回 BAD_REQUEST，一次报齐", async () => {
    const core = await oneProject();
    expect(add(core, "  队列看板 ", { subItems: [" 看板"] })).toMatchObject({
      content: "队列看板",
      subItems: ["看板"],
    });
    const result = addQueueItem(core.ctx, "app", {
      content: "  ",
      stage: "land",
      proposer: "ai",
      subItems: ["看板", " "],
      acceptance: "",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "没有写内容。",
        hint: "补上内容再重跑。",
        where: "内容",
        issues: [
          { message: "没有写内容。", hint: "补上内容再重跑。", where: "内容" },
          { message: "没有写子项。", hint: "补上子项再重跑。", where: "子项 2" },
          { message: "没有写验收标准。", hint: "补上验收标准再重跑。", where: "验收标准" },
        ],
        total: 3,
      },
    });
  });

  it("项目不存在返回 NOT_FOUND，迁移没完成的返回 NEEDS_DOCTOR", async () => {
    const core = await oneProject();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    const input = { content: "队列看板", stage: "land", proposer: "ai" } as const;
    expect(addQueueItem(core.ctx, "ghost", input)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
    expect(addQueueItem(core.ctx, "abei", input)).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
  });

  it("带着同一个请求编号重发时返回第一次的结果，不多放一件", async () => {
    const core = await oneProject();
    const idempotency = { key: "k-1", operation: "POST /projects/app/queue" };
    const ctx = { ...core.ctx, idempotency };
    const input = { content: "队列看板", stage: "land", proposer: "ai" } as const;
    const first = addQueueItem(ctx, "app", input);
    expect(addQueueItem(ctx, "app", input)).toEqual(first);
    expect(ids(list(core))).toEqual(["Q1"]);
  });
});

describe("放进时的写作校验", () => {
  it("内容、子项、验收标准、依赖都查，拦截一次报齐，每条写明规矩和位置", async () => {
    const core = await oneProject();
    const before = rowCounts(core);
    const result = addQueueItem(core.ctx, "app", {
      content:
        "这是一句故意写得很长很长的内容，用来检查写作校验会不会在放进队列的时候就把超过六十个字的句子拦截下来，而不是等到给出信息的时候才发现",
      stage: "land",
      proposer: "ai",
      subItems: ["设置页", "替人用的脚本要改"],
      acceptance: "一；二；三",
      dependsOn: "等那道检查改完",
    });
    expect(result.ok ? [] : [result.error.code, result.error.total]).toEqual(["RULE_BLOCKED", 5]);
    const issues = result.ok ? [] : (result.error.issues ?? []);
    expect(issues.map((issue) => [issue.rule, issue.where])).toEqual([
      ["writing.sentence.tooLong", "内容"],
      ["queue.content.tooLong", "内容"],
      ["writing.term.banned", "子项 2"],
      ["writing.sentence.semicolons", "验收标准"],
      ["writing.term.banned", "依赖"],
    ]);
    expect(issues[2]?.message).toBe(
      "出现了术语表停用的说法「替人用的脚本」，统一的术语是「走查脚本」",
    );
    // 每条拦截都写怎么改：停用的说法写要改成什么，别的写通用的一句，内容太长的写把细节放到哪里。
    expect(issues.map((issue) => issue.hint)).toEqual([
      "按报错改写这段文字，再重跑。",
      "缩短到 40 个字以内，细节写进备注。",
      "改成术语表里的说法「走查脚本」，或者换一种说法。引号里的原话不用改",
      "按报错改写这段文字，再重跑。",
      "改成术语表里的说法「构建校验」，或者换一种说法。引号里的原话不用改",
    ]);
    expect(rowCounts(core)).toEqual(before);
  });

  it("来源常照录原话，不做写作校验", async () => {
    const core = await oneProject();
    expect(add(core, "队列看板", { source: "用户说：那道检查太慢" }).source).toBe(
      "用户说：那道检查太慢",
    );
  });

  it("警告不拦截，随结果返回并写明位置", async () => {
    const core = await oneProject();
    // 内容超过 40 个字直接拦下，一句超过四十字的警告只会出在别的字段上。
    const result = addQueueItem(core.ctx, "app", {
      content: "设置页的保存按钮在窄屏被挡住",
      stage: "check",
      proposer: "ai",
      acceptance:
        "窄屏下设置页的保存按钮完整可见，右边的侧栏不再挡住它，用户不用先把窗口拉宽也能点到它，取消按钮也一样",
    });
    expect(result.ok && result.value.item.id).toBe("Q1");
    expect(result.ok && result.value.warnings).toEqual([
      {
        rule: "writing.sentence.long",
        message: expect.stringContaining("四十字"),
        where: "验收标准",
      },
    ]);
  });

  it("停用的说法的报错带一句怎么改，位置写字段的中文名", async () => {
    const core = await oneProject();
    const result = addQueueItem(core.ctx, "app", {
      content: "队列看板",
      stage: "land",
      proposer: "ai",
      subItems: ["设置页", "替人用的脚本要改"],
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: "writing.term.banned",
        message: "出现了术语表停用的说法「替人用的脚本」，统一的术语是「走查脚本」",
        hint: "改成术语表里的说法「走查脚本」，或者换一种说法。引号里的原话不用改",
        where: "子项 2",
      },
    });
    const writing = {
      project: { banned: [{ phrase: "看板", replacement: "列表" }], exceptions: [] },
    };
    const second = addQueueItem(
      core.ctx,
      "app",
      { content: "队列看板", stage: "land", proposer: "ai" },
      writing,
    );
    expect(second).toMatchObject({
      ok: false,
      error: {
        rule: "writing.term.banned",
        hint: "改成术语表里的说法「列表」，或者换一种说法。引号里的原话不用改",
        where: "内容",
      },
    });
  });

  it("项目主线「写作规范」一节加的停用说法也拦截", async () => {
    const core = await oneProject();
    const writing = {
      project: { banned: [{ phrase: "看板", replacement: "列表" }], exceptions: [] },
    };
    const input = { content: "队列看板", stage: "land", proposer: "ai" } as const;
    expect(addQueueItem(core.ctx, "app", input, writing)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: "writing.term.banned",
        message: "出现了术语表停用的说法「看板」，统一的术语是「列表」",
        where: "内容",
      },
    });
    expect(succeed(addQueueItem(core.ctx, "app", input)).item.id).toBe("Q1");
  });
});

describe("内容不超过 40 个字", () => {
  const fit = "字".repeat(40);
  const long = "字".repeat(41);

  it("放进时：40 个字放得进去，41 个字拦下，写明规矩、字数和怎么改，什么都不写", async () => {
    const core = await oneProject();
    expect(add(core, fit).content).toBe(fit);
    const before = rowCounts(core);
    expect(addQueueItem(core.ctx, "app", { content: long, stage: "land", proposer: "ai" })).toEqual(
      {
        ok: false,
        error: {
          code: "RULE_BLOCKED",
          rule: "queue.content.tooLong",
          message: "内容有 41 个字，超过 40 个字。",
          hint: "缩短到 40 个字以内，细节写进备注。",
          where: "内容",
        },
      },
    );
    expect(rowCounts(core)).toEqual(before);
  });

  it("备注、子项、验收标准、来源不受这一条限制：内容写短，细节写进备注", async () => {
    const core = await oneProject();
    const details = "细节写在备注里，可以很长很长。".repeat(30);
    const item = add(core, "队列看板", { note: details, source: details });
    expect(item).toMatchObject({ note: details, source: details });
  });

  it("修改时：改成超过 40 个字的内容拦下，原来的内容不变，修改计数也不变", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const before = rowCounts(core);
    const result = editQueueItem(core.ctx, "app", "Q1", 0, { content: long });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "queue.content.tooLong", where: "内容" },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(detail(core, "Q1").item).toMatchObject({ content: "队列看板", editCount: 0 });
    // 改成 40 个字以内就行。
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { content: fit })).toMatchObject({ ok: true });
  });

  it("已有的超过 40 个字的事：读取不校验，只改别的项也不查，改内容才查", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    // 迁移进来的旧数据可以很长，直接写进库里摆出来。
    const old = "旧数据里写得很长很长的一句内容，".repeat(6);
    core.ctx.db.update(queueItems).set({ content: old }).run();
    expect(detail(core, "Q1").item.content).toBe(old);
    expect(list(core)[0]?.content).toBe(old);
    const noted = editQueueItem(core.ctx, "app", "Q1", 0, { note: "先把内容缩短" });
    expect(noted).toMatchObject({
      ok: true,
      value: { item: { content: old, note: "先把内容缩短" } },
    });
    expect(editQueueItem(core.ctx, "app", "Q1", 1, { content: "缩短后的内容" })).toMatchObject({
      ok: true,
      value: { item: { content: "缩短后的内容", editCount: 2 } },
    });
  });
});

describe("旧 check-queue.py 的用例", () => {
  it("放进去：状态是待办，记下创建时间，写了的格原样记下，没写的格不出现", async () => {
    const core = await oneProject();
    const item = add(core, "队列看板", {
      proposer: "user",
      acceptance: "五列看板点一张出展示卡片",
      source: "构思第 17 轮的想法",
    });
    expect(item).toMatchObject({ status: "todo", createdAt: startAt.toISOString() });
    expect(Object.keys(item)).toEqual([
      "id",
      "content",
      "stage",
      "proposer",
      "createdAt",
      "status",
      "acceptance",
      "subItems",
      "source",
      "editCount",
    ]);
  });

  it("同样内容的事放进两次时拦截，只查还没做完的，做完或取消的可以重新放进一件", async () => {
    const core = await oneProject();
    const round = openRound(core);
    add(core, "队列看板");
    const again = addQueueItem(core.ctx, "app", {
      content: " 队列看板 ",
      stage: "think",
      proposer: "user",
    });
    expect(again).toEqual({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: queueRules.contentDuplicate,
        message: "队列里已经有内容相同的 Q1，它还没有做完。",
        hint: "接着用 Q1，不要再放一件。要改内容，运行 ploop queue edit Q1。",
        where: "内容",
      },
    });
    succeed(take(core, round, [1]));
    succeed(move(core, "Q1", changeTo("done")));
    expect(add(core, "队列看板", { source: "接 Q1" }).id).toBe("Q2");
  });

  it("阶段不是五个之一时拦截：接口上不收，库里也存不进去", () => {
    const input = { content: "换个皮肤", stage: "写代码", proposer: "AI" };
    expect(queueItemCreateSchema.safeParse(input).success).toBe(false);
    expect(queueItemCreateSchema.safeParse({ ...input, stage: "落地" }).success).toBe(true);
    // 库里的检查约束见 store/schema/queue.test.ts。
  });

  it("拿出队列里没有的事时返回 NOT_FOUND", async () => {
    const core = await oneProject();
    const round = openRound(core);
    add(core, "队列看板");
    expect(take(core, round, [2])).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」的队列里没有 Q2。",
        hint: "运行 ploop queue list，查看这个项目的队列。",
        where: "Q2",
      },
    });
  });

  it("拿出来以后是进行中，变动记在第 17 轮上", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const round = openRound(core, "land", 17);
    expect(succeed(take(core, round, [1]))).toMatchObject([{ id: "Q1", status: "doing" }]);
    expect(detail(core, "Q1").events.at(-1)).toMatchObject({
      from: "todo",
      to: "doing",
      round: "v1-落地-17",
    });
  });

  it("在等什么写进依赖，状态说明也写它", async () => {
    const core = await oneProject();
    const round = openRound(core, "land", 17);
    add(core, "队列看板");
    succeed(take(core, round, [1]));
    const waiting = move(core, "Q1", { to: "waiting", dependsOn: "等用户定文件的形式" });
    expect(waiting).toMatchObject({
      ok: true,
      value: {
        status: "waiting",
        dependsOn: "等用户定文件的形式",
        statusNote: "等用户定文件的形式",
      },
    });
  });

  it("做完了不写完成证据时拦截，写了就记进完成证据；等待的事要先回到待办再拿出来", async () => {
    const core = await oneProject();
    const round = openRound(core, "land", 17);
    add(core, "队列看板");
    succeed(take(core, round, [1]));
    succeed(move(core, "Q1", { to: "waiting", dependsOn: "等用户定文件的形式" }));
    // 旧脚本能从等待直接做完，新的状态图里等待只能回到待办或取消。
    expect(move(core, "Q1", changeTo("done"))).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", message: "Q1 现在是等待，不能改成已完成。" },
    });
    succeed(move(core, "Q1", { to: "todo", note: "用户定了文件的形式" }));
    closeRound(core, round);
    succeed(take(core, openRound(core, "land", 18), [1]));
    expect(move(core, "Q1", { to: "done", evidence: " " })).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "已完成的事要写完成证据。", where: "完成证据" },
    });
    expect(move(core, "Q1", { to: "done", evidence: "落地第 17 轮的验收页" })).toMatchObject({
      ok: true,
      value: { status: "done", evidence: "落地第 17 轮的验收页" },
    });
  });

  it("不做了不写原因时拦截，写了就记进状态说明", async () => {
    const core = await oneProject();
    add(core, "换一套配色", { stage: "improve" });
    expect(move(core, "Q1", { to: "dropped", reason: "" })).toEqual({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: queueRules.dropReason,
        message: "取消 Q1 要写原因。",
        hint: "写明为什么不做了，例如「已在第 2 版的落地阶段修掉」。",
        where: "原因",
      },
    });
    expect(move(core, "Q1", { to: "dropped", reason: "两天里没有人提过" })).toMatchObject({
      ok: true,
      value: { status: "dropped", statusNote: "两天里没有人提过" },
    });
  });

  it("几件并列的事用分号挤进内容时，写入之前拦截；之后队列照常能读，编号接着编", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const result = addQueueItem(core.ctx, "app", {
      content: "缺口要不要补：收起展开；键盘左右键；深色模式",
      stage: "land",
      proposer: "ai",
    });
    const issues = result.ok ? [] : (result.error.issues ?? []);
    expect(issues.map((issue) => issue.rule)).toEqual([
      "writing.sentence.semicolons",
      queueRules.contentSemicolons,
    ]);
    expect(issues[1]).toEqual({
      rule: queueRules.contentSemicolons,
      message: "内容里用分号写了几件并列的事。",
      hint: "内容只写这件事是什么，并列的几件放进子项。",
      where: "内容",
    });
    expect(ids(list(core))).toEqual(["Q1"]);
    const split = add(core, "缺口要不要补", { subItems: ["收起展开", "键盘左右键", "深色模式"] });
    expect(split.id).toBe("Q2");
  });

  it("分号的查法照旧：半角的也算，写了子项就不查", async () => {
    const core = await oneProject();
    const content = "改三处地方;设置页;项目页";
    const input = { content, stage: "land", proposer: "ai" } as const;
    expect(addQueueItem(core.ctx, "app", input)).toMatchObject({
      ok: false,
      error: { rule: queueRules.contentSemicolons },
    });
    expect(add(core, content, { subItems: ["设置页", "项目页"] }).id).toBe("Q1");
  });

  it("创建时间由后端填，写法带时区，放进时写了就不收", async () => {
    const core = await oneProject();
    const input = { content: "日期写错的一件", stage: "落地", proposer: "AI" };
    expect(queueItemCreateSchema.safeParse({ ...input, createdAt: "9月20日" }).success).toBe(false);
    expect(add(core, "日期写错的一件").createdAt).toBe("2026-09-28T08:00:00.000Z");
  });

  it("内容互为前缀的两件按编号各找各的，写内容的开头不算编号", async () => {
    const core = await oneProject();
    const round = openRound(core, "improve", 18);
    add(core, "看板要变淡", { stage: "improve" });
    add(core, "看板要变淡一点，淡到什么程度另说", { stage: "improve" });
    succeed(take(core, round, [1]));
    expect(list(core).map((item) => [item.id, item.status])).toEqual([
      ["Q1", "doing"],
      ["Q2", "todo"],
    ]);
    expect(move(core, "看板要变", changeTo("dropped"))).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "队列事项的编号「看板要变」写法不对。" },
    });
  });

  it("已经做完的事不能再拿出来", async () => {
    const core = await oneProject();
    const round = openRound(core);
    add(core, "队列看板");
    succeed(take(core, round, [1]));
    succeed(move(core, "Q1", changeTo("done")));
    expect(take(core, round, [1])).toEqual({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: queueRules.statusGraph,
        message: "Q1 已经完成，不能再改状态。",
        hint: "要重新做，就放进一件新的，在来源里写明接的是 Q1。",
        where: "Q1",
      },
    });
  });
});

describe("状态图里的每一对都经过用例", () => {
  // 「03 数据模型」第二节的表，照抄中文。已完成是终态，表里没有它的一行。
  const table: [string, string[]][] = [
    ["待办", ["进行中", "等待", "已取消"]],
    ["进行中", ["已完成", "等待", "待办", "已取消"]],
    ["等待", ["待办", "已取消"]],
    ["已取消", ["待办"]],
  ];
  const allowed = new Map(table);
  const verdict = (from: string, to: string): string => {
    if (from === "已完成") return "终态";
    if (!(allowed.get(from)?.includes(to) ?? false)) return "不在表里";
    return from === "已取消" ? "只限捞回" : "可以";
  };
  const cases = queueStatus.labels.flatMap((from) =>
    queueStatus.labels.map((to) => [from, to, verdict(from, to)] as const),
  );
  const key = (label: string): QueueStatus => {
    const found = queueStatus.key(label);
    if (found === undefined) throw new Error(`不是队列的状态：${label}`);
    return found;
  };

  it("二十五对里能走的九对，只限捞回的一对，不在表里的十对，终态五对", () => {
    const counts = new Map<string, number>();
    for (const [, , expected] of cases) counts.set(expected, (counts.get(expected) ?? 0) + 1);
    expect(counts).toEqual(
      new Map([
        ["可以", 9],
        ["只限捞回", 1],
        ["不在表里", 10],
        ["终态", 5],
      ]),
    );
  });

  it.each(cases)("%s → %s：%s", async (fromLabel, toLabel, expected) => {
    const core = await oneProject();
    const round = openRound(core);
    const from = key(fromLabel);
    const to = key(toLabel);
    const qid = itemIn(core, round, from);
    const attempt = (context?: QueueTransitionContext) =>
      to === "doing"
        ? take(core, round, [Number(qid.slice(1))])
        : move(core, qid, changeTo(to), context);
    const before = rowCounts(core);
    const result = attempt();
    if (expected === "可以") {
      expect(result.ok).toBe(true);
      const { item, events: history } = detail(core, qid);
      expect(item.status).toBe(to);
      expect(history.at(-1)).toMatchObject({ from, to, round: "v1-落地-1" });
      return;
    }
    const message =
      expected === "终态"
        ? `${qid} 已经完成，不能再改状态。`
        : expected === "不在表里"
          ? `${qid} 现在是${fromLabel}，不能改成${toLabel}。`
          : `${qid} 不是这个阶段开始时取消的，不能捞回。`;
    expect(result).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: queueRules.statusGraph, message, where: qid },
    });
    expect(detail(core, qid).item.status).toBe(from);
    expect(rowCounts(core)).toEqual(before);
    if (expected === "只限捞回") {
      const restored = attempt({ droppedAtRoundStart: true, namedInReply: true });
      expect(restored).toMatchObject({ ok: true, value: { id: qid, status: "todo" } });
    }
  });

  it.each([
    ["todo", "todo", "待办只能改成进行中、等待或已取消。"],
    ["doing", "doing", "进行中只能改成已完成、等待、待办或已取消。"],
    ["waiting", "done", "先运行 ploop queue reopen Q1，改回待办。"],
    [
      "todo",
      "done",
      "待办只能改成进行中、等待或已取消。先运行 ploop round start 落地，把它拿成进行中。做完写 ploop round close --done Q1=<证据>。",
    ],
    ["dropped", "waiting", "先运行 ploop queue reopen Q1，改回待办。"],
  ] as const)(
    "从 %s 改成 %s 被拦截时，写明只能改成哪几个，等待和已取消的写成能运行的命令",
    async (from, to, hint) => {
      const core = await oneProject();
      const round = openRound(core);
      const qid = itemIn(core, round, from);
      const result =
        to === "doing" ? take(core, round, [Number(qid.slice(1))]) : move(core, qid, changeTo(to));
      expect(result).toMatchObject({ ok: false, error: { hint } });
    },
  );
});

describe("改状态", () => {
  it("改成等待要写依赖，写进依赖和状态说明", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(move(core, "Q1", { to: "waiting", dependsOn: "  " })).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "等待的事要写明依赖。",
        hint: "写明在等什么，例如「等构思定下场景 S4」。",
        where: "依赖",
      },
    });
    expect(move(core, "Q1", { to: "waiting", dependsOn: " 等构思定下场景 S4 " })).toMatchObject({
      ok: true,
      value: { status: "waiting", dependsOn: "等构思定下场景 S4", statusNote: "等构思定下场景 S4" },
    });
  });

  it("取消已完成的事又没写原因时，状态图和原因的拦截一起报", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const qid = itemIn(core, round, "done");
    const result = move(core, qid, { to: "dropped", reason: " " });
    expect(result).toMatchObject({ ok: false, error: { code: "RULE_BLOCKED", total: 2 } });
    const issues = result.ok ? [] : (result.error.issues ?? []);
    expect(issues.map((issue) => issue.rule)).toEqual([
      queueRules.statusGraph,
      queueRules.dropReason,
    ]);
  });

  it("在开着的阶段里改状态，变动记在这个阶段上；两个阶段之间的不记阶段", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色");
    const round = openRound(core, "check", 1);
    succeed(move(core, "Q1", changeTo("dropped")));
    closeRound(core, round);
    succeed(move(core, "Q2", changeTo("dropped")));
    expect(detail(core, "Q1").events.at(-1)).toMatchObject({ to: "dropped", round: "v1-检查-1" });
    expect(detail(core, "Q2").events.at(-1)).not.toHaveProperty("round");
  });

  it("回到待办可以写一句说明，不写时状态说明清空", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色");
    succeed(move(core, "Q1", changeTo("waiting")));
    succeed(move(core, "Q2", changeTo("waiting")));
    expect(succeed(move(core, "Q1", { to: "todo", note: "依赖满足了" }))).toMatchObject({
      status: "todo",
      statusNote: "依赖满足了",
      dependsOn: "等构思定下场景 S4",
    });
    expect(succeed(move(core, "Q2", { to: "todo" }))).not.toHaveProperty("statusNote");
  });

  it("每次改状态记一条队列变动和一条事件，执行者取自请求", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    core.setNow(later(hour));
    const web = { ...core.ctx, actor: { client: "web/2.0.0" } };
    succeed(transitionQueueItem(web, "app", "Q1", changeTo("dropped")));
    expect(detail(core, "Q1").events).toEqual([
      { item: "Q1", at: startAt.toISOString(), to: "todo", actor: "cli/2.0.0" },
      {
        item: "Q1",
        at: later(hour).toISOString(),
        from: "todo",
        to: "dropped",
        note: "已在 v1-落地-1 修掉",
        actor: "web/2.0.0",
      },
    ]);
    expect(core.received.at(-1)).toMatchObject({
      kind: "queue.moved",
      objectType: "queueItem",
      objectId: "Q1",
      client: "web/2.0.0",
      session: null,
      detail: { from: "todo", to: "dropped", note: "已在 v1-落地-1 修掉" },
    });
  });

  it("编号写错返回 BAD_REQUEST，没有这件事返回 NOT_FOUND，要先做迁移检查的返回 NEEDS_DOCTOR", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(move(core, "q1", changeTo("dropped"))).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "队列事项的编号「q1」写法不对。" },
    });
    expect(move(core, "Q0", changeTo("dropped"))).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "队列事项的编号「Q0」写了 0。" },
    });
    expect(move(core, "Q9", changeTo("dropped"))).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "项目「app」的队列里没有 Q9。" },
    });
    core.ctx.db.update(projects).set({ skillVersion: "v1-final" }).run();
    expect(move(core, "Q1", changeTo("dropped"))).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
    expect(list(core).map((item) => item.status)).toEqual(["todo"]);
  });

  it("在调用者的事务里改状态时，可以写明记在哪个阶段", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const round = openRound(core, "land", 3);
    closeRound(core, round);
    const moved = writeTx(core.ctx, (w) =>
      moveQueueItem(w, "app", 1, changeTo("waiting"), { roundId: round }),
    );
    expect(moved).toMatchObject({ ok: true, value: { status: "waiting" } });
    expect(detail(core, "Q1").events.at(-1)).toMatchObject({ to: "waiting", round: "v1-落地-3" });
  });
});

describe("捞回开始时取消的事", () => {
  /** 开一轮落地，拿出 Q1、Q2，再在开始时取消 Q2。 */
  async function droppedAtStart() {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "设置页的保存按钮在窄屏被挡住");
    const round = openRound(core);
    succeed(take(core, round));
    succeed(move(core, "Q2", { to: "dropped", reason: "已在 v1-落地-1 修掉" }));
    return core;
  }

  it("开始时取消、用户又在回复里点名的，回到待办，编号不变", async () => {
    const core = await droppedAtStart();
    const context = { droppedAtRoundStart: true, namedInReply: true };
    const restored = move(core, "Q2", { to: "todo", note: "用户在回复里点名要做" }, context);
    expect(restored).toMatchObject({
      ok: true,
      value: { id: "Q2", status: "todo", statusNote: "用户在回复里点名要做" },
    });
    expect(ids(list(core))).toEqual(["Q1", "Q2"]);
    expect(detail(core, "Q2").events.map((event) => [event.from, event.to, event.round])).toEqual([
      [undefined, "todo", undefined],
      ["todo", "doing", "v1-落地-1"],
      ["doing", "dropped", "v1-落地-1"],
      ["dropped", "todo", "v1-落地-1"],
    ]);
  });

  it.each([
    [{}, "Q2 不是这个阶段开始时取消的，不能捞回。"],
    [{ namedInReply: true }, "Q2 不是这个阶段开始时取消的，不能捞回。"],
    [{ droppedAtRoundStart: true }, "用户没有在这个阶段的回复里点名 Q2，不能捞回。"],
  ])("context 写成 %j 时拦截：%s", async (context, message) => {
    const core = await droppedAtStart();
    expect(move(core, "Q2", { to: "todo" }, context)).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: queueRules.statusGraph, message },
    });
    expect(detail(core, "Q2").item.status).toBe("dropped");
  });
});

describe("早就取消的事不能被回复捞回", () => {
  it("不是这个阶段开始时取消的：拦下，写明要重新做就放进一件新的，来源写旧的编号", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    succeed(move(core, "Q1", { to: "dropped", reason: "不做了" }));
    const blocked = move(core, "Q1", { to: "todo" }, { namedInReply: true });
    expect(blocked).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: queueRules.statusGraph,
        message: "Q1 不是这个阶段开始时取消的，不能捞回。",
        hint: "要重新做它，就放进一件新的，在来源里写明接的是 Q1。",
      },
    });
    expect(detail(core, "Q1").item.status).toBe("dropped");
  });
});

describe("开始阶段时拿出，收尾时退回", () => {
  /** 落地的 Q1、Q4 待办，Q2 是检查的待办，Q3 在等待，Q5 已取消。 */
  async function mixedQueue() {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色", { stage: "check" });
    add(core, "看板要变淡");
    add(core, "设置页的保存按钮在窄屏被挡住");
    add(core, "日期写错的一件");
    succeed(move(core, "Q3", changeTo("waiting")));
    succeed(move(core, "Q5", changeTo("dropped")));
    return core;
  }

  it("不写编号时拿出属于这个阶段的全部待办的事，别的阶段、别的状态不动", async () => {
    const core = await mixedQueue();
    const round = openRound(core);
    expect(ids(succeed(take(core, round)))).toEqual(["Q1", "Q4"]);
    expect(list(core).map((item) => [item.id, item.status])).toEqual([
      ["Q1", "doing"],
      ["Q2", "todo"],
      ["Q3", "waiting"],
      ["Q4", "doing"],
      ["Q5", "dropped"],
    ]);
    expect(core.received.at(-1)?.kind).toBe("queue.moved");
    expect(core.received.at(-1)?.detail).toEqual({
      from: "todo",
      to: "doing",
      round: "v1-落地-1",
    });
  });

  it("写了编号只拿这几件，按编号排", async () => {
    const core = await mixedQueue();
    const round = openRound(core);
    expect(ids(succeed(take(core, round, [4, 2])))).toEqual(["Q2", "Q4"]);
    expect(list(core).find((item) => item.id === "Q1")?.status).toBe("todo");
  });

  it("找不到的、改不成进行中的，各自一次报齐，什么都不改", async () => {
    const core = await mixedQueue();
    const round = openRound(core);
    const before = rowCounts(core);
    const missing = take(core, round, [1, 98, 99]);
    expect(missing).toMatchObject({ ok: false, error: { code: "NOT_FOUND", total: 2 } });
    expect(missing.ok ? [] : missing.error.issues?.map((issue) => issue.where)).toEqual([
      "Q98",
      "Q99",
    ]);
    const blocked = take(core, round, [1, 3, 5]);
    expect(blocked).toMatchObject({ ok: false, error: { code: "RULE_BLOCKED", total: 2 } });
    expect(blocked.ok ? [] : blocked.error.issues?.map((issue) => issue.message)).toEqual([
      "Q3 现在是等待，不能改成进行中。",
      "Q5 现在是已取消，不能改成进行中。",
    ]);
    expect(rowCounts(core)).toEqual(before);
    expect(list(core)[0]?.status).toBe("todo");
  });

  it("退回待办写明原因，可以改到别的阶段，变动记在这个阶段上", async () => {
    const core = await mixedQueue();
    const round = openRound(core);
    succeed(take(core, round));
    const back = writeTx(core.ctx, (w) =>
      returnFromRound(w, round, 1, { note: "定义不对，回到构思", stage: "think" }),
    );
    expect(back).toMatchObject({
      ok: true,
      value: { id: "Q1", status: "todo", stage: "think", statusNote: "定义不对，回到构思" },
    });
    expect(detail(core, "Q1").events.at(-1)).toMatchObject({
      from: "doing",
      to: "todo",
      note: "定义不对，回到构思",
      round: "v1-落地-1",
    });
    expect(core.received.at(-1)).toMatchObject({ kind: "queue.moved", detail: { stage: "think" } });
    const same = writeTx(core.ctx, (w) => returnFromRound(w, round, 4, { note: "这一轮做不完" }));
    expect(same).toMatchObject({ ok: true, value: { stage: "land" } });
  });

  it("退回不写原因返回 BAD_REQUEST", async () => {
    const core = await mixedQueue();
    const round = openRound(core);
    succeed(take(core, round));
    expect(writeTx(core.ctx, (w) => returnFromRound(w, round, 1, { note: " " }))).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "没有写说明。", where: "note" },
    });
  });
});

describe("修改一件事", () => {
  it("改内容、验收标准、子项、来源，修改计数加一，记一条事件，不记队列变动", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const result = editQueueItem(core.ctx, "app", "Q1", 0, {
      content: "队列看板的等待列",
      acceptance: "等待的事单独放在看板上面",
      subItems: ["看板", "展示卡片"],
      source: "构思第 17 轮的想法",
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        item: {
          id: "Q1",
          content: "队列看板的等待列",
          acceptance: "等待的事单独放在看板上面",
          subItems: ["看板", "展示卡片"],
          source: "构思第 17 轮的想法",
          editCount: 1,
        },
        warnings: [],
      },
    });
    expect(core.received.at(-1)).toMatchObject({
      kind: "queue.edited",
      objectId: "Q1",
      detail: {
        content: "队列看板的等待列",
        acceptance: "等待的事单独放在看板上面",
        subItems: ["看板", "展示卡片"],
        source: "构思第 17 轮的想法",
        editCount: 1,
      },
    });
    expect(detail(core, "Q1").events).toHaveLength(1);
  });

  it("If-Match 的修改计数对不上时返回 CONFLICT，什么都不改", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    succeed(editQueueItem(core.ctx, "app", "Q1", 0, { content: "队列看板的等待列" }));
    const before = rowCounts(core);
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { content: "队列看板的列宽" })).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "Q1 已被别处改过，修改计数现在是 1，请求里写的是 0。",
        hint: "运行 ploop queue show Q1 看最新的内容，再重新修改。",
        where: "Q1",
      },
    });
    expect(rowCounts(core)).toEqual(before);
    expect(detail(core, "Q1").item).toMatchObject({ content: "队列看板的等待列", editCount: 1 });
  });

  it("验收标准和来源写 null 表示删掉，子项整份替换", async () => {
    const core = await oneProject();
    add(core, "队列看板", { acceptance: "五列", source: "构思第 17 轮的想法", subItems: ["看板"] });
    const item = succeed(
      editQueueItem(core.ctx, "app", "Q1", 0, { acceptance: null, source: null, subItems: [] }),
    ).item;
    expect(item).toMatchObject({ subItems: [], editCount: 1 });
    expect(item).not.toHaveProperty("acceptance");
    expect(item).not.toHaveProperty("source");
  });

  it("改备注：修改计数加一，事件里写新的备注，写 null 表示删掉，和原来一样不算改", async () => {
    const core = await oneProject();
    add(core, "队列看板", { note: "先做等待列" });
    const edited = succeed(
      editQueueItem(core.ctx, "app", "Q1", 0, { note: "先做等待列\n再做阶段列" }),
    ).item;
    expect(edited).toMatchObject({ note: "先做等待列\n再做阶段列", editCount: 1 });
    expect(core.received.at(-1)).toMatchObject({
      kind: "queue.edited",
      detail: { note: "先做等待列\n再做阶段列", editCount: 1 },
    });
    // 内容和别的项没动，备注和原来一样时什么都不写。
    const before = core.received.length;
    const same = succeed(
      editQueueItem(core.ctx, "app", "Q1", 1, { note: " 先做等待列\n再做阶段列 " }),
    ).item;
    expect(same.editCount).toBe(1);
    expect(core.received).toHaveLength(before);
    const removed = succeed(editQueueItem(core.ctx, "app", "Q1", 1, { note: null })).item;
    expect(removed).not.toHaveProperty("note");
    expect(removed.editCount).toBe(2);
    expect(core.ctx.db.select().from(queueItems).get()?.note).toBeNull();
  });

  it("备注写成只有空白时，请求的格式不合定义；只改备注不查内容的写作校验", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(queueItemUpdateSchema.safeParse({ note: "   " }).success).toBe(false);
    expect(queueItemUpdateSchema.safeParse({ note: null }).success).toBe(true);
    // 备注里写一整段长句，不被写作校验拦下。
    const note =
      "这一件事要先把看板的等待列做出来，再把每一列的数量写在列头上，最后逐个验证摆出来的件数。";
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { note })).toMatchObject({ ok: true });
  });

  it("和原来一样时不加修改计数，也不记事件", async () => {
    const core = await oneProject();
    add(core, "队列看板", { subItems: ["看板"] });
    const before = core.received.length;
    const result = editQueueItem(core.ctx, "app", "Q1", 0, {
      content: " 队列看板 ",
      subItems: ["看板"],
      source: null,
    });
    expect(result).toMatchObject({ ok: true, value: { item: { editCount: 0 } } });
    expect(core.received).toHaveLength(before);
  });

  it("一项都不写、写成空白时返回 BAD_REQUEST", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(editQueueItem(core.ctx, "app", "Q1", 0, {})).toMatchObject({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "至少要改一项：内容、阶段、验收标准、子项、来源、备注、状态说明、证据或依赖。",
      },
    });
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { content: " ", subItems: [""] })).toMatchObject(
      {
        ok: false,
        error: { code: "BAD_REQUEST", total: 2 },
      },
    );
  });

  it("改了的字段重新做写作校验，拦截一次报齐，什么都不改", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const result = editQueueItem(core.ctx, "app", "Q1", 0, {
      content: "那道检查太慢",
      subItems: ["一；二；三"],
      acceptance: "替人用的脚本能跑",
    });
    const issues = result.ok ? [] : (result.error.issues ?? []);
    expect(issues.map((issue) => [issue.rule, issue.where])).toEqual([
      ["writing.term.banned", "内容"],
      ["writing.sentence.semicolons", "子项 1"],
      ["writing.term.banned", "验收标准"],
    ]);
    expect(detail(core, "Q1").item).toMatchObject({ content: "队列看板", editCount: 0 });
  });

  it("分号的查法看改完以后的内容和子项，只改别的字段时不查", async () => {
    const core = await oneProject();
    add(core, "改三处地方;设置页;项目页", { subItems: ["设置页", "项目页"] });
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { acceptance: "三处都改好" })).toMatchObject({
      ok: true,
    });
    expect(editQueueItem(core.ctx, "app", "Q1", 1, { subItems: [] })).toMatchObject({
      ok: false,
      error: { rule: queueRules.contentSemicolons },
    });
  });

  it("做完和取消的事只是存档，分号不查，内容重复也不查", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色");
    succeed(move(core, "Q2", changeTo("dropped")));
    const archived = editQueueItem(core.ctx, "app", "Q2", 0, {
      content: "改三处地方;设置页;项目页",
    });
    expect(archived).toMatchObject({ ok: true, value: { item: { editCount: 1 } } });
    expect(editQueueItem(core.ctx, "app", "Q2", 1, { content: "队列看板" })).toMatchObject({
      ok: true,
    });
  });

  it("改成和别的还没做完的事相同的内容时拦截", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色");
    expect(editQueueItem(core.ctx, "app", "Q2", 0, { content: "队列看板" })).toMatchObject({
      ok: false,
      error: {
        rule: queueRules.contentDuplicate,
        message: "队列里已经有内容相同的 Q1，它还没有做完。",
      },
    });
  });

  it("编号写错、没有这件事、要先做迁移检查的项目，和改状态一样报", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const patch = { content: "队列看板的等待列" };
    expect(editQueueItem(core.ctx, "app", "Q01", 0, patch)).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
    expect(editQueueItem(core.ctx, "app", "Q2", 0, patch)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    core.ctx.db.update(projects).set({ skillVersion: null }).run();
    expect(editQueueItem(core.ctx, "app", "Q1", 0, patch)).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
  });
});

describe("列出和查看", () => {
  it("按编号排，可以按阶段和状态筛选，不写就不筛", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    add(core, "换一套配色", { stage: "improve" });
    add(core, "看板要变淡", { stage: "improve" });
    succeed(move(core, "Q3", changeTo("dropped")));
    const filtered = (filter: Parameters<typeof listQueueItems>[2]) =>
      ids(succeed(listQueueItems(core.ctx.db, "app", filter)));
    expect(filtered({})).toEqual(["Q1", "Q2", "Q3"]);
    expect(filtered({ stages: [], statuses: [] })).toEqual(["Q1", "Q2", "Q3"]);
    expect(filtered({ stages: ["improve"] })).toEqual(["Q2", "Q3"]);
    expect(filtered({ statuses: ["todo", "doing", "waiting"] })).toEqual(["Q1", "Q2"]);
    expect(filtered({ stages: ["improve"], statuses: ["dropped"] })).toEqual(["Q3"]);
  });

  it("项目不存在时返回 NOT_FOUND，要先做迁移检查的项目照常能读", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(listQueueItems(core.ctx.db, "ghost")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(getQueueItem(core.ctx.db, "ghost", "Q1")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
    core.ctx.db.update(projects).set({ skillVersion: null }).run();
    expect(ids(list(core))).toEqual(["Q1"]);
    expect(detail(core, "Q1").item.id).toBe("Q1");
  });

  it("查看一件事时带着全部状态变化，按先后排", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const round = openRound(core);
    succeed(take(core, round, [1]));
    succeed(move(core, "Q1", changeTo("done")));
    expect(detail(core, "Q1").events).toEqual([
      { item: "Q1", at: startAt.toISOString(), to: "todo", actor: "cli/2.0.0" },
      {
        item: "Q1",
        at: startAt.toISOString(),
        from: "todo",
        to: "doing",
        round: "v1-落地-1",
        actor: "cli/2.0.0",
      },
      {
        item: "Q1",
        at: startAt.toISOString(),
        from: "doing",
        to: "done",
        note: "v1-落地-1 的改后截图",
        round: "v1-落地-1",
        actor: "cli/2.0.0",
      },
    ]);
  });

  it("对外的样子合 model 的定义，接口上编码成中文，再解码回来不变", async () => {
    const core = await oneProject();
    const round = openRound(core, "check", 2);
    add(core, "队列看板", { proposer: "user", subItems: ["看板"], acceptance: "五列" });
    succeed(
      writeTx(core.ctx, (w) =>
        putQueueItem(
          w,
          "app",
          { content: "换一套配色", stage: "improve", proposer: "user" },
          { fromLine: { submission: 7, line: 3 } },
        ),
      ),
    );
    succeed(take(core, round, [1]));
    succeed(move(core, "Q1", changeTo("waiting")));
    succeed(move(core, "Q2", changeTo("dropped")));
    for (const qid of ["Q1", "Q2"]) {
      const { item, events: history } = detail(core, qid);
      expect(queueItemSchema.parse(z.encode(queueItemSchema, item))).toEqual(item);
      for (const event of history) {
        expect(queueEventSchema.parse(z.encode(queueEventSchema, event))).toEqual(event);
      }
    }
    expect(z.encode(queueItemSchema, detail(core, "Q1").item)).toMatchObject({
      stage: "落地",
      proposer: "用户",
      status: "等待",
      proposedIn: "v1-检查-2",
    });
  });
});

describe("改回待办：queue reopen", () => {
  const reopen = (core: TestCore, qid: string, note?: string) =>
    reopenQueueItem(core.ctx, "app", qid, note);

  it("等待的事改回待办，编号不变，说明写进状态说明", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const qid = itemIn(core, round, "waiting");
    expect(reopen(core, qid, "等的事做完了")).toMatchObject({
      ok: true,
      value: { id: qid, status: "todo", statusNote: "等的事做完了" },
    });
    expect(detail(core, qid).events.at(-1)).toMatchObject({
      from: "waiting",
      to: "todo",
      note: "等的事做完了",
    });
  });

  it("已取消的事不用点名，也不必是开始时取消的，明确要求就改回待办", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const qid = itemIn(core, round, "dropped");
    expect(reopen(core, qid)).toMatchObject({ ok: true, value: { id: qid, status: "todo" } });
    // 同一条要求，走状态图的 transitionQueueItem 仍要点名，两条路不混。
    const other = add(core, "另一件事").id;
    succeed(move(core, other, { to: "dropped", reason: "不做了" }));
    expect(move(core, other, { to: "todo" })).toMatchObject({
      ok: false,
      error: { rule: queueRules.statusGraph },
    });
  });

  it("已经是待办的什么都不做，不算错，也不多记一条变动", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    const before = rowCounts(core);
    expect(reopen(core, "Q1")).toMatchObject({ ok: true, value: { id: "Q1", status: "todo" } });
    expect(rowCounts(core)).toEqual(before);
  });

  it("已完成的事不能改回，要重新做就放进一件新的", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const qid = itemIn(core, round, "done");
    expect(reopen(core, qid)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        message: `${qid} 已经完成，不能再改状态。`,
        hint: `要重新做，就放进一件新的，在来源里写明接的是 ${qid}。`,
      },
    });
  });

  it("找不到的编号返回 NOT_FOUND", async () => {
    const core = await oneProject();
    expect(reopen(core, "Q9")).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("改标阶段：选中已有的一件", () => {
  const restage = (core: TestCore, qid: string, to: Stage, roundId?: number) =>
    writeTx(core.ctx, (w) => restageQueueItem(w, "app", Number(qid.slice(1)), to, { roundId }));

  it("待办的事只改阶段，编号不变，修改计数加一", async () => {
    const core = await oneProject();
    add(core, "队列看板", { stage: "improve" });
    const done = restage(core, "Q1", "land");
    expect(done).toMatchObject({ ok: true, value: { id: "Q1", stage: "land", status: "todo" } });
    expect(list(core)).toHaveLength(1);
    expect(detail(core, "Q1").item.editCount).toBe(1);
  });

  it("阶段没变时什么都不做", async () => {
    const core = await oneProject();
    add(core, "队列看板", { stage: "land" });
    const before = rowCounts(core);
    expect(restage(core, "Q1", "land")).toEqual({ ok: true, value: null });
    expect(rowCounts(core)).toEqual(before);
  });

  it("这一轮拿出的事改标以后回到待办，收尾时记成退回到那个阶段", async () => {
    const core = await oneProject();
    const round = openRound(core, "improve");
    add(core, "队列看板", { stage: "improve" });
    succeed(take(core, round));
    expect(detail(core, "Q1").item.status).toBe("doing");
    const result = restage(core, "Q1", "land", round);
    expect(result).toMatchObject({
      ok: true,
      value: { id: "Q1", stage: "land", status: "todo", statusNote: "选中，改标落地" },
    });
    expect(detail(core, "Q1").events.at(-1)).toMatchObject({
      from: "doing",
      to: "todo",
      round: "v1-提升-1",
    });
  });
});

describe("改阶段、状态说明和证据：queue edit", () => {
  it("待办和等待的事能改阶段，进行中、已完成、已取消的拦下并写明怎么办", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const waiting = itemIn(core, round, "waiting");
    expect(editQueueItem(core.ctx, "app", waiting, 0, { stage: "think" })).toMatchObject({
      ok: true,
      value: { item: { stage: "think", status: "waiting" } },
    });
    add(core, "第二件事");
    const doing = "Q2";
    succeed(take(core, round, [2]));
    expect(editQueueItem(core.ctx, "app", doing, 0, { stage: "think" })).toMatchObject({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: `${doing} 正在这个阶段里进行，这里不能改它的阶段。`,
        hint: `收尾时运行 ploop round close --return ${doing}:构思=<原因>，退回到别的阶段。`,
      },
    });
    const dropped = add(core, "第三件事").id;
    succeed(move(core, dropped, { to: "dropped", reason: "不做了" }));
    expect(editQueueItem(core.ctx, "app", dropped, 0, { stage: "think" })).toMatchObject({
      ok: false,
      error: { hint: `要再做它，先运行 ploop queue reopen ${dropped}，再改阶段。` },
    });
  });

  it("已完成的事改证据，状态说明和最近一次的变动说明一起改，状态不变", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const qid = itemIn(core, round, "done");
    const before = detail(core, qid).item;
    const edited = editQueueItem(core.ctx, "app", qid, before.editCount, {
      evidence: "第 2 版的落地阶段的改后截图",
    });
    expect(edited).toMatchObject({
      ok: true,
      value: {
        item: {
          status: "done",
          evidence: "第 2 版的落地阶段的改后截图",
          statusNote: "第 2 版的落地阶段的改后截图",
        },
      },
    });
    const { events: history } = detail(core, qid);
    expect(history.at(-1)).toMatchObject({ to: "done", note: "第 2 版的落地阶段的改后截图" });
    expect(history.at(-1)?.from).toBe("doing");
  });

  it("改状态说明：等待的事，依赖和状态说明一起改；已取消的事只改原因", async () => {
    const core = await oneProject();
    const round = openRound(core);
    const waiting = itemIn(core, round, "waiting");
    expect(
      editQueueItem(core.ctx, "app", waiting, 0, { statusNote: "等构思定下场景 S5" }),
    ).toMatchObject({
      ok: true,
      value: {
        item: {
          status: "waiting",
          dependsOn: "等构思定下场景 S5",
          statusNote: "等构思定下场景 S5",
        },
      },
    });
    const dropped = add(core, "第二件事").id;
    succeed(move(core, dropped, { to: "dropped", reason: "不做了" }));
    expect(
      editQueueItem(core.ctx, "app", dropped, 0, { statusNote: "已在第 2 版的落地阶段修掉" }),
    ).toMatchObject({
      ok: true,
      value: { item: { status: "dropped", statusNote: "已在第 2 版的落地阶段修掉" } },
    });
  });

  it("没有状态说明或证据可改的事，拦下并写明原因；只写空白也拦", async () => {
    const core = await oneProject();
    add(core, "队列看板");
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { statusNote: "补一句" })).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Q1 现在是待办，没有状态说明可改。" },
    });
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { evidence: "提交 3f2a9c1" })).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "Q1 现在是待办，没有证据可改。" },
    });
    expect(editQueueItem(core.ctx, "app", "Q1", 0, { evidence: "  " })).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
  });
});
