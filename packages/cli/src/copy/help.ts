import { type CopyEntry, copy, type RoundStep } from "@product-loop/model";

// 帮助的文案，结构见「04 命令行」第四节。暂时放在命令行里，以后并进共用定义的文案表。

/** 帮助里各节的标题，顺序就是各节出现的顺序。 */
export const helpHeadingCopy = {
  usage: copy("用法"),
  arguments: copy("参数"),
  options: copy("选项"),
  commands: copy("命令"),
  steps: copy("阶段的四步"),
  details: copy("细节"),
  blocks: copy("会拦截的情况"),
  readsAndWrites: copy("读和写"),
  examples: copy("例子"),
  after: copy("做完以后"),
  env: copy("环境变量"),
  exits: copy("退出码"),
};

/**
 * ploop 自己的帮助把命令分成四组，见决定 209。过渡命令只服务旧 skill 的迁移和退回，到日期就删。
 * 各条过渡命令的说明结尾也写这个日期，测试核对两处一致，见 program.test.ts。
 */
export const transitionalDate = "2026-12-31";

export const helpGroupCopy = {
  daily: copy("日常命令"),
  onDemand: copy("按需命令"),
  maintenance: copy("维护命令"),
  transitional: copy("过渡命令（{date} 删除）", { date: transitionalDate }),
};

/** docs/命令参考.md 的命令一览里，分组一栏写的字，和命令一览前面的一段说明。 */
export const helpGroupNameCopy = {
  daily: copy("日常"),
  onDemand: copy("按需"),
  maintenance: copy("维护"),
  transitional: copy("过渡"),
};

export const commandOverviewCopy = {
  title: copy("命令一览"),
  intro: copy(
    "命令分四组。日常命令每个阶段都会用。按需命令用到时才用。维护命令管安装、查看、备份和导出。过渡命令服务旧 skill 的迁移，{date} 删除。",
    { date: transitionalDate },
  ),
  columns: copy("命令、作用、分组"),
};

/** 帮助里的固定写法。 */
export const helpTextCopy = {
  /** 「读和写」一节的两个开头。 */
  reads: copy("读"),
  writes: copy("写"),
  /** 用法一行里代表选项和子命令的写法。 */
  usageOptions: copy("[选项]"),
  usageCommand: copy("<命令>"),
  /** 参数和选项的说明后面补的取值、默认值和环境变量，几项之间用逗号隔开。 */
  extras: copy("{description}（{extras}）", {
    description: "最多等多久",
    extras: "默认：540",
  }),
  /** 必填的选项，说明里第一个写上它，用法一行里也写出来。 */
  mandatory: copy("必填"),
  choices: copy("取值：{choices}", { choices: "构思、使用、检查、落地、提升" }),
  defaultValue: copy("默认：{value}", { value: "540" }),
  envVar: copy("环境变量：{name}", { name: "PLOOP_PORT" }),
};

/**
 * ploop 自己的说明和全局选项的说明，见「04 命令行」第二节。
 * 选项本身的写法（例如 --project <项目名或路径>）留在命令的定义里，类型要从字面量推出来。
 */
export const programCopy = {
  description: copy("产品循环的命令行"),
  /** 命令行自己的几条说明，每条一句，写在帮助的「细节」里。 */
  details: {
    bare: copy("不写命令，等同 ploop status。"),
    hidden: copy("维护命令和过渡命令默认不列，运行 ploop --help --all 列出全部。"),
    time: copy("输出里的时间一律是北京时间。"),
    fileTime: copy("文件夹名里的时间是 UTC，以 Z 结尾。"),
  },
  json: copy("输出机读的结果"),
  project: copy("指定项目：项目名，或项目里的路径；不写按当前目录找"),
  version: copy("显示命令行自己的版本号和构建号"),
  build: copy("构建号：{build}", { build: "0.0.1+a3d9226.20260929T092846Z" }),
  help: copy("显示帮助"),
};

/** ploop 的帮助里「一个阶段怎么走」的四条命令，见「04 命令行」第一节。 */
export const roundStepCommandCopy = {
  start: copy("ploop round start <阶段名>"),
  present: copy("ploop page present"),
  reply: copy("ploop reply wait"),
  handle: copy("ploop reply handle"),
} satisfies Record<RoundStep, CopyEntry>;

/**
 * ploop 的帮助末尾列出的环境变量：名字和作用。读它们的代码分散在命令行和后端里，
 * 这里是唯一的清单，新加环境变量时补在这里，program.test.ts 会核对代码里读到的都在。
 * PLOOP_SESSION 只是可选的：会话开始的钩子不设置它，所以没有它时，输出里不写「没有记下会话」。
 */
export const helpEnvCopy = [
  {
    name: "PLOOP_HOME",
    text: copy("集中存储的位置；不写用 ~/.product-loop"),
  },
  {
    name: "PLOOP_PORT",
    text: copy("后端的端口；默认 4731，写 0 由系统分配"),
  },
  {
    name: "PLOOP_SESSION",
    text: copy("会话标识，可不写；写了冲突时能看到是哪个会话"),
  },
  {
    name: "PLOOP_BROWSER",
    text: copy("ploop open 用的程序；不写用系统的"),
  },
  {
    name: "PLOOP_TIME_MACHINE",
    text: copy("写 off 关掉每天的 Time Machine 检查，测试用"),
  },
  {
    name: "PLOOP_LAUNCHCTL",
    text: copy("backend autostart 用的 launchctl，测试用"),
  },
  {
    name: "PLOOP_BACKEND_ENTRY",
    text: copy("后端的入口文件，开发用；不写用 backend.mjs"),
  },
  {
    name: "PLOOP_USE_OUT",
    text: copy("use run 设好的输出目录，不用自己设"),
  },
];
