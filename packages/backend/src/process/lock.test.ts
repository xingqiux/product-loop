import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instanceLockFileName } from "@product-loop/model";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished } from "vitest";
import { tempDir } from "../store/testing.ts";
import { type InstanceLock, tryInstanceLock, waitForInstanceLock } from "./lock.ts";

// 实例锁：一个集中存储同一时间只跑一个后端，见「01 架构」第六节后端启动的第 1 步。
// 同一个进程里的两个连接也互相排斥，所以这里在一个进程里测。
// 进程异常退出以后锁由系统放开，这一条在 main.use.test.ts 里用子进程测。

/** 占到锁，测试结束时放开。占不到时测试失败。 */
function lockOf(dir: string): InstanceLock {
  const lock = tryInstanceLock(dir);
  if (lock === undefined) throw new Error("应当占到锁");
  onTestFinished(lock.release);
  return lock;
}

describe("实例锁", () => {
  it("占着的时候别人占不到，放开以后能占到", () => {
    const dir = tempDir("ploop-run-");
    const first = lockOf(dir);
    expect(tryInstanceLock(dir)).toBeUndefined();
    first.release();
    lockOf(dir);
  });

  it("放开两次也没关系", () => {
    const dir = tempDir("ploop-run-");
    const lock = lockOf(dir);
    lock.release();
    lock.release();
    lockOf(dir);
  });

  it("文件头写着占锁的进程号，旁边不留 -journal 文件", () => {
    const dir = tempDir("ploop-run-");
    lockOf(dir).release();
    const db = new Database(join(dir, instanceLockFileName), { readonly: true });
    expect(db.pragma("user_version", { simple: true })).toBe(process.pid);
    db.close();
    expect(readdirSync(dir)).toEqual([instanceLockFileName]);
  });

  it("文件被写坏了、不是 SQLite 的，删掉重来一次", () => {
    const dir = tempDir("ploop-run-");
    writeFileSync(join(dir, instanceLockFileName), "这不是数据库".repeat(20));
    lockOf(dir);
    expect(tryInstanceLock(dir)).toBeUndefined();
  });
});

describe("等别的后端放开实例锁", () => {
  it("等的期间对方放开了，就占到", async () => {
    const dir = tempDir("ploop-run-");
    const first = lockOf(dir);
    setTimeout(first.release, 100);
    const lock = await waitForInstanceLock(dir, { waitMs: 3000, pollMs: 20 });
    expect(lock).toBeDefined();
    lock?.release();
  });

  it("到时仍占不到，返回 undefined", async () => {
    const dir = tempDir("ploop-run-");
    lockOf(dir);
    const started = Date.now();
    expect(await waitForInstanceLock(dir, { waitMs: 150, pollMs: 20 })).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
  });
});
