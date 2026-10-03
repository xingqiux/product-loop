import {
  backendCopy,
  type CopyEntry,
  copy,
  type ErrorCopy,
  type LogLevel,
} from "@product-loop/model";

// Node 入口的文案：日志的一行怎么写给人看，后端起不来时报给 AI 的话，见「01 架构」第八节。
// 按约定 0002 第 15 条先放在客户端，测试里跑写作校验，第一期结束前并进共用定义的文案表。
// 拉起后八秒内没有就绪、Node 版本不够，这两种直接用共用定义的 backendCopy。

/** 样例里日志的最后几行，和 log-tail.ts 写出来的样子相同。 */
const sampleTail = [
  "2026-09-28 11:00:01 错误：数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
  "  怎么改：运行 ploop setup 安装新版本。",
].join("\n");

export const nodeCopy = {
  /** 日志的一行：时间、级别和说明。出错的行另起一行写报错的原文，要动手时再起一行写怎么改。 */
  log: {
    level: {
      info: copy("信息"),
      warn: copy("警告"),
      error: copy("错误"),
    } satisfies Record<LogLevel, CopyEntry>,
    line: copy("{time} {level}：{message}", {
      time: "2026-09-28 11:00:01",
      level: "错误",
      message: "数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
    }),
    request: copy("请求：{request}", { request: "GET /api/v1/projects/app/queue/Q1" }),
    error: copy("报错的原文：{detail}", {
      detail: "SqliteError: database disk image is malformed",
    }),
    hint: copy("怎么改：{hint}", { hint: "运行 ploop setup 安装新版本。" }),
    /** 这一次拉起以后，日志里一行也没有。 */
    none: copy("日志里没有这一次启动的记录。"),
  },
  /** 拉起八秒还没就绪，后端占着实例锁，可能在迁移数据库。命令行打印这一行，接着等。 */
  slowStart: copy("后端还没有就绪，可能在迁移数据库，最多再等 {seconds} 秒。", { seconds: 52 }),
  /** 后端起不来的原因，命令行以退出码 5 结束。 */
  failure: {
    exited: {
      message: copy("后端没有启动成功，进程以退出码 {code} 结束。日志的最后几行：\n{logTail}", {
        code: 3,
        logTail: sampleTail,
      }),
      hint: copy("按日志里写的「怎么改」处理，再重跑这条命令。"),
    },
    killed: {
      message: copy("后端没有启动成功，进程被信号 {signal} 结束。日志的最后几行：\n{logTail}", {
        signal: "SIGKILL",
        logTail: sampleTail,
      }),
      hint: backendCopy.startFailed.hint,
    },
    /** 后端占着实例锁，等过了八秒仍没有就绪。 */
    slow: {
      message: copy(
        "后端没有启动成功，拉起后等了 {seconds} 秒仍没有就绪。日志的最后几行：\n{logTail}",
        { seconds: 60, logTail: sampleTail },
      ),
      hint: backendCopy.startFailed.hint,
    },
    spawnFailed: {
      message: copy("没能用 {node} 运行后端，系统的报错是：{detail}", {
        node: "/Users/someone/.nvm/versions/node/v24.20.0/bin/node",
        detail: "spawn /Users/someone/.nvm/versions/node/v24.20.0/bin/node ENOENT",
      }),
      hint: copy("运行 ploop setup，重新绑定 Node。"),
    },
    entryMissing: {
      message: copy("找不到后端的入口文件：{entry}。", {
        entry: "/Users/someone/.product-loop/app/current/backend.mjs",
      }),
      hint: copy("运行 ploop setup，重新安装这一版。"),
    },
    buildMismatch: {
      message: copy("拉起的后端构建号是 {actual}，和命令行的 {expected} 不同。", {
        actual: "0.0.1+a1b2c3d.20261001T030000Z",
        expected: "2.0.1+e4f5a6b.20261008T030000Z",
      }),
      hint: copy("运行 ploop setup 重新安装，让命令行和后端来自同一次构建。"),
    },
    /** 构建号不同，请旧后端退出时它没有答应，例如一直在做快照。 */
    replaceRefused: {
      message: copy("构建号不同，要换掉旧的后端，但它没有答应退出。后端的回答：{answer}", {
        answer: "后端正在做今天的数据库快照，现在不能退出。",
      }),
      hint: copy("等后端做完手上的事，再重跑这条命令。"),
    },
    /** 旧后端答应退出，却一直没有结束。 */
    stillRunning: {
      message: copy("构建号不同，已请旧的后端退出。过了 {seconds} 秒，它仍在运行，进程号 {pid}。", {
        seconds: 10,
        pid: 51234,
      }),
      hint: copy("结束进程 {pid} 以后，再重跑这条命令。", { pid: 51234 }),
    },
  } satisfies Record<string, ErrorCopy>,
};
