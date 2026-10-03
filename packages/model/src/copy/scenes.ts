import { copy } from "./define.ts";

// 场景清单的两条规则的报错，见第一期计划第 27 步和「07 校验」第四节。
// 键加上前缀 scenes 就是规矩的编号，例如 scenes.name.number。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

export const scenesCopy = {
  name: {
    number: {
      message: copy("场景清单里的「{name}」把编号写进了名字。", { name: "S1 看所有项目停在哪" }),
      hint: copy(
        "编号写进 scene，名字里只写场景叫什么。新场景还没有编号时不写 scene，由命令收进主线时补上。",
      ),
    },
  },
  pasted: {
    message: copy("{section}「{title}」的文字里整段写了场景清单。", {
      section: "疑问",
      title: "场景清单草稿：请直接删改",
    }),
    hint: copy("场景清单写进构思页的 scenes，一个场景写一项。卡里只留要问的那一件事。"),
  },
};
