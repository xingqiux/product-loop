import { join } from "node:path";
import { type ApiEnvelope, apiEnvelopeSchema, errorCodeInfo } from "@product-loop/model";
import { expect } from "vitest";
import { systemClock } from "../core/replies/wait.ts";
import { emptyCore, reservedDirs, type TestCore } from "../core/testing.ts";
import { backupActions } from "../process/backup.ts";
import type { HomePaths } from "../store/home.ts";
import { migrationsFolder, tempHome } from "../store/testing.ts";
import { createApp } from "./app.ts";
import type { AppDeps, ProcessGate } from "./deps.ts";

// 接口测试用的应用，只给测试用。用 app.request 调用，不监听端口，见「02 技术选型」第十三节。
// 数据库是临时的，时钟是假的。请求默认带上后端的 Host，会改数据的请求再带上客户端和 JSON 的类型。
// 进程的状态默认是空闲的，写请求之前不做快照，没有备份的警告。要测这几样时用 overrides 换掉。

/** 测试里后端的端口。 */
export const port = 4731;
/** 测试里默认带的请求头 Host。 */
export const host = `127.0.0.1:${port}`;
/** 测试里默认带的客户端。 */
const client = "cli/2.0.0";

/** 一次请求要改的地方。请求头写 undefined 表示不带这个请求头。 */
type Send = {
  /** 不是文字的，写成 JSON 发出。 */
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string | undefined>>;
};

/** 响应：状态码、响应头，和按响应外壳的定义解析过的内容。 */
export type Received = {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ApiEnvelope;
};

export type TestApp = {
  readonly app: ReturnType<typeof createApp>;
  readonly core: TestCore;
  readonly paths: HomePaths;
  readonly deps: AppDeps;
  /** POST /admin/shutdown 调用 shutdown 的次数。 */
  shutdowns(): number;
  /** 写进日志的错误。 */
  readonly logged: unknown[];
  request(method: string, path: string, send?: Send): Promise<Received>;
};

/** 没在做全局操作、也没在退出的后端。全局操作的任务照常执行。 */
const idleProcess: ProcessGate = {
  busy: () => undefined,
  stopping: () => false,
  onStopping: () => () => {},
  during: (_work, task) => task(),
};

/** 默认的请求头。会改数据的请求带上客户端；带请求体的写明是 JSON。 */
function defaultHeaders(method: string, body: unknown): Record<string, string> {
  const writing = !["GET", "HEAD", "OPTIONS"].includes(method);
  return {
    host,
    ...(writing ? { "X-Ploop-Client": client } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  };
}

/**
 * 打开临时数据库和临时的集中存储，建一个接口应用。
 * 每个响应都先按响应外壳的定义解析。失败的响应另外核对 HTTP 状态和错误码对得上。
 */
export async function testApp(overrides: Partial<AppDeps> = {}): Promise<TestApp> {
  const core = await emptyCore();
  const paths = tempHome();
  const logged: unknown[] = [];
  let shutdowns = 0;
  const deps: AppDeps = {
    db: core.ctx.db,
    notifier: core.ctx.notifier,
    now: core.ctx.now,
    waitClock: systemClock,
    reserved: reservedDirs,
    paths,
    port: () => port,
    build: "dev",
    webDir: join(paths.home, "web"),
    schemaVersion: 1790000000000,
    shutdown: () => {
      shutdowns += 1;
    },
    log: { file: join(paths.dirs.logs, "backend.log"), error: (error) => logged.push(error) },
    process: idleProcess,
    dailySnapshot: async () => {},
    backupWarnings: async () => [],
    backups: backupActions({
      sqlite: core.sqlite,
      db: core.ctx.db,
      backupsDir: paths.dirs.backups,
      migrationsFolder,
      now: core.ctx.now,
    }),
    ...overrides,
  };
  const app = createApp(deps);
  const request = async (method: string, path: string, send: Send = {}): Promise<Received> => {
    const headers = Object.entries({ ...defaultHeaders(method, send.body), ...send.headers });
    const body =
      send.body === undefined || typeof send.body === "string"
        ? send.body
        : JSON.stringify(send.body);
    const response = await app.request(path, {
      method,
      headers: headers.flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
      ...(body === undefined ? {} : { body }),
    });
    const envelope = apiEnvelopeSchema.parse(await response.json());
    if (!envelope.ok) expect(response.status).toBe(errorCodeInfo(envelope.error.code).http);
    return { status: response.status, headers: response.headers, body: envelope };
  };
  return { app, core, paths, deps, shutdowns: () => shutdowns, logged, request };
}

/** 成功的响应里的 data。不是成功的响应时，测试失败并写明收到的错误。 */
export function dataOf(received: Received): unknown {
  if (!received.body.ok) throw new Error(`应当成功，收到 ${received.body.error.code}`);
  return received.body.data;
}

/** 失败的响应里的 error。不是失败的响应时，测试失败。 */
export function errorOf(received: Received) {
  if (received.body.ok) throw new Error(`应当失败，收到的状态码是 ${received.status}`);
  return received.body.error;
}
