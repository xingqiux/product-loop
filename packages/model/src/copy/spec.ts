import { copy } from "./define.ts";

// 设计规范的三条规则的报错，见第一期计划第 27 步和「07 校验」第四节。
// 键加上前缀 spec 就是规矩的编号，例如 spec.text.lines。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

export const specCopy = {
  for: {
    message: copy("设计规范「{name}」没有写 for。", { name: "状态标签" }),
    hint: copy("for 写这一格规范用在哪个组件上，例如「队列看板的小卡」。"),
  },
  text: {
    lines: {
      message: copy("设计规范「{name}」的文字有 {lines} 行，超过三行。", {
        name: "字段名",
        lines: 4,
      }),
      hint: copy(
        "并列的几条改写成表格：kind 写「表格」，columns 写这一类规范的列，rows 一行写一条。文字只写一条规则或一个例子。",
      ),
    },
  },
  pasted: {
    message: copy("{section}「{title}」的文字里整段写了设计规范。", {
      section: "疑问",
      title: "设计规范其余各项：请直接删改",
    }),
    hint: copy("设计规范写进构思页的 spec，每一格写一样规范。卡里只留要问的那一件事。"),
  },
};
