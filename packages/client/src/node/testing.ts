import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clientHeader, type LogLevel, ok, type RunInfo } from "@product-loop/model";
import { onTestFinished } from "vitest";
import { busyResponse, errorResponse, okResponse } from "../testing.ts";
import type { EnsureOptions } from "./ensure.ts";
import { backendFiles, readRunInfo } from "./files.ts";
import type { EnsureSystem, SpawnExit, Spawned, SpawnOptions } from "./system.ts";

// 测试用的假世界，只给测试用：假时钟、假的后端进程、假的网络。
// 集中存储是真的临时目录，backend.json、启动锁和日志都是真的文件，写法和真的后端相同。
// sleep 不真的等，只把时间往后拨，并按先后执行到了时间的事：后端占锁、开始服务、退出。
// 几个调用同时等时，每个 sleep 都往后拨，时间走得比真的快，先后顺序不变。

/** 在系统的临时目录下建一个空目录，测试结束时删掉。 */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 连接被拒绝时 Node 的 fetch 抛出的错误。 */
export function refusedError(port: number): TypeError {
  const cause = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), {
    code: "ECONNREFUSED",
  });
  return new TypeError("fetch failed", { cause });
}

/** 假后端写进日志的一行，时间和进程号由它自己填。 */
export type FakeLogLine = {
  readonly level: LogLevel;
  readonly event: string;
  readonly message: string;
  readonly hint?: string;
  readonly [field: string]: unknown;
};

/** 拉起的假后端怎么表现。 */
export type Behavior =
  /** 先占实例锁，过一会儿开始服务。build 不写时和命令行的相同。 */
  | { readonly kind: "serve"; readonly readyAfterMs?: number; readonly build?: string }
  /** 写几行日志，然后退出。lockFirst 时先占实例锁，例如数据库比程序新。 */
  | {
      readonly kind: "exit";
      readonly code: number | null;
      readonly signal?: NodeJS.Signals;
      readonly afterMs?: number;
      readonly lines?: readonly FakeLogLine[];
      readonly lockFirst?: boolean;
    }
  /** 占着实例锁，一直不开始服务，像在迁移一个很大的数据库。 */
  | { readonly kind: "hang" }
  /** 进程在，却没占实例锁，也不开始服务。 */
  | { readonly kind: "stall" }
  /** 没能运行起来。 */
  | { readonly kind: "spawnError"; readonly detail: string };

/** 端口上的一个假后端。 */
export type FakeBackend = {
  readonly pid: number;
  readonly port: number;
  readonly build: string;
  readonly home: string;
  /** 不是后端，是别的程序：回的不是响应外壳。 */
  readonly foreign: boolean;
  /** 在这个时间之前请它退出，返回 BUSY。 */
  busyUntil: number;
  /** 答应退出以后多久结束。never 表示一直不结束。 */
  stopAfterMs: number | "never";
};

/** 已经在运行的后端：进程号、端口和构建号不写时自动编，其余照写。 */
type RunningFields = {
  readonly port?: number;
  readonly build?: string;
  readonly home?: string;
  readonly foreign?: boolean;
  readonly busyForMs?: number;
  readonly stopAfterMs?: number | "never";
  /** 写不写 backend.json，默认写。 */
  readonly runInfo?: boolean;
};

/** 假后端收到的一个请求。 */
type Request = { readonly method: string; readonly url: string; readonly headers: Headers };

type Route = (backend: FakeBackend, request: Request, body: string | undefined) => Response;

/** 占实例锁要多久：拉起以后先运行 Node、加载代码。 */
const lockAfterMs = 50;

