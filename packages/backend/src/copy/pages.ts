import { copy } from "@product-loop/model";

// 校验、给出和撤回页面的文案，见「04 命令行」第六节和「05 接口」第四节。
// 规则的报错在 rules.ts，阶段的写法不对用 model 的 parseCopy.roundLabel。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const round = "第 2 版的检查阶段";
const file = "skill/SKILL.md";

export const pagesCopy = {
  round: {
    /** 按阶段的写法找不到这个阶段。 */
    notFound: {
      message: copy("项目「{project}」没有{round}。", { project: "app", round }),
      hint: copy("运行 ploop status，查看现在开着的是哪个阶段。"),
    },
    /** 这个阶段已经收尾，不能再给出信息。 */
    closed: {
      message: copy("{round}已经收尾了，不能再给出信息。", { round }),
      hint: copy("运行 ploop round start 开始新的阶段，再给出信息。"),
    },
  },
  page: {
    /** 按编号找不到页面。页面的编号是全局的整数，见约定 0001 第 4 条。 */
    notFound: {
      message: copy("没有编号为 {page} 的页面。", { page: 12 }),
      hint: copy("运行 ploop status，查看在等的是哪一页。"),
    },
    /** 页面在，但不属于请求里的项目。 */
    otherProject: {
      message: copy("项目「{project}」里没有编号为 {page} 的页面。", { project: "app", page: 12 }),
      hint: copy("运行 ploop status，查看这个项目在等的是哪一页。"),
    },
  },
  /** 给出信息的请求本身不对。原文和截图由命令行读出，AI 写的页面数据没有问题。 */
  present: {
    excerptLines: {
      message: copy("原文 {file} 的行号 {lines} 写法不对。", { file, lines: "12-20" }),
      hint: copy("行号写成 12-20，只摘一行写 12。"),
    },
    excerptHash: {
      message: copy("原文 {file} 的哈希不是六十四位小写十六进制。", { file }),
      hint: copy("按文件的内容算 SHA-256，写成六十四位小写十六进制。"),
    },
    excerptCount: {
      message: copy("原文 {file} 第 {lines} 行应有 {expected} 行，交来的有 {actual} 行。", {
        file,
        lines: "12-20",
        expected: 9,
        actual: 7,
      }),
      hint: copy("按起止行读出原文，行与行之间用换行连接。文件没有这么多行时，改来源里的 lines。"),
    },
    excerptTwice: {
      message: copy("原文 {file} 第 {lines} 行交了两份不同的内容。", { file, lines: "12-20" }),
      hint: copy("同一段原文只交一份。"),
    },
    excerptMissing: {
      message: copy("来源「{name}」摘的 {file} 第 {lines} 行没有交来原文。", {
        name: "规矩的说明",
        file,
        lines: "12-20",
      }),
      hint: copy("用 ploop page present 给出，命令会读出来源写到的原文，一起交给后端。"),
    },
    imageTwice: {
      message: copy("截图 {path} 交了两个不同的哈希。", { path: "img/before.png" }),
      hint: copy("每个截图的路径只交一个哈希。"),
    },
  },
  withdraw: {
    reasonBlank: {
      message: copy("撤回的原因是空的。"),
      hint: copy("写一句为什么撤回，或者不写原因。"),
    },
    withdrawn: {
      message: copy("{page}已经撤回了。", { page: "第 2 版的检查阶段的第 2 页" }),
      hint: copy("运行 ploop status，查看现在在等的是哪一页。"),
    },
    replied: {
      message: copy("用户已经回复了{page}，不能再撤回。", { page: "第 2 版的检查阶段的第 2 页" }),
      hint: copy("运行 ploop reply show 查看这份回复，逐行处理。"),
    },
  },
  /** 后端填进页面的文字，见 core/pages/fill.ts。 */
  fill: {
    /** 落地阶段还没收尾时，先失败后通过的那件改动当作这个阶段做完的证据。 */
    landed: copy("{change}，提交 {commit}", { change: "看板放到首页", commit: "2222222" }),
  },
};
