import { type CopyEntry, copy, type ErrorCopy } from "@product-loop/model";
import type { GlobalWork } from "../http/deps.ts";

// 后端进程的文案：日志里每一行的说明、后端起不来的原因、全局操作期间的 BUSY。
// 见「01 架构」第六到八节。日志的一行里，message 写发生了什么，要人或 AI 动手时 hint 写怎么做。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const processCopy = {
  /** 日志里各事件的说明，键和日志里的 event 相同。 */
  log: {
    started: copy("后端已启动，端口 {port}，进程号 {pid}，构建号 {build}。", {
      port: 4731,
      pid: 51234,
      build: "dev",
    }),
    /** 第二个实例发现这个集中存储的后端已在运行，安静退出。 */
    alreadyRunning: copy("这个集中存储的后端已在运行，端口 {port}，进程号 {pid}。这个实例退出。", {
      port: 4731,
      pid: 51234,
    }),
    migrated: copy("执行了 {count} 个数据库迁移。", { count: 2 }),
    snapshotsPruned: copy("删掉了上一次升级的迁移前快照：{files}。", {
      files: "pre-migration-20260920T010203004Z.db",
    }),
    stopping: copy("收到{reason}，后端开始退出：不再接新的连接，等手上的请求做完。", {
      reason: "停止信号 SIGTERM",
    }),
    forced: copy("等了 {seconds} 秒，还有请求或快照没有做完，后端不再等，直接退出。", {
      seconds: 4,
    }),
    stopped: copy("后端已退出。"),
    cleanupFailed: copy("退出前收尾的一步出了错，后面的步骤照做。"),
    snapshotTaken: copy("今天的数据库快照做好了：{file}。", {
      file: "/Users/someone/.product-loop/backups/daily-2026-09-28.db",
    }),
    busyBegin: copy("开始{task}，这期间写请求和退出的请求返回正忙。", { task: "迁移数据" }),
    busyEnd: copy("{task}做完了，用了 {seconds} 秒。", { task: "迁移数据", seconds: 3 }),
    timeMachineOk: copy("检查了 Time Machine，两个条件都满足。"),
    unexpected: copy("处理请求时出了没有接住的错误，这个请求返回内部出错。"),
    subscriberFailed: copy("事件的订阅者出了错。数据已经写入，不受影响。"),
    crashed: copy("后端出了没有接住的错误，已经退出。"),
    serverError: copy("接收连接时出了错，后端照常运行。"),
  },
  /** 停止的原因，填进 log.stopping 的 reason。 */
  reason: {
    signal: copy("停止信号 {signal}", { signal: "SIGTERM" }),
    request: copy("退出的请求"),
  },
  /** 这个实例安静退出，不算出错：这个集中存储的另一个后端占着实例锁。 */
  otherInstance: {
    message: copy("这个集中存储的另一个后端正在启动或退出，也可能没有应答。这个实例退出。"),
    hint: copy("过几秒再试。一直这样时，运行 ploop backend stop 以后再试。"),
  } satisfies ErrorCopy,
  /** 后端起不来的原因。进程以非零的退出码结束，命令行报出日志的最后几行。 */
  refused: {
    envPort: {
      message: copy("环境变量 PLOOP_PORT 写的是「{value}」，不是端口号。", { value: "47x1" }),
      hint: copy("写 0 到 65535 的整数。写 0 时由系统分配一个空闲的端口。"),
    },
    config: {
      message: copy("{file} 写错了，写错的项是：{fields}。", {
        file: "/Users/someone/.product-loop/config.json",
        fields: "port、reviewThreshold.lines",
      }),
      hint: copy("改正这几项，或者删掉这个文件，改用默认的设置。"),
    },
    configNotObject: {
      message: copy("{file} 不是一个 JSON 对象。", {
        file: "/Users/someone/.product-loop/config.json",
      }),
      hint: copy("改成一个 JSON 对象，或者删掉这个文件，改用默认的设置。"),
    },
    /** 数据库比程序新，约定 0002 第 7 条：写明原因和 ploop setup。 */
    dbNewer: {
      message: copy("数据库已被更新版本的程序迁移过，这一版的后端不能打开它。"),
      hint: copy("运行 ploop setup 安装新版本。"),
    },
    portTakenByProcess: {
      message: copy("端口 {port} 被别的程序占用，占用它的进程是 {command}，进程号 {pid}。", {
        port: 4731,
        command: "python3",
        pid: 51234,
      }),
      hint: copy("用环境变量 PLOOP_PORT 换一个端口，或者改 config.json 里的 port。"),
    },
    portTakenByBackend: {
      message: copy("端口 {port} 被另一个集中存储的后端占用，它的目录是 {home}，进程号 {pid}。", {
        port: 4731,
        home: "/tmp/ploop-home",
        pid: 51234,
      }),
      hint: copy("用环境变量 PLOOP_PORT 换一个端口，或者先停掉那个后端。"),
    },
    portTakenByUnknown: {
      message: copy("端口 {port} 被别的程序占用，查不到是哪个进程。", { port: 4731 }),
      hint: copy("用环境变量 PLOOP_PORT 换一个端口，或者改 config.json 里的 port。"),
    },
    portUnusable: {
      message: copy("端口 {port} 不能用，系统的报错是：{detail}", {
        port: 80,
        detail: "listen EACCES: permission denied 127.0.0.1:80",
      }),
      hint: copy("用环境变量 PLOOP_PORT 换一个端口，写 1024 以上的数。"),
    },
    nodeTooOld: {
      message: copy("本机的 Node 版本是 {current}，低于需要的 {required}。", {
        current: "22.11.0",
        required: "24.12.0",
      }),
      hint: copy("运行 ploop setup，重新绑定 Node。"),
    },
    crashed: {
      message: copy("后端启动时出了没有接住的错误，没有启动。"),
      hint: copy("报错的详情在这一行的 error 里。运行 ploop doctor 检查一遍。"),
    },
  } satisfies Record<string, ErrorCopy>,
  /** 全局操作期间的 BUSY，见「01 架构」第七节。命令行按 Retry-After 重试，最多六十秒。 */
  busy: {
    task: {
      migrate: copy("迁移数据"),
      restore: copy("从快照恢复数据库"),
    } satisfies Record<GlobalWork, CopyEntry>,
    write: {
      message: copy("后端正在{task}，已经 {seconds} 秒，这时不能写入。", {
        task: "迁移数据",
        seconds: 12,
      }),
      hint: copy("等它做完再写。命令行会按 Retry-After 自动重试。"),
    },
    shutdown: {
      message: copy("后端正在{task}，已经 {seconds} 秒，这时不能退出。", {
        task: "从快照恢复数据库",
        seconds: 12,
      }),
      hint: copy("等它做完再请后端退出。命令行会按 Retry-After 自动重试。"),
    },
  },
  /** 外部命令超时，写进 Time Machine 的警告的详情。 */
  execTimeout: copy("超过 {seconds} 秒没有结束。", { seconds: 10 }),
};
