import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { basename } from "node:path";
import { getRequestListener } from "@hono/node-server";
import {
  type BackendExitCode,
  backendExitCode,
  type CopyEntry,
  type ErrorCopy,
  envPort,
  err,
  isNodeTooOld,
  ok,
  type Result,
  renderCopy,
  requiredNode,
  resolveHome,
} from "@product-loop/model";
import type Database from "better-sqlite3";
import { processCopy } from "../copy/process.ts";
import { createNotifier } from "../core/events.ts";
import { systemClock } from "../core/replies/wait.ts";
import type { Exec, TimeMachineWarning } from "../core/time-machine.ts";
import { createApp } from "../http/app.ts";
import type { AppDeps } from "../http/deps.ts";
import { prunePreMigrationSnapshots, snapshotRunning } from "../store/backup.ts";
import { readConfig } from "../store/config.ts";
import { type Db, openDatabase } from "../store/db.ts";
import { ensureHome, type HomePaths, homePaths } from "../store/home.ts";
import {
  backupActions,
  backupWarnings,
  dailySnapshotHook,
  loggedTimeMachineCheck,
} from "./backup.ts";
import { timeMachineEnabled } from "./env.ts";
import { type InstanceLock, tryInstanceLock, waitForInstanceLock } from "./lock.ts";
import { type LogFields, type Logger, openLog } from "./log.ts";
import { type BackendOnPort, findOccupant, probeBackend, sameDir } from "./occupant.ts";
import { clearStaleRunInfo, readRunInfo, removeRunInfo, writeRunInfo } from "./run-info.ts";
import { createProcessState, type ProcessState } from "./state.ts";
import { createStopper, type StopReason } from "./stop.ts";

// 后端的启动，见「01 架构」第六节，按这个顺序：
// 1. 确认没有别的实例：占实例锁，见 lock.ts。这个集中存储的后端已在运行时，安静退出。
// 2. 打开数据库，对照迁移记录。有没执行的迁移时先做快照再迁移。数据库比程序新时拒绝启动。
// 3. 绑定 127.0.0.1 上的端口。端口被占用时查是谁：这个集中存储的后端就安静退出，别的就报错。
// 4. 写 run/backend.json，开始服务。
// 起不来的原因都写进日志，进程以非零的退出码结束。命令行报出日志的最后几行，见第八节。
// 迁移在绑定端口之前做，迁移期间命令行连不上，按「后端没开」等它。
// 进程的退出码和需要的 Node 版本在共用定义里，命令行按同一份判断，见 model 的 process.ts。

type StartTiming = {
  /** 退出时等手上的请求做完，最多等多久。五秒内要退出，留出收尾的时间。 */
  readonly graceMs: number;
  /** 退出期间关空闲连接、查快照做完没有的间隔。 */
  readonly sweepMs: number;
  /** 实例锁被占着、又没有后端应答时，等它放开的时限。占着的后端可能正在退出，最多五秒。 */
  readonly lockWaitMs: number;
  readonly lockPollMs: number;
  /** 问一个端口上是不是后端，等多久。 */
  readonly probeMs: number;
  /** ploop status 等当天的 Time Machine 检查，最多等多久。 */
  readonly timeMachineWaitMs: number;
};

const defaultTiming: StartTiming = {
  graceMs: 4000,
  sweepMs: 25,
  lockWaitMs: 6000,
  lockPollMs: 100,
  probeMs: 1000,
  timeMachineWaitMs: 2000,
};

