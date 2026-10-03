import { existsSync, mkdirSync, realpathSync } from "node:fs";
import {
  backendIdentitySchema,
  defaultPort,
  envPort,
  err,
  isNodeTooOld,
  ok,
  type Result,
  renderCopy,
  requiredNode,
} from "@product-loop/model";
import { createClient, isUnreachable } from "../client.ts";
import { nodeCopy } from "./copy.ts";
import type { EnsureFailure, ReplaceFailed, StartFailed, StartFailedReason } from "./failure.ts";
import { type BackendFiles, backendFiles, readRunInfo } from "./files.ts";
import { readLogTail } from "./log-tail.ts";
import { type StartLock, startLockAge, takeOverStartLock, tryStartLock } from "./start-lock.ts";
import { type EnsureSystem, realSystem, type SpawnExit, type Spawned } from "./system.ts";

// 命令行调用接口之前，确认后端在运行、构建号对得上。不在运行就拉起来，拉不起来就报出原因。
// 步骤见「01 架构」第六节：
// 1. 读 run/backend.json，取出端口。文件不在时用默认端口。
// 2. 请求 GET /health，等半秒。通了、目录是这个集中存储、构建号相同，直接用。
// 3. 构建号不同，说明刚升级过：请旧后端退出，等它结束，再拉起新的。它在做快照时按 Retry-After 等。
// 4. 不通就去占启动锁 run/start.lock，占到以后再看一次，仍然不通才拉起。
//    没占到的一方每隔一百毫秒看一次后端，就绪了直接用。锁超过三十秒没更新时接手。
// 5. 以脱离终端的方式运行 node <入口>，标准输入输出都不接，日志由后端自己写。
// 6. 每隔一百毫秒看一次，最多等八秒。
// 后端先占实例锁，迁移完数据库才绑定端口、写 backend.json，迁移期间连不上它。
// 所以八秒到了时，有后端占着实例锁、还没写 backend.json，就当它在迁移数据库，接着等。
// 从拉起算最多等六十秒，和后端忙时的上限相同，见「01 架构」第七节。占锁的是谁，读实例锁的文件头。
// 起不来时报出退出码和这一次拉起以后日志里的几行，命令行都以退出码 5 结束，见第八节。

export type EnsureOptions = {
  /** 集中存储的目录。调用的一方按 PLOOP_HOME 算好传入，见约定 0002 第 13 条。 */
  readonly home: string;
  /** 后端的入口文件。开发时是 packages/backend/src/main.ts，打包以后是命令行旁边的 backend.mjs。 */
  readonly backendEntry: string;
  /** 命令行的构建号。后端的构建号不同时，先请它退出再拉起新的，见约定 0001 第 22 条。 */
  readonly build: string;
  /** 用来运行后端的 Node。不写时用运行命令行的这一个。 */
  readonly nodePath?: string;
  /** 传给后端的环境变量，例如 PLOOP_PORT。PLOOP_HOME 按 home 写。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 拉起八秒还没就绪、后端可能在迁移数据库时告诉调用的一方，命令行据此打印一行。 */
  readonly onSlowStart?: (notice: SlowStart) => void;
  readonly timing?: Partial<EnsureTiming>;
  /** 时钟、网络和进程，测试时换成假的。 */
  readonly system?: Partial<EnsureSystem>;
};

export type EnsureTiming = {
  /** 请求 health 等多久。第 2 步写半秒。 */
  readonly probeMs: number;
  /** 看一次后端的间隔。第 6 步写一百毫秒。 */
  readonly pollMs: number;
  /** 拉起以后最多等多久就绪。 */
  readonly readyMs: number;
  /** 后端占着实例锁、还没开始服务时，从拉起算最多等多久。 */
  readonly startingMs: number;
  /** 启动锁多久没更新，就当占锁的一方已经异常退出。 */
  readonly staleLockMs: number;
  /** 旧后端答应退出以后最多等它多久。后端五秒内退出，多留五秒。 */
  readonly stopMs: number;
  /** 请旧后端退出的请求等多久。 */
  readonly requestMs: number;
};

const defaultTiming: EnsureTiming = {
  probeMs: 500,
  pollMs: 100,
  readyMs: 8_000,
  startingMs: 60_000,
  staleLockMs: 30_000,
  stopMs: 10_000,
  requestMs: 5_000,
};

/** 报出日志的最后几行，最多几行。 */
const tailLines = 5;

