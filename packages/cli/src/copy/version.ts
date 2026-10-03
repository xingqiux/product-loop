import { copy } from "@product-loop/model";

// ploop version show|next 的文案，见「04 命令行」第二节和「08 版本与迁移」第二节。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const versionCopy = {
  help: {
    description: copy("产品的版本"),
    show: {
      description: copy("查看当前的一版"),
      details: { what: copy("写什么时候开始，这一版有哪几个阶段。") },
      examples: { plain: copy("ploop version show") },
      after: copy("ploop round show <阶段>"),
    },
    next: {
      description: copy("提前结束这一版"),
      details: {
        what: copy("结束当前的一版，开始下一版，例如跳过提升。"),
        reason: copy("原因必填。"),
      },
      reason: copy("提前结束的原因，例如「跳过提升，先做下一版」"),
      blocks: {
        open: {
          situation: copy("还有一个阶段没收尾"),
          fix: copy("先运行 ploop round close"),
        },
        blank: { situation: copy("原因只写了空白"), fix: copy("写上具体的原因") },
      },
      examples: { plain: copy('ploop version next --reason "跳过提升，先做下一版"') },
      after: copy("ploop round start 构思"),
    },
    reads: copy("项目缓存的 project.json、主线.md，集中存储的版本和阶段"),
    writes: copy("集中存储的版本"),
    writesNone: copy("不写"),
  },
  output: {
    head: copy("第 {version} 版：{status}，{time} 开始", {
      version: 2,
      status: "进行中",
      time: "2026-09-28 16:05",
    }),
    ended: copy("结束：{time}", { time: "2026-09-30 10:00" }),
    endReason: copy("结束的原因：{reason}", { reason: "跳过提升，先做下一版" }),
    roundsHead: copy("这一版的阶段："),
    roundsNone: copy("这一版还没有阶段。"),
    roundRow: copy("  {round}  {status}", { round: "第 2 版的构思阶段", status: "已收尾" }),
    next: copy("进入了第 {started} 版，第 {ended} 版已结束。", { started: 3, ended: 2 }),
  },
};
