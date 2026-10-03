import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { createClient } from "../client.ts";
import { type EnsuredBackend, type EnsureOptions, ensureBackend } from "./ensure.ts";
import { type EnsureFailure, failureIssue } from "./failure.ts";
import { backendFiles, instanceHolder, processAlive, readRunInfo } from "./files.ts";
import { createNodeClient } from "./node-client.ts";
import { tempDir } from "./testing.ts";

// 拉起真的后端：node packages/backend/src/main.ts，见「01 架构」第六节。
// 要起子进程，所以归到 pnpm use。集中存储是临时的，端口写 0，Time Machine 的检查关掉。
// 拉起的后端脱离了测试进程，测试结束时按 backend.json 和实例锁找到它们，强行结束。

const backendMain = fileURLToPath(new URL("../../../backend/src/main.ts", import.meta.url));
/** 共用定义里的构建号，开发时是 dev。 */
const buildModule = fileURLToPath(new URL("../../../model/src/build.ts", import.meta.url));
const nodeEntry = new URL("./index.ts", import.meta.url).href;

const env = { ...process.env, PLOOP_PORT: "0", PLOOP_TIME_MACHINE: "off" };

type Result = Awaited<ReturnType<typeof ensureBackend>>;

function ensuredOf(result: Result): EnsuredBackend {
  if (!result.ok) {
    throw new Error(`应当成功，却失败了：${JSON.stringify(failureIssue(result.error))}`);
  }
  return result.value;
}

function failureOf(result: Result): EnsureFailure {
  if (result.ok) throw new Error(`应当失败，却成功了：${JSON.stringify(result.value)}`);
  return result.error;
}

/** 是这个测试拉起的后端：命令行里有后端的入口，或者测试写的入口。 */
function isOurs(pid: number, entries: readonly string[]): boolean {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return entries.some((entry) => command.includes(entry));
  } catch {
    return false;
  }
}

/** 强行结束进程，等它结束。 */
async function killAndWait(pid: number): Promise<void> {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }
  for (let i = 0; i < 100 && processAlive(pid); i++) await sleep(50);
}

/** 临时的集中存储。测试结束时结束在它上面运行的后端，再删掉目录。 */
function setup() {
  const home = tempDir("ploop-home-");
  const files = backendFiles(home);
  const entries = [backendMain];
  const seen = new Set<number>();
  onTestFinished(async () => {
    const pids = [...seen, readRunInfo(files.runInfo)?.pid, instanceHolder(files.instanceLock)];
    for (const pid of new Set(pids)) {
      if (pid !== undefined && processAlive(pid) && isOurs(pid, entries)) await killAndWait(pid);
    }
  });
  const options = (extra: Partial<EnsureOptions> = {}): EnsureOptions => ({
    home,
    backendEntry: backendMain,
    build: "dev",
    env,
    ...extra,
  });
  const ensure = async (extra: Partial<EnsureOptions> = {}) => {
    const result = await ensureBackend(options(extra));
    if (result.ok) seen.add(result.value.pid);
    return result;
  };
  return { home, files, entries, seen, options, ensure };
}

async function health(baseUrl: string) {
  const client = createClient({ baseUrl, client: "cli" });
  const result = await client.call((api) => api.api.v1.health.$get());
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value.data;
}

/** 日志里写过行的进程号。 */
function logPids(logFile: string): Set<unknown> {
  if (!existsSync(logFile)) return new Set();
  const lines = readFileSync(logFile, "utf8").trimEnd().split("\n");
  return new Set(lines.map((line) => JSON.parse(line).pid));
}

/** 停掉后端：请它退出不走接口，直接发 SIGTERM，等它结束。 */
async function stop(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 200 && processAlive(pid); i++) await sleep(50);
  expect(processAlive(pid)).toBe(false);
}