export type SlowStart = {
  /** 已经等了多久，最多还等多久，毫秒。 */
  readonly waitedMs: number;
  readonly leftMs: number;
  /** 给人看的一行。 */
  readonly message: string;
};

export type EnsuredBackend = {
  /** 例如 http://127.0.0.1:4731。 */
  readonly baseUrl: string;
  readonly port: number;
  readonly pid: number;
  readonly build: string;
  /** 这一次调用拉起了它。自动拉起时命令行不多打印一行，见 S13 第 2 步。 */
  readonly started: boolean;
  /** 这一次调用请退出的旧后端，它的构建号和命令行的不同。 */
  readonly replaced?: { readonly pid: number; readonly build: string };
};

type Context = {
  readonly options: EnsureOptions;
  readonly files: BackendFiles;
  readonly timing: EnsureTiming;
  readonly system: EnsureSystem;
  /** 用来运行后端的 Node。 */
  readonly node: string;
};

/** 在应答、目录是这个集中存储的后端。 */
type Found = { readonly port: number; readonly pid: number; readonly build: string };

/** 看一眼后端要用的几样。 */
type LookContext = Pick<Context, "files" | "timing" | "system"> & {
  readonly options: Pick<EnsureOptions, "env">;
};

export type FindOptions = Pick<EnsureOptions, "home" | "env" | "timing" | "system">;

/**
 * 只看一眼这个集中存储的后端在不在运行，不拉起，也不管构建号。
 * ploop backend status 和 stop 用：查看和停下都不该先把后端拉起来。
 */
export async function findBackend(options: FindOptions): Promise<Found | undefined> {
  return look(
    {
      options,
      files: backendFiles(options.home),
      timing: { ...defaultTiming, ...options.timing },
      system: { ...realSystem, ...options.system },
    },
    true,
  );
}

/** 确认后端在运行、构建号对得上，不在运行就拉起。几个会话同时调用时只拉起一个。 */
export async function ensureBackend(
  options: EnsureOptions,
): Promise<Result<EnsuredBackend, EnsureFailure>> {
  const ctx: Context = {
    options,
    files: backendFiles(options.home),
    timing: { ...defaultTiming, ...options.timing },
    system: { ...realSystem, ...options.system },
    node: options.nodePath ?? process.execPath,
  };
  const found = await look(ctx, true);
  if (found !== undefined && found.build === options.build) return ok(ensured(found, false));
  mkdirSync(ctx.files.runDir, { recursive: true });
  const taken = await takeStartLock(ctx);
  if ("found" in taken) return ok(ensured(taken.found, false));
  try {
    return await startWithLock(ctx, taken.lock);
  } finally {
    taken.lock.release();
  }
}

/**
 * 看一眼后端：backend.json 写的进程还在，端口上应答的是这个集中存储的后端，就返回它。
 * fallback 为 true 时，backend.json 不在也用默认端口找一次。
 */
async function look(ctx: LookContext, fallback: boolean): Promise<Found | undefined> {
  const info = readRunInfo(ctx.files.runInfo);
  let port: number | undefined;
  if (info !== undefined) {
    // 进程已经不在：文件是上一个后端异常退出时留下的。
    if (!ctx.system.alive(info.pid)) return undefined;
    port = info.port;
  } else if (fallback) {
    port = fallbackPort(ctx.options.env);
  }
  if (port === undefined) return undefined;
  const identity = await identify(ctx, port);
  if (identity === undefined || !sameDir(identity.home, ctx.files.home)) return undefined;
  return { port, pid: identity.pid, build: identity.build };
}

/**
 * backend.json 不在时找后端用的端口，见「01 架构」第六节第 1 步：PLOOP_PORT 写的，没写就是默认端口。
 * PLOOP_PORT 写 0 或写错时不找。config.json 里改了端口时这里找不到后端，这时照常拉起：
 * 新拉起的后端发现这个集中存储的后端已在运行，会安静退出。
 */
function fallbackPort(env: EnsureOptions["env"]): number | undefined {
  const port = envPort(env);
  if (!port.ok) return undefined;
  const value = port.value ?? defaultPort;
  return value === 0 ? undefined : value;
}

/** 请求这个端口的 GET /health，取出进程号、目录和构建号。不通或者不是后端时返回 undefined。 */
async function identify(ctx: LookContext, port: number) {
  const client = apiClient(ctx, port, ctx.timing.probeMs, ctx.system.sleep);
  const result = await client.call((api) => api.api.v1.health.$get());
  if (!result.ok) return undefined;
  const identity = backendIdentitySchema.safeParse(result.value.data);
  return identity.success ? identity.data : undefined;
}

