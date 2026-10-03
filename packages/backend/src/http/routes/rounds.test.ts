import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addRound, startAt } from "../../core/testing.ts";
import { recordUseRun } from "../../core/use/testing.ts";
import { pages, rounds } from "../../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 轮次的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 开始和收尾的细节在内核 rounds/*.test.ts 里，这里只看请求和响应：中文进出、状态码、外壳。

/** 经接口登记项目 app，返回它的编号。 */
async function register(t: TestApp): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", {
    body: { root: "/work/app", repoKind: "自己的" },
  });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

/** 放进一件事。 */
async function add(t: TestApp, pid: string, content: string, stage: string): Promise<void> {
  const res = await t.request("POST", `/api/v1/projects/${pid}/queue`, {
    body: { content, stage, proposer: "AI" },
  });
  expect(res.status).toBe(201);
}

const start = (t: TestApp, pid: string, body: object, session?: string) =>
  t.request("POST", `/api/v1/projects/${pid}/rounds`, {
    body,
    headers: { "X-Ploop-Session": session },
  });

describe("POST /projects/:pid/rounds", () => {
  it("开始阶段：阶段写中文，拿出的事和主线缺的几个部分写中文，警告和下一步放进外壳", async () => {
    const t = await testApp();
    const pid = await register(t);
    await add(t, pid, "设置页的保存按钮在窄屏被挡住", "使用");
    const res = await start(t, pid, { stage: "使用" });
    expect(res.status).toBe(201);
    expect(dataOf(res)).toMatchObject({
      round: { label: "v1-使用-1", stage: "使用", status: "进行中" },
      versionChange: null,
      autoClosed: null,
      taken: [{ id: "Q1", status: "进行中", stage: "使用" }],
      deferred: [],
      baseCommits: null,
      mainline: { revision: null, missingParts: expect.arrayContaining(["给谁用"]) },
    });
    if (!res.body.ok) throw new Error("应当成功");
    expect(res.body.warnings.map((w) => w.rule)).toEqual(["mainline.ten"]);
    expect(res.body.next).toEqual(["ploop use schema"]);
  });

  it("已有一个阶段开着：CONFLICT，写明是哪个阶段、哪个会话开的", async () => {
    const t = await testApp();
    const pid = await register(t);
    expect((await start(t, pid, { stage: "构思" }, "7f3a9c2e")).status).toBe(201);
    const res = await start(t, pid, { stage: "使用" }, "b81d");
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: "CONFLICT",
      where: "第 1 版的构思阶段",
      message: expect.stringContaining("是会话 7f3a9c2e 在"),
    });
  });

  it("阶段写英文键：BAD_REQUEST", async () => {
    const t = await testApp();
    const pid = await register(t);
    expect((await start(t, pid, { stage: "use" })).status).toBe(400);
  });
});

describe("GET /projects/:pid/rounds/:rid", () => {
  it("按阶段的写法取一个阶段：拿出的事、页面，状态写中文", async () => {
    const t = await testApp();
    const pid = await register(t);
    await add(t, pid, "设置页的保存按钮在窄屏被挡住", "使用");
    await start(t, pid, { stage: "使用" }, "7f3a9c2e");
    const res = await t.request(
      "GET",
      `/api/v1/projects/${pid}/rounds/${encodeURIComponent("v1-使用-1")}`,
    );
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      round: { label: "v1-使用-1", status: "进行中" },
      openedBySession: "7f3a9c2e",
      openedByClient: "cli/2.0.0",
      items: [{ item: { id: "Q1", status: "进行中" }, result: null }],
      pages: [],
    });
  });

  it("按旧编号取一个阶段，旧编号里的斜杠编码成 %2F", async () => {
    const t = await testApp();
    const pid = await register(t);
    addRound(t.core, pid, { version: 1, stage: "think", seq: 29 });
    t.core.ctx.db.update(rounds).set({ legacyId: "2026-09-20/think-29" }).run();
    const rid = encodeURIComponent("2026-09-20/think-29");
    const res = await t.request("GET", `/api/v1/projects/${pid}/rounds/${rid}`);
    expect(dataOf(res)).toMatchObject({
      round: { label: "v1-构思-29", status: "已收尾", legacyId: "2026-09-20/think-29" },
    });
  });

  it("没有这个阶段：NOT_FOUND", async () => {
    const t = await testApp();
    const pid = await register(t);
    const res = await t.request("GET", `/api/v1/projects/${pid}/rounds/fix-13`);
    expect(res.status).toBe(404);
    expect(errorOf(res).message).toBe("项目「app」没有迁移前的文件名是「fix-13」的阶段。");
  });
});

describe("POST /projects/:pid/rounds/:rid/close", () => {
  it("收尾：结果写中文，下一步放进外壳", async () => {
    const t = await testApp();
    const pid = await register(t);
    await add(t, pid, "设置页的保存按钮在窄屏被挡住", "使用");
    await start(t, pid, { stage: "使用" });
    recordUseRun(t.core);
    const res = await t.request("POST", `/api/v1/projects/${pid}/rounds/v1-使用-1/close`, {
      body: {
        results: [{ id: "Q1", result: "退回", note: "定义不对", stage: "构思" }],
        summary: "看完了设置页",
      },
    });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      round: { label: "v1-使用-1", status: "已收尾" },
      summary: "看完了设置页",
      items: [{ item: { id: "Q1", status: "待办" }, result: "退回", returnedTo: "构思" }],
    });
    if (!res.body.ok) throw new Error("应当成功");
    // 设计规范还没写齐，进入检查以前先补主线
    expect(res.body.next).toEqual(["ploop mainline check"]);
  });

  it("还有一页在等用户点：CONFLICT，写明是哪一页", async () => {
    const t = await testApp();
    const pid = await register(t);
    await start(t, pid, { stage: "使用" });
    const round = t.core.ctx.db.select().from(rounds).where(eq(rounds.projectId, pid)).get();
    t.core.ctx.db
      .insert(pages)
      .values({
        projectId: pid,
        roundId: round?.id ?? 0,
        seq: 1,
        purpose: "ask",
        formatVersion: 1,
        sections: {},
        images: [],
        fill: {},
        status: "presented",
        presentedAt: startAt,
      })
      .run();
    const res = await t.request("POST", `/api/v1/projects/${pid}/rounds/v1-使用-1/close`, {
      body: {},
    });
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      message: "第 1 版的使用阶段的第 1 页还在等用户点，现在不能收尾。",
      where: "第 1 版的使用阶段",
    });
  });

  it("结果写成开始时取消：BAD_REQUEST", async () => {
    const t = await testApp();
    const pid = await register(t);
    const res = await t.request("POST", `/api/v1/projects/${pid}/rounds/v1-使用-1/close`, {
      body: { results: [{ id: "Q1", result: "开始时取消" }] },
    });
    expect(res.status).toBe(400);
  });
});
