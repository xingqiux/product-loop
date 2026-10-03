import { copy } from "@product-loop/model";

// 主线的用例的文案：报错写什么不对、怎么改，见「04 命令行」第六节。
// 解析主线查出的问题已在 model 的 mainlineCopy 里，这里只补用例自己的。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const mainlineRevisionsCopy = {
  /** 按修订的编号找不到这次修订。 */
  notFound: {
    message: copy("项目「{project}」的主线没有修订 {revision}。", { project: "app", revision: 3 }),
    hint: copy("运行 ploop mainline history，查看主线的历次修订。"),
  },
  /** 交上来的全文是空的，或者只有空白。 */
  empty: {
    message: copy("交上来的主线是空的。"),
    hint: copy("在项目缓存的主线.md 里写好主线，再重跑这条命令。"),
  },
  /** 基准修订写了，却不是从 1 起的整数。 */
  baseInvalid: {
    message: copy("主线的基准修订要写从 1 起的整数，这里是 {base}。", { base: 0 }),
    hint: copy("写 project.json 里记的主线修订。还没交过主线时不写基准修订。"),
  },
  /** 基准不是最新的一次修订，见「03 数据模型」第五节。三种情况的改法相同。 */
  conflict: {
    stale: copy("交上来的主线以修订 {base} 为基准，集中存储里最新的已经是修订 {latest}。", {
      base: 3,
      latest: 4,
    }),
    noBase: copy("交上来的主线没有写基准修订，集中存储里已经有修订 {latest}。", { latest: 4 }),
    hint: copy(
      "先把修订 {latest} 的内容合进这次的改动，再交一次。运行 ploop mainline show 可以看修订 {latest}。",
      { latest: 4 },
    ),
  },
  /** 写了基准修订，集中存储里却还没有主线。项目缓存和集中存储对不上了。 */
  noMainline: {
    message: copy("交上来的主线以修订 {base} 为基准，集中存储里还没有主线。", { base: 3 }),
    hint: copy("运行 ploop doctor，让项目缓存和集中存储重新对上。"),
  },
  /** 写明的阶段在这个项目里没有。 */
  roundNotFound: {
    message: copy("项目「{project}」没有{round}。", { project: "app", round: "第 2 版的构思阶段" }),
    hint: copy("运行 ploop version show，查看当前这一版有哪几个阶段。"),
  },
};
