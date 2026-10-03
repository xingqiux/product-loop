import { copy } from "./define.ts";

// 设计类的卡的三条规则的报错，见第一期计划第 27 步和「07 校验」第四节。
// 键加上前缀 design 就是规矩的编号，例如 design.outside。
// 这三条只在构思查，构思页的卡只有疑问，所以报错里称呼疑问卡。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

/** 样例参数里的那张疑问卡。 */
const ask = { title: "新建设计的入口放在哪里" };

export const designCopy = {
  outside: {
    message: copy("疑问「{title}」是设计类的卡，来源里没有外面的东西。", ask),
    hint: copy(
      "加一条来源，写已有的产品或网上的设计：img 写截图的路径，标 outside: true。saw 写它怎么解决同一个问题。",
    ),
  },
  sketch: {
    message: copy("疑问「{title}」是设计类的卡，选项 {key} 没有草稿。", { ...ask, key: "b" }),
    hint: copy("在这个选项的 sketch 里画出来：用线稿积木，或者放一张草稿图的 img 标签。"),
  },
  spec: {
    message: copy("疑问「{title}」是设计类的卡，这一页却没有设计规范。", ask),
    hint: copy(
      "把这个组件用到的规范写进 spec。已有的照原样写，没有的先补一格，让用户点保留、修改或删除。",
    ),
  },
};
