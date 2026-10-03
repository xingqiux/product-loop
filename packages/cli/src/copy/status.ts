import { copy } from "@product-loop/model";

// ploop status 和不带子命令的 ploop 的文案，见「04 命令行」第二节和 S13、S14。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const statusCopy = {
  help: {
    description: copy("查看当前项目的状态"),
    details: {
      state: copy("写第几版的哪个阶段，哪一页在等，队列剩什么。"),
      next: copy("最后给出下一步做什么，只给一条。"),
    },
    all: copy("列出所有项目，不看当前目录"),
    blocks: {
      none: {
        situation: copy("往上找不到 project.json"),
        fix: copy("到项目根目录运行 ploop init，或者用 --project 指定项目"),
      },
      unregistered: {
        situation: copy("项目缓存还在，集中存储里没有登记这个目录"),
        fix: copy("运行 ploop init 重新登记，项目缓存保留"),
      },
    },
    reads: copy("项目缓存的 project.json、主线.md，集中存储的项目"),
    writes: copy("不写"),
    examples: {
      current: copy("ploop status"),
      all: copy("ploop status --all"),
      byId: copy("ploop status --project sketch-board"),
    },
    after: copy("按输出的「下一步」运行"),
  },
  /** 项目的称呼：名称和编号不同时，编号写在括号里。 */
  project: copy("{name}（{id}）", { name: "Sketch Board", id: "sketch-board" }),
  /** 第一行。 */
  head: copy("项目 {project}：{round}，{status}", {
    project: "app",
    round: "第 2 版的检查阶段",
    status: "等用户回复",
  }),
  /** 这一版还没开始任何阶段。 */
  headNoRound: copy("项目 {project}：第 {version} 版，还没开始任何阶段", {
    project: "app",
    version: 1,
  }),
  headClosed: copy("项目 {project}：第 {version} 版已结束", { project: "app", version: 1 }),
  noRound: copy("还没开始任何阶段"),
  waitingNone: copy("在等的页：没有"),
  /** 只看的页不占「在等」的名额，不等用户回复，见决定 204。 */
  viewing: copy("只看的页：{page}，不等回复", { page: "第 2 版的使用阶段的第 1 页" }),
  waiting: copy("在等的页：{page}，{purpose}", {
    page: "第 2 版的检查阶段的第 2 页",
    purpose: "要用户点",
  }),
  queueNone: copy("队列里没做完的事：没有"),
  queue: copy("队列里没做完的事：{counts}", { counts: "构思 2 件、检查 1 件" }),
  /** 一个阶段收尾以后，队列里这个阶段还有待办的事：先做完它们再往下走。 */
  sameStageFirst: copy("队列里还有 {count} 件{stage}的事，先做完它们，再进下一个阶段。", {
    count: 3,
    stage: "检查",
  }),
  /** 收尾前，进行中的事要各写一个结果：把做完和退回的完整写法都给出来。 */
  closeFirst: {
    ids: copy("进行中的事：{ids}，收尾时各写一个结果。", { ids: "Q12、Q15" }),
    done: copy("做完的运行 ploop round close --done {first}=<证据>。", { first: "Q12" }),
    back: copy("退回的运行 ploop round close --return {back}。", { back: "Q12=<原因>" }),
  },
  /** 回复还有行没处理：收尾和开始下一个阶段都会被拦，先看回复。 */
  unhandled: copy("回复还有行没有处理，先运行 ploop reply show 看，再给每一行定去处。"),
  /** 回复处理完、事都有结果：开始下一个阶段时，这个阶段自动收尾，不用再敲收尾。 */
  autoClose: copy("开始下一个阶段时，会自动给这个阶段收尾。"),
  /** 检查收尾以后落地队列里没有事：不开落地，直接到提升。 */
  skipLand: copy("落地队列里没有待办的事，不用开落地阶段。"),

  /** 下一步是先看主线：进入检查阶段前，设计规范要补齐。 */
  specFirst: copy("进入检查阶段前，要先补齐主线里的设计规范。"),
  /** 提升阶段收尾以后，下一步开始构思时换新的一版，见决定 168 和 205。 */
  newVersionNext: copy("提升阶段已经收尾。开始下一个阶段时，会进入第 {version} 版。", {
    version: 2,
  }),
  /** 新的一版里构思队列没有事：从使用开始，见决定 216。 */
  skipThink: copy("构思队列里没有待办的事，主线也齐全，从使用开始。"),
  queueCount: copy("{stage} {count} 件", { stage: "构思", count: 2 }),
  mainlineComplete: copy("主线：{total} 个部分齐全", { total: 10 }),
  mainlineMissing: copy("主线缺 {count} 个部分", { count: 5 }),
  /** 缺得少时直接写出名字，省一次 ploop mainline check。 */
  mainlineMissingNames: copy("主线缺 {count} 个部分：{names}", {
    count: 2,
    names: "给谁用、交付线",
  }),
  /** 主线缺的几个部分，一个一行，只在 ploop mainline check 和 show 里列。 */
  mainlineList: copy("主线缺 {count} 个部分：", { count: 2 }),
  designList: copy("设计规范缺 {count} 个部分：", { count: 2 }),
  mainlineNames: copy("  {name}", { name: "给谁用" }),
  designComplete: copy("设计规范：{total} 个部分齐全", { total: 12 }),
  designMissing: copy("设计规范缺 {count} 个部分", { count: 2 }),
  /** 设计规范是主线十个部分之一，缺的也算在上一行里：写成「其中」，免得读成缺了两份。 */
  designMissingWithin: copy("其中设计规范缺 {count} 个部分", { count: 2 }),
  newerRules: copy("skill 有这个项目还没用上的新规则。"),
  idle: copy("停了 {days} 天没有改动", { days: 3 }),
  /** --all 的输出。 */
  list: {
    head: copy("列出了 {count} 个项目：", { count: 2 }),
    empty: copy("还没有登记过项目。"),
    init: copy("在项目的根目录运行 ploop init"),
    version: copy("第 {version} 版", { version: 2 }),
    closed: copy("第 {version} 版已结束", { version: 1 }),
    waiting: copy("{count} 页在等", { count: 1 }),
    queue: copy("队列 {count} 件没做完", { count: 3 }),
    idle: copy("停了 {days} 天", { days: 3 }),
  },
};