/** 在另一个 Node 进程里调用 ensureBackend，到 goAt 这一刻才开始。 */
function driver(home: string, goAt: number) {
  const code = `
    const { ensureBackend } = await import(process.env.NODE_ENTRY);
    const wait = Number(process.env.GO_AT) - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    const result = await ensureBackend({
      home: process.env.TEST_HOME,
      backendEntry: process.env.BACKEND_MAIN,
      build: "dev",
      env: process.env,
    });
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: {
      ...env,
      NODE_ENTRY: nodeEntry,
      GO_AT: String(goAt),
      TEST_HOME: home,
      BACKEND_MAIN: backendMain,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let errText = "";
  child.stdout.on("data", (chunk) => {
    out += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errText += chunk;
  });
  return new Promise<Result>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) resolve(JSON.parse(out) as Result);
      else reject(new Error(`调用的进程以 ${code} 结束：${errText}`));
    });
  });
}

describe("拉起真的后端", { timeout: 60_000 }, () => {
  it("冷启动：八秒内就绪，backend.json 和 health 都是拉起的这个进程", async () => {
    const s = setup();
    const began = Date.now();
    const value = ensuredOf(await s.ensure());
    expect(Date.now() - began).toBeLessThan(8_000);
    expect(value.started).toBe(true);
    expect(readRunInfo(s.files.runInfo)?.pid).toBe(value.pid);
    expect(await health(value.baseUrl)).toMatchObject({ pid: value.pid, build: "dev" });
    expect(existsSync(s.files.startLock)).toBe(false);
    // 再调用一次直接用它。
    expect(ensuredOf(await s.ensure())).toMatchObject({ pid: value.pid, started: false });
  });

  it("五个进程同时调用：只拉起一个后端，都用它", async () => {
    const s = setup();
    const goAt = Date.now() + 3_000;
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => driver(s.home, goAt)));
    const values = results.map(ensuredOf);
    for (const value of values) s.seen.add(value.pid);
    expect(new Set(values.map((value) => value.pid)).size).toBe(1);
    expect(values.filter((value) => value.started)).toHaveLength(1);
    // 日志里只有一个进程写过行：没有多拉起的后端，连启动后安静退出的也没有。
    expect(logPids(s.files.log)).toEqual(new Set([values[0]?.pid]));
  });

  it("启动锁超过三十秒没更新：接手，照常在八秒内拉起", async () => {
    const s = setup();
    mkdirSync(s.files.runDir, { recursive: true });
    const startedAt = new Date(Date.now() - 31_000).toISOString();
    writeFileSync(s.files.startLock, JSON.stringify({ pid: 999_999, startedAt, token: "旧的" }));
    const seconds = (Date.now() - 31_000) / 1000;
    utimesSync(s.files.startLock, seconds, seconds);
    const began = Date.now();
    expect(ensuredOf(await s.ensure()).started).toBe(true);
    expect(Date.now() - began).toBeLessThan(8_000);
    expect(existsSync(s.files.startLock)).toBe(false);
  });

  it("构建号不同：请旧后端退出，拉起新的", async () => {
    const s = setup();
    // 用模块钩子把共用定义里的构建号换成 old，当作上一版的后端。
    const wrapper = join(tempDir("ploop-old-"), "old-backend.mjs");
    writeFileSync(
      wrapper,
      `import { registerHooks } from "node:module";
const target = ${JSON.stringify(pathToFileURL(backendMain).href)};
const build = ${JSON.stringify(pathToFileURL(buildModule).href)};
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url !== build) return result;
    const source = String(result.source);
    if (!source.includes(': "dev";')) throw new Error("共用定义里找不到构建号");
    return { ...result, source: source.replace(': "dev";', ': "old";') };
  },
});
await import(target);
`,
    );
    s.entries.push(wrapper);
    const old = ensuredOf(await s.ensure({ backendEntry: wrapper, build: "old" }));
    expect(await health(old.baseUrl)).toMatchObject({ pid: old.pid, build: "old" });
    const value = ensuredOf(await s.ensure());
    expect(value).toMatchObject({
      build: "dev",
      started: true,
      replaced: { pid: old.pid, build: "old" },
    });
    expect(value.pid).not.toBe(old.pid);
    expect(processAlive(old.pid)).toBe(false);
    expect(await health(value.baseUrl)).toMatchObject({ pid: value.pid, build: "dev" });
  });

  it("数据库比程序新：退出码 3，报出日志里这一次的原因和怎么改", async () => {
    const s = setup();
    const first = ensuredOf(await s.ensure());
    await stop(first.pid);
    const db = new DatabaseSync(join(s.home, "data", "ploop.db"));
    db.prepare("insert into __drizzle_migrations (hash, created_at) values ('newer', ?)").run(
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    );
    db.close();
    const failure = failureOf(await s.ensure());
    expect(failure).toMatchObject({ kind: "startFailed", reason: "exited", exitCode: 3 });
    if (failure.kind !== "startFailed") throw new Error("应当是 startFailed");
    // 只报这一次拉起以后的行，上一次启动写的不报。
    expect(failure.logTail.join("\n")).not.toContain("信息");
    expect(failure.logTail.at(-1)).toContain("数据库已被更新版本的程序迁移过");
    expect(failure.logTail.at(-1)).toContain("怎么改：运行 ploop setup 安装新版本。");
    const issue = failureIssue(failure);
    expect(issue.message).toContain("退出码 3");
    expect(issue.where).toBe(s.files.log);
    expect(existsSync(s.files.startLock)).toBe(false);
  });

  it("config.json 写错：退出码 2，日志的几行写明哪里错了", async () => {
    const s = setup();
    writeFileSync(join(s.home, "config.json"), JSON.stringify({ port: "abc" }));
    const failure = failureOf(await s.ensure());
    expect(failure).toMatchObject({ kind: "startFailed", reason: "exited", exitCode: 2 });
    if (failure.kind !== "startFailed") throw new Error("应当是 startFailed");
    expect(failure.logTail.join("\n")).toContain("config.json");
    expect(failure.logTail.join("\n")).toContain("怎么改：");
  });

  it("Node 版本不够：不拉起，不留下任何文件", async () => {
    const s = setup();
    const fakeNode = join(tempDir("ploop-node-"), "node");
    writeFileSync(fakeNode, "#!/bin/sh\necho v22.11.0\n");
    chmodSync(fakeNode, 0o755);
    expect(failureOf(await s.ensure({ nodePath: fakeNode }))).toEqual({
      kind: "nodeTooOld",
      node: fakeNode,
      current: "22.11.0",
      required: "24.12.0",
    });
    expect(existsSync(s.files.log)).toBe(false);
    expect(existsSync(s.files.runInfo)).toBe(false);
    expect(existsSync(s.files.startLock)).toBe(false);
  });

  it("命令行用的客户端：后端被强行结束以后，下一次调用自动拉起", async () => {
    const s = setup();
    const client = createNodeClient(s.options());
    const first = await client.call((api) => api.api.v1.health.$get());
    if (!first.ok) throw new Error(JSON.stringify(first.error));
    const firstPid = first.value.data.pid;
    s.seen.add(firstPid);
    await killAndWait(firstPid);
    const second = await client.call((api) => api.api.v1.health.$get());
    if (!second.ok) throw new Error(JSON.stringify(second.error));
    s.seen.add(second.value.data.pid);
    expect(second.value.data.pid).not.toBe(firstPid);
  });
});
