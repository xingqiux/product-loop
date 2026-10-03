import { EventEmitter } from "node:events";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { err, logFileName, ok } from "@product-loop/model";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Exec } from "../core/time-machine.ts";
import { openDatabase } from "../store/db.ts";
import { homePaths } from "../store/home.ts";
import { migrationsFolder, tempDir } from "../store/testing.ts";
import { tryInstanceLock } from "./lock.ts";
import { readRunInfo } from "./run-info.ts";
import { type Started, type StartOptions, startBackend } from "./start.ts";

// 后端的启动，见「01 架构」第六节。在这个进程里起真的服务，端口写 0，集中存储是临时的。
// 停止信号、结束进程、外部命令都换成假的。子进程的测试在 main.use.test.ts 里。

/** 假的执行器：Time Machine 的检查说没有设置备份盘，lsof 查不到进程。 */
const quietExec: Exec = async (command) =>
  command.endsWith("lsof")
    ? ok({ status: 1, stdout: "", stderr: "" })
    : ok({ status: 0, stdout: "", stderr: "tmutil: No destinations configured.\n" });

type Harness = {
  readonly home: string;
  readonly signals: EventEmitter;
  /** 结束进程时的退出码，按先后。 */
  readonly exits: number[];
  /** 等到结束进程。 */
  readonly exited: Promise<number>;
  readonly options: StartOptions;
  start(): Promise<Started>;
};

function harness(overrides: Partial<StartOptions> = {}, home = tempDir("ploop-home-")): Harness {
  const signals = new EventEmitter();
  const exits: number[] = [];
  let onExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    onExit = resolve;
  });
  const options: StartOptions = {
    env: { PLOOP_HOME: home, PLOOP_PORT: "0", PLOOP_TIME_MACHINE: "off" },
    build: "dev",
    webDir: join(home, "web"),
    migrationsFolder,
    entry: "/work/product-loop/packages/backend/src/main.ts",
    exec: quietExec,
    exit: (code) => {
      exits.push(code);
      onExit(code);
    },
    signals,
    userHome: "/Users/someone",
    timing: { graceMs: 1000, lockWaitMs: 300, probeMs: 500 },
    ...overrides,
  };
  return {
    home,
    signals,
    exits,
    exited,
    options,
    start: async () => {
      const started = await startBackend(options);
      if (started.kind === "serving") {
        onTestFinished(() => started.backend.stop("request"));
      }
      return started;
    },
  };
}

/** 启动，应当开始服务。 */
async function serving(h: Harness) {
  const started = await h.start();
  if (started.kind !== "serving") throw new Error(`应当开始服务，退出码是 ${started.code}`);
  return started.backend;
}

