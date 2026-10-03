import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { type CommandUnknownOpts, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import { createClient } from "@product-loop/client";
import {
  ensureBackend,
  findBackend,
  processAlive,
  readLogTail,
  readRunInfo,
} from "@product-loop/client/node";
import {
  beijingMinute,
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import {
  type Backend,
  backendDown,
  type CommandEnv,
  cliBuild,
  connect,
  settleCall,
} from "../connect.ts";
import { backendCopy } from "../copy/backend.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { autostartCommand } from "./autostart.ts";

// ploop backend start|stop|status|logs：后端的启停和查看，见「04 命令行」第二节和「01 架构」第六、八节。
// 只有 start 会拉起后端。status 和 stop 只看一眼，后端没开时照实说，不先把它拉起来。
// logs 把日志的 JSON 行写成中文，刚轮转过、这一份不够时连同 backend.log.1 一起读。

const { output, errors } = backendCopy;

/** 请后端退出以后最多等它多久。后端五秒内退出，多留五秒，和拉起时替换旧后端的相同。 */
const stopWaitMs = 10_000;
const stopPollMs = 100;

/** logs 默认打印几条。 */
const defaultLogLines = 50;

/** 运行了多久，写成中文，只写最大的两级。 */
export function durationText(ms: number): string {
  const { duration } = backendCopy;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return renderCopy(duration.days, { days, hours: hours % 24 });
  if (hours > 0) return renderCopy(duration.hours, { hours, minutes: minutes % 60 });
  if (minutes > 0) return renderCopy(duration.minutes, { minutes });
  return renderCopy(duration.seconds, { seconds });
}

/** 在前台运行的后端怎么结束的：退出了，或者没能运行起来。 */
type ForegroundExit =
  | {
      readonly kind: "exited";
      readonly code: number | null;
      readonly signal: NodeJS.Signals | null;
    }
  | { readonly kind: "failed"; readonly detail: string };

/** ploop backend start：后端没开就拉起，构建号不同就换掉旧的。 */
async function startBackend(ctx: CommandEnv): Promise<Outcome> {
  const backend = connect(ctx);
  const result = await ensureBackend(backend.ensureOptions);
  if (!result.ok) return err(backendDown(result.error));
  const { pid, port, started, replaced } = result.value;
  const first = renderCopy(started ? output.started : output.alreadyRunning, { pid, port });
  return ok({
    kind: "backend.started",
    data: { ...result.value, home: backend.home, logFile: backend.files.log },
    lines: [
      first,
      ...(replaced === undefined ? [] : [renderCopy(output.replaced, replaced)]),
      renderCopy(output.home, { home: backend.home }),
      renderCopy(output.log, { file: backend.files.log }),
    ],
    next: [renderCopy(backendCopy.help.start.after)],
    warnings: [],
  });
}

/**
 * ploop backend start --foreground：在前台运行后端，它的报错直接写到终端，见「01 架构」第八节。
 * 按 Ctrl-C 时终端把信号发给前台的每个进程，后端收到后自己收尾，命令行等它结束。
 */
async function runInForeground(ctx: CommandEnv): Promise<Outcome> {
  const backend = connect(ctx);
  const running = await findBackend(backend.ensureOptions);
  if (running !== undefined) {
    const { message, hint } = errors.runningInBackground;
    const issue = { message: renderCopy(message, running), hint: renderCopy(hint) };
    return err(errorBody("CONFLICT", [issue]));
  }
  const { backendEntry, env, home } = backend.ensureOptions;
  // 集中存储还没建时，先建好目录，后端在这里运行。
  mkdirSync(home, { recursive: true });
  const child = spawn(process.execPath, [backendEntry], {
    stdio: "inherit",
    env: { ...env, PLOOP_HOME: home },
    cwd: home,
  });
  const ignore = () => {};
  process.on("SIGINT", ignore);
  process.on("SIGTERM", ignore);
  const exit = await new Promise<ForegroundExit>((resolve) => {
    child.on("error", (error) => resolve({ kind: "failed", detail: error.message }));
    child.on("exit", (code, signal) => resolve({ kind: "exited", code, signal }));
  });
  process.off("SIGINT", ignore);
  process.off("SIGTERM", ignore);
  if (exit.kind === "failed") {
    return err(
      backendDown({
        kind: "startFailed",
        reason: "spawnFailed",
        detail: exit.detail,
        waitedMs: 0,
        logTail: [],
        logFile: backend.files.log,
        node: process.execPath,
        entry: backendEntry,
      }),
    );
  }
  if (exit.code === 0) {
    return ok({
      kind: "backend.exited",
      data: { code: 0, logFile: backend.files.log },
      lines: [renderCopy(output.exited)],
      next: [],
      warnings: [],
    });
  }
  const text =
    exit.code === null
      ? {
          message: renderCopy(errors.foregroundKilled.message, { signal: exit.signal ?? "" }),
          hint: renderCopy(errors.foregroundKilled.hint),
        }
      : {
          message: renderCopy(errors.foregroundExited.message, { code: exit.code }),
          hint: renderCopy(errors.foregroundExited.hint),
        };
  return err(errorBody("INTERNAL", [{ ...text, where: backend.files.log }]));
}

/** 请后端退出，等它结束。 */
async function requestStop(
  backend: Backend,
  port: number,
  pid: number,
  ctx: CommandEnv,
): Promise<Result<void, ErrorBody>> {
  const client = createClient({
    baseUrl: `http://127.0.0.1:${port}`,
    client: "cli",
    timeoutMs: 5_000,
    onBusy: (error, waitMs) => {
      const seconds = Math.ceil(waitMs / 1000);
      ctx.notice(renderCopy(backendCopy.call.busy, { seconds, message: error.message }));
    },
  });
  const sent = settleCall(
    await client.call((api) => api.api.v1.admin.shutdown.$post()),
    backend.files.log,
  );
  if (!sent.ok) return sent;
  for (let waited = 0; processAlive(pid); waited += stopPollMs) {
    if (waited >= stopWaitMs) {
      const { message, hint } = errors.stillRunning;
      const seconds = stopWaitMs / 1000;
      const issue = {
        message: renderCopy(message, { seconds, pid }),
        hint: renderCopy(hint, { pid }),
      };
      return err(errorBody("INTERNAL", [issue]));
    }
    await sleep(stopPollMs);
  }
  return ok(undefined);
}

/** 请正在运行的后端退出，等它结束。没在运行时返回 undefined，退出了返回它的进程号。 */
export async function stopRunning(ctx: CommandEnv): Promise<Result<number | undefined, ErrorBody>> {
  const backend = connect(ctx);
  const running = await findBackend(backend.ensureOptions);
  if (running === undefined) return ok(undefined);
  const stopped = await requestStop(backend, running.port, running.pid, ctx);
  return stopped.ok ? ok(running.pid) : stopped;
}

/** ploop backend stop：请后端退出。没开时照实说，退出码 0。 */
async function stopBackend(ctx: CommandEnv): Promise<Outcome> {
  const backend = connect(ctx);
  const running = await findBackend(backend.ensureOptions);
  if (running === undefined) {
    return ok({
      kind: "backend.stopped",
      data: { stopped: false },
      lines: [renderCopy(output.notRunning)],
      next: [],
      warnings: [],
    });
  }
  const stopped = await requestStop(backend, running.port, running.pid, ctx);
  if (!stopped.ok) return stopped;
  return ok({
    kind: "backend.stopped",
    data: { stopped: true, pid: running.pid },
    lines: [renderCopy(output.stopped, { pid: running.pid })],
    next: [],
    warnings: [],
  });
}

/** 工作台的首页地址：后端在本机的端口上直接提供工作台。 */
const workbenchUrl = (port: number) => `http://127.0.0.1:${port}/`;

/** ploop backend status：后端在不在运行、运行了多久、用哪一版、数据放在哪里。 */
async function backendStatus(ctx: CommandEnv, now: number = Date.now()): Promise<Outcome> {
  const backend = connect(ctx);
  const { home, files } = backend;
  const running = await findBackend(backend.ensureOptions);
  const where = [renderCopy(output.home, { home }), renderCopy(output.log, { file: files.log })];
  if (running === undefined) {
    return ok({
      kind: "backend.status",
      data: { running: false, home, logFile: files.log },
      lines: [renderCopy(output.notRunning), ...where],
      next: [renderCopy(backendCopy.help.examples.start)],
      warnings: [],
    });
  }
  const { pid, port, build } = running;
  // backend.json 是这个进程写的才用，别的会话刚换过后端时可能对不上。
  const info = readRunInfo(files.runInfo);
  const run = info?.pid === pid ? info : undefined;
  const details =
    run === undefined
      ? []
      : [
          renderCopy(output.uptime, { duration: durationText(now - Date.parse(run.startedAt)) }),
          // 数据结构版本是最后一个迁移的生成时间，毫秒数，读不出含义，写成本机时间。
          renderCopy(output.schemaVersion, { time: beijingMinute(new Date(run.schemaVersion)) }),
          renderCopy(output.entry, { entry: run.entry }),
          renderCopy(output.node, { node: run.node }),
        ];
  const workbench = workbenchUrl(port);
  return ok({
    kind: "backend.status",
    data: {
      running: true,
      pid,
      port,
      build,
      cliBuild,
      workbench,
      home,
      logFile: files.log,
      run: run ?? null,
    },
    lines: [
      renderCopy(output.running, { pid, port }),
      renderCopy(output.workbench, { url: workbench }),
      build === cliBuild
        ? renderCopy(output.build, { build })
        : renderCopy(output.buildDiffers, { build, cli: cliBuild }),
      ...details,
      ...where,
    ],
    next: [],
    warnings: [],
  });
}

/** ploop backend logs：日志的最后几条，写成中文。 */
function backendLogs(ctx: CommandEnv, count: number): Outcome {
  const backend = connect(ctx);
  const file = backend.files.log;
  const entries = readLogTail(file, { lines: count });
  const [first, ...rest] =
    entries.length === 0
      ? [renderCopy(output.logsEmpty, { file })]
      : [renderCopy(output.logsHead, { count: entries.length, file }), ...entries];
  return ok({
    kind: "backend.logs",
    data: { file, entries },
    lines: [first ?? "", ...rest],
    next: [],
    warnings: [],
  });
}

/** --lines 的取值：正整数。 */
function positiveInt(value: string): number {
  if (/^[1-9]\d*$/u.test(value)) return Number(value);
  throw new InvalidArgumentError(renderCopy(backendCopy.help.logs.linesInvalid));
}

/** 挂上 ploop backend 和它的四个子命令，另有 autostart 一组。 */
export function backendCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = backendCopy;
  const group = program.command("backend").description(renderCopy(help.description));
  const reads = renderCopy(help.reads);

  const start = group
    .command("start")
    .description(renderCopy(help.start.description))
    .option("--foreground", renderCopy(help.start.foreground))
    .action(async (options) => {
      context.settle(
        options.foreground ? await runInForeground(context) : await startBackend(context),
      );
    });
  const details = (entries: Record<string, CopyEntry>) =>
    Object.values(entries).map((entry) => renderCopy(entry));
  withHelp(start, {
    details: details(help.start.details),
    reads,
    examples: [renderCopy(help.examples.start), renderCopy(help.examples.foreground)],
    after: [renderCopy(help.start.after)],
  });

  const stop = group
    .command("stop")
    .description(renderCopy(help.stop.description))
    .action(async () => context.settle(await stopBackend(context)));
  withHelp(stop, {
    details: details(help.stop.details),
    reads,
    after: [renderCopy(help.stop.after)],
  });

  const status = group
    .command("status")
    .description(renderCopy(help.status.description))
    .action(async () => context.settle(await backendStatus(context)));
  withHelp(status, { details: details(help.status.details), reads });

  const logs = group
    .command("logs")
    .description(renderCopy(help.logs.description))
    .addOption(
      new Option("--lines <条数>", renderCopy(help.logs.lines))
        .argParser(positiveInt)
        .default(defaultLogLines),
    )
    .action((options) => context.settle(backendLogs(context, options.lines)));
  withHelp(logs, {
    details: details(help.logs.details),
    reads,
    examples: [renderCopy(help.examples.logs)],
  });

  autostartCommand(group, context);
}
