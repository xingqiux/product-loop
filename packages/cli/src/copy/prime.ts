import { copy } from "@product-loop/model";

// ploop prime 的文案，见「09 skill 与软件」第八节和「13 待定」第 8 项。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const primeCopy = {
  help: {
    description: copy("输出状态和下一步，给会话开始的钩子用"),
    details: {
      lines: copy("十行以内。"),
      none: copy("不在项目里什么都不输出。"),
    },
    blocks: {
      noProject: {
        situation: copy("往上找不到 project.json"),
        fix: copy("什么都不输出，退出码 0"),
      },
      noBackend: {
        situation: copy("后端没有在运行，或者三秒内没有应答"),
        fix: copy("输出一行说明怎么启动，退出码 0，也不拉起后端"),
      },
    },
    reads: copy("项目缓存的 project.json，集中存储的项目状态"),
    writes: copy("不写"),
    examples: {
      current: copy("ploop prime"),
    },
    after: copy("按输出的「下一步」运行"),
  },
  /** 第一行：提醒 AI 这个项目在用产品循环。 */
  tip: copy("这个项目用产品循环，下面是现在的状态，完整的运行 ploop status。"),
  /** 第二行：钩子和 skill 互相指到，压缩或新会话以后 AI 不一定加载了 skill。 */
  skill: copy("做法和规矩在 product-loop skill 里，没读过先读它，再照下一步做。"),
  /** 在项目里可是给不出状态时的一行：现在是什么情况、敲什么。 */
  unavailable: {
    notRunning: copy("这个项目用产品循环，后端没有在运行。运行 ploop status 拉起它。"),
    noAnswer: copy(
      "这个项目用产品循环，后端 3 秒内没有应答。运行 ploop status 看状态。一直没有应答，运行 ploop backend logs。",
    ),
    needsDoctor: copy("这个项目用产品循环，但还停在旧版本的 skill。运行 ploop doctor 迁移。"),
    failed: copy("这个项目用产品循环，没能取到状态。运行 ploop status 看原因。"),
  },
  /** 在等的页不止一页时，第二行合并写。 */
  waitingMore: copy("在等的页：共 {count} 页，{page}最先，{purpose}", {
    count: 2,
    page: "第 2 版的检查阶段的第 2 页",
    purpose: "要用户点",
  }),
};
