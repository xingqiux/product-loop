import { copy } from "@product-loop/model";

// ploop backend 各子命令的文案，和调用接口时给人看的几行，见「01 架构」第六到第八节。
// 暂时放在命令行里，以后并进共用定义的文案表。

const home = "/Users/me/.product-loop";

export const backendCopy = {
  help: {
    description: copy("后端的启停和查看"),
    start: {
      description: copy("启动后端"),
      details: {
        running: copy("已在运行就直接用。"),
        replace: copy("构建号和命令行的不同，就换成新的。"),
      },
      foreground: copy("在前台运行，报错写到终端，按 Ctrl-C 停下"),
      after: copy("ploop status"),
    },
    stop: {
      description: copy("停下后端"),
      details: { wait: copy("它做完手上的请求再退出。") },
      after: copy("下一条命令会自动拉起后端"),
    },
    status: {
      description: copy("查看后端"),
      details: { what: copy("写是否在运行、运行多久、哪一版、工作台地址、数据位置。") },
    },
    logs: {
      description: copy("打印后端的日志"),
      details: {
        chinese: copy("把最近的日志写成中文。"),
        rotated: copy("日志文件刚换过新的，连同上一份一起读。"),
      },
      lines: copy("打印最后几条，例如 --lines 20"),
      linesInvalid: copy("要写正整数，例如 20。"),
    },
    reads: copy("集中存储的 run/backend.json、logs/backend.log"),
    examples: {
      start: copy("ploop backend start"),
      foreground: copy("ploop backend start --foreground"),
      logs: copy("ploop backend logs --lines 20"),
    },
  },
  output: {
    started: copy("启动了：后端，进程 {pid}，端口 {port}", { pid: 51234, port: 4731 }),
    alreadyRunning: copy("后端已在运行：进程 {pid}，端口 {port}", { pid: 51234, port: 4731 }),
    replaced: copy("换掉了构建号是 {build} 的旧后端，进程 {pid}", { build: "old", pid: 51200 }),
    running: copy("在运行：后端，进程 {pid}，端口 {port}", { pid: 51234, port: 4731 }),
    notRunning: copy("后端没有在运行"),
    stopped: copy("停下了：后端，进程 {pid}", { pid: 51234 }),
    exited: copy("后端已退出"),
    uptime: copy("运行了：{duration}", { duration: "2 小时 5 分钟" }),
    build: copy("构建号：{build}", { build: "dev" }),
    buildDiffers: copy("构建号：{build}，和命令行的 {cli} 不同，下一条命令会换掉它", {
      build: "old",
      cli: "dev",
    }),
    schemaVersion: copy("数据结构：最后一次迁移生成于 {time}", { time: "2026-09-29 06:45" }),
    workbench: copy("工作台：{url}", { url: "http://127.0.0.1:4731/" }),
    home: copy("集中存储：{home}", { home }),
    entry: copy("入口：{entry}", { entry: `${home}/app/current/backend.mjs` }),
    node: copy("Node：{node}", { node: "v24.20.0" }),
    log: copy("日志：{file}", { file: `${home}/logs/backend.log` }),
    logsHead: copy("日志的最后 {count} 条：{file}", {
      count: 20,
      file: `${home}/logs/backend.log`,
    }),
    logsEmpty: copy("日志里还没有记录：{file}", { file: `${home}/logs/backend.log` }),
  },
  /** 运行了多久。 */
  duration: {
    seconds: copy("{seconds} 秒", { seconds: 12 }),
    minutes: copy("{minutes} 分钟", { minutes: 5 }),
    hours: copy("{hours} 小时 {minutes} 分钟", { hours: 2, minutes: 5 }),
    days: copy("{days} 天 {hours} 小时", { days: 3, hours: 2 }),
  },
  errors: {
    /** 已在后台运行时，不能再在前台运行一个。 */
    runningInBackground: {
      message: copy("后端已在后台运行，进程 {pid}，端口 {port}。", { pid: 51234, port: 4731 }),
      hint: copy("先运行 ploop backend stop，再在前台启动。"),
    },
    foregroundExited: {
      message: copy("后端在前台运行，以退出码 {code} 结束。", { code: 3 }),
      hint: copy("按上面的报错处理，再重跑这条命令。"),
    },
    foregroundKilled: {
      message: copy("后端在前台运行，被信号 {signal} 结束。", { signal: "SIGKILL" }),
      hint: copy("查看日志里最后几行，再重跑这条命令。"),
    },
    stillRunning: {
      message: copy("已请后端退出，过了 {seconds} 秒它仍在运行，进程 {pid}。", {
        seconds: 10,
        pid: 51234,
      }),
      hint: copy("结束进程 {pid} 以后，再重跑这条命令。", { pid: 51234 }),
    },
  },
  /** 调用接口时的几种情况，所有命令共用。 */
  call: {
    /** 后端正忙，按 Retry-After 等一会儿再重发。写到标准错误。 */
    busy: copy("后端正忙，{seconds} 秒后重试：{message}", {
      seconds: 3,
      message: "后端正在迁移或恢复数据，暂时不能写入。",
    }),
    /** 拉起了后端，请求却没有拿到应答，例如等响应超时。 */
    unreachable: {
      message: copy("没有收到后端的应答：{detail}", {
        detail: "connect ECONNREFUSED 127.0.0.1:4731",
      }),
      hint: copy("运行 ploop backend status 查看后端。仍不通时运行 ploop backend stop，再重跑。"),
    },
    /** PLOOP_SESSION 写了中文或别的不能放进请求头的字符：不发请求，按用法错误报。 */
    badSession: {
      message: copy("环境变量 PLOOP_SESSION 的值「{value}」里有中文或别的非英文字符。", {
        value: "会话甲",
      }),
      hint: copy("只写英文字母、数字和短横，例如 PLOOP_SESSION=sessA。"),
    },
  },
};
