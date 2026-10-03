import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import { addRound, startAt } from "../../core/testing.ts";
import type { AppType } from "../../index.ts";
import { queueEvents, queueItems } from "../../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 队列的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 业务规则的细节在内核的测试里，这里只看请求和响应：中文进出、状态码、If-Match、外壳的警告。

const at = startAt.toISOString();
const content = "设置页的保存按钮在窄屏被挡住";

/** 登记项目 app，返回它的编号。 */
async function register(t: TestApp): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", {
    body: { root: "/work/app", repoKind: "自己的" },
  });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

/** 在项目 app 里放进一件，阶段默认是落地，提出者是 AI。 */
async function add(t: TestApp, text = content, extra: object = {}) {
  return t.request("POST", "/api/v1/projects/app/queue", {
    body: { content: text, stage: "落地", proposer: "AI", ...extra },
  });
}

/** 登记项目 app，放进一件，返回测试的应用。 */
async function oneItem(): Promise<TestApp> {
  const t = await testApp();
  await register(t);
  await add(t);
  return t;
}

/** 改一件事的状态。 */
function transition(t: TestApp, qid: string, body: unknown) {
  return t.request("POST", `/api/v1/projects/app/queue/${qid}/transitions`, { body });
}

/** 列出队列，查询参数按给的顺序写。 */
async function listIds(t: TestApp, query: [string, string][] = []): Promise<string[]> {
  const search = new URLSearchParams(query).toString();
  const res = await t.request("GET", `/api/v1/projects/app/queue${search ? `?${search}` : ""}`);
  return (dataOf(res) as { id: string }[]).map((item) => item.id);
}

/** 刚放进的 Q1 在接口上的样子。 */
const q1 = {
  id: "Q1",
  content,
  stage: "落地",
  proposer: "AI",
  createdAt: at,
  status: "待办",
  subItems: [],
  editCount: 0,
};