export function fakeWorld(settings: { readonly build?: string } = {}) {
  const build = settings.build ?? "dev";
  const home = tempDir("ploop-home-");
  const files = backendFiles(home);
  mkdirSync(files.runDir, { recursive: true });
  mkdirSync(dirname(files.log), { recursive: true });
  const entry = join(tempDir("ploop-app-"), "backend.mjs");
  writeFileSync(entry, "");

  let time = Date.now();
  let order = 0;
  const timers: { at: number; order: number; run: () => void }[] = [];
  const alive = new Set<number>();
  const listening = new Map<number, FakeBackend>();
  const exits = new Map<number, (exit: SpawnExit) => void>();
  const behaviors: Behavior[] = [];
  const spawns: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
  const requests: Request[] = [];
  let route: Route | undefined;
  /** 下一次请求这个路径时抛出的错误，像网络出了问题。 */
  const failures: { readonly path: string; readonly error: Error }[] = [];
  let holder: number | undefined;
  let nextPid = 70_001;
  let nextPort = 50_001;
  let nodeVersion = "24.20.0";

  const later = (delay: number, run: () => void) => {
    timers.push({ at: time + delay, order: order++, run });
  };
  const advance = (ms: number) => {
    const until = time + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.order - b.order);
      const next = timers[0];
      if (next === undefined || next.at > until) break;
      timers.shift();
      time = Math.max(time, next.at);
      next.run();
    }
    time = until;
  };

  const serve = (backend: FakeBackend, runInfo: boolean) => {
    listening.set(backend.port, backend);
    if (!runInfo) return;
    const info: RunInfo = {
      pid: backend.pid,
      port: backend.port,
      build: backend.build,
      schemaVersion: 1,
      startedAt: new Date(time).toISOString(),
      home: backend.home,
      node: "v24.20.0",
      entry,
    };
    writeFileSync(files.runInfo, JSON.stringify(info));
  };

  /** 进程结束：不再监听，删掉自己写的 backend.json。实例锁的文件头里仍留着它的进程号。 */
  const end = (pid: number, exit: SpawnExit) => {
    alive.delete(pid);
    for (const [port, backend] of listening) if (backend.pid === pid) listening.delete(port);
    if (readRunInfo(files.runInfo)?.pid === pid) rmSync(files.runInfo, { force: true });
    exits.get(pid)?.(exit);
  };

  const writeLog = (pid: number, line: FakeLogLine) => {
    const entry = { time: new Date(time).toISOString(), pid, ...line };
    appendFileSync(files.log, `${JSON.stringify(entry)}\n`);
  };

  const backendOf = (pid: number, fields: RunningFields): FakeBackend => ({
    pid,
    port: fields.port ?? nextPort++,
    build: fields.build ?? build,
    home: fields.home ?? home,
    foreign: fields.foreign ?? false,
    busyUntil: time + (fields.busyForMs ?? 0),
    stopAfterMs: fields.stopAfterMs ?? 200,
  });

  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const target = new URL(url);
    const method = init.method ?? "GET";
    const request: Request = { method, url, headers: new Headers(init.headers) };
    requests.push(request);
    const failure = failures.findIndex((item) => item.path === target.pathname);
    if (failure !== -1) throw failures.splice(failure, 1)[0]?.error;
    const port = Number(target.port);
    const backend = listening.get(port);
    if (backend === undefined || !alive.has(backend.pid)) throw refusedError(port);
    if (backend.foreign) return new Response("hello");
    const body = typeof init.body === "string" ? init.body : undefined;
    if (method === "GET" && target.pathname === "/api/v1/health") {
      const { pid, home: dir } = backend;
      const health = { build: backend.build, apiVersion: 1, schemaVersion: 1, pid, home: dir };
      return okResponse({ status: "正常", ...health });
    }
    if (method === "POST" && target.pathname === "/api/v1/admin/shutdown") {
      if (!request.headers.get(clientHeader)) {
        return errorResponse("BAD_REQUEST", [{ message: "会改数据的请求要带 X-Ploop-Client。" }]);
      }
      if (time < backend.busyUntil) return busyResponse("1");
      // 不再接新的连接，手上的请求做完再结束。
      listening.delete(port);
      const { stopAfterMs } = backend;
      if (stopAfterMs !== "never") {
        later(stopAfterMs, () => end(backend.pid, { kind: "exited", code: 0, signal: null }));
      }
      return okResponse({ pid: backend.pid }, { status: 202 });
    }
    if (route !== undefined) return route(backend, request, body);
    return errorResponse("NOT_FOUND", [
      { message: `没有这个接口：${method} ${target.pathname}。` },
    ]);
  };

  const spawn = (command: string, args: readonly string[], options: SpawnOptions): Spawned => {
    spawns.push({ command, args, options });
    const behavior: Behavior = behaviors.shift() ?? { kind: "serve" };
    if (behavior.kind === "spawnError") {
      return {
        pid: undefined,
        exited: Promise.resolve({ kind: "failed", detail: behavior.detail }),
      };
    }
    const pid = nextPid++;
    alive.add(pid);
    const exited = new Promise<SpawnExit>((resolve) => exits.set(pid, resolve));
    const takeLock = () =>
      later(lockAfterMs, () => {
        holder = pid;
      });
    switch (behavior.kind) {
      case "serve": {
        takeLock();
        const fields = behavior.build === undefined ? {} : { build: behavior.build };
        later(behavior.readyAfterMs ?? 300, () => serve(backendOf(pid, fields), true));
        break;
      }
      case "exit": {
        if (behavior.lockFirst === true) takeLock();
        later(behavior.afterMs ?? 200, () => {
          for (const line of behavior.lines ?? []) writeLog(pid, line);
          end(pid, { kind: "exited", code: behavior.code, signal: behavior.signal ?? null });
        });
        break;
      }
      case "hang":
        takeLock();
        break;
      case "stall":
        break;
    }
    return { pid, exited };
  };

  const system: EnsureSystem = {
    now: () => time,
    sleep: async (ms) => advance(ms),
    fetch,
    spawn,
    alive: (pid) => alive.has(pid),
    lockHolder: () => holder,
    nodeVersion: async () => ok(nodeVersion),
    pid: 4242,
  };

  return {
    home,
    files,
    entry,
    system,
    spawns,
    requests,
    now: () => time,
    advance,
    /** 调用 ensureBackend 的参数。PLOOP_PORT 写 0，backend.json 不在时不按默认端口找。 */
    options: (extra: Partial<EnsureOptions> = {}): EnsureOptions => ({
      home,
      backendEntry: entry,
      build,
      env: { PLOOP_PORT: "0" },
      system,
      ...extra,
    }),
    /** 下一次拉起的后端怎么表现，可以排好几次的。 */
    next: (...list: Behavior[]) => behaviors.push(...list),
    /** 已经在运行的后端，占着实例锁。 */
    running: (fields: RunningFields = {}): FakeBackend => {
      const pid = nextPid++;
      alive.add(pid);
      holder = pid;
      const backend = backendOf(pid, fields);
      serve(backend, fields.runInfo ?? true);
      return backend;
    },
    /** 别的会话拉起的后端：占着实例锁，过 readyAfterMs 开始服务。 */
    startingElsewhere: (readyAfterMs: number): number => {
      const pid = nextPid++;
      alive.add(pid);
      holder = pid;
      later(readyAfterMs, () => serve(backendOf(pid, {}), true));
      return pid;
    },
    /** 到了时间执行 run，时间由 sleep 往后拨。 */
    at: later,
    /** 下一次请求这个路径时抛出 error。 */
    failNext: (path: string, error: Error) => {
      failures.push({ path, error });
    },
    /** 像 SIGKILL 一样结束进程：留下 backend.json。 */
    kill: (pid: number) => {
      alive.delete(pid);
      for (const [port, backend] of listening) if (backend.pid === pid) listening.delete(port);
    },
    /** 后端别的接口怎么回应。 */
    route: (answer: Route) => {
      route = answer;
    },
    setNodeVersion: (version: string) => {
      nodeVersion = version;
    },
    writeLog,
  };
}

export type FakeWorld = ReturnType<typeof fakeWorld>;
