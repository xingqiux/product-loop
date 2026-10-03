import { execFile, spawn } from "node:child_process";
import { err, ok, type Result } from "@product-loop/model";
import type { Fetch } from "../client.ts";
import { instanceHolder, processAlive } from "./files.ts";

// 拉起后端要用到的系统调用：时钟、发请求、运行进程、看进程在不在。
// 真的做法写在这里，测试换成假的，见 testing.ts。

/** 拉起的进程怎么结束的：退出了，带退出码或信号；或者没能运行起来。 */
export type SpawnExit =
  | {
      readonly kind: "exited";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | { readonly kind: "failed"; readonly detail: string };

export type Spawned = {
  /** 进程号。没能运行起来时没有。 */
  readonly pid: number | undefined;
  /** 进程结束时给出结果。命令行先退出时，它一直不给出。 */
  readonly exited: Promise<SpawnExit>;
};

export type SpawnOptions = {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
};

export type EnsureSystem = {
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** 发请求，写法和 fetch 相同。 */
  readonly fetch: Fetch;
  /** 以脱离终端的方式运行一个程序。 */
  readonly spawn: (command: string, args: readonly string[], options: SpawnOptions) => Spawned;
  readonly alive: (pid: number) => boolean;
  /** 占着实例锁的进程号，见 files.ts 的 instanceHolder。 */
  readonly lockHolder: (file: string) => number | undefined;
  /** 这个 Node 的版本，例如 24.20.0。运行不了时返回系统的报错。 */
  readonly nodeVersion: (node: string) => Promise<Result<string, string>>;
  /** 命令行自己的进程号，写进启动锁。 */
  readonly pid: number;
};

/** node --version 最多等这么久。 */
const versionTimeoutMs = 10_000;

/**
 * 以脱离终端的方式运行后端，见「01 架构」第六节第 5 步：它自成一个进程组，终端关掉、按 Ctrl-C 都不影响它。
 * 标准输入输出都不接，命令行退出以后它照常运行。日志由后端自己写进 logs/backend.log，命令行不往里写。
 */
function spawnDetached(command: string, args: readonly string[], options: SpawnOptions): Spawned {
  const child = spawn(command, [...args], {
    detached: true,
    stdio: "ignore",
    env: options.env,
    cwd: options.cwd,
  });
  const exited = new Promise<SpawnExit>((resolve) => {
    child.once("exit", (code, signal) => resolve({ kind: "exited", code, signal }));
    child.once("error", (error) => resolve({ kind: "failed", detail: error.message }));
  });
  child.unref();
  return { pid: child.pid, exited };
}

/** 这个 Node 的版本。就是运行命令行的这一个时直接取，否则运行 node --version。 */
function nodeVersionOf(node: string): Promise<Result<string, string>> {
  if (node === process.execPath) return Promise.resolve(ok(process.versions.node));
  return new Promise((resolve) => {
    execFile(node, ["--version"], { encoding: "utf8", timeout: versionTimeoutMs }, (error, out) => {
      resolve(error === null ? ok(out.trim().replace(/^v/u, "")) : err(error.message));
    });
  });
}

export const realSystem: EnsureSystem = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  fetch: (url, init) => globalThis.fetch(url, init),
  spawn: spawnDetached,
  alive: processAlive,
  lockHolder: instanceHolder,
  nodeVersion: nodeVersionOf,
  pid: process.pid,
};