describe("POST /projects/:pid/queue", () => {
  it("放进一件，编号是 Q1。阶段和提出者写中文，存成英文键", async () => {
    const t = await testApp();
    const id = await register(t);
    const res = await t.request("POST", `/api/v1/projects/${id}/queue`, {
      body: { content, stage: "落地", proposer: "AI", acceptance: "窄屏下按钮完整可见" },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      data: { ...q1, acceptance: "窄屏下按钮完整可见" },
      warnings: [],
      next: [],
    });
    const row = t.core.ctx.db.select().from(queueItems).get();
    expect([row?.stage, row?.proposer, row?.status]).toEqual(["land", "ai", "todo"]);
  });

  it("放进时带备注：多行文字原样返回，没写备注的事没有 note 这一项", async () => {
    const t = await testApp();
    await register(t);
    const note = "第一行\n第二行，细节写在这里";
    const res = await add(t, content, { note });
    expect(res.status).toBe(201);
    expect(dataOf(res)).toEqual({ ...q1, note });
    expect(t.core.ctx.db.select().from(queueItems).get()?.note).toBe(note);
    expect(dataOf(await add(t, "换一套配色"))).not.toHaveProperty("note");
  });

  it("备注写成只有空白，返回 BAD_REQUEST，写明是哪个字段", async () => {
    const t = await testApp();
    await register(t);
    const res = await add(t, content, { note: "  \n " });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      code: "BAD_REQUEST",
      message: "没有写备注。",
      where: "note",
    });
  });

  it("写作校验的警告不拦截，放进外壳的 warnings，写明规矩和位置", async () => {
    const t = await testApp();
    await register(t);
    const res = await add(t, "写作校验拦住了看板上的文字");
    expect(res.status).toBe(201);
    expect(res.body.ok && res.body.warnings).toEqual([
      expect.objectContaining({ rule: "writing.term.soft", where: "内容" }),
    ]);
  });

  it("内容超过 40 个字，返回 RULE_BLOCKED，写明怎么改；备注写长了不拦", async () => {
    const t = await testApp();
    await register(t);
    const res = await add(t, "字".repeat(41));
    expect(res.status).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "queue.content.tooLong",
      message: "内容有 41 个字，超过 40 个字。",
      hint: "缩短到 40 个字以内，细节写进备注。",
      where: "内容",
    });
    expect(t.core.ctx.db.select().from(queueItems).all()).toEqual([]);
    const ok = await add(t, content, { note: "细节".repeat(200) });
    expect(ok.status).toBe(201);
  });

  it("项目主线「写作规范」一节停用的说法，放进时拦截，返回 RULE_BLOCKED 和规矩编号", async () => {
    const t = await testApp();
    await register(t);
    const text = ["# 主线", "", "## 写作规范", "", "| 停用的说法 | 改成什么 |", "| --- | --- |"];
    await t.request("POST", "/api/v1/projects/app/mainline/revisions", {
      body: { text: [...text, "| 工作流 | 流程 |", ""].join("\n"), baseRevision: null },
    });
    const res = await add(t, "理清发布的工作流");
    expect(res.status).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "writing.term.banned",
      where: "内容",
    });
    expect(t.core.ctx.db.select().from(queueItems).all()).toEqual([]);
  });

  it("阶段写英文键，返回 BAD_REQUEST，写明可以写的中文", async () => {
    const t = await testApp();
    await register(t);
    const res = await add(t, content, { stage: "land" });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      message: "stage 写的是「land」，可以写的有：构思、使用、检查、落地、提升。",
      where: "stage",
    });
  });

  it("带着同一个请求编号重发，返回第一次的结果，不多放一件", async () => {
    const t = await testApp();
    await register(t);
    const headers = { "Idempotency-Key": "5b1f7d2e-9a0c-4c1e-8f3a-2d6b7e9c0a14" };
    const path = "/api/v1/projects/app/queue";
    const body = { content, stage: "落地", proposer: "AI" };
    const first = await t.request("POST", path, { body, headers });
    t.core.setNow(new Date("2026-09-28T09:00:00Z"));
    const again = await t.request("POST", path, { body, headers });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(t.core.ctx.db.select().from(queueItems).all()).toHaveLength(1);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await add(t);
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/queue", () => {
  /** Q1、Q3 在落地，Q2 在构思，Q3 已取消。 */
  async function threeItems(): Promise<TestApp> {
    const t = await oneItem();
    await add(t, "场景清单缺交付线", { stage: "构思" });
    await add(t, "队列看板的等待行和列里的卡重复");
    await transition(t, "Q3", { to: "已取消", reason: "和 Q1 重复" });
    return t;
  }

  it("按编号排，写中文的阶段和状态筛选，不写就不筛", async () => {
    const t = await threeItems();
    expect(await listIds(t)).toEqual(["Q1", "Q2", "Q3"]);
    expect(await listIds(t, [["stage", "落地"]])).toEqual(["Q1", "Q3"]);
    expect(
      await listIds(t, [
        ["stage", "落地"],
        ["status", "待办"],
      ]),
    ).toEqual(["Q1"]);
    const statuses: [string, string][] = [
      ["status", "待办"],
      ["status", "已取消"],
    ];
    expect(await listIds(t, statuses)).toEqual(["Q1", "Q2", "Q3"]);
  });

  it("每一件的枚举写中文", async () => {
    const t = await threeItems();
    const res = await t.request("GET", "/api/v1/projects/app/queue");
    expect(res.status).toBe(200);
    const items = dataOf(res) as { id: string; stage: string; status: string }[];
    expect(items.map((item) => [item.id, item.stage, item.status])).toEqual([
      ["Q1", "落地", "待办"],
      ["Q2", "构思", "待办"],
      ["Q3", "落地", "已取消"],
    ]);
  });

  it("筛选的取值写错，返回 BAD_REQUEST，写明是第几个、可以写什么", async () => {
    const t = await oneItem();
    const query = new URLSearchParams([
      ["status", "待办"],
      ["status", "不做了"],
    ]);
    const res = await t.request("GET", `/api/v1/projects/app/queue?${query}`);
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      message: "status[1] 写的是「不做了」，可以写的有：待办、进行中、等待、已完成、已取消。",
      where: "status[1]",
    });
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/queue");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/queue/board", () => {
  it("在等的放上面，其余按阶段分五列；停了七天的标出来，取消的不上看板", async () => {
    const t = await oneItem();
    await add(t, "看板停了七天的卡片要淡一些", { stage: "检查" });
    await add(t, "决定表要能切换全部", { stage: "提升" });
    expect((await transition(t, "Q2", { to: "等待", dependsOn: "Q1" })).status).toBe(200);
    expect((await transition(t, "Q3", { to: "已取消", reason: "和决定表合并做" })).status).toBe(
      200,
    );
    t.core.setNow(new Date(startAt.getTime() + 8 * 24 * 60 * 60 * 1000));
    const res = await t.request("GET", "/api/v1/projects/app/queue/board");
    expect(res.status).toBe(200);
    const board = dataOf(res) as {
      waiting: { id: string; stale: boolean }[];
      columns: { stage: string; items: { id: string; stale: boolean }[] }[];
    };
    expect(board.waiting.map(({ id, stale }) => ({ id, stale }))).toEqual([
      { id: "Q2", stale: true },
    ]);
    expect(board.columns.map((column) => column.stage)).toEqual([
      "构思",
      "使用",
      "检查",
      "落地",
      "提升",
    ]);
    expect(
      board.columns.flatMap((column) => column.items.map(({ id, stale }) => ({ id, stale }))),
    ).toEqual([{ id: "Q1", stale: true }]);
  });

  it("看板上的每一件带着备注，没有备注的没有这一项", async () => {
    const t = await oneItem();
    await add(t, "决定表要能切换全部", { stage: "提升", note: "先做全部按钮\n再做搜索" });
    const res = await t.request("GET", "/api/v1/projects/app/queue/board");
    const board = dataOf(res) as {
      columns: { items: { id: string; note?: string }[] }[];
    };
    const items = board.columns.flatMap((column) => column.items);
    expect(items.map(({ id, note }) => [id, note])).toEqual([
      ["Q1", undefined],
      ["Q2", "先做全部按钮\n再做搜索"],
    ]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/nope/queue/board");
    expect(res.status).toBe(404);
    expect(errorOf(res).code).toBe("NOT_FOUND");
  });
});

describe("GET /projects/:pid/queue/:qid", () => {
  it("一件事的全部字段和状态变化，按先后排", async () => {
    const t = await oneItem();
    await transition(t, "Q1", { to: "等待", dependsOn: "等构思定下场景 S4" });
    const res = await t.request("GET", "/api/v1/projects/app/queue/Q1");
    expect(res.status).toBe(200);
    const waiting = "等构思定下场景 S4";
    expect(dataOf(res)).toEqual({
      item: { ...q1, status: "等待", statusNote: waiting, dependsOn: waiting },
      events: [
        { item: "Q1", at, to: "待办", actor: "cli/2.0.0" },
        { item: "Q1", at, from: "待办", to: "等待", note: waiting, actor: "cli/2.0.0" },
      ],
      appearances: [],
    });
  });

  it("早先迁移进来的事项，第一条变动不是待办，也读得出来", async () => {
    const t = await oneItem();
    // 早先的迁移只写一条没有 from 的变动，状态是迁移时的状态。已迁移的真实数据就是这样的。
    t.core.ctx.db.update(queueItems).set({ status: "done", evidence: "提交 3f2a9c1" }).run();
    t.core.ctx.db.update(queueEvents).set({ toStatus: "done" }).run();
    const res = await t.request("GET", "/api/v1/projects/app/queue/Q1");
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      item: { id: "Q1", status: "已完成" },
      events: [{ item: "Q1", to: "已完成" }],
    });
  });

  it("编号写错返回 BAD_REQUEST，没有这件事返回 NOT_FOUND", async () => {
    const t = await oneItem();
    const bad = await t.request("GET", "/api/v1/projects/app/queue/q1");
    expect(bad.status).toBe(400);
    expect(errorOf(bad).where).toBe("q1");
    const missing = await t.request("GET", "/api/v1/projects/app/queue/Q9");
    expect(missing.status).toBe(404);
    expect(errorOf(missing).message).toBe("项目「app」的队列里没有 Q9。");
  });
});