/** 集中存储里日志的每一行。 */
function logLines(home: string): Record<string, unknown>[] {
  const file = join(home, "logs", logFileName);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const lastLine = (home: string) => logLines(home).at(-1);

/** 在集中存储的 run/ 下占好实例锁，像另一个后端占着一样。 */
function heldLock(home: string) {
  mkdirSync(join(home, "run"), { recursive: true });
  return tryInstanceLock(join(home, "run"));
}

const health = async (port: number) =>
  (await fetch(`http://127.0.0.1:${port}/api/v1/health`)).json() as Promise<{
    readonly data: { readonly pid: number; readonly home: string };
  }>;

describe("启动和退出", () => {
  it("开始服务以后写好 backend.json，health 能应答，日志记下启动", async () => {
    const h = harness();
    const backend = await serving(h);
    const info = readRunInfo(join(h.home, "run"));
    expect(info).toEqual({
      pid: process.pid,
      port: backend.port,
      build: "dev",
      schemaVersion: expect.any(Number),
      startedAt: expect.any(String),
      home: h.home,
      node: process.version,
      entry: "/work/product-loop/packages/backend/src/main.ts",
    });
    expect(backend.port).toBeGreaterThan(0);
    expect((await health(backend.port)).data).toMatchObject({ pid: process.pid, home: h.home });
    expect(lastLine(h.home)).toMatchObject({ level: "info", event: "started", port: backend.port });
  });

  it("POST /admin/shutdown：响应照常发出，收尾以后以 0 结束，backend.json 删掉，实例锁放开", async () => {
    const h = harness();
    const backend = await serving(h);
    const res = await fetch(`http://127.0.0.1:${backend.port}/api/v1/admin/shutdown`, {
      method: "POST",
      headers: { "X-Ploop-Client": "cli/2.0.0" },
    });
    expect(res.status).toBe(202);
    expect(res.headers.get("connection")).toBe("close");
    expect(await h.exited).toBe(0);
    expect(readRunInfo(join(h.home, "run"))).toBeUndefined();
    const lock = tryInstanceLock(join(h.home, "run"));
    expect(lock).toBeDefined();
    lock?.release();
    expect(logLines(h.home).map((line) => line.event)).toEqual(
      expect.arrayContaining(["started", "stopping", "stopped"]),
    );
  });

  it("收到 SIGTERM：同样收尾，以 0 结束", async () => {
    const h = harness();
    await serving(h);
    h.signals.emit("SIGTERM");
    expect(await h.exited).toBe(0);
    expect(readRunInfo(join(h.home, "run"))).toBeUndefined();
    expect(lastLine(h.home)).toMatchObject({ event: "stopped" });
  });

  it("上一个实例异常退出留下的 backend.json，拿到实例锁以后换掉", async () => {
    const h = harness();
    const run = join(h.home, "run");
    mkdirSync(run, { recursive: true });
    const stale = {
      pid: 99999,
      port: 1,
      build: "old",
      schemaVersion: 1,
      startedAt: "2026-09-01T00:00:00.000Z",
      home: h.home,
      node: "v24.12.0",
      entry: "/old/backend.mjs",
    };
    writeFileSync(join(run, "backend.json"), JSON.stringify(stale));
    const backend = await serving(h);
    expect(readRunInfo(run)).toMatchObject({ pid: process.pid, port: backend.port });
  });
});

describe("一个集中存储只跑一个后端", () => {
  it("第二个实例发现这个集中存储的后端在应答：安静退出，退出码 0，日志写明", async () => {
    const first = harness();
    const backend = await serving(first);
    const second = harness({}, first.home);
    expect(await second.start()).toEqual({ kind: "exited", code: 0 });
    expect(lastLine(first.home)).toMatchObject({
      level: "info",
      event: "alreadyRunning",
      port: backend.port,
      runningPid: process.pid,
    });
    expect(readRunInfo(join(first.home, "run"))).toMatchObject({ port: backend.port });
    expect((await health(backend.port)).data.home).toBe(first.home);
  });

  it("实例锁被占着、却没有后端应答：等一会儿，等不到也安静退出", async () => {
    const h = harness();
    const lock = heldLock(h.home);
    onTestFinished(() => lock?.release());
    expect(await h.start()).toEqual({ kind: "exited", code: 0 });
    expect(lastLine(h.home)).toMatchObject({
      level: "info",
      event: "otherInstance",
      hint: "过几秒再试。一直这样时，运行 ploop backend stop 以后再试。",
    });
  });

  it("占着实例锁的后端在等待期间退出了：接着启动", async () => {
    const h = harness({ timing: { lockWaitMs: 3000 } });
    const lock = heldLock(h.home);
    setTimeout(() => lock?.release(), 200);
    const backend = await serving(h);
    expect(backend.port).toBeGreaterThan(0);
  });
});

describe("起不来时写明原因", () => {
  it("端口被别的程序占用：退出码 4，写明占用它的进程，不写 backend.json", async () => {
    const occupier = createServer((socket) => socket.resume());
    await new Promise<void>((resolve) => occupier.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => occupier.close(() => resolve())));
    const address = occupier.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const lsof: Exec = async () =>
      ok({ status: 0, stdout: `p${process.pid}\ncnode\nf12\n`, stderr: "" });
    const errors: string[] = [];
    const h = harness({
      env: { PLOOP_HOME: tempDir("ploop-home-"), PLOOP_PORT: String(port) },
      exec: lsof,
      timing: { probeMs: 200 },
      onErrorLine: (line) => errors.push(line),
    });
    expect(await h.start()).toEqual({ kind: "exited", code: 4 });
    const home = String(h.options.env.PLOOP_HOME);
    expect(lastLine(home)).toMatchObject({
      level: "error",
      event: "portTaken",
      message: `端口 ${port} 被别的程序占用，占用它的进程是 node，进程号 ${process.pid}。`,
      hint: "用环境变量 PLOOP_PORT 换一个端口，或者改 config.json 里的 port。",
      occupant: { kind: "process", pid: process.pid, command: "node" },
    });
    expect(errors).toHaveLength(1);
    expect(readRunInfo(join(home, "run"))).toBeUndefined();
    const lock = tryInstanceLock(join(home, "run"));
    expect(lock).toBeDefined();
    lock?.release();
  });

  it("端口被另一个集中存储的后端占用：退出码 4，写明它的目录和进程号", async () => {
    const other = await serving(harness());
    const h = harness({
      env: { PLOOP_HOME: tempDir("ploop-home-"), PLOOP_PORT: String(other.port) },
    });
    expect(await h.start()).toEqual({ kind: "exited", code: 4 });
    expect(lastLine(String(h.options.env.PLOOP_HOME))).toMatchObject({
      event: "portTaken",
      message: `端口 ${other.port} 被另一个集中存储的后端占用，它的目录是 ${other.paths.home}，进程号 ${process.pid}。`,
      occupant: { kind: "backend", home: other.paths.home },
    });
  });

  it("数据库比程序新：退出码 3，日志写明原因和 ploop setup，放开实例锁", async () => {
    const home = tempDir("ploop-home-");
    const paths = homePaths(home);
    const h = harness({}, home);
    await serving(harness({}, home)).then((b) => b.stop("request"));
    const opened = await openDatabase({
      file: paths.database,
      migrationsFolder,
      backupsDir: paths.dirs.backups,
    });
    if (!opened.ok) throw new Error("打不开数据库");
    const newer = Date.now() + 365 * 24 * 60 * 60 * 1000;
    opened.value.sqlite
      .prepare("insert into __drizzle_migrations (hash, created_at) values ('newer', ?)")
      .run(newer);
    opened.value.sqlite.close();
    expect(await h.start()).toEqual({ kind: "exited", code: 3 });
    expect(lastLine(home)).toMatchObject({
      level: "error",
      event: "dbNewer",
      message: "数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
      hint: "运行 ploop setup 安装新版本。",
      databaseLatest: newer,
    });
    const lock = tryInstanceLock(paths.dirs.run);
    expect(lock).toBeDefined();
    lock?.release();
  });

  it("config.json 写错了：退出码 2，写明哪几项", async () => {
    const home = tempDir("ploop-home-");
    writeFileSync(join(home, "config.json"), JSON.stringify({ port: "4731" }));
    expect(await harness({ env: { PLOOP_HOME: home } }, home).start()).toEqual({
      kind: "exited",
      code: 2,
    });
    expect(lastLine(home)).toMatchObject({
      event: "badConfig",
      message: `${join(home, "config.json")} 写错了，写错的项是：port。`,
      fields: ["port"],
    });
  });

  it("config.json 不是 JSON 对象：退出码 2", async () => {
    const home = tempDir("ploop-home-");
    writeFileSync(join(home, "config.json"), "[");
    expect(await harness({ env: { PLOOP_HOME: home } }, home).start()).toEqual({
      kind: "exited",
      code: 2,
    });
    expect(lastLine(home)).toMatchObject({
      event: "badConfig",
      message: `${join(home, "config.json")} 不是一个 JSON 对象。`,
    });
  });

  it.each(["abc", "65536", "-1", "4731.5"])("PLOOP_PORT 写 %s：退出码 2", async (value) => {
    const home = tempDir("ploop-home-");
    const h = harness({ env: { PLOOP_HOME: home, PLOOP_PORT: value } }, home);
    expect(await h.start()).toEqual({ kind: "exited", code: 2 });
    expect(lastLine(home)).toMatchObject({
      event: "badEnv",
      message: `环境变量 PLOOP_PORT 写的是「${value}」，不是端口号。`,
    });
  });

  it("Node 的版本低于要求：退出码 5，写明两个版本和 ploop setup", async () => {
    const h = harness({ nodeVersion: "24.11.9" });
    expect(await h.start()).toEqual({ kind: "exited", code: 5 });
    expect(lastLine(h.home)).toMatchObject({
      event: "nodeTooOld",
      message: "本机的 Node 版本是 24.11.9，低于需要的 24.12.0。",
      hint: "运行 ploop setup，重新绑定 Node。",
    });
  });
});

