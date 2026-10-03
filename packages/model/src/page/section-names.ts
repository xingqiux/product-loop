import { defineEnum, type KeyOf } from "../enum.ts";

/**
 * 页面数据里 AI 写的区块。键是页面数据里的字段名，标签是工作台上的区块名，
 * 顺序是页面上的顺序，见「06 工作台」第四节。元素清单不在页面上显示。
 * 哪个阶段能写哪几个区块，由第 21 步按阶段定。
 */
export const pageSection = defineEnum({
  align: "先对齐",
  scenes: "场景清单",
  spec: "设计规范",
  asks: "疑问",
  findings: "发现问题",
  improvements: "提升",
  changes: "更改",
  refs: "参考",
  screens: "元素清单",
});
export type PageSection = KeyOf<typeof pageSection>;