describe("PATCH /projects/:pid/queue/:qid", () => {
  const path = "/api/v1/projects/app/queue/Q1";
  const body = { content: "设置页的保存按钮在窄屏下被遮住", subItems: ["保存按钮", "取消按钮"] };

  it("带 If-Match 改内容和子项，修改计数加一", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, { body, headers: { "If-Match": "0" } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: { ...q1, ...body, editCount: 1 },
      warnings: [],
      next: [],
    });
  });

  it("改备注：写文字是改，写 null 是删掉，都要带 If-Match", async () => {
    const t = await oneItem();
    const set = await t.request("PATCH", path, {
      body: { note: "先做等待列\n再做阶段列" },
      headers: { "If-Match": "0" },
    });
    expect(dataOf(set)).toEqual({ ...q1, note: "先做等待列\n再做阶段列", editCount: 1 });
    const removed = await t.request("PATCH", path, {
      body: { note: null },
      headers: { "If-Match": "1" },
    });
    expect(dataOf(removed)).toEqual({ ...q1, editCount: 2 });
    const blank = await t.request("PATCH", path, {
      body: { note: " " },
      headers: { "If-Match": "2" },
    });
    expect(blank.status).toBe(400);
    expect(errorOf(blank).where).toBe("note");
  });

  it("改内容时超过 40 个字，返回 RULE_BLOCKED，什么都不改", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, {
      body: { content: "字".repeat(41) },
      headers: { "If-Match": "0" },
    });
    expect(res.status).toBe(422);
    expect(errorOf(res)).toMatchObject({ rule: "queue.content.tooLong", where: "内容" });
    const after = await t.request("GET", path);
    expect(dataOf(after)).toMatchObject({ item: { content, editCount: 0 } });
  });

  it("If-Match 也可以写成带引号的修改计数", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, { body, headers: { "If-Match": '"0"' } });
    expect(dataOf(res)).toMatchObject({ editCount: 1 });
  });

  it("If-Match 对不上，返回 409 CONFLICT，什么都不改", async () => {
    const t = await oneItem();
    await t.request("PATCH", path, { body, headers: { "If-Match": "0" } });
    const res = await t.request("PATCH", path, {
      body: { content: "另一个会话写的内容" },
      headers: { "If-Match": "0" },
    });
    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual({
      code: "CONFLICT",
      message: "Q1 已被别处改过，修改计数现在是 1，请求里写的是 0。",
      hint: "运行 ploop queue show Q1 看最新的内容，再重新修改。",
      where: "Q1",
    });
    const row = t.core.ctx.db.select().from(queueItems).get();
    expect([row?.content, row?.editCount]).toEqual([body.content, 1]);
  });

  it("没带 If-Match，返回 BAD_REQUEST，写明怎么取修改计数", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, { body });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "修改 Q1 要带请求头 If-Match，写它现在的修改计数。",
      hint: "运行 ploop queue show Q1，取 Q1 现在的修改计数。",
      where: "If-Match",
    });
  });

  it("If-Match 写的不是修改计数，返回 BAD_REQUEST", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, { body, headers: { "If-Match": 'W/"0"' } });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe('请求头 If-Match 写的是「W/"0"」，要写修改计数，例如 3。');
  });

  it("一项都不写，返回 BAD_REQUEST", async () => {
    const t = await oneItem();
    const res = await t.request("PATCH", path, { body: {}, headers: { "If-Match": "0" } });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe(
      "至少要改一项：内容、阶段、验收标准、子项、来源、备注、状态说明、证据或依赖。",
    );
  });

  it("改阶段、已完成事项的证据：只改文字，状态不变，修改计数加一", async () => {
    const t = await oneItem();
    const staged = await t.request("PATCH", path, {
      body: { stage: "构思" },
      headers: { "If-Match": "0" },
    });
    expect(staged.status).toBe(200);
    expect(dataOf(staged)).toMatchObject({ stage: "构思", status: "待办", editCount: 1 });
    const noEvidence = await t.request("PATCH", path, {
      body: { evidence: "提交 3f2a9c1" },
      headers: { "If-Match": "1" },
    });
    expect(noEvidence.status).toBe(400);
    expect(errorOf(noEvidence).message).toBe("Q1 现在是待办，没有证据可改。");
  });

  it("改等待事项的依赖：状态说明和改成等待的那条变动一起改，待办的事没有依赖可改", async () => {
    const t = await oneItem();
    const noDepends = await t.request("PATCH", path, {
      body: { dependsOn: "等构思阶段定下场景" },
      headers: { "If-Match": "0" },
    });
    expect(noDepends.status).toBe(400);
    expect(errorOf(noDepends).message).toBe("Q1 现在是待办，没有依赖可改。");
    await transition(t, "Q1", { to: "等待", dependsOn: "等第 1 版的结果" });
    const count = t.core.ctx.db.select().from(queueItems).get()?.editCount ?? 0;
    const res = await t.request("PATCH", path, {
      body: { dependsOn: "等构思阶段定下场景" },
      headers: { "If-Match": String(count) },
    });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      status: "等待",
      dependsOn: "等构思阶段定下场景",
      statusNote: "等构思阶段定下场景",
    });
    const notes = t.core.ctx.db.select({ note: queueEvents.note }).from(queueEvents).all();
    expect(notes.map((e) => e.note)).not.toContain("等第 1 版的结果");
  });

  it("带着同一个请求编号重发，返回第一次的结果，不因修改计数变了而冲突", async () => {
    const t = await oneItem();
    const headers = { "If-Match": "0", "Idempotency-Key": "c7e2a9d4-1f3b-4e6a-9b8c-0d5f2e7a1b36" };
    const first = await t.request("PATCH", path, { body, headers });
    const again = await t.request("PATCH", path, { body, headers });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
  });
});

