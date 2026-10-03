import { existsSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { clientHeader, type Result, requiredNode } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { type EnsuredBackend, ensureBackend, findBackend, type SlowStart } from "./ensure.ts";
import type { EnsureFailure } from "./failure.ts";
import { startLockAge } from "./start-lock.ts";
import { type FakeLogLine, type FakeWorld, fakeWorld } from "./testing.ts";

// 确认后端在运行、不在就拉起，见「01 架构」第六节。对着假世界测：时钟、后端进程和网络都是假的，
// 集中存储是真的临时目录。真的后端和子进程的测试在 ensure.use.test.ts 里。

function ensuredOf(result: Result<EnsuredBackend, EnsureFailure>): EnsuredBackend {
  if (!result.ok) throw new Error(`应当成功，却失败了：${JSON.stringify(result.error)}`);
  return result.value;
}

function failureOf(result: Result<EnsuredBackend, EnsureFailure>): EnsureFailure {
  if (result.ok) throw new Error(`应当失败，却成功了：${JSON.stringify(result.value)}`);
  return result.error;
}

/** 请后端退出的请求。 */
const shutdowns = (w: FakeWorld) =>
  w.requests.filter(({ method, url }) => method === "POST" && url.endsWith("/admin/shutdown"));

/** 在启动锁的位置放一把别人的锁，离上一次更新过了 ageMs。 */
function othersLock(w: FakeWorld, ageMs: number) {
  const startedAt = new Date(w.now() - ageMs).toISOString();
  writeFileSync(w.files.startLock, JSON.stringify({ pid: 5151, startedAt, token: "别人的" }));
  const seconds = (w.now() - ageMs) / 1000;
  utimesSync(w.files.startLock, seconds, seconds);
}

const dbNewer: FakeLogLine = {
  level: "error",
  event: "dbNewer",
  message: "数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
  hint: "运行 ploop setup 安装新版本。",
};

describe("后端已在运行", () => {
  it("构建号相同：直接用，不占启动锁，不拉起", async () => {
    const w = fakeWorld();
    const backend = w.running();
    expect(ensuredOf(await ensureBackend(w.options()))).toEqual({
      baseUrl: `http://127.0.0.1:${backend.port}`,
      port: backend.port,
      pid: backend.pid,
      build: "dev",
      started: false,
    });
    expect(w.spawns).toEqual([]);
    expect(existsSync(w.files.startLock)).toBe(false);
    expect(w.requests.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET http://127.0.0.1:${backend.port}/api/v1/health`,
    ]);
  });

  it("backend.json 不在时按默认端口找：PLOOP_PORT 没写就是 4731", async () => {
    const w = fakeWorld();
    const backend = w.running({ port: 4731, runInfo: false });
    expect(ensuredOf(await ensureBackend(w.options({ env: {} }))).pid).toBe(backend.pid);
    expect(w.spawns).toEqual([]);
  });

  it("backend.json 不在时按 PLOOP_PORT 找", async () => {
    const w = fakeWorld();
    const backend = w.running({ port: 51_000, runInfo: false });
    const env = { PLOOP_PORT: "51000" };
    expect(ensuredOf(await ensureBackend(w.options({ env }))).pid).toBe(backend.pid);
  });

  it("backend.json 留着，进程却已经不在：当作没开，拉起新的", async () => {
    const w = fakeWorld();
    const dead = w.running();
    w.kill(dead.pid);
    const value = ensuredOf(await ensureBackend(w.options()));
    expect(value).toMatchObject({ started: true, build: "dev" });
    expect(value.pid).not.toBe(dead.pid);
    expect(w.spawns).toHaveLength(1);
  });

  it("端口上应答的不是后端：当作没开，拉起新的", async () => {
    const w = fakeWorld();
    w.running({ foreign: true });
    expect(ensuredOf(await ensureBackend(w.options())).started).toBe(true);
  });

  it("应答的是另一个集中存储的后端：不算，拉起这个集中存储的", async () => {
    const w = fakeWorld();
    const other = w.running({ home: "/tmp/another-ploop-home" });
    const value = ensuredOf(await ensureBackend(w.options()));
    expect(value.started).toBe(true);
    expect(value.pid).not.toBe(other.pid);
  });
});

