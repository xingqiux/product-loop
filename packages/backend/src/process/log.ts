import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { type LogLevel, logFileName, rotatedLogFileName } from "@product-loop/model";

// 后端的日志，放在集中存储的 logs/，按大小轮转，见「03 数据模型」第四节。
// 一行一件事，写成一个 JSON 对象，也就是 JSON Lines。
// 每行都有时间、级别、进程号、事件和说明，其余的字段按事件而定。
// 说明是给人和 AI 看的中文，取自文案表。命令行在后端起不来时报出最后几行，见「01 架构」第八节。
// 写入是同步的：进程接着就退出时，最后一行也已经写进文件。
// 文件超过上限时轮转：backend.log 改名为 backend.log.1，原来的 .1 改成 .2，以此类推，只留 keep 份。
// 文件名和一行的格式在共用定义里，命令行按同一份定义读，见 model 的 process.ts。

/** 一行日志里，时间、级别、进程号和事件以外的内容。 */
export type LogFields = {
  /** 发生了什么，中文。 */
  readonly message: string;
  /** 要人或 AI 动手时，写怎么做。 */
  readonly hint?: string | undefined;
  readonly [field: string]: unknown;
};

export type Logger = {
  /** 当前的日志文件。 */
  readonly file: string;
  readonly info: (event: string, fields: LogFields) => void;
  readonly warn: (event: string, fields: LogFields) => void;
  readonly error: (event: string, fields: LogFields) => void;
  /** 关掉文件。之后再写的行会重新打开文件。 */
  readonly close: () => void;
};

export type LogOptions = {
  readonly dir: string;
  /** 一个文件的上限，字节。默认一兆。 */
  readonly maxBytes?: number;
  /** 轮转下来的旧文件留几份，至少一份。默认三份。 */
  readonly keep?: number;
  readonly now?: () => Date;
  readonly pid?: number;
  /** 错误级别的行另外交给它。进程入口写到标准错误，前台运行时能直接看到。 */
  readonly onError?: ((line: string) => void) | undefined;
};

const defaultMaxBytes = 1024 * 1024;
const defaultKeep = 3;

/** 打开日志。文件已经超过上限时，第一行写入之前先轮转。 */
export function openLog(options: LogOptions): Logger {
  const { dir, onError } = options;
  const maxBytes = options.maxBytes ?? defaultMaxBytes;
  const keep = Math.max(1, options.keep ?? defaultKeep);
  const now = options.now ?? (() => new Date());
  const pid = options.pid ?? process.pid;
  const file = join(dir, logFileName);
  let fd: number | undefined;
  let size = 0;

  const close = () => {
    if (fd !== undefined) closeSync(fd);
    fd = undefined;
  };
  const open = (): number => {
    close();
    mkdirSync(dir, { recursive: true });
    const opened = openSync(file, "a");
    fd = opened;
    size = fstatSync(opened).size;
    return opened;
  };
  // 别的进程轮转过或者删掉了文件，就重新打开，不往改了名的旧文件里写。
  const current = (): number => (fd !== undefined && sameFile(fd, file) ? fd : open());
  const rotate = (): number => {
    close();
    for (let i = keep - 1; i >= 1; i--) {
      const older = join(dir, rotatedLogFileName(i));
      if (existsSync(older)) renameSync(older, join(dir, rotatedLogFileName(i + 1)));
    }
    renameSync(file, join(dir, rotatedLogFileName(1)));
    return open();
  };

  const write = (level: LogLevel, event: string, fields: LogFields) => {
    const line = `${formatLine({ time: now().toISOString(), level, pid, event, ...fields })}\n`;
    try {
      let target = current();
      if (size > 0 && size + Buffer.byteLength(line) > maxBytes) target = rotate();
      size += writeSync(target, line);
    } catch {
      // 日志写不进去时没有别处可记，不让它影响后端本身。错误级别的行仍交给 onError。
    }
    if (level === "error") onError?.(line);
  };

  return {
    file,
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    close,
  };
}

/** 打开的文件和路径上的文件是不是同一个。路径上没有文件时算不是。 */
function sameFile(fd: number, file: string): boolean {
  try {
    const opened = fstatSync(fd);
    const onDisk = statSync(file);
    return opened.ino === onDisk.ino && opened.dev === onDisk.dev;
  } catch {
    return false;
  }
}

/** 一行 JSON。错误对象写出名字、说明、code 和调用栈。写不成 JSON 时只留前几个字段。 */
function formatLine(entry: Readonly<Record<string, unknown>>): string {
  try {
    return JSON.stringify(entry, (_key, value: unknown) => {
      if (value instanceof Error) return describeError(value);
      if (typeof value === "bigint") return value.toString();
      return value;
    });
  } catch {
    const { time, level, pid, event, message } = entry;
    return JSON.stringify({ time, level, pid, event, message });
  }
}

function describeError(error: Error): Readonly<Record<string, unknown>> {
  const code: unknown = Reflect.get(error, "code");
  return {
    name: error.name,
    message: error.message,
    ...(code === undefined ? {} : { code }),
    ...(error.stack === undefined ? {} : { stack: error.stack }),
  };
}
