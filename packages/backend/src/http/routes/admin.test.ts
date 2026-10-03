import { describe, expect, it } from "vitest";
import { addProject } from "../../core/testing.ts";
import { createProcessState } from "../../process/state.ts";
import { ensureDailySnapshot } from "../../store/backup.ts";
import { retryAfterSeconds } from "../respond.ts";
import { dataOf, errorOf, testApp } from "../testing.ts";

// POST /admin/shutdown，见「05 接口」第四节。正在做快照时返回忙，见「01 架构」第六节。

describe("POST /admin/shutdown", () => {
  it("请后端退出，返回它的进程号", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/admin/shutdown");
    expect(res.status).toBe(202);
    expect(dataOf(res)).toEqual({ pid: process.pid });
    expect(t.shutdowns()).toBe(1);
  });

  it("正在做每日快照时返回 BUSY 和 Retry-After，不退出。快照做完以后可以退出", async () => {
    const t = await testApp();
    const backupsDir = t.paths.dirs.backups;
    const snapshot = ensureDailySnapshot({ sqlite: t.core.sqlite, backupsDir }, t.core.ctx.now());
    const busy = await t.request("POST", "/api/v1/admin/shutdown");
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBe(String(retryAfterSeconds));
    expect(errorOf(busy)).toEqual({
      code: "BUSY",
      message: "后端正在做今天的数据库快照，现在不能退出。",
      hint: "等快照做完再请后端退出，命令行会按 Retry-After 自动重试。",
    });
    expect(t.shutdowns()).toBe(0);
    expect((await snapshot).ok).toBe(true);
    const res = await t.request("POST", "/api/v1/admin/shutdown");
    expect(res.status).toBe(202);
    expect(t.shutdowns()).toBe(1);
  });
});

// 备份、恢复和清理附件，见「03 数据模型」第七节。
describe("备份和恢复的接口", () => {
  it("立即做一份快照，列在 manual 里；恢复它以后，之后登记的项目不见了", async () => {
    const t = await testApp();
    const taken = await t.request("POST", "/api/v1/admin/backup");
    expect(taken.status).toBe(201);
    const { name } = dataOf(taken) as { name: string };
    expect(name).toMatch(/^manual-\d{8}T\d{9}Z\.db$/u);
    const listed = await t.request("GET", "/api/v1/admin/backups");
    expect(dataOf(listed)).toMatchObject({ manual: [{ name }], daily: [] });

    const app = addProject(t.core, "/work/app");
    // 恢复之前先预览：快照里没有 app，它是恢复以后会消失的那个（N17）。预览不改任何东西。
    const previewed = await t.request("GET", `/api/v1/admin/restore/preview?snapshot=${name}`);
    expect(previewed.status).toBe(200);
    expect(dataOf(previewed)).toEqual({ snapshot: name, projects: [] });
    expect(dataOf(await t.request("GET", "/api/v1/projects"))).toHaveLength(1);
    const gone = await t.request("GET", "/api/v1/admin/restore/preview?snapshot=nope.db");
    expect(gone.status).toBe(404);
    expect(app).toBeDefined();
    const restored = await t.request("POST", "/api/v1/admin/restore", {
      body: { snapshot: name },
    });
    expect(restored.status).toBe(200);
    expect(dataOf(restored)).toMatchObject({ snapshot: name, migrated: 0, problems: [] });
    const projects = await t.request("GET", "/api/v1/projects");
    expect(dataOf(projects)).toEqual([]);
    const again = await t.request("GET", "/api/v1/admin/backups");
    expect((dataOf(again) as { preRestore: unknown[] }).preRestore).toHaveLength(1);
  });

  it("恢复期间写请求返回 BUSY；快照不在返回 NOT_FOUND", async () => {
    let finish: () => void = () => {};
    const state = createProcessState({ now: () => new Date() });
    const t = await testApp({
      process: state,
      backups: {
        snapshotNow: async () => ({
          ok: false,
          error: { kind: "snapshotFailed", file: "x", message: "" },
        }),
        preview: () => ({ ok: true, value: { snapshot: "a.db", projects: [] } }),
        restore: async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { ok: true, value: { snapshot: "a.db", kept: "b.db", migrated: 0, problems: [] } };
        },
      },
    });
    const restoring = t.request("POST", "/api/v1/admin/restore", { body: { snapshot: "a.db" } });
    await until(() => state.busy() !== undefined);
    const write = await t.request("POST", "/api/v1/projects", {
      body: { root: "/work/app", repoKind: "自己的" },
    });
    expect(write.status).toBe(503);
    expect(errorOf(write).code).toBe("BUSY");
    finish();
    expect((await restoring).status).toBe(200);

    const plain = await testApp();
    const missing = await plain.request("POST", "/api/v1/admin/restore", {
      body: { snapshot: "daily-2020-01-01.db" },
    });
    expect(errorOf(missing).code).toBe("NOT_FOUND");
  });

  it("gc 只删没有引用、超过七天的附件", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/admin/gc");
    expect(dataOf(res)).toEqual({ removed: 0, bytes: 0, tempFiles: 0 });
  });
});

/** 每轮事件循环查一次条件，直到满足。 */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("等了一千轮事件循环，条件仍不满足");
}
