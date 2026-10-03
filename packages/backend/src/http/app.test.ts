import { describe, expect, it } from "vitest";
import { addRound } from "../core/testing.ts";
import { ensureDailySnapshot } from "../store/backup.ts";
import { events, productVersions, projects, queueEvents } from "../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "./testing.ts";

// 接口层的共同行为：没有的接口、没接住的错误、请求的格式、请求编号和执行者。
// 各个接口的一成一败在 routes/ 下的测试里。

const register = { root: "/work/app", repoKind: "自己的" };

/** 登记一个项目，返回它的编号。 */
async function registered(t: TestApp, body: object = register): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", { body });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

describe("错误码对上 HTTP 状态", () => {
  // 这一步的接口能给出的六种错误码，各用一个真实的请求触发。
  // RULE_BLOCKED、PAGE_GONE、CLIENT_TOO_OLD 由以后的接口给出，映射在 respond.test.ts 里核对。
  it("BAD_REQUEST 400：根目录是家目录", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: { root: "/Users/someone", repoKind: "自己的" },
    });
    expect([res.status, errorOf(res).code]).toEqual([400, "BAD_REQUEST"]);
  });

  it("CONFLICT 409：根目录已经登记给别的项目", async () => {
    const t = await testApp();
    await registered(t);
    const res = await t.request("POST", "/api/v1/projects", { body: register });
    expect([res.status, errorOf(res).code]).toEqual([409, "CONFLICT"]);
  });

  it("NOT_FOUND 404：没有这个项目", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/nothing");
    expect([res.status, errorOf(res).code]).toEqual([404, "NOT_FOUND"]);
  });

  it("NEEDS_DOCTOR 412：迁移没完成的项目改数据", async () => {
    const t = await testApp();
    const id = await registered(t, { ...register, legacySource: "/work/app/docs" });
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, { body: { name: "新名字" } });
    expect([res.status, errorOf(res).code]).toEqual([412, "NEEDS_DOCTOR"]);
  });

  it("BUSY 503：正在做每日快照时请后端退出", async () => {
    const t = await testApp();
    const backupsDir = t.paths.dirs.backups;
    const snapshot = ensureDailySnapshot({ sqlite: t.core.sqlite, backupsDir }, t.core.ctx.now());
    const res = await t.request("POST", "/api/v1/admin/shutdown");
    expect([res.status, errorOf(res).code]).toEqual([503, "BUSY"]);
    await snapshot;
  });

  it("INTERNAL 500：数据库出错，详情写进日志，hint 写日志的位置", async () => {
    const t = await testApp();
    t.core.sqlite.close();
    const res = await t.request("GET", "/api/v1/projects/app");
    expect(res.status).toBe(500);
    expect(errorOf(res)).toEqual({
      code: "INTERNAL",
      message: "后端内部出错。",
      hint: `出错的详情写在日志里：${t.deps.log.file}。`,
      where: "GET /api/v1/projects/app",
    });
    expect(t.logged).toHaveLength(1);
    expect(String(t.logged[0])).toMatch(/database connection is not open/u);
  });

  it("INTERNAL 500：存下的数据对不上定义时，hint 写出错的字段，where 写是哪个请求", async () => {
    const t = await testApp();
    await registered(t);
    await t.request("POST", "/api/v1/projects/app/queue", {
      body: { content: "设置页的保存按钮被挡住", stage: "落地", proposer: "AI" },
    });
    t.core.ctx.db.update(queueEvents).set({ actor: " " }).run();
    const res = await t.request("GET", "/api/v1/projects/app/queue/Q1");
    expect(res.status).toBe(500);
    expect(errorOf(res)).toMatchObject({
      code: "INTERNAL",
      hint: `出错的字段：events.0.actor。出错的详情写在日志里：${t.deps.log.file}。`,
      where: "GET /api/v1/projects/app/queue/Q1",
    });
  });
});

