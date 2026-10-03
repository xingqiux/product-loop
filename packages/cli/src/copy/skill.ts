import { copy } from "@product-loop/model";

// ploop skill report|issues 的文案，见「04 命令行」第十一节。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const skillCopy = {
  help: {
    description: copy("报 skill 的问题，维护者处理"),
    report: {
      description: copy("报一个 skill 的问题"),
      details: { auto: copy("命令自动带上项目、阶段和 skill 的版本。") },
      aspect: copy("哪个方面，例如页面、命令、正文"),
      issueClass: copy("问题的类：一句话写这一类问题是什么"),
      example: copy("原始情况，作为例子附上"),
      reads: copy("项目缓存的 project.json"),
      writes: copy("集中存储的 skill 问题"),
      examples: {
        plain: copy('ploop skill report --aspect 页面 --class "选项卡太长" --example "a 写了九行"'),
      },
      after: copy("告诉用户问题的编号"),
    },
    issues: {
      description: copy("维护者用：列出 skill 问题"),
      details: { what: copy("每条写哪个项目、哪个阶段。") },
      status: copy("只列这个状态的：新、已理解、已确认、已改、不改"),
      reads: copy("集中存储的 skill 问题"),
      writes: copy("不写"),
      examples: {
        plain: copy("ploop skill issues"),
        fresh: copy("ploop skill issues --status 新"),
      },
      after: copy("ploop skill issues reply <编号> <理解>"),
    },
    reply: {
      description: copy("维护者用：回复对问题的理解"),
      details: {
        what: copy("状态改成已理解。"),
        gate: copy("只在产品循环自己的项目里能用。"),
      },
      id: copy("问题的编号"),
      note: copy("对这个问题的理解"),
      reads: copy("集中存储的 skill 问题"),
      writes: copy("集中存储的 skill 问题"),
      examples: { plain: copy('ploop skill issues reply 12 "选项卡要限定行数"') },
      after: copy("ploop skill issues"),
    },
    set: {
      description: copy("维护者用：改问题的状态"),
      details: {
        what: copy("改成已确认、已改或不改，也可以改回已理解。"),
        gate: copy("只在产品循环自己的项目里能用。"),
      },
      id: copy("问题的编号"),
      status: copy("要改成的状态：已理解、已确认、已改、不改"),
      note: copy("说明：改成已理解或不改时必填"),
      fixedIn: copy("在 skill 的哪个版本改的：改成已改时必填，例如 0.0.2"),
      reads: copy("集中存储的 skill 问题"),
      writes: copy("集中存储的 skill 问题"),
      examples: {
        fixed: copy("ploop skill issues set 12 已改 --fixed-in 0.0.2"),
        wontFix: copy('ploop skill issues set 12 不改 --note "这一类不常见，先不动"'),
      },
      after: copy("ploop skill issues"),
    },
  },
  output: {
    reported: copy("报上了：问题 {id}", { id: 12 }),
    /** 报问题的一方接下来只要把编号告诉用户，由维护 skill 的人处理。 */
    tell: copy("把问题 {id} 的编号告诉用户，由维护 skill 的人处理。", { id: 12 }),
    detail: copy("{aspect}：{issueClass}", { aspect: "页面", issueClass: "选项卡太长" }),
    context: copy("项目 {project}，{round}，skill 版本 {version}", {
      project: "app",
      round: "第 2 版的检查阶段",
      version: "0.0.1",
    }),
    unknown: copy("没有记下"),
    listed: copy("skill 的问题：{count} 条", { count: 3 }),
    none: copy("还没有报上来的 skill 问题"),
    row: copy("  {id}  {status}  {project}  {round}  {aspect}：{issueClass}", {
      id: 12,
      status: "新",
      project: "app",
      round: "第 2 版的检查阶段",
      aspect: "页面",
      issueClass: "选项卡太长",
    }),
    example: copy("      例子：{example}", { example: "a 写了九行" }),
    note: copy("      说明：{note}", { note: "选项卡要限定行数" }),
    replied: copy("回了理解：问题 {id}", { id: 12 }),
    moved: copy("改了状态：问题 {id} 现在是「{status}」", { id: 12, status: "已改" }),
  },
  errors: {
    idInvalid: copy("写成正整数，例如 12。"),
    /** 处理问题只在产品循环自己的项目里放行，别的项目里的 AI 只能报问题。 */
    maintainerOnly: {
      message: copy("只有维护者能处理 skill 的问题。"),
      hint: copy("在项目 {project} 里运行；别的项目只能用 ploop skill report 报问题。", {
        project: "product-loop",
      }),
    },
  },
};
