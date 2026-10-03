import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { logFileName, type RunInfo } from "@product-loop/model";
import { describe, expect, it, onTestFinished } from "vitest";
import { readRunInfo } from "./process/run-info.ts";
import { openDatabase } from "./store/db.ts";
import { homePaths } from "./store/home.ts";
import { migrationsFolder, tempDir } from "./store/testing.ts";

// 后端的进程入口：用 node 直接运行 src/main.ts，Node 运行时去掉类型，见第一期计划第 9 步。
// 要起子进程，所以归到 pnpm use。集中存储是临时的，端口写 0，Time Machine 的检查关掉。
// 端口被别的程序占用时，后端用真的 lsof 查占用者，占用者就是这个测试进程。

const main = fileURLToPath(new URL("./main.ts", import.meta.url));

type Exit = { readonly code: number | null; readonly signal: NodeJS.Signals | null };

type Backend = {
  readonly proc: ChildProcess;
  readonly exited: Promise<Exit>;
  readonly stderr: () => string;
  readonly stdout: () => string;
};

/** 用临时集中存储起一个后端。测试结束时还没退出的，强行结束。 */
function spawnBackend(home: string, env: Readonly<Record<string, string>> = {}): Backend {
  const proc = spawn(process.execPath, [main], {
    env: { ...process.env, PLOOP_HOME: home, PLOOP_PORT: "0", PLOOP_TIME_MACHINE: "off", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk;
  });
  proc.stdout?.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise<Exit>((resolve) => {
    proc.on("exit", (code, signal) => resolve({ code, signal }));
  });
  onTestFinished(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    await exited;
  });
  return { proc, exited, stderr: () => stderr, stdout: () => stdout };
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

/** 等后端写好 backend.json。后端先退出了，或者十五秒还没写好，测试失败并附上日志。 */
async function runInfoOf(home: string, backend: Backend): Promise<RunInfo> {
  const deadline = Date.now() + 15_000;
  let exited = false;
  void backend.exited.then(() => {
    exited = true;
  });
  for (;;) {
    const info = readRunInfo(join(home, "run"));
    if (info !== undefined && info.pid === backend.proc.pid) return info;
    if (exited || Date.now() > deadline) {
      const log = JSON.stringify(logLines(home), null, 2);
      throw new Error(`后端没有写好 backend.json。标准错误：${backend.stderr()}\n日志：${log}`);
    }
    await sleep(50);
  }
}

async function health(port: number) {
  const res = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
  return (await res.json()) as { readonly data: { readonly pid: number; readonly home: string } };
}

describe("后端的进程入口", { timeout: 30_000 }, () => {
  it("启动后写好 run/backend.json：进程号、实际的端口、构建号、目录，health 能应答", async () => {
    const home = tempDir("ploop-home-");
    const backend = spawnBackend(home);
    const info = await runInfoOf(home, backend);
    expect(info).toMatchObject({
      pid: backend.proc.pid,
      build: "dev",
      home,
      node: process.version,
      entry: main,
    });
    expect(info.port).toBeGreaterThan(0);
    expect(info.schemaVersion).toBeGreaterThan(0);
    expect((await health(info.port)).data).toMatchObject({ pid: backend.proc.pid, home });
    expect(backend.stdout()).toBe("");
    expect(backend.stderr()).toBe("");
  });

  it.each([
    ["端口也写 0", () => "0"],
    ["端口写第一个后端的端口", (info: RunInfo) => String(info.port)],
  ])("第二个实例发现这个集中存储的后端在运行，安静退出（%s）", async (_name, portOf) => {
    const home = tempDir("ploop-home-");
    const first = spawnBackend(home);
    const info = await runInfoOf(home, first);
    const second = spawnBackend(home, { PLOOP_PORT: portOf(info) });
    expect(await second.exited).toEqual({ code: 0, signal: null });
    expect(second.stderr()).toBe("");
    expect(logLines(home).at(-1)).toMatchObject({
      level: "info",
      pid: second.proc.pid,
      event: "alreadyRunning",
      runningPid: first.proc.pid,
      port: info.port,
    });
    expect(readRunInfo(join(home, "run"))).toEqual(info);
    expect((await health(info.port)).data.pid).toBe(first.proc.pid);
  });

  it("端口被别的程序占用：退出码 4，日志和标准错误写明占用它的进程，不写 backend.json", async () => {
    const occupier = createHttpServer((_req, res) => res.end("hello"));
    await new Promise<void>((resolve) => occupier.listen(0, "127.0.0.1", resolve));
    onTestFinished(() => new Promise<void>((resolve) => occupier.close(() => resolve())));
    const address = occupier.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const home = tempDir("ploop-home-");
    const backend = spawnBackend(home, { PLOOP_PORT: String(port) });
    expect(await backend.exited).toEqual({ code: 4, signal: null });
    const line = logLines(home).at(-1);
    expect(line).toMatchObject({
      level: "error",
      event: "portTaken",
      port,
      occupant: { kind: "process", pid: process.pid },
      hint: "用环境变量 PLOOP_PORT 换一个端口，或者改 config.json 里的 port。",
    });
    expect(String(line?.message)).toMatch(
      new RegExp(`^端口 ${port} 被别的程序占用，占用它的进程是 .+，进程号 ${process.pid}。$`, "u"),
    );
    expect(backend.stderr()).toContain(String(line?.message));
    expect(readRunInfo(join(home, "run"))).toBeUndefined();
  });

  it("端口被另一个集中存储的后端占用：退出码 4，写明它的目录和进程号", async () => {
    const otherHome = tempDir("ploop-home-");
    const other = spawnBackend(otherHome);
    const info = await runInfoOf(otherHome, other);
    const home = tempDir("ploop-home-");
    const backend = spawnBackend(home, { PLOOP_PORT: String(info.port) });
    expect(await backend.exited).toEqual({ code: 4, signal: null });
    expect(logLines(home).at(-1)).toMatchObject({
      event: "portTaken",
      message: `端口 ${info.port} 被另一个集中存储的后端占用，它的目录是 ${otherHome}，进程号 ${other.proc.pid}。`,
    });
  });

  it("SIGTERM 后五秒内以 0 退出，删掉 backend.json", async () => {
    const home = tempDir("ploop-home-");
    const backend = spawnBackend(home);
    await runInfoOf(home, backend);
    const started = Date.now();
    backend.proc.kill("SIGTERM");
    expect(await backend.exited).toEqual({ code: 0, signal: null });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(existsSync(join(home, "run", "backend.json"))).toBe(false);
    expect(logLines(home).map((line) => line.event)).toEqual(
      expect.arrayContaining(["started", "stopping", "stopped"]),
    );
  });

  it("POST /admin/shutdown：响应照常发出，随后以 0 退出，删掉 backend.json", async () => {
    const home = tempDir("ploop-home-");
    const backend = spawnBackend(home);
    const info = await runInfoOf(home, backend);
    const res = await fetch(`http://127.0.0.1:${info.port}/api/v1/admin/shutdown`, {
      method: "POST",
      headers: { "X-Ploop-Client": "cli/2.0.0" },
    });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ ok: true, data: { pid: backend.proc.pid } });
    expect(await backend.exited).toEqual({ code: 0, signal: null });
    expect(existsSync(join(home, "run", "backend.json"))).toBe(false);
  });

  it("异常退出以后能再启动：实例锁由系统放开，留下的 backend.json 被换掉", async () => {
    const home = tempDir("ploop-home-");
    const first = spawnBackend(home);
    await runInfoOf(home, first);
    first.proc.kill("SIGKILL");
    await first.exited;
    expect(readRunInfo(join(home, "run"))?.pid).toBe(first.proc.pid);
    const second = spawnBackend(home);
    const info = await runInfoOf(home, second);
    expect((await health(info.port)).data.pid).toBe(second.proc.pid);
  });

  it("数据库比程序新：拒绝启动，退出码不是 0，日志写明原因和 ploop setup", async () => {
    const home = tempDir("ploop-home-");
    const paths = homePaths(home);
    const first = spawnBackend(home);
    await runInfoOf(home, first);
    first.proc.kill("SIGTERM");
    await first.exited;
    const opened = await openDatabase({
      file: paths.database,
      migrationsFolder,
      backupsDir: paths.dirs.backups,
    });
    if (!opened.ok) throw new Error("打不开数据库");
    opened.value.sqlite
      .prepare("insert into __drizzle_migrations (hash, created_at) values ('newer', ?)")
      .run(Date.now() + 365 * 24 * 60 * 60 * 1000);
    opened.value.sqlite.close();
    const backend = spawnBackend(home);
    const exit = await backend.exited;
    expect(exit).toEqual({ code: 3, signal: null });
    const line = logLines(home).at(-1);
    expect(line).toMatchObject({
      level: "error",
      pid: backend.proc.pid,
      event: "dbNewer",
      message: "数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
      hint: "运行 ploop setup 安装新版本。",
    });
    expect(backend.stderr()).toContain("ploop setup");
    expect(existsSync(join(home, "run", "backend.json"))).toBe(false);
  });
});
