import { copy } from "./define.ts";

// 调研分档的三条规则的报错，见第一期计划第 27 步和决定 92。
// 键加上前缀 research 就是规矩的编号，例如 research.tier。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

/** 样例参数里的那张疑问卡。 */
const ask = { title: "队列看板参考哪几家的做法" };

export const researchCopy = {
  tier: {
    message: copy("疑问「{title}」的来源里有外面的东西，却没有写调研是哪一档。", ask),
    hint: copy("写 research，tier 写不查、快查或深查。先定下查多深，再去查。"),
  },
  reason: {
    message: copy("疑问「{title}」的调研写了不查，却没有写 reason。", ask),
    hint: copy("reason 写这一条为什么不用查。"),
  },
  approved: {
    message: copy("疑问「{title}」的调研是深查，却没有写 approved。", ask),
    hint: copy(
      "approved 写问句和检索计划是哪个阶段给用户批的，例如「第 2 版的构思阶段（第 3 次）」。",
    ),
  },
};
