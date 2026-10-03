import { copy } from "@product-loop/model";

// ploop open 的文案，见「04 命令行」第二节和「06 工作台」第一节。
// 暂时放在命令行里，以后并进共用定义的文案表。

const url = "http://127.0.0.1:4731/p/app/r/v2-%E6%A3%80%E6%9F%A5-1";

export const openCopy = {
  help: {
    description: copy("在浏览器里打开工作台"),
    details: {
      waiting: copy("不写选项，打开在等的那一页所在的阶段。"),
      latest: copy("没有在等的页，打开最近的阶段。"),
      none: copy("一个阶段也没开始过，打开项目页。"),
      short: copy("--round 只写「检查」，指这一版里最近一次的检查阶段。"),
      label: copy("--round 也认 --json 输出里 label 的写法。"),
    },
    round: copy("打开这个阶段，写成「第 2 版的检查阶段」"),
    queue: copy("打开这个项目的队列看板"),
    mainline: copy("打开这个项目的主线页"),
    decisions: copy("打开这个项目的决定页"),
    all: copy("打开首页，列出所有项目；不用在项目里"),
    reads: copy("集中存储的阶段和页面"),
    writes: copy("不写"),
    examples: {
      plain: copy("ploop open"),
      round: copy('ploop open --round "第 2 版的检查阶段"'),
      queue: copy("ploop open --queue"),
      all: copy("ploop open --all"),
    },
    after: copy("在页面上点完，提交"),
  },
  output: {
    opened: copy("打开了：{url}", { url }),
    notOpened: copy("没能打开浏览器，请手动打开：{url}", { url }),
    /** 一个阶段也没开始过，没有页可打开，先打开了项目页。 */
    noRound: copy("这个项目还没有开始过任何阶段，先打开的是项目页。"),
  },
  next: { wait: copy("ploop reply wait"), start: copy("ploop round start 构思") },
  errors: {
    browser: {
      message: copy("打开浏览器的命令 {command} 没有跑起来：{reason}。", {
        command: "open",
        reason: "找不到这个程序，确认名字写对了、已经装好",
      }),
      hint: copy("手动打开上面的地址，或设置环境变量 PLOOP_BROWSER。"),
    },
  },
};