describe("迁移以后", () => {
  it("执行了迁移：日志记一行，上一次升级的迁移前快照删掉，这一次的留下", async () => {
    const home = tempDir("ploop-home-");
    const paths = homePaths(home);
    // 旧版本的程序少带最后一个迁移。
    const older = tempDir("ploop-migrations-");
    cpSync(migrationsFolder, older, { recursive: true });
    const journalFile = join(older, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalFile, "utf8")) as { entries: unknown[] };
    writeFileSync(
      journalFile,
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }),
    );
    await serving(harness({ migrationsFolder: older }, home)).then((b) => b.stop("request"));
    const stale = join(paths.dirs.backups, "pre-migration-20260101T000000000Z.db");
    writeFileSync(stale, "");
    await serving(harness({}, home));
    const events = logLines(home).map((line) => line.event);
    expect(events.slice(-3)).toEqual(["migrated", "snapshotsPruned", "started"]);
    expect(existsSync(stale)).toBe(false);
    const kept = readdirSync(paths.dirs.backups).filter((name) => name.startsWith("pre-"));
    expect(kept).toHaveLength(1);
  });
});

describe("备份的警告", () => {
  it("启动时就做当天的 Time Machine 检查，警告放进 status --all 的 warnings", async () => {
    const h = harness({ env: { PLOOP_HOME: tempDir("ploop-home-"), PLOOP_PORT: "0" } });
    const backend = await serving(h);
    const res = await fetch(`http://127.0.0.1:${backend.port}/api/v1/projects`);
    const body = (await res.json()) as { readonly warnings: readonly { message: string }[] };
    expect(body.warnings.map((warning) => warning.message)).toEqual([
      "Time Machine 没有设置备份盘，集中存储没有第二份。",
    ]);
  });

  it("PLOOP_TIME_MACHINE=off 时不查，也不运行外部命令", async () => {
    const calls: string[] = [];
    const exec: Exec = async (command) => {
      calls.push(command);
      return err({ kind: "notFound" });
    };
    const backend = await serving(harness({ exec }));
    const res = await fetch(`http://127.0.0.1:${backend.port}/api/v1/projects`);
    expect(((await res.json()) as { warnings: unknown[] }).warnings).toEqual([]);
    expect(calls).toEqual([]);
  });
});
