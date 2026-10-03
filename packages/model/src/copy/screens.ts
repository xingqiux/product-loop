import { copy } from "./define.ts";

// 元素清单的两条规则的报错，见第一期计划第 27 步和「07 校验」第四节。
// 键加上前缀 screens 就是规矩的编号，例如 screens.where。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

export const screensCopy = {
  present: {
    message: copy("检查阶段的页面没有元素清单。"),
    hint: copy(
      "逐屏写一份元素清单，放进 screens。每一屏写 name、where 和 elements，elements 每行写 what 和 answers。",
    ),
  },
  where: {
    message: copy("元素清单的「{name}」没有写 where。", { name: "报告网页：疑问块" }),
    hint: copy("where 写这一屏是哪个场景的第几步：scene 写场景编号，step 写步号。"),
  },
};
