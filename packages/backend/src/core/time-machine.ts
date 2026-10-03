import {
  beijingDay,
  err,
  type Issue,
  localDate,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { backupCopy } from "../copy/backup.ts";
import type { HomePaths } from "../store/home.ts";

// Time Machine 是集中存储唯一的第二份，后端每天检查一次，这是用户定的（决定 174）。
// 检查两件事，见「03 数据模型」第七节。不满足时各出一条警告，显示在 ploop status 和工作台顶上。
// 条件一：集中存储在备份范围内。要设了备份盘，并且集中存储、data/、blobs/ 都没被排除。
// 条件二：最近一次备份没有超过七天。
// 外部命令由调用方注入。测试一律用假的执行器，不运行真的 tmutil。

/** 外部命令结束以后的输出。 */
export type CommandOutput = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

/** 外部命令没能运行完：找不到命令，或者超时、被信号结束。 */
export type CommandFailure =
  | { readonly kind: "notFound" }
  | { readonly kind: "failed"; readonly message: string };

/**
 * 运行一个外部命令。由进程入口用 node:child_process 的 execFile 实现，并设好超时。
 * 命令运行完就返回 ok，退出码不是 0 也一样：tmutil 出错时常以 0 退出，要由检查自己看输出。
 * 找不到命令时返回 notFound，超时或被信号结束时返回 failed。
 */
export type Exec = (
  command: string,
  args: readonly string[],
) => Promise<Result<CommandOutput, CommandFailure>>;

/**
 * 一条警告。kind 就是文案表里 backup.timeMachine 下的键。
 * noDestination、excluded 是条件一不满足，stale、noRecord 是条件二不满足。
 * missing、unchecked 是检查本身没做成，那一个条件不知道满不满足。
 */
export type TimeMachineWarning =
  /** 没有设置备份盘。这时不再查条件二。 */
  | { readonly kind: "noDestination" }
  /** 集中存储或它下面的 data/、blobs/ 被排除在备份之外。path 是第一个被排除的。 */
  | { readonly kind: "excluded"; readonly path: string }
  /** 最近一次备份超过七天。days 按整天向下取。 */
  | { readonly kind: "stale"; readonly lastBackup: Date; readonly days: number }
  /** 两处都查过，没有一次做成的备份。 */
  | { readonly kind: "noRecord" }
  /** 找不到命令，command 是它的完整路径。 */
  | { readonly kind: "missing"; readonly command: string }
  /** 命令的结果认不出来。command 可以在终端照着运行，detail 是输出的第一行，写进日志用。 */
  | { readonly kind: "unchecked"; readonly command: string; readonly detail: string };

type Program = { readonly path: string; readonly name: string };

const tmutil: Program = { path: "/usr/bin/tmutil", name: "tmutil" };
const plutil: Program = { path: "/usr/bin/plutil", name: "plutil" };
/** Time Machine 自己的设置。 */
const preferences = "/Library/Preferences/com.apple.TimeMachine.plist";

const dayMs = 24 * 60 * 60 * 1000;
/** 最近一次备份超过这么久就警告。 */
const maxAgeMs = 7 * dayMs;

/**
 * 检查一次，返回不满足的条件，都满足时返回空数组。不抛出，命令出错时也只出一条警告。
 * paths 是集中存储的各个路径。now 是现在的时间，用来算最近一次备份过了几天。
 */
export async function checkTimeMachine(
  exec: Exec,
  paths: HomePaths,
  now: Date,
): Promise<TimeMachineWarning[]> {
  const args = ["destinationinfo"];
  const destinations = await run(exec, tmutil, args);
  if (!destinations.ok) return [destinations.error];
  const output = destinations.value;
  // 没设备份盘时，tmutil 写一句 "tmutil: No destinations configured."。
  if (/No destinations configured/iu.test(`${output.stdout}\n${output.stderr}`)) {
    return [{ kind: "noDestination" }];
  }
  // 设了备份盘时，每个备份盘一段，其中一行是 "ID            : <UUID>"。
  if (output.status !== 0 || !/^ID\s*:\s*\S/mu.test(output.stdout)) {
    return [unchecked(tmutil, args, output)];
  }
  const warnings = [await coverage(exec, paths), await recency(exec, now)];
  return warnings.filter((warning) => warning !== undefined);
}

/**
 * 条件一的后一半：集中存储没被排除。
 * 附件库的第二份只靠 Time Machine，所以连同 data/ 和 blobs/ 一起查。
 * tmutil 按给的顺序每项打一行，[Included] 或 [Excluded] 后面是路径。
 * 上级文件夹被排除时也是 [Excluded]，路径不存在时是 [UNKNOWN]。
 */
async function coverage(exec: Exec, paths: HomePaths): Promise<TimeMachineWarning | undefined> {
  const items = [paths.home, paths.dirs.data, paths.dirs.blobs];
  const args = ["isexcluded", ...items];
  const result = await run(exec, tmutil, args);
  if (!result.ok) return result.error;
  const marks = [...result.value.stdout.matchAll(/^\[(\w+)\]/gmu)].map((match) => match[1]);
  const excluded = items.find((_, i) => marks[i] === "Excluded");
  if (excluded !== undefined) return { kind: "excluded", path: excluded };
  if (marks.length === items.length && marks.every((mark) => mark === "Included")) return undefined;
  return unchecked(tmutil, args, result.value);
}

/**
 * 条件二：最近一次备份没有超过七天。备份盘常常没接上，这时 tmutil latestbackup 读不到。
 * 所以先读 Time Machine 设置里记下的备份时间，读不到再问 tmutil。
 */
async function recency(exec: Exec, now: Date): Promise<TimeMachineWarning | undefined> {
  const recorded = await recordedBackups(exec);
  const fromPreferences = recorded.ok ? newest(recorded.value) : undefined;
  const asked = fromPreferences === undefined ? await latestBackup(exec) : undefined;
  const latest = fromPreferences ?? (asked?.ok === true ? asked.value : undefined);
  if (latest !== undefined) {
    const age = now.getTime() - latest.getTime();
    if (age <= maxAgeMs) return undefined;
    return { kind: "stale", lastBackup: latest, days: Math.floor(age / dayMs) };
  }
  // 至少一处读成了，只是没有备份。
  // 两处都没读成时报 tmutil 的错，它更能说明原因，例如备份盘没接上。
  if (recorded.ok || asked?.ok === true) return { kind: "noRecord" };
  return asked?.ok === false ? asked.error : recorded.error;
}

/**
 * Time Machine 的设置里，Destinations 下每个备份盘的 SnapshotDates 是做成的每次备份的时间。
 * 备份盘没接上时也读得到。这个键不在 Apple 的文档里，在 macOS 26 上核对过。
 */
async function recordedBackups(exec: Exec): Promise<Result<Date[], TimeMachineWarning>> {
  const args = ["-extract", "Destinations", "xml1", "-o", "-", preferences];
  const result = await run(exec, plutil, args);
  if (!result.ok) return result;
  const { status, stdout } = result.value;
  if (status !== 0 || !stdout.includes("<plist")) return err(unchecked(plutil, args, result.value));
  const lists = stdout.matchAll(/<key>SnapshotDates<\/key>\s*<array>([\s\S]*?)<\/array>/gu);
  const dates = [...lists]
    .flatMap((list) => [...(list[1] ?? "").matchAll(/<date>([^<]+)<\/date>/gu)])
    .map((match) => new Date(match[1] ?? ""));
  return ok(dates.filter((date) => !Number.isNaN(date.getTime())));
}

/**
 * tmutil latestbackup 打出最近一次备份的路径，末尾是本地时间，例如 2026-09-20-093123。
 * 备份盘没接上时它仍以 0 退出，只在标准错误写一句 Failed to mount backup destination。
 * 所以不看退出码，看输出。
 */
async function latestBackup(exec: Exec): Promise<Result<Date | undefined, TimeMachineWarning>> {
  const args = ["latestbackup"];
  const result = await run(exec, tmutil, args);
  if (!result.ok) return result;
  const { status, stdout, stderr } = result.value;
  const stamp = [...stdout.matchAll(/(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/gu)].at(-1);
  if (status === 0 && stamp !== undefined) {
    const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = stamp
      .slice(1)
      .map(Number);
    return ok(new Date(year, month - 1, day, hour, minute, second));
  }
  // 正常退出又什么都没打，说明备份盘上还没有备份。
  if (status === 0 && `${stdout}${stderr}`.trim() === "") return ok(undefined);
  return err(unchecked(tmutil, args, result.value));
}

function newest(dates: readonly Date[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (latest, date) => (latest === undefined || date > latest ? date : latest),
    undefined,
  );
}

/** 运行一个命令。找不到命令、没运行完、执行器自己抛出，都换成一条警告。 */
async function run(
  exec: Exec,
  program: Program,
  args: readonly string[],
): Promise<Result<CommandOutput, TimeMachineWarning>> {
  let result: Result<CommandOutput, CommandFailure>;
  try {
    result = await exec(program.path, args);
  } catch (error) {
    result = err({
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (result.ok) return result;
  if (result.error.kind === "notFound") return err({ kind: "missing", command: program.path });
  return err(unchecked(program, args, result.error.message));
}

/** 没查成的警告。命令写成能在终端照着运行的样子，带空格的参数加引号。 */
function unchecked(
  program: Program,
  args: readonly string[],
  output: CommandOutput | string,
): TimeMachineWarning {
  const shown = args.map((arg) => (/\s/u.test(arg) ? JSON.stringify(arg) : arg));
  const detail = typeof output === "string" ? output : firstLine(output);
  return { kind: "unchecked", command: [program.name, ...shown].join(" "), detail };
}

/** 输出里第一行不空的，先看标准错误。 */
function firstLine({ stdout, stderr }: CommandOutput): string {
  const lines = `${stderr}\n${stdout}`.split("\n").map((line) => line.trim());
  return lines.find((line) => line !== "") ?? "";
}

/**
 * 每天只检查一次：当天第一次调用时运行，之后当天都返回同一份结果。
 * 跨过零点再调用时重新检查。同时来的几次调用共用同一次检查。
 * 结果只记在这个进程里，后端重启以后当天会再查一次。
 */
export function dailyTimeMachineCheck(
  exec: Exec,
  paths: HomePaths,
): (now: Date) => Promise<readonly TimeMachineWarning[]> {
  let last:
    | { readonly day: string; readonly warnings: Promise<readonly TimeMachineWarning[]> }
    | undefined;
  return (now) => {
    const day = beijingDay(now);
    if (last === undefined || last.day !== day) {
      last = { day, warnings: checkTimeMachine(exec, paths, now) };
    }
    return last.warnings;
  };
}

/** 把一条警告写成 ploop status 和工作台顶上显示的文字。 */
export function timeMachineIssue(warning: TimeMachineWarning): Issue {
  const texts = backupCopy.timeMachine;
  switch (warning.kind) {
    case "noDestination":
      return {
        message: renderCopy(texts.noDestination.message),
        hint: renderCopy(texts.noDestination.hint),
      };
    case "excluded":
      return {
        message: renderCopy(texts.excluded.message, { path: warning.path }),
        hint: renderCopy(texts.excluded.hint),
      };
    case "stale":
      return {
        message: renderCopy(texts.stale.message, {
          date: localDate(warning.lastBackup),
          days: warning.days,
        }),
        hint: renderCopy(texts.stale.hint),
      };
    case "noRecord":
      return { message: renderCopy(texts.noRecord.message), hint: renderCopy(texts.noRecord.hint) };
    case "missing":
      return {
        message: renderCopy(texts.missing.message, { command: warning.command }),
        hint: renderCopy(texts.missing.hint),
      };
    case "unchecked":
      return {
        message: renderCopy(texts.unchecked.message, { command: warning.command }),
        hint: renderCopy(texts.unchecked.hint, { command: warning.command }),
      };
  }
}
