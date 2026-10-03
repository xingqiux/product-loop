import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { processAlive, readRunInfo } from "@product-loop/client/node";
import { onTestFinished } from "vitest";
import { tempRoot } from "../project/testing.ts";

// 命令的使用测试共用的沙盒，只给测试用。用 node 运行命令行的入口，像 AI 一样敲命令。
// 家目录、集中存储都是临时目录，端口写 0，Time Machine 的检查关掉，不碰真实的数据和后端。
// 命令拉起的后端脱离了测试进程，测试结束时按日志里写过行的进程号找到它们，强行结束。

/**
 * pnpm use 先打好的运行目录，见 scripts/use-setup.ts。有它时运行打包的 ploop.mjs，
 * 命令行拉起旁边的 backend.mjs。单独跑一个测试文件、没有它时，直接运行源码。
 */
const appDir = process.env.PLOOP_TEST_APP;
const main =
  appDir === undefined
    ? fileURLToPath(new URL("../main.ts", import.meta.url))
    : join(appDir, "ploop.mjs");
const backendMain =
  appDir === undefined
    ? fileURLToPath(new URL("../../../backend/src/main.ts", import.meta.url))
    : join(appDir, "backend.mjs");

/** 命令行和后端的构建号：打包的产物是 build.json 里写的，源码是 dev。 */
export const testBuild =
  appDir === undefined
    ? "dev"
    : (JSON.parse(readFileSync(join(appDir, "build.json"), "utf8")) as { build: string }).build;

/** better-sqlite3 是后端的依赖，从后端的包里取，命令行不依赖它。 */
type Sqlite = {
  pragma(source: string): unknown;
  prepare(source: string): { run(...params: unknown[]): unknown };
  close(): void;
};
const backendRequire = createRequire(new URL("../../../backend/package.json", import.meta.url));
const Database = backendRequire("better-sqlite3") as new (file: string) => Sqlite;

export type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** 这个进程是不是后端：命令行里有后端的入口。 */
function isBackend(pid: number): boolean {
  try {
    const command = execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    return command.includes(backendMain);
  } catch {
    return false;
  }
}

/** 日志里写过行的进程号，和 backend.json 里的。 */
function backendPids(store: string): Set<number> {
  const pids = new Set<number>();
  const info = readRunInfo(join(store, "run", "backend.json"));
  if (info !== undefined) pids.add(info.pid);
  const log = join(store, "logs", "backend.log");
  if (existsSync(log)) {
    for (const line of readFileSync(log, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const pid: unknown = JSON.parse(line).pid;
      if (typeof pid === "number") pids.add(pid);
    }
  }
  return pids;
}

async function killAll(store: string): Promise<void> {
  for (const pid of backendPids(store)) {
    if (!processAlive(pid) || !isBackend(pid)) continue;
    process.kill(pid, "SIGKILL");
    for (let i = 0; i < 100 && processAlive(pid); i++) await sleep(50);
  }
}

/** 一个沙盒：临时的家目录和集中存储。at 把家目录下的相对路径换成绝对路径。 */
export function sandbox() {
  const base = tempRoot();
  const home = join(base, "home");
  const store = join(base, "store");
  mkdirSync(home);
  // 测试结束时先结束后端，再删临时目录。onTestFinished 按登记的反序执行。
  onTestFinished(() => killAll(store));
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PLOOP_HOME: store,
    PLOOP_PORT: "0",
    PLOOP_TIME_MACHINE: "off",
    // 登录启动项的命令换成一定失败的，没有专门换假的测试碰不到真实的 launchd。
    PLOOP_LAUNCHCTL: "/usr/bin/false",
  };
  // 外面设了也不要：入口用源码里的，不带会话标识。
  delete env.PLOOP_BACKEND_ENTRY;
  delete env.PLOOP_SESSION;
  const at = (path: string) => join(home, path);
  /** 在 cwd 下运行一次 ploop。cwd 是家目录下的相对路径。 */
  const ploop = (cwd: string, ...argv: string[]): Run => {
    const dir = at(cwd);
    mkdirSync(dir, { recursive: true });
    const result = spawnSync(process.execPath, [main, ...argv], {
      cwd: dir,
      env,
      encoding: "utf8",
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  /** 在 cwd 下运行一次 ploop，把 input 写进它的标准输入。 */
  const feed = (cwd: string, input: string, ...argv: string[]): Run => {
    mkdirSync(at(cwd), { recursive: true });
    const result = spawnSync(process.execPath, [main, ...argv], {
      cwd: at(cwd),
      env,
      encoding: "utf8",
      input,
    });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  /** 在 cwd 下运行 ploop，不等它结束。给要一直运行的命令用，例如在前台运行后端。 */
  const launch = (cwd: string, ...argv: string[]) => {
    const child = spawn(process.execPath, [main, ...argv], { cwd: at(cwd), env });
    // 测试失败时它可能还在运行，还会拉起新的后端。先结束它，再结束后端。
    onTestFinished(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const done = new Promise<Run>((resolve) => {
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    });
    return { child, done };
  };
  /** 在 cwd 下建一个 git 仓库。 */
  const gitInit = (cwd: string) => {
    mkdirSync(at(cwd), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: at(cwd), env });
  };
  const runInfo = () => readRunInfo(join(store, "run", "backend.json"));
  /**
   * 直接改集中存储的数据库，摆出命令还做不到的状态，例如用户回复过的一个阶段、在等的一页。
   * 后端开着也能改，SQLite 的写锁会让两边排队。
   */
  const database = (source: string, ...params: unknown[]) => {
    const db = new Database(join(store, "data", "ploop.db"));
    try {
      db.pragma("busy_timeout = 5000");
      db.prepare(source).run(...params);
    } finally {
      db.close();
    }
  };
  return { home, store, env, at, ploop, feed, launch, gitInit, runInfo, database };
}

/** 十样齐全、设计规范十二样齐全的主线，进入检查不被拦截。 */
export const fullMainline = [
  "# 主线",
  "",
  "## 1 一句话新闻稿",
  "给自己用的待办工具。",
  "## 2 给谁用",
  "独立开发者。",
  "## 3 要完成的任务",
  "每天早上排好当天的事。",
  "## 4 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：你，每天早上。",
  "1. 点队列 → 看到看板",
  "",
  "## 5 不做什么和胃口",
  "不做多人协作。",
  "## 6 交付线",
  "装好以后五分钟内能排好一天。",
  "## 7 四个风险",
  "价值：用户会用。",
  "## 8 常见问题与待定",
  "问：要不要同步？答：不要。",
  "## 9 事前验尸",
  "原因：没人用。对策：先自己用。",
  "## 10 设计规范",
  ...[
    "信息结构",
    "配色",
    "字体排版",
    "布局",
    "交互",
    "动效",
    "图标和 SVG",
    "文案",
    "给 AI 的界面",
    "状态",
    "无障碍",
    "做法和阶段",
  ].flatMap((item) => [`### ${item}`, "无。这个产品只有命令行。", ""]),
].join("\n");