describe("POST /projects/:pid/queue/:qid/transitions", () => {
  it("改成已取消，写明原因。状态写中文，存成英文键", async () => {
    const t = await oneItem();
    const res = await transition(t, "Q1", { to: "已取消", reason: "已在 v1-落地-1 修掉" });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({ ...q1, status: "已取消", statusNote: "已在 v1-落地-1 修掉" });
    const row = t.core.ctx.db.select().from(queueItems).get();
    expect(row?.status).toBe("dropped");
  });

  it("取消不写原因，返回 BAD_REQUEST；只写空白，返回 RULE_BLOCKED 和规矩编号", async () => {
    const t = await oneItem();
    const missing = await transition(t, "Q1", { to: "已取消" });
    expect(missing.status).toBe(400);
    expect(errorOf(missing)).toMatchObject({ message: "没有写 reason。", where: "reason" });
    const blank = await transition(t, "Q1", { to: "已取消", reason: "  " });
    expect(blank.status).toBe(422);
    expect(errorOf(blank)).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "queue.drop.reason",
      message: "取消 Q1 要写原因。",
    });
  });

  it("改成进行中不收：进行中只在开始阶段时拿出来", async () => {
    const t = await oneItem();
    const res = await transition(t, "Q1", { to: "进行中" });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("to");
  });

  it("状态图以外的变化，返回 RULE_BLOCKED，写明只能改成什么", async () => {
    const t = await oneItem();
    const res = await transition(t, "Q1", { to: "已完成", evidence: "v1-落地-1 的改后截图" });
    expect(res.status).toBe(422);
    expect(errorOf(res)).toEqual({
      code: "RULE_BLOCKED",
      rule: "queue.status.graph",
      message: "Q1 现在是待办，不能改成已完成。",
      hint: "待办只能改成进行中、等待或已取消。先运行 ploop round start 落地，把它拿成进行中。做完写 ploop round close --done Q1=<证据>。",
      where: "Q1",
    });
  });

  it("写待办就是改回待办：已取消的事不用点名也能改回，请求里伪造的捞回条件仍然不收", async () => {
    const t = await oneItem();
    addRound(t.core, "app", { version: 1, stage: "land", seq: 1, status: "open" });
    await transition(t, "Q1", { to: "已取消", reason: "已在 v1-落地-1 修掉" });
    const forged = await transition(t, "Q1", {
      to: "待办",
      droppedAtRoundStart: true,
      namedInReply: true,
    });
    expect(forged.status).toBe(400);
    expect(errorOf(forged).message).toBe("不认识的字段：droppedAtRoundStart、namedInReply。");
    expect(t.core.ctx.db.select().from(queueItems).get()?.status).toBe("dropped");

    const res = await transition(t, "Q1", { to: "待办", note: "用户说还要做" });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({ id: "Q1", status: "待办", statusNote: "用户说还要做" });
    expect(t.core.ctx.db.select().from(queueItems).get()?.status).toBe("todo");
    expect(t.core.ctx.db.select().from(queueEvents).all()).toHaveLength(3);
  });

  it("等待的事写待办改回；已经是待办的再写一次不算错，不多记一条变动", async () => {
    const t = await oneItem();
    await transition(t, "Q1", { to: "等待", dependsOn: "等构思定下场景 S4" });
    const back = await transition(t, "Q1", { to: "待办" });
    expect(back.status).toBe(200);
    expect(dataOf(back)).toMatchObject({ status: "待办" });
    const again = await transition(t, "Q1", { to: "待办" });
    expect(again.status).toBe(200);
    expect(t.core.ctx.db.select().from(queueEvents).all()).toHaveLength(3);
  });

  it("等待的事不能直接做完：写出能运行的命令", async () => {
    const t = await oneItem();
    await transition(t, "Q1", { to: "等待", dependsOn: "等构思定下场景 S4" });
    const res = await transition(t, "Q1", { to: "已完成", evidence: "v1-落地-1 的改后截图" });
    expect(res.status).toBe(422);
    expect(errorOf(res)).toMatchObject({
      rule: "queue.status.graph",
      hint: "先运行 ploop queue reopen Q1，改回待办。",
    });
  });

  it("没有这件事，返回 NOT_FOUND", async () => {
    const t = await oneItem();
    const res = await transition(t, "Q9", { to: "等待", dependsOn: "等构思定下场景 S4" });
    expect(res.status).toBe(404);
  });
});