function apiClient(
  ctx: LookContext,
  port: number,
  timeoutMs: number,
  sleep: (ms: number) => Promise<void>,
) {
  const { fetch, now } = ctx.system;
  return createClient({ baseUrl: baseUrlOf(port), client: "cli", fetch, timeoutMs, now, sleep });
}

function baseUrlOf(port: number): string {
  return `http://127.0.0.1:${port}`;
}

/** 两个目录是不是同一个。符号链接展开以后再比，例如 macOS 上的 /var 和 /private/var。 */
function sameDir(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

/**
 * 占启动锁。别人占着时每隔一百毫秒看一次后端，就绪了直接用，不用再占。
 * 锁超过三十秒没更新，占锁的一方已经异常退出，接手它。占锁的一方最多等六十秒，其间一直在更新。
 */
async function takeStartLock(
  ctx: Context,
): Promise<{ readonly lock: StartLock } | { readonly found: Found }> {
  const { files, system, timing } = ctx;
  for (;;) {
    const lock = tryStartLock(files.startLock, system);
    if (lock !== undefined) return { lock };
    const found = await look(ctx, false);
    if (found !== undefined && found.build === ctx.options.build) return { found };
    const age = startLockAge(files.startLock, system.now());
    // 锁刚被放开，马上再去占。
    if (age === undefined) continue;
    if (age.ageMs > timing.staleLockMs) {
      takeOverStartLock(files.startLock, age.ino);
      continue;
    }
    await system.sleep(timing.pollMs);
  }
}

async function startWithLock(
  ctx: Context,
  lock: StartLock,
): Promise<Result<EnsuredBackend, EnsureFailure>> {
  // 占到锁以后再看一次：可能刚有别的会话拉起了后端，或者已经换好了新的一版。
  const found = await look(ctx, true);
  if (found !== undefined && found.build === ctx.options.build) return ok(ensured(found, false));
  // 先确认拉得起来，再请旧后端退出。拉不起来时不动旧的后端，别的会话还能用它。
  const startable = await checkStartable(ctx);
  if (!startable.ok) return startable;
  if (found === undefined) return launch(ctx, lock, undefined);
  const stopped = await stopOld(ctx, found, lock);
  if (!stopped.ok) return stopped;
  return launch(ctx, lock, { pid: found.pid, build: found.build });
}

/** 拉起之前先确认：Node 能运行、版本够，入口文件在。 */
async function checkStartable(ctx: Context): Promise<Result<void, EnsureFailure>> {
  const { node, options, system } = ctx;
  const version = await system.nodeVersion(node);
  if (!version.ok) {
    return err(startFailure(ctx, { reason: "spawnFailed", detail: version.error }, undefined, 0));
  }
  if (isNodeTooOld(version.value)) {
    return err({ kind: "nodeTooOld", node, current: version.value, required: requiredNode });
  }
  if (!existsSync(options.backendEntry)) {
    return err(startFailure(ctx, { reason: "entryMissing" }, undefined, 0));
  }
  return ok(undefined);
}

/**
 * 请构建号不同的旧后端退出，等它结束，见「01 架构」第六节第 4 步。
 * 它在做快照时返回 BUSY，客户端按 Retry-After 重发，最多等六十秒。等的时候照样更新启动锁。
 */
async function stopOld(
  ctx: Context,
  old: Found,
  lock: StartLock,
): Promise<Result<void, ReplaceFailed>> {
  const { system, timing } = ctx;
  const { pid, build } = old;
  const sleep = async (ms: number) => {
    lock.refresh();
    await system.sleep(ms);
  };
  const client = apiClient(ctx, old.port, timing.requestMs, sleep);
  const answer = await client.call((api) => api.api.v1.admin.shutdown.$post());
  if (!answer.ok && !isUnreachable(answer.error)) {
    return err({ kind: "replaceFailed", reason: "refused", pid, build, error: answer.error });
  }
  // 答应了，或者已经连不上，它可能正在退出。等进程结束，结束时实例锁才放开。
  const began = system.now();
  while (system.alive(pid)) {
    const waitedMs = system.now() - began;
    if (waitedMs >= timing.stopMs) {
      return err({ kind: "replaceFailed", reason: "stillRunning", pid, build, waitedMs });
    }
    lock.refresh();
    await system.sleep(timing.pollMs);
  }
  return ok(undefined);
}

/** 拉起后端，等它就绪。 */
async function launch(
  ctx: Context,
  lock: StartLock,
  replaced: EnsuredBackend["replaced"],
): Promise<Result<EnsuredBackend, EnsureFailure>> {
  const { options, system, timing, files } = ctx;
  const spawnedAt = system.now();
  const child = system.spawn(ctx.node, [options.backendEntry], {
    env: { ...options.env, PLOOP_HOME: files.home },
    cwd: files.home,
  });
  const state: { exit?: SpawnExit; noticed?: true } = {};
  void child.exited.then((exit) => {
    state.exit = exit;
  });
  for (;;) {
    lock.refresh();
    const found = await look(ctx, false);
    if (found !== undefined) return readyResult(ctx, found, child, replaced);
    const waitedMs = system.now() - spawnedAt;
    const busy = starting(ctx);
    const { exit } = state;
    // 进程退出了：没能运行、以非零退出，或者安静退出而没有别的后端在启动，都不用再等。
    if (exit !== undefined && (exit.kind === "failed" || exit.code !== 0 || !busy)) {
      return err(exitFailure(ctx, exit, spawnedAt, waitedMs));
    }
    if (waitedMs >= timing.readyMs) {
      if (!busy || waitedMs >= timing.startingMs) {
        return err(startFailure(ctx, { reason: "timeout" }, spawnedAt, waitedMs));
      }
      if (state.noticed === undefined) {
        state.noticed = true;
        const leftMs = timing.startingMs - waitedMs;
        const message = renderCopy(nodeCopy.slowStart, { seconds: Math.ceil(leftMs / 1000) });
        options.onSlowStart?.({ waitedMs, leftMs, message });
      }
    }
    await system.sleep(timing.pollMs);
  }
}

/**
 * 有后端占着实例锁、还没写 backend.json：它在打开数据库、迁移或绑定端口。
 * 占锁的进程号写在实例锁的文件头里，放开锁以后号码还留着，所以另看进程在不在。
 */
function starting(ctx: Context): boolean {
  if (readRunInfo(ctx.files.runInfo) !== undefined) return false;
  const pid = ctx.system.lockHolder(ctx.files.instanceLock);
  return pid !== undefined && ctx.system.alive(pid);
}

/** 就绪的后端。构建号仍然不同，说明入口文件来自另一次构建，再拉起也一样。 */
function readyResult(
  ctx: Context,
  found: Found,
  child: Spawned,
  replaced: EnsuredBackend["replaced"],
): Result<EnsuredBackend, EnsureFailure> {
  const { build, backendEntry } = ctx.options;
  if (found.build !== build) {
    const { pid } = found;
    return err({
      kind: "buildMismatch",
      expected: build,
      actual: found.build,
      pid,
      entry: backendEntry,
    });
  }
  return ok(ensured(found, found.pid === child.pid, replaced));
}

function exitFailure(ctx: Context, exit: SpawnExit, since: number, waitedMs: number): StartFailed {
  if (exit.kind === "failed") {
    return startFailure(ctx, { reason: "spawnFailed", detail: exit.detail }, since, waitedMs);
  }
  const reason: StartFailedReason = {
    reason: "exited",
    ...(exit.code === null ? {} : { exitCode: exit.code }),
    ...(exit.signal === null ? {} : { signal: exit.signal }),
  };
  return startFailure(ctx, reason, since, waitedMs);
}

/** 起不来的结果。拉起过的，带上这一次拉起以后日志里的最后几行。 */
function startFailure(
  ctx: Context,
  reason: StartFailedReason,
  since: number | undefined,
  waitedMs: number,
): StartFailed {
  const logTail =
    since === undefined ? [] : readLogTail(ctx.files.log, { lines: tailLines, since });
  const { node, files, options } = ctx;
  return {
    kind: "startFailed",
    ...reason,
    waitedMs,
    logTail,
    logFile: files.log,
    node,
    entry: options.backendEntry,
  };
}

function ensured(
  found: Found,
  started: boolean,
  replaced?: EnsuredBackend["replaced"],
): EnsuredBackend {
  return {
    baseUrl: baseUrlOf(found.port),
    ...found,
    started,
    ...(replaced === undefined ? {} : { replaced }),
  };
}
