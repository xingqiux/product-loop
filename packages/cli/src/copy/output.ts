import { type CopyEntry, copy, type ErrorCode } from "@product-loop/model";

// 输出的文案，写法见「04 命令行」第五节和第六节。暂时放在命令行里，以后并进共用定义的文案表。

/** 文字输出里固定的几样。 */
export const outputCopy = {
  /** 最后一段的开头，下面逐条列出下一步。 */
  next: copy("下一步："),
  /** 警告另起一段，写到标准错误。 */
  warning: copy("警告：{message}", { message: "主线缺两个部分：给谁用、风险。" }),
  /** 报错和警告的第一行以后，依次写在哪里、怎么改、规矩的编号。 */
  where: copy("位置：{where}", { where: "rounds/v2-构思-1/page.json → asks[0].sources[1]" }),
  hint: copy("怎么改：{hint}", { hint: "先运行 ploop round close。" }),
  rule: copy("规矩：{rule}", { rule: "card.source.visual" }),
  /** 几条问题只差名字或位置时合成一条，列得太多时列前几个，再写总数。 */
  moreNames: copy("等 {count} 处", { count: 9 }),
};

/**
 * 报错的第一行，按错误码写开头。拦截照「04 命令行」第六节写，其余几种沿用第七节退出码表的说法。
 * 错误码全大写，Biome 的命名规则不收这样的对象键，所以写成数组，顺序和「05 接口」第九节相同。
 */
export const errorLineCopy = [
  {
    code: "RULE_BLOCKED",
    line: copy("拦截：{message}", {
      message: "疑问「主线里缺的部分」的来源「报告网页现在的样子」没有图。",
    }),
  },
  {
    code: "BAD_REQUEST",
    line: copy("用法错误：{message}", { message: "ploop round start 缺少参数 <阶段名>。" }),
  },
  {
    code: "CONFLICT",
    line: copy("冲突：{message}", { message: "另一个阶段（第 2 版的检查阶段）还开着。" }),
  },
  {
    code: "NOT_FOUND",
    line: copy("找不到：{message}", { message: "没有这个阶段：第 2 版的检查阶段（第 9 次）。" }),
  },
  {
    code: "BUSY",
    line: copy("后端正忙：{message}", { message: "后端正在迁移或恢复数据，暂时不能写入。" }),
  },
  {
    code: "NEEDS_DOCTOR",
    line: copy("要先做迁移检查：{message}", { message: "项目停在旧版本的 skill。" }),
  },
  { code: "PAGE_GONE", line: copy("页已不在：{message}", { message: "在等的那一页已撤回。" }) },
  {
    code: "CLIENT_TOO_OLD",
    line: copy("版本过低：{message}", { message: "命令行的版本低于后端要求的最低版本。" }),
  },
  { code: "INTERNAL", line: copy("后端出错：{message}", { message: "后端内部出错。" }) },
] as const satisfies readonly { readonly code: ErrorCode; readonly line: CopyEntry }[];