describe("没有的接口", () => {
  it.each([
    ["GET", "/api/v1/nothing"],
    ["DELETE", "/api/v1/projects/app"],
    ["GET", "/api/v2/health"],
    ["POST", "/"],
  ])("%s %s 返回 NOT_FOUND，写明方法和路径", async (method, path) => {
    const t = await testApp();
    const res = await t.request(method, path);
    expect(res.status).toBe(404);
    expect(errorOf(res)).toEqual({
      code: "NOT_FOUND",
      message: `没有这个接口：${method} ${path}。`,
      hint: "检查方法和路径。命令行和后端的版本不同时，运行 ploop setup。",
    });
  });
});

describe("请求的格式", () => {
  it("Content-Type 不是 JSON，拒绝，不当成空的请求体", async () => {
    const t = await testApp();
    const id = await registered(t);
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, {
      body: JSON.stringify({ name: "新名字" }),
      headers: { "Content-Type": "text/plain" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "请求体要写成 JSON，Content-Type 要写 application/json。",
      hint: "把请求头 Content-Type 改成 application/json。",
    });
  });

  it("Content-Type 带字符集，照常处理", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    expect(res.status).toBe(201);
  });

  it("JSON 写坏了，拒绝", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", { body: '{"root": "/work/app",' });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "请求体不是合法的 JSON。",
      hint: "请求体要写成一个 JSON 对象。",
    });
  });

  it("不合定义时一次列出全部问题，每条写位置", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: { repoKind: "shared", name: 3, addRoots: ["/a"], stage: "构思" },
    });
    expect(res.status).toBe(400);
    const hint = "对照这条命令的 --help，检查参数和取值。";
    const issues = [
      { message: "没有写 root。", hint, where: "root" },
      { message: "name 要写成文字。", hint, where: "name" },
      {
        message: "repoKind 写的是「shared」，可以写的有：自己的、共用的。",
        hint,
        where: "repoKind",
      },
      { message: "不认识的字段：addRoots、stage。", hint },
    ];
    expect(errorOf(res)).toEqual({ code: "BAD_REQUEST", ...issues[0], issues, total: 4 });
  });

  it("数组里的问题写到第几项", async () => {
    const t = await testApp();
    const id = await registered(t);
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, {
      body: { addRoots: ["/work/b", 7] },
    });
    expect(errorOf(res)).toMatchObject({
      message: "addRoots[1] 要写成文字。",
      where: "addRoots[1]",
    });
  });

  it("请求体不是对象", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", { body: ["/work/app"] });
    expect(errorOf(res)).toMatchObject({ message: "请求体要写成一个 JSON 对象。" });
    expect(errorOf(res).where).toBeUndefined();
  });

  it("枚举没写时报缺了这一项，不把空的输入写成「undefined」", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", { body: { root: "/work/app" } });
    expect(errorOf(res)).toMatchObject({ message: "没有写 repoKind。", where: "repoKind" });
    expect(JSON.stringify(res.body)).not.toMatch(/undefined|\{value\}/u);
  });

  it("接口收的是一组，请求体写成对象时说明要写数组", async () => {
    const t = await testApp();
    const id = await registered(t);
    const res = await t.request("POST", `/api/v1/projects/${id}/submissions/1/destinations`, {
      body: { line: 1, to: "不处理", reason: "x" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("请求体要写成一个 JSON 数组。");
  });

  it("请求体有两种写法都没对上时，报走得最远的那一种里的字段，不留空的字段名", async () => {
    const t = await testApp();
    const id = await registered(t);
    const path = `/api/v1/projects/${id}/rounds/v1-落地-1/land/review`;
    const level = await t.request("POST", path, {
      body: { opinions: [{ file: "a.txt", line: 1, level: "suggest", text: "名字" }], changed: [] },
    });
    expect(level.status).toBe(400);
    expect(errorOf(level).message).toBe("opinions[0].level 的写法不对，可以写的有：阻塞、建议。");
    const neither = await t.request("POST", path, { body: { changed: [] } });
    expect(errorOf(neither).message).toBe("opinions、skip 里要写对一种。");
    expect(JSON.stringify([level.body, neither.body])).not.toMatch(/"message":" 的/u);
  });

  it("查询参数不认识，拒绝", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects?stage=构思");
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("不认识的字段：stage。");
  });
});

describe("中文进来存成英文键", () => {
  it("仓库类别写中文，存成英文键，读出来又是中文", async () => {
    const t = await testApp();
    const id = await registered(t, { root: "/work/app", repoKind: "共用的" });
    const row = t.core.ctx.db.select().from(projects).get();
    expect(row?.repoKind).toBe("shared");
    const res = await t.request("GET", `/api/v1/projects/${id}`);
    expect(dataOf(res)).toMatchObject({ repoKind: "共用的" });
  });

  it("阶段存成英文键，状态里写中文", async () => {
    const t = await testApp();
    const id = await registered(t);
    addRound(t.core, id, { version: 1, stage: "check", seq: 2, status: "open" });
    const res = await t.request("GET", `/api/v1/projects/${id}/status`);
    expect(dataOf(res)).toMatchObject({
      round: { label: "v1-检查-2", stage: "检查", status: "进行中" },
    });
  });

  it("接口上写英文键，拒绝", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: { root: "/work/app", repoKind: "own" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("repoKind");
  });
});

describe("请求编号", () => {
  const key = { "Idempotency-Key": "2f4c0e1a-6d0b-4f0e-9d7c-1b5a3e2d9c80" };

  it("重发同一个请求，返回第一次的响应，不再执行", async () => {
    const t = await testApp();
    const first = await t.request("POST", "/api/v1/projects", { body: register, headers: key });
    t.core.setNow(new Date("2026-09-28T09:00:00Z"));
    const again = await t.request("POST", "/api/v1/projects", { body: register, headers: key });
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(t.core.ctx.db.select().from(projects).all()).toHaveLength(1);
    expect(t.core.ctx.db.select().from(events).all()).toHaveLength(2);
  });

  it("换一个编号，照常执行", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", { body: register, headers: key });
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { "Idempotency-Key": "another" },
    });
    expect(errorOf(res).code).toBe("CONFLICT");
  });

  it("结束一版重发时，不会多开一版", async () => {
    const t = await testApp();
    const id = await registered(t);
    const path = `/api/v1/projects/${id}/versions/next`;
    const body = { reason: "跳过提升" };
    const first = await t.request("POST", path, { body, headers: key });
    const again = await t.request("POST", path, { body, headers: key });
    expect(again.body).toEqual(first.body);
    expect(t.core.ctx.db.select().from(productVersions).all()).toHaveLength(2);
  });

  it("同一个编号用在别的路由上，各算各的", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", { body: register, headers: key });
    const res = await t.request("POST", "/api/v1/projects/app/versions/next", {
      body: { reason: "跳过提升" },
      headers: key,
    });
    expect(res.status).toBe(201);
    expect(dataOf(res)).toMatchObject({ started: { version: 2 } });
  });

  it("第一次失败的不记，改好以后用同一个编号重发，照常执行", async () => {
    const t = await testApp();
    const id = await registered(t);
    addRound(t.core, id, { version: 1, stage: "think", seq: 1, status: "open" });
    const path = `/api/v1/projects/${id}/versions/next`;
    const body = { reason: "跳过提升" };
    const blocked = await t.request("POST", path, { body, headers: key });
    expect(errorOf(blocked).code).toBe("CONFLICT");
    t.core.sqlite.exec("update rounds set status = 'closed', closed_at = started_at");
    const res = await t.request("POST", path, { body, headers: key });
    expect(res.status).toBe(201);
  });
});

describe("执行者", () => {
  it("事件记下客户端和会话", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { "X-Ploop-Client": "web/2.0.0", "X-Ploop-Session": "session-9" },
    });
    const rows = t.core.ctx.db.select().from(events).all();
    expect(rows.map((row) => [row.kind, row.client, row.session])).toEqual([
      ["project.registered", "web/2.0.0", "session-9"],
      ["version.started", "web/2.0.0", "session-9"],
    ]);
  });

  it("没带会话就不记", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", { body: register });
    const rows = t.core.ctx.db.select().from(events).all();
    expect(rows.map((row) => [row.client, row.session])).toEqual([
      ["cli/2.0.0", null],
      ["cli/2.0.0", null],
    ]);
  });

  it("写请求提交以后，订阅者收到这次的事件", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", { body: register });
    expect(t.core.received.map((event) => event.kind)).toEqual([
      "project.registered",
      "version.started",
    ]);
  });
});
