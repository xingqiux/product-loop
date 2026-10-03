import { existsSync } from "node:fs";
import { join } from "node:path";
import { beijingDay } from "@product-loop/model";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { dailySnapshotHook } from "../process/backup.ts";
import { openLog } from "../process/log.ts";
import { createProcessState } from "../process/state.ts";
import { ensureDailySnapshot } from "../store/backup.ts";
import { tempDir } from "../store/testing.ts";
import { retryAfterSeconds } from "./respond.ts";
import { dataOf, errorOf, type TestApp, testApp } from "./testing.ts";

// 后端进程的状态在接口层的体现，见 gate.ts：全局操作期间返回 BUSY，
// 写请求之前做每日快照，退出期间关掉用完的连接。

const register = { root: "/work/app", repoKind: "自己的" };

/** 用假时钟建一份进程的状态，接进接口应用。 */
async function withState() {
  let now = new Date("2026-09-28T08:00:00Z");
  const state = createProcessState({ now: () => now });
  const t = await testApp({ process: state, now: () => now });
  const later = (seconds: number) => {
    now = new Date(now.getTime() + seconds * 1000);
  };
  return { t, state, later };
}

/** 开始一件全局操作，返回让它做完的函数。 */
function begin(state: ReturnType<typeof createProcessState>, work: "migrate" | "restore") {
  let finish: () => void = () => {};
  const done = state.during(work, () => new Promise<void>((resolve) => (finish = resolve)));
  return async () => {
    finish();
    await done;
  };
}

describe("全局操作期间", () => {
  it("迁移数据时，写请求返回 BUSY 和 Retry-After，写明在做什么、做了多久，不写入", async () => {
    const { t, state, later } = await withState();
    const finish = begin(state, "migrate");
    later(12);
    const res = await t.request("POST", "/api/v1/projects", { body: register });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(String(retryAfterSeconds));
    expect(errorOf(res)).toEqual({
      code: "BUSY",
      message: "后端正在迁移数据，已经 12 秒，这时不能写入。",
      hint: "等它做完再写。命令行会按 Retry-After 自动重试。",
    });
    await finish();
    const projects = await t.request("GET", "/api/v1/projects");
    expect(dataOf(projects)).toEqual([]);
  });

  it("从快照恢复时，退出的请求也返回 BUSY，后端不退出", async () => {
    const { t, state } = await withState();
    const finish = begin(state, "restore");
    const res = await t.request("POST", "/api/v1/admin/shutdown");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(String(retryAfterSeconds));
    expect(errorOf(res).message).toBe("后端正在从快照恢复数据库，已经 0 秒，这时不能退出。");
    expect(t.shutdowns()).toBe(0);
    await finish();
  });

  it("读的请求和 health 照常", async () => {
    const { t, state } = await withState();
    const finish = begin(state, "restore");
    expect((await t.request("GET", "/api/v1/health")).status).toBe(200);
    expect((await t.request("GET", "/api/v1/projects")).status).toBe(200);
    await finish();
  });

  it("做完以后，写请求和退出照常", async () => {
    const { t, state } = await withState();
    const finish = begin(state, "migrate");
    await finish();
    expect(state.busy()).toBeUndefined();
    expect((await t.request("POST", "/api/v1/projects", { body: register })).status).toBe(201);
    expect((await t.request("POST", "/api/v1/admin/shutdown")).status).toBe(202);
  });

  it("同时只能做一件全局操作", async () => {
    const { state } = await withState();
    const finish = begin(state, "migrate");
    await expect(state.during("restore", async () => {})).rejects.toThrow(/同时只能做一件/u);
    await finish();
  });
});

/** 接口应用接上真的每日快照。快照放在临时集中存储的 backups/。 */
async function withSnapshots(): Promise<TestApp> {
  let hook: () => Promise<void> = async () => {};
  const t = await testApp({ dailySnapshot: () => hook() });
  hook = dailySnapshotHook({
    sqlite: t.core.sqlite,
    backupsDir: t.paths.dirs.backups,
    now: t.deps.now,
    log: openLog({ dir: tempDir("ploop-logs-") }),
  });
  return t;
}

const dailyFile = (t: TestApp) =>
  join(t.paths.dirs.backups, `daily-${beijingDay(t.deps.now())}.db`);

describe("写请求之前的每日快照", () => {
  it("当天第一次写入之前先做快照，快照里是写入之前的数据", async () => {
    const t = await withSnapshots();
    expect((await t.request("POST", "/api/v1/projects", { body: register })).status).toBe(201);
    const snapshot = new Database(dailyFile(t), { readonly: true });
    const count = (db: Database.Database) =>
      db.prepare("select count(*) from projects").pluck().get();
    expect(count(snapshot)).toBe(0);
    snapshot.close();
    expect(count(t.core.sqlite)).toBe(1);
  });

  it("读的请求和管理后端的请求不做快照", async () => {
    const t = await withSnapshots();
    await t.request("GET", "/api/v1/projects");
    await t.request("POST", "/api/v1/admin/shutdown");
    expect(existsSync(dailyFile(t))).toBe(false);
  });

  it("快照期间来的写请求等它做完再执行，只有退出的请求返回 BUSY", async () => {
    const t = await withSnapshots();
    const order: string[] = [];
    const backupsDir = t.paths.dirs.backups;
    const snapshot = ensureDailySnapshot({ sqlite: t.core.sqlite, backupsDir }, t.deps.now());
    void snapshot.then(() => order.push("snapshot"));
    const write = t.request("POST", "/api/v1/projects", { body: register });
    void write.then(() => order.push("write"));
    const shutdown = await t.request("POST", "/api/v1/admin/shutdown");
    expect([shutdown.status, errorOf(shutdown).code]).toEqual([503, "BUSY"]);
    expect((await write).status).toBe(201);
    await snapshot;
    expect(order).toEqual(["snapshot", "write"]);
  });
});

describe("后端退出期间", () => {
  it("响应带 Connection: close，连接用完就关", async () => {
    const { t, state } = await withState();
    expect((await t.request("GET", "/api/v1/health")).headers.get("connection")).toBeNull();
    state.markStopping();
    const health = await t.request("GET", "/api/v1/health");
    expect(health.headers.get("connection")).toBe("close");
    const write = await t.request("POST", "/api/v1/projects", { body: register });
    expect([write.status, write.headers.get("connection")]).toEqual([201, "close"]);
  });
});
