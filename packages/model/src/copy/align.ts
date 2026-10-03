import { copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 先对齐的规则报的问题，见「07 校验」第四节。规则在 rules/align.ts，键和规则的编号相同。
// 四项齐全由数据定义查，报错在 page.ts 的 field 里。

export const alignCopy = {
  usedIn: {
    matched: {
      message: copy(
        "先对齐的术语「{name}」，usedIn 写的「{title}」不是本页任何一张疑问卡的标题。",
        { name: "信息结构", title: "看板放在哪里" },
      ),
      hint: copy("usedIn 只写本页疑问卡的标题，照卡上的 title 原样写。"),
    },
  },
  name: {
    unique: {
      message: copy("先对齐里前面已经有一项叫「{name}」。", { name: "信息结构" }),
      hint: copy("一个术语只对齐一次。把重复的两项合成一项，usedIn 合在一起。"),
    },
  },
} satisfies Record<string, Record<string, ErrorCopy>>;
