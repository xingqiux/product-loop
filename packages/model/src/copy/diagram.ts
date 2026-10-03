import { copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 图表的规则报的问题，见「07 校验」第四节。规则在 rules/diagram.ts，键和规则的编号相同。
// 种类、标题和文字定义由数据定义查，报错在 page.ts 的 field 里。

export const diagramCopy = {
  edge: {
    relation: {
      message: copy(
        "架构图「{title}」第 {row} 行的第 {order} 条线没有写明关系。这一行是「{text}」。",
        {
          title: "后端和两个客户端",
          row: 2,
          order: 1,
          text: "cli[命令行] --> backend[后端]",
        },
      ),
      hint: copy("每条线写明是什么关系，例如 A-- 调用 -->B，或者 A-->|调用|B。"),
    },
  },
} satisfies Record<string, Record<string, ErrorCopy>>;