describe("拉起", () => {
  it("用 node 运行入口，PLOOP_HOME 写集中存储，别的环境变量照传", async () => {
    const w = fakeWorld();
    const env = { PLOOP_PORT: "0", PLOOP_TIME_MACHINE: "off", PLOOP_HOME: "/别处" };
    const value = ensuredOf(await ensureBackend(w.options({ env })));
    expect(value.started).toBe(true);
    expect(w.spawns).toEqual([
      {
        command: process.execPath,
        args: [w.entry],
        options: { env: { ...env, PLOOP_HOME: w.home }, cwd: w.home },
      },
    ]);
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("写了 nodePath 就用它运行", async () => {
    const w = fakeWorld();
    await ensureBackend(w.options({ nodePath: "/opt/node-24/bin/node" }));
    expect(w.spawns.map((spawn) => spawn.command)).toEqual(["/opt/node-24/bin/node"]);
  });

  it("每隔一百毫秒看一次，八秒内就绪就用它", async () => {
    const w = fakeWorld();
    w.next({ kind: "serve", readyAfterMs: 7_950 });
    const began = w.now();
    expect(ensuredOf(await ensureBackend(w.options())).started).toBe(true);
    expect(w.now() - began).toBe(8_000);
  });

  it("八秒到了还没就绪，也没有后端占着实例锁：报出起不来", async () => {
    const w = fakeWorld();
    w.next({ kind: "stall" });
    const failure = failureOf(await ensureBackend(w.options()));
    expect(failure).toMatchObject({
      kind: "startFailed",
      reason: "timeout",
      waitedMs: 8_000,
      logTail: [],
      logFile: w.files.log,
      entry: w.entry,
      node: process.execPath,
    });
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("进程退出了：马上报出退出码和这一次拉起以后日志里的几行，不等到八秒", async () => {
    const w = fakeWorld();
    w.writeLog(1234, { level: "info", event: "stopped", message: "后端已退出。" });
    w.next({ kind: "exit", code: 3, lockFirst: true, lines: [dbNewer] });
    w.advance(1_000);
    const failure = failureOf(await ensureBackend(w.options()));
    expect(failure).toMatchObject({ kind: "startFailed", reason: "exited", exitCode: 3 });
    if (failure.kind !== "startFailed") throw new Error("应当是 startFailed");
    expect(failure.waitedMs).toBeLessThan(1_000);
    expect(failure.logTail).toHaveLength(1);
    expect(failure.logTail[0]).toContain("错误：数据库已被更新版本的程序迁移过");
    expect(failure.logTail[0]).toContain("怎么改：运行 ploop setup 安装新版本。");
  });

  it("进程被信号结束：报出信号，没有退出码", async () => {
    const w = fakeWorld();
    w.next({ kind: "exit", code: null, signal: "SIGKILL" });
    const failure = failureOf(await ensureBackend(w.options()));
    expect(failure).toMatchObject({ reason: "exited", signal: "SIGKILL" });
    expect(failure).not.toHaveProperty("exitCode");
  });

  it("没能运行 Node：报出系统的报错", async () => {
    const w = fakeWorld();
    w.next({ kind: "spawnError", detail: "spawn /opt/node ENOENT" });
    expect(failureOf(await ensureBackend(w.options()))).toMatchObject({
      kind: "startFailed",
      reason: "spawnFailed",
      detail: "spawn /opt/node ENOENT",
    });
  });

  it("安静退出，又没有别的后端在启动：马上报出，退出码 0", async () => {
    const w = fakeWorld();
    const otherInstance = { level: "info", event: "otherInstance", message: "另一个后端在退出。" };
    w.next({ kind: "exit", code: 0, lines: [otherInstance as FakeLogLine] });
    const failure = failureOf(await ensureBackend(w.options()));
    expect(failure).toMatchObject({ reason: "exited", exitCode: 0 });
    if (failure.kind !== "startFailed") throw new Error("应当是 startFailed");
    expect(failure.waitedMs).toBeLessThan(1_000);
  });

  it("拉起的安静退出了，另一个后端占着实例锁在启动：接着等它", async () => {
    const w = fakeWorld();
    const other = w.startingElsewhere(12_000);
    w.next({ kind: "exit", code: 0, afterMs: 6_000 });
    const value = ensuredOf(await ensureBackend(w.options()));
    expect(value).toMatchObject({ pid: other, started: false });
  });

  it("入口文件不在：不拉起", async () => {
    const w = fakeWorld();
    const backendEntry = `${w.home}/app/current/backend.mjs`;
    expect(failureOf(await ensureBackend(w.options({ backendEntry })))).toMatchObject({
      kind: "startFailed",
      reason: "entryMissing",
      entry: backendEntry,
      waitedMs: 0,
      logTail: [],
    });
    expect(w.spawns).toEqual([]);
  });

  it("Node 版本不够：不拉起，写明需要的版本和当前版本", async () => {
    const w = fakeWorld();
    w.setNodeVersion("22.11.0");
    expect(failureOf(await ensureBackend(w.options()))).toEqual({
      kind: "nodeTooOld",
      node: process.execPath,
      current: "22.11.0",
      required: requiredNode,
    });
    expect(w.spawns).toEqual([]);
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("拉起的后端构建号和命令行的不同：报出，不再拉起", async () => {
    const w = fakeWorld();
    w.next({ kind: "serve", build: "2.0.0+a1b2c3d" });
    expect(failureOf(await ensureBackend(w.options()))).toMatchObject({
      kind: "buildMismatch",
      expected: "dev",
      actual: "2.0.0+a1b2c3d",
      entry: w.entry,
    });
    expect(w.spawns).toHaveLength(1);
  });
});

describe("迁移数据库期间", () => {
  it("后端占着实例锁、八秒还没写 backend.json：接着等，告诉调用的一方一次", async () => {
    const w = fakeWorld();
    w.next({ kind: "serve", readyAfterMs: 20_000 });
    const notices: SlowStart[] = [];
    const onSlowStart = (notice: SlowStart) => notices.push(notice);
    const began = w.now();
    expect(ensuredOf(await ensureBackend(w.options({ onSlowStart }))).started).toBe(true);
    expect(w.now() - began).toBe(20_000);
    expect(notices).toEqual([
      {
        waitedMs: 8_000,
        leftMs: 52_000,
        message: "后端还没有就绪，可能在迁移数据库，最多再等 52 秒。",
      },
    ]);
  });

  it("从拉起算最多等六十秒，到时报出起不来", async () => {
    const w = fakeWorld();
    w.next({ kind: "hang" });
    expect(failureOf(await ensureBackend(w.options()))).toMatchObject({
      kind: "startFailed",
      reason: "timeout",
      waitedMs: 60_000,
    });
  });

  it("等的时候一直更新启动锁，别的会话不会当它异常而接手", async () => {
    const w = fakeWorld();
    w.next({ kind: "serve", readyAfterMs: 45_000 });
    const ages: number[] = [];
    w.at(40_000, () => {
      const age = startLockAge(w.files.startLock, w.now());
      if (age !== undefined) ages.push(age.ageMs);
    });
    ensuredOf(await ensureBackend(w.options()));
    expect(ages).toHaveLength(1);
    expect(ages[0]).toBeLessThan(1_000);
  });
});

describe("启动锁", () => {
  it("五个同时调用，只拉起一个后端，都用它", async () => {
    const w = fakeWorld();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => ensureBackend(w.options())));
    const values = results.map(ensuredOf);
    expect(w.spawns).toHaveLength(1);
    expect(new Set(values.map((value) => value.pid)).size).toBe(1);
    expect(values.filter((value) => value.started)).toHaveLength(1);
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("别人占着新的锁：等它拉起的后端就绪，直接用，不动别人的锁", async () => {
    const w = fakeWorld();
    othersLock(w, 0);
    const other = w.startingElsewhere(2_000);
    expect(ensuredOf(await ensureBackend(w.options()))).toMatchObject({
      pid: other,
      started: false,
    });
    expect(w.spawns).toEqual([]);
    expect(JSON.parse(readFileSync(w.files.startLock, "utf8"))).toMatchObject({ token: "别人的" });
  });

  it("锁超过三十秒没更新：接手，拉起", async () => {
    const w = fakeWorld();
    othersLock(w, 31_000);
    const began = w.now();
    expect(ensuredOf(await ensureBackend(w.options())).started).toBe(true);
    expect(w.now() - began).toBeLessThan(1_000);
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("锁一直在更新就不接手，等占锁的一方拉起的后端", async () => {
    const w = fakeWorld();
    othersLock(w, 0);
    for (let at = 5_000; at <= 40_000; at += 5_000) {
      w.at(at, () => {
        const seconds = w.now() / 1000;
        utimesSync(w.files.startLock, seconds, seconds);
      });
    }
    const other = w.startingElsewhere(40_000);
    expect(ensuredOf(await ensureBackend(w.options())).pid).toBe(other);
    expect(w.spawns).toEqual([]);
  });

  it("占到锁以后再看一次：刚有别人拉起了后端就不拉起", async () => {
    const w = fakeWorld();
    // 第一眼看时还没有后端。别人拉起的后端就绪，同时放开了锁，这一方接着就占到了锁。
    othersLock(w, 0);
    w.at(1_000, () => {
      w.running();
      rmSync(w.files.startLock);
    });
    const value = ensuredOf(await ensureBackend(w.options()));
    expect(value.started).toBe(false);
    expect(w.spawns).toEqual([]);
  });

  it("拉起失败时也放开锁", async () => {
    const w = fakeWorld();
    w.next({ kind: "exit", code: 2 });
    failureOf(await ensureBackend(w.options()));
    expect(existsSync(w.files.startLock)).toBe(false);
  });
});

describe("构建号不同", () => {
  it("请旧后端退出，等它结束，再拉起新的", async () => {
    const w = fakeWorld();
    const old = w.running({ build: "old" });
    const value = ensuredOf(await ensureBackend(w.options()));
    expect(value).toMatchObject({
      build: "dev",
      started: true,
      replaced: { pid: old.pid, build: "old" },
    });
    expect(value.pid).not.toBe(old.pid);
    expect(w.system.alive(old.pid)).toBe(false);
    const sent = shutdowns(w);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.headers.get(clientHeader)).toMatch(/^cli\//u);
  });

  it("旧后端在做快照：按 Retry-After 重发，做完以后退出", async () => {
    const w = fakeWorld();
    w.running({ build: "old", busyForMs: 3_000 });
    expect(ensuredOf(await ensureBackend(w.options())).started).toBe(true);
    expect(shutdowns(w)).toHaveLength(4);
  });

  it("旧后端六十秒内一直不能退出：放弃，不拉起新的，旧的照常运行", async () => {
    const w = fakeWorld();
    const old = w.running({ build: "old", busyForMs: 120_000 });
    const failure = failureOf(await ensureBackend(w.options()));
    expect(failure).toMatchObject({
      kind: "replaceFailed",
      reason: "refused",
      pid: old.pid,
      build: "old",
      error: { code: "BUSY" },
    });
    expect(w.spawns).toEqual([]);
    expect(w.system.alive(old.pid)).toBe(true);
    expect(existsSync(w.files.startLock)).toBe(false);
  });

  it("旧后端答应退出却一直不结束：等十秒后报出，写明进程号", async () => {
    const w = fakeWorld();
    const old = w.running({ build: "old", stopAfterMs: "never" });
    expect(failureOf(await ensureBackend(w.options()))).toEqual({
      kind: "replaceFailed",
      reason: "stillRunning",
      pid: old.pid,
      build: "old",
      waitedMs: 10_000,
    });
    expect(w.spawns).toEqual([]);
  });

  it("Node 版本不够时不动旧的后端", async () => {
    const w = fakeWorld();
    const old = w.running({ build: "old" });
    w.setNodeVersion("22.11.0");
    expect(failureOf(await ensureBackend(w.options())).kind).toBe("nodeTooOld");
    expect(shutdowns(w)).toEqual([]);
    expect(w.system.alive(old.pid)).toBe(true);
  });

  it("几个调用同时发现构建号不同：只请一次退出，只拉起一个", async () => {
    const w = fakeWorld();
    w.running({ build: "old" });
    const results = await Promise.all([1, 2, 3].map(() => ensureBackend(w.options())));
    const values = results.map(ensuredOf);
    expect(new Set(values.map((value) => value.pid)).size).toBe(1);
    expect(values.every((value) => value.build === "dev")).toBe(true);
    expect(shutdowns(w)).toHaveLength(1);
    expect(w.spawns).toHaveLength(1);
  });
});

describe("只看一眼，不拉起", () => {
  it("后端在运行：返回它，构建号不同也照样返回", async () => {
    const w = fakeWorld();
    const backend = w.running({ build: "old" });
    expect(await findBackend(w.options())).toEqual({
      port: backend.port,
      pid: backend.pid,
      build: "old",
    });
    expect(shutdowns(w)).toEqual([]);
  });

  it("后端没开：返回 undefined，不拉起，也不占启动锁", async () => {
    const w = fakeWorld();
    expect(await findBackend(w.options())).toBeUndefined();
    expect(w.spawns).toEqual([]);
    expect(existsSync(w.files.startLock)).toBe(false);
  });
});
