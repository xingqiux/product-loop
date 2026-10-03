import { copy } from "@product-loop/model";

// skill 的问题和写作校验的文案：报错写什么不对、怎么改，下一步写完整的命令，见「04 命令行」第四到六节。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const skillIssuesCopy = {
  notFound: {
    message: copy("没有编号是 {id} 的 skill 问题。", { id: 12 }),
    hint: copy("运行 ploop skill issues 看有哪些问题。"),
  },
  /** 回理解和不改要写说明。 */
  noteMissing: {
    message: copy("把问题 {id} 改成「{status}」要写说明。", { id: 12, status: "已理解" }),
    hint: copy("写上你对这个问题的理解，或不改的理由。"),
  },
  /** 改了要写在哪一版改的。 */
  fixedInMissing: {
    message: copy("把问题 {id} 改成「已改」要写在哪一版改的。", { id: 12 }),
    hint: copy("写上 skill 的版本，例如 2.1.0。"),
  },
  /** 新报上来的问题不能再改回「新」。 */
  backToNew: {
    message: copy("问题 {id} 已经处理过，不能改回「新」。", { id: 12 }),
    hint: copy("写已理解、已确认、已改或不改之一。"),
  },
  next: {
    issues: copy("ploop skill issues"),
  },
};

export const lintCopy = {
  /** 规矩 writing.reply.round：回复的首行以当前的阶段开头，写成「第 2 版的检查阶段」，见决定 211。 */
  round: {
    message: copy("回复的首行没有以当前的阶段「{round}」开头。", { round: "第 2 版的检查阶段" }),
    hint: copy("首行写成「{round}：」加一句原因。", { round: "第 2 版的检查阶段" }),
  },
};