/** 停止信号从这里来。进程入口传 process，测试传假的。 */
type SignalSource = {
  readonly on: (signal: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
};

export type StartOptions = {
  /** 环境变量：PLOOP_HOME、PLOOP_PORT、PLOOP_TIME_MACHINE。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 构建号，见约定 0001 第 22 条。开发时写 dev。 */
  readonly build: string;
  /** 工作台的静态文件，随程序一起发布，见「02 技术选型」第十五节。 */
  readonly webDir: string;
  /** 迁移文件夹，随程序一起发布。 */
  readonly migrationsFolder: string;
  /** better-sqlite3 的原生文件。打包以后必须写，见「02 技术选型」第十五节。 */
  readonly nativeBinding?: string | undefined;
  /** 进程入口的文件，写进 backend.json。 */
  readonly entry: string;
  /** 运行外部命令：Time Machine 的检查、查端口的占用者。 */
  readonly exec: Exec;
  /** 后端退出以后结束进程。 */
  readonly exit: (code: number) => void;
  readonly signals: SignalSource;
  readonly now?: () => Date;
  /** 用户的家目录。不写时取系统的。 */
  readonly userHome?: string;
  /** Node 的版本，例如 24.20.0。不写时取当前进程的。 */
  readonly nodeVersion?: string;
  readonly timing?: Partial<StartTiming>;
  /** 错误级别的日志另外交给它。进程入口写到标准错误。 */
  readonly onErrorLine?: (line: string) => void;
};

/** 在跑的后端。 */
type RunningBackend = {
  readonly port: number;
  readonly paths: HomePaths;
  readonly stop: (reason: StopReason) => Promise<void>;
  /** 进程出了没有接住的错误：写进日志，删掉 backend.json，以 1 退出。 */
  readonly crash: (error: unknown) => void;
};

export type Started =
  | { readonly kind: "serving"; readonly backend: RunningBackend }
  /** 没有开始服务。进程入口以 code 结束进程。 */
  | { readonly kind: "exited"; readonly code: BackendExitCode };

/** 没有开始服务的原因：写进日志的一行，和进程的退出码。 */
type Refusal = {
  readonly code: BackendExitCode;
  readonly level: "info" | "error";
  readonly event: string;
  readonly fields: LogFields;
};

/** 按「01 架构」第六节的顺序启动后端。起不来时写好日志，返回退出码。 */
export async function startBackend(options: StartOptions): Promise<Started> {
  const timing: StartTiming = { ...defaultTiming, ...options.timing };
  const now = options.now ?? (() => new Date());
  const userHome = options.userHome ?? homedir();
  const paths = homePaths(resolveHome(options.env, { userHome, cwd: process.cwd() }));
  const log = openLog({ dir: paths.dirs.logs, now, onError: options.onErrorLine });
  const run = paths.dirs.run;
  const backupsDir = paths.dirs.backups;
  let lock: InstanceLock | undefined;
  let sqlite: Database.Database | undefined;
  let server: Server | undefined;
  const refused = (refusal: Refusal): Started => {
    if (server?.listening === true) server.close();
    sqlite?.close();
    lock?.release();
    log[refusal.level](refusal.event, refusal.fields);
    log.close();
    return { kind: "exited", code: refusal.code };
  };
  try {
    ensureHome(paths);
    const settings = readSettings(options, paths);
    if (!settings.ok) return refused(settings.error);

    // 1. 确认没有别的实例。
    const taken = await takeInstanceLock(options, paths, settings.value.port, timing);
    if (!taken.ok) return refused(taken.error);
    const held = taken.value;
    lock = held;
    clearStaleRunInfo(run);

    // 2. 打开数据库，对照迁移记录。
    const opened = await openDatabase({
      file: paths.database,
      nativeBinding: options.nativeBinding,
      migrationsFolder: options.migrationsFolder,
      backupsDir,
    });
    if (!opened.ok) {
      const { databaseLatest, appLatest } = opened.error;
      const fields = { ...texts(processCopy.refused.dbNewer), databaseLatest, appLatest };
      return refused({ code: backendExitCode.dbNewer, level: "error", event: "dbNewer", fields });
    }
    const connection = opened.value.sqlite;
    sqlite = connection;
    afterMigration(opened.value.migrated, opened.value.snapshot, paths, log);

    // 3. 绑定端口。
    const state = createProcessState({ now, log });
    const timeMachine = timeMachineEnabled(options.env)
      ? loggedTimeMachineCheck(options.exec, paths, log)
      : undefined;
    let stop: (reason: StopReason) => Promise<void> = async () => {};
    let boundPort = 0;
    const deps = appDeps({
      options,
      paths,
      log,
      now,
      sqlite: connection,
      db: opened.value.db,
      state,
      timeMachine,
      timeMachineWaitMs: timing.timeMachineWaitMs,
      port: () => boundPort,
      shutdown: () => void stop("request"),
    });
    const http = createServer(getRequestListener(createApp(deps).fetch, { hostname: "127.0.0.1" }));
    server = http;
    const listened = await listen(http, settings.value.port);
    if (!listened.ok) {
      const problem = await portProblem(
        listened.error,
        settings.value.port,
        options,
        paths,
        timing,
      );
      return refused(problem);
    }
    boundPort = listened.value;
    http.on("error", (error) => {
      log.error("serverError", { message: renderCopy(processCopy.log.serverError), error });
    });

    // 4. 写 backend.json，开始服务。
    writeRunInfo(run, {
      pid: process.pid,
      port: boundPort,
      build: options.build,
      schemaVersion: deps.schemaVersion,
      startedAt: now().toISOString(),
      home: paths.home,
      node: process.version,
      entry: options.entry,
    });
    const stopper = createStopper(
      {
        server: http,
        snapshotRunning: () => snapshotRunning(backupsDir),
        markStopping: state.markStopping,
        cleanup: [
          () => connection.close(),
          () => removeRunInfo(run, process.pid),
          () => held.release(),
        ],
        log,
        exit: options.exit,
      },
      timing,
    );
    stop = stopper.stop;
    options.signals.on("SIGTERM", () => void stopper.stop("SIGTERM"));
    options.signals.on("SIGINT", () => void stopper.stop("SIGINT"));
    const { build } = options;
    log.info("started", {
      message: renderCopy(processCopy.log.started, { port: boundPort, pid: process.pid, build }),
      port: boundPort,
      build,
      schemaVersion: deps.schemaVersion,
      home: paths.home,
      node: process.version,
    });
    // 当天的 Time Machine 检查先做起来，第一次 ploop status 就能带上结果。
    void timeMachine?.(now());
    const crash = (error: unknown) => {
      log.error("crashed", { message: renderCopy(processCopy.log.crashed), error });
      removeRunInfo(run, process.pid);
      log.close();
      options.exit(backendExitCode.crashed);
    };
    return { kind: "serving", backend: { port: boundPort, paths, stop: stopper.stop, crash } };
  } catch (error) {
    const fields = { ...texts(processCopy.refused.crashed), error };
    return refused({ code: backendExitCode.crashed, level: "error", event: "crashed", fields });
  }
}

/** 渲染一条没有参数的报错。 */
function texts(entry: ErrorCopy): { readonly message: string; readonly hint: string } {
  return { message: renderCopy(entry.message), hint: renderCopy(entry.hint) };
}

/** 报错的一行：message 和 hint 取自文案表，hint 没有参数。 */
function problem(
  code: BackendExitCode,
  event: string,
  message: string,
  hint: CopyEntry,
  extra: Readonly<Record<string, unknown>> = {},
): Refusal {
  return { code, level: "error", event, fields: { message, hint: renderCopy(hint), ...extra } };
}

/** Node 的版本、PLOOP_PORT、config.json。有一样不对就不启动。 */
function readSettings(
  options: StartOptions,
  paths: HomePaths,
): Result<{ readonly port: number }, Refusal> {
  const current = options.nodeVersion ?? process.versions.node;
  if (isNodeTooOld(current)) {
    const { message, hint } = processCopy.refused.nodeTooOld;
    const text = renderCopy(message, { current, required: requiredNode });
    return err(problem(backendExitCode.nodeTooOld, "nodeTooOld", text, hint));
  }
  const fromEnv = envPort(options.env);
  if (!fromEnv.ok) {
    const { message, hint } = processCopy.refused.envPort;
    const text = renderCopy(message, { value: fromEnv.error.value });
    return err(problem(backendExitCode.badSettings, "badEnv", text, hint));
  }
  const config = readConfig(paths.config);
  if (!config.ok) {
    const { file, fields } = config.error;
    const { configNotObject, config: wrong } = processCopy.refused;
    const text =
      fields.length === 0
        ? renderCopy(configNotObject.message, { file })
        : renderCopy(wrong.message, { file, fields: fields.join("、") });
    const hint = fields.length === 0 ? configNotObject.hint : wrong.hint;
    return err(problem(backendExitCode.badSettings, "badConfig", text, hint, { file, fields }));
  }
  return ok({ port: fromEnv.value ?? config.value.port });
}

/**
 * 占实例锁。别人占着时，先问那个后端在不在应答，在就安静退出。
 * 不在应答时，它可能正在退出或正在启动，等它放开锁。等不到也安静退出，日志写明。
 */
async function takeInstanceLock(
  options: StartOptions,
  paths: HomePaths,
  port: number,
  timing: StartTiming,
): Promise<Result<InstanceLock, Refusal>> {
  const { nativeBinding } = options;
  const lock = tryInstanceLock(paths.dirs.run, nativeBinding);
  if (lock !== undefined) return ok(lock);
  const running = await ourBackend(paths, port, timing.probeMs);
  if (running === undefined) {
    const waited = await waitForInstanceLock(paths.dirs.run, {
      waitMs: timing.lockWaitMs,
      pollMs: timing.lockPollMs,
      ...(nativeBinding === undefined ? {} : { nativeBinding }),
    });
    if (waited !== undefined) return ok(waited);
  }
  const found = running ?? (await ourBackend(paths, port, timing.probeMs));
  if (found !== undefined) return err(alreadyRunning(found));
  const fields = texts(processCopy.otherInstance);
  return err({ code: backendExitCode.ok, level: "info", event: "otherInstance", fields });
}

/** 这个集中存储的后端已在运行，这个实例安静退出。 */
function alreadyRunning(found: BackendOnPort): Refusal {
  const { port, pid } = found;
  const message = renderCopy(processCopy.log.alreadyRunning, { port, pid });
  const fields = { message, port, runningPid: pid };
  return { code: backendExitCode.ok, level: "info", event: "alreadyRunning", fields };
}

/** 这个集中存储的后端有没有在应答：先看 backend.json 写的端口，再看要用的端口。 */
async function ourBackend(
  paths: HomePaths,
  port: number,
  probeMs: number,
): Promise<BackendOnPort | undefined> {
  const ports = [readRunInfo(paths.dirs.run)?.port, port].filter(
    (p, i, all): p is number => p !== undefined && p > 0 && all.indexOf(p) === i,
  );
  for (const candidate of ports) {
    const found = await probeBackend(candidate, probeMs);
    if (found !== undefined && sameDir(found.home, paths.home)) return found;
  }
  return undefined;
}

/** 迁移以后：记一行日志，删掉上一次升级的迁移前快照，见「03 数据模型」第七节。 */
function afterMigration(
  migrated: number,
  snapshot: string | undefined,
  paths: HomePaths,
  log: Logger,
): void {
  if (migrated === 0) return;
  const message = renderCopy(processCopy.log.migrated, { count: migrated });
  log.info("migrated", { message, count: migrated, snapshot });
  if (snapshot === undefined) return;
  const removed = prunePreMigrationSnapshots(paths.dirs.backups, snapshot);
  if (removed.length === 0) return;
  const files = removed.map((file) => basename(file)).join("、");
  log.info("snapshotsPruned", {
    message: renderCopy(processCopy.log.snapshotsPruned, { files }),
    removed,
  });
}

type AppDepsInput = {
  readonly options: StartOptions;
  readonly paths: HomePaths;
  readonly log: Logger;
  readonly now: () => Date;
  readonly sqlite: Database.Database;
  readonly db: Db;
  readonly state: ProcessState;
  readonly timeMachine: ((now: Date) => Promise<readonly TimeMachineWarning[]>) | undefined;
  readonly timeMachineWaitMs: number;
  readonly port: () => number;
  readonly shutdown: () => void;
};

/** 接口层的依赖，见 http/deps.ts。 */
function appDeps(input: AppDepsInput): AppDeps {
  const { options, paths, log, now, sqlite, db, state } = input;
  const backupsDir = paths.dirs.backups;
  return {
    db,
    notifier: createNotifier((error) => {
      log.error("subscriberFailed", {
        message: renderCopy(processCopy.log.subscriberFailed),
        error,
      });
    }),
    now,
    waitClock: systemClock,
    reserved: { userHome: options.userHome ?? homedir(), home: paths.home },
    paths,
    port: input.port,
    build: options.build,
    webDir: options.webDir,
    schemaVersion: schemaVersionOf(sqlite),
    shutdown: input.shutdown,
    log: {
      file: log.file,
      error: (error, request) => {
        log.error("unexpected", {
          message: renderCopy(processCopy.log.unexpected),
          ...(request === undefined ? {} : { request }),
          error,
        });
      },
    },
    process: state,
    dailySnapshot: dailySnapshotHook({
      sqlite,
      backupsDir,
      nativeBinding: options.nativeBinding,
      now,
      log,
    }),
    backups: backupActions({
      sqlite,
      db,
      backupsDir,
      nativeBinding: options.nativeBinding,
      migrationsFolder: options.migrationsFolder,
      now,
    }),
    backupWarnings: backupWarnings({
      backupsDir,
      timeMachine: input.timeMachine,
      waitMs: input.timeMachineWaitMs,
    }),
  };
}

/** 数据结构版本：已执行的最后一个迁移的生成时间，毫秒数。 */
function schemaVersionOf(sqlite: Database.Database): number {
  const latest = sqlite.prepare("select max(created_at) from __drizzle_migrations").pluck().get();
  return latest === null || latest === undefined ? 0 : Number(latest);
}

/** 绑定 127.0.0.1 上的端口，返回实际的端口。端口写 0 时由系统分配。 */
function listen(server: Server, port: number): Promise<Result<number, NodeJS.ErrnoException>> {
  return new Promise((resolve) => {
    const failed = (error: NodeJS.ErrnoException) => {
      server.off("listening", listening);
      resolve(err(error));
    };
    const listening = () => {
      server.off("error", failed);
      const address = server.address();
      resolve(ok(typeof address === "object" && address !== null ? address.port : port));
    };
    server.once("error", failed);
    server.once("listening", listening);
    server.listen(port, "127.0.0.1");
  });
}

/**
 * 端口没绑成。被占用时查是谁，见「01 架构」第六节和第八节：
 * 这个集中存储的后端就安静退出，别的后端或程序就报错，写明占用者。
 */
async function portProblem(
  error: NodeJS.ErrnoException,
  port: number,
  options: StartOptions,
  paths: HomePaths,
  timing: StartTiming,
): Promise<Refusal> {
  const words = processCopy.refused;
  const code = backendExitCode.portTaken;
  if (error.code !== "EADDRINUSE") {
    const message = renderCopy(words.portUnusable.message, { port, detail: error.message });
    return problem(code, "portUnusable", message, words.portUnusable.hint, { errno: error.code });
  }
  const occupant = await findOccupant(port, options.exec, timing.probeMs);
  switch (occupant.kind) {
    case "backend": {
      if (sameDir(occupant.home, paths.home)) return alreadyRunning(occupant);
      const { home, pid } = occupant;
      const text = words.portTakenByBackend;
      const message = renderCopy(text.message, { port, home, pid });
      return problem(code, "portTaken", message, text.hint, { port, occupant });
    }
    case "process": {
      const { command, pid } = occupant;
      const text = words.portTakenByProcess;
      const message = renderCopy(text.message, { port, command, pid });
      return problem(code, "portTaken", message, text.hint, { port, occupant });
    }
    case "unknown": {
      const text = words.portTakenByUnknown;
      const message = renderCopy(text.message, { port });
      return problem(code, "portTaken", message, text.hint, { port, occupant });
    }
  }
}