describe("接口的类型", () => {
  // 类型化客户端从 AppType 看到的请求和响应，由类型检查核对，见「02 技术选型」第六节。
  const client = hc<AppType>("http://127.0.0.1:4731");
  type Queue = (typeof client.api.v1.projects)[":pid"]["queue"];
  type Transition = Queue[":qid"]["transitions"]["$post"];

  it("请求和响应里的状态都写中文，改状态不收进行中", () => {
    type To = InferRequestType<Transition>["json"]["to"];
    expectTypeOf<To>().toEqualTypeOf<"等待" | "已完成" | "已取消" | "待办">();
    type Status = InferResponseType<Transition, 200>["data"]["status"];
    expectTypeOf<Status>().toEqualTypeOf<"待办" | "进行中" | "等待" | "已完成" | "已取消">();
  });

  it("响应按状态码收窄：拦截是 RULE_BLOCKED，修改计数对不上是 CONFLICT", () => {
    type Blocked = InferResponseType<Transition, 422>["error"]["code"];
    expectTypeOf<Blocked>().toEqualTypeOf<"RULE_BLOCKED">();
    type Edit = Queue[":qid"]["$patch"];
    expectTypeOf<InferResponseType<Edit, 409>["error"]["code"]>().toEqualTypeOf<"CONFLICT">();
  });
});
