import { copy } from "@product-loop/model";

// 决定的用例的文案：报错写什么不对、怎么改，见「04 命令行」第六节。
// 决定三项必填、作废要写明被哪一条推翻，这两类报错已在 model 的文案表里，这里不重复。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const decisionsCopy = {
  notFound: {
    message: copy("项目「{project}」没有编号是 {id} 的决定。", { project: "app", id: 12 }),
    hint: copy("运行 ploop decision list，查看这个项目有效的决定和编号。"),
  },
  /** ploop decision edit：一项都没写。什么不对用 model 的 decisionCopy.edit.empty。 */
  edit: {
    emptyHint: copy("写上要改的项和新的文字，再重跑。"),
  },
  /** ploop decision void <编号> --by <新编号> 的报错，见「04 命令行」第十节。 */
  void: {
    /** 报错用 model 的 decisionCopy.voidedBySelf。 */
    self: {
      hint: copy("--by 写推翻它的那一条新决定的编号。"),
    },
    alreadyVoided: {
      message: copy("编号是 {id} 的决定已经作废，被第 {by} 条推翻。", { id: 12, by: 25 }),
      hint: copy("不用再作废。要推翻的是第 {by} 条时，作废那一条。", { by: 25 }),
    },
    byNotFound: {
      message: copy("推翻它的决定不存在：项目「{project}」没有编号是 {by} 的决定。", {
        project: "app",
        by: 25,
      }),
      hint: copy("先用 ploop decision add 新增推翻它的那一条，再用新的编号作废。"),
    },
    byVoided: {
      message: copy("编号是 {by} 的决定已经作废，不能用它推翻别的决定。", { by: 25 }),
      hint: copy("--by 写一条有效的决定。运行 ploop decision list，查看有效的决定。"),
    },
  },
  /** 迁移时导入旧决定的报错，见「08 版本与迁移」第五节。位置写成「编号.字段名」。 */
  import: {
    id: copy("编号要写从 1 起的整数，这里是 {id}。", { id: 0 }),
    date: copy("日期「{date}」不是年月日的写法，要写成 2026-09-28 这样。", { date: "9月18日" }),
    duplicate: copy("编号 {id} 用了不止一次，同一个项目里的编号不能重复。", { id: 12 }),
    /** 旧决定写得不对时，改法都是改好旧表再重跑。 */
    hint: copy("按报错改好旧决定表里的这一条，再运行 ploop doctor --fix。"),
  },
};
