import { z } from "zod";
import { err, ok, type Result } from "./result.ts";

// 后端进程和命令行共用的约定，见「01 架构」第六节和第八节。后端按它写，命令行按它读：
// 集中存储 run/ 和 logs/ 下的文件名、run/backend.json 的格式、日志一行的格式、
// 后端进程的退出码、需要的 Node 版本、默认的端口和 PLOOP_PORT 的写法。
// 读写文件由两边各自用 Node 做。共用定义也给浏览器用，所以这里不引用 Node 的模块。

/** 后端默认的端口，见「05 接口」第一节。config.json 的 port 和环境变量 PLOOP_PORT 可以改。 */
export const defaultPort = 4731;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * 环境变量 PLOOP_PORT 写的端口，见「04 命令行」第二节。没写或写了空值时是 undefined，
 * 后端这时用 config.json 的端口。写 0 时由系统分配一个空闲的端口，测试时用。
 */
export function envPort(env: Env): Result<number | undefined, { readonly value: string }> {
  const value = env.PLOOP_PORT;
  if (value === undefined || value === "") return ok(undefined);
  const port = Number(value);
  return /^\d{1,5}$/u.test(value) && port <= 65535 ? ok(port) : err({ value });
}

/** 集中存储默认放在家目录下的这个文件夹里，见「03 数据模型」第四节。 */
const defaultHomeDirName = ".product-loop";

/** 按 POSIX 的写法整理绝对路径：去掉重复的斜杠、末尾的斜杠和 .、.. 这样的段。 */
function normalizeAbsolute(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/**
 * 集中存储的目录，命令行和后端用同一个函数，见约定 0002 第 13 条。
 * PLOOP_HOME 优先，相对路径按当前目录展开。没写或写了空值时，用家目录下的 .product-loop。
 * 共用定义也给浏览器用，不引用 Node 的模块，所以家目录和当前目录由调用的一方传入。
 */
export function resolveHome(
  env: Env,
  dirs: { readonly userHome: string; readonly cwd: string },
): string {
  const fromEnv = env.PLOOP_HOME;
  if (fromEnv === undefined || fromEnv === "") {
    return normalizeAbsolute(`${dirs.userHome}/${defaultHomeDirName}`);
  }
  return normalizeAbsolute(fromEnv.startsWith("/") ? fromEnv : `${dirs.cwd}/${fromEnv}`);
}

/** 集中存储下后端进程用的两个目录，见「03 数据模型」第四节：进程号、端口和锁，还有日志。 */
export const runDirName = "run";
export const logDirName = "logs";

/** run/ 下的运行信息：后端开始服务时写下，退出时删掉。 */
export const runInfoFileName = "backend.json";

/**
 * run/ 下的实例锁：一个集中存储同一时间只跑一个后端。它是 SQLite 文件，后端占着上面的独占锁，
 * 文件头的 user_version 写着占锁的进程号。放开锁以后号码还留着，要另看那个进程在不在。
 */
export const instanceLockFileName = "backend.lock";

/** run/ 下的启动锁：命令行拉起后端之前先占它，几个会话同时发现后端没开时只拉起一个。 */
export const startLockFileName = "start.lock";

/**
 * run/backend.json 的格式。读的一方不管多出来的字段，新版本的后端加了字段，旧版本的命令行照样能读。
 * 命令行先读它，取出端口、进程号和构建号，再请求 GET /health，见「01 架构」第六节。
 */
export const runInfoSchema = z.object({
  /** 后端的进程号。请它退出以后，命令行等这个进程结束。 */
  pid: z.int().min(1),
  /** 实际监听的端口。设置里写 0 时，这里是系统分配的端口。 */
  port: z.int().min(1).max(65535),
  /** 构建号，和 GET /health 的相同。 */
  build: z.string().min(1),
  /** 数据结构版本：已执行的最后一个迁移的生成时间，毫秒数。 */
  schemaVersion: z.int().min(0),
  /** 开始服务的时间。ploop backend status 用它算运行了多久。 */
  startedAt: z.iso.datetime({ offset: true }),
  /** 集中存储的目录。 */
  home: z.string().min(1),
  /** 运行后端的 Node 版本，例如 v24.20.0。 */
  node: z.string().min(1),
  /** 进程入口的文件，开发时是 src/main.ts，安装以后是 app/<版本>/ 下的文件。 */
  entry: z.string().min(1),
});

export type RunInfo = z.infer<typeof runInfoSchema>;

/** 解析 backend.json 的内容。不是 JSON、不合定义，都返回 undefined。 */
export function parseRunInfo(text: string): RunInfo | undefined {
  try {
    const parsed = runInfoSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** logs/ 下的日志文件，一行一个 JSON 对象，见「03 数据模型」第四节。 */
export const logFileName = "backend.log";

/**
 * 轮转下来的旧日志：超过上限时 backend.log 改名为 backend.log.1，原来的 .1 改成 .2，以此类推。
 * 刚轮转过时，最后几行在 backend.log.1 里。
 */
export function rotatedLogFileName(n: number): string {
  return `${logFileName}.${n}`;
}

export const logLevels = ["info", "warn", "error"] as const;
export type LogLevel = (typeof logLevels)[number];

/**
 * 日志的一行。每行都有时间、级别、进程号、事件和说明，要人或 AI 动手时另有 hint。
 * 其余的字段按事件而定，读的一方照原样留着。出错的行在 error 里写报错的名字、说明和调用栈。
 * 命令行在后端起不来时报出最后几行，见「01 架构」第八节。
 */
export const logLineSchema = z.looseObject({
  time: z.iso.datetime({ offset: true }),
  level: z.enum(logLevels),
  pid: z.int().min(1),
  /** 发生了什么事，英文小驼峰，例如 dbNewer。 */
  event: z.string().min(1),
  /** 发生了什么，中文。 */
  message: z.string().min(1),
  /** 怎么做，中文。 */
  hint: z.string().min(1).optional(),
});

export type LogLine = z.infer<typeof logLineSchema>;

/**
 * 后端进程的退出码。拉起以后没有开始服务就退出的，命令行都当作后端起不来，
 * 以退出码 5 结束，并报出日志的最后几行，见约定 0002 第 7 条。
 */
export const backendExitCode = {
  /** 正常退出，或者这个集中存储的后端已在运行，这个实例安静退出。 */
  ok: 0,
  /** 没有接住的错误。 */
  crashed: 1,
  /** 环境变量或 config.json 写错了。 */
  badSettings: 2,
  /** 数据库比程序新，要运行 ploop setup。 */
  dbNewer: 3,
  /** 端口被别的程序占用，或者不能用。 */
  portTaken: 4,
  /** Node 的版本低于要求。 */
  nodeTooOld: 5,
} as const;

export type BackendExitCode = (typeof backendExitCode)[keyof typeof backendExitCode];

/** 需要的最低 Node 版本，和根目录 package.json 的 engines 相同，见「02 技术选型」第二节。 */
export const requiredNode = "24.12.0";

/** 这个版本的 Node 低于要求。版本写成 24.20.0 或 v24.20.0，按每一段的数比。 */
export function isNodeTooOld(version: string): boolean {
  return olderThan(version.replace(/^v/u, ""), requiredNode);
}

/** a 比 b 旧。版本写成 24.20.0 这样，按每一段的数比。 */
function olderThan(a: string, b: string): boolean {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10));
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p < q;
  }
  return false;
}
