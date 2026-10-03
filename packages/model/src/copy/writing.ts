import { copy } from "./define.ts";

// 写作校验的报错，见「07 校验」第五节。文字照录旧脚本 writing.py、check-reply.py，
// 以及 build-report.py 的措辞提醒，和旧脚本对照时逐字相同，所以末尾都不带句号。
// 措辞提醒去掉了开头的「提醒：」和页面上的位置，位置由调用的地方写。
// 措辞五项末尾的「是引用就留着，是写错了就改」单独成「怎么改」，和报错句子合起来仍和旧脚本逐字相同。
// 新写的只有 term.quoted 一条，对应第五节「停用的说法出现在引号里只警告」。

/**
 * 写作校验报错后面的「怎么改」。只有停用的说法一条要单独写：报错句子里已经写了改法的几条不需要。
 * 报错里的「统一的术语」和原句的语境不一定合得上，所以说明可以换一种说法，见审查报告 P25。
 */
export const writingHintCopy = {
  /** 首行写了 v2-落地-1 这样的内部编号，见决定 211。 */
  firstLine: copy("阶段不写 v2-落地-1 这样的编号，写「第 2 版的落地阶段」，再写一句原因"),
  fileName: copy("把文件名换成它的内容，例如「主线」「计划」"),
  banned: copy("改成术语表里的说法「{replacement}」，或者换一种说法。引号里的原话不用改", {
    replacement: "走查脚本",
  }),
  /** 措辞一类的五项都只警告：命中的是引用就留着，是写错了才改。 */
  wording: copy("是引用就留着，是写错了就改"),
};

/** 写作校验的报错。键加上前缀 writing 就是规矩的编号，例如 writing.term.banned。 */
export const writingCopy = {
  term: {
    banned: copy("出现了术语表停用的说法「{phrase}」，统一的术语是「{replacement}」", {
      phrase: "替人用的脚本",
      replacement: "走查脚本",
    }),
    quoted: copy(
      "引号里出现了术语表停用的说法「{phrase}」，统一的术语是「{replacement}」。如果是照录的原话，可以保留",
      { phrase: "收起来", replacement: "折叠" },
    ),
    soft: copy("出现了「{phrase}」。如果指的是术语表里的那个意思，统一写「{replacement}」", {
      phrase: "整理",
      replacement: "重构",
    }),
  },
  sentence: {
    tooLong: copy("这一句超过六十字，拆成两句：「{head}……」", {
      head: "这次新增一个写作校验模块，构建校验和回复",
    }),
    long: copy("这一句超过四十字，考虑拆开：「{head}……」", {
      head: "这次把 Electron 的 Brows",
    }),
    semicolons: copy("这一句里有两个以上的分号，它是一张清单，改成列表：「{head}……」", {
      head: "这次改了正文、脚本和模板；另外补了参考文",
    }),
  },
  paren: {
    list: copy("括号里嵌了一张清单，改成引导语加列表：「（{head}……）」", {
      head: "首页、项目页、队列看板、设计规范",
    }),
    items: copy("括号里有三项以上的并列，内容再多就改成列表：「（{head}……）」", {
      head: "构思、使用、检查",
    }),
  },
  demonstrative: {
    dense: copy("指示词太密（这一、那一、这个、那些……）。写出事物的名称，不用指示词代替"),
  },
  wording: {
    redBlue: copy("出现「{hit}」。不写红方、蓝方，候选就叫候选", { hit: "红方" }),
    interpunct: copy("出现「{hit}」。不用间隔号", { hit: "·" }),
    spoken: copy("出现「{hit}」。用书面语，不用口头说法", { hit: "接着跑" }),
    numberRef: copy("出现「{hit}」。不拿编号指代东西，第一次出现写它的名字", { hit: "场景 3" }),
    statistics: copy("出现「{hit}」。不对用户报统计数字", { hit: "7 处" }),
  },
  /** 会话回复的自查另外查的四项。 */
  reply: {
    firstLine: copy("首行要写当前的阶段和一句原因，例如「第 2 版的落地阶段：……」"),
    fileName: copy("出现了文件名「{name}」。会话里说事情本身，不说它写在哪个文件里", {
      name: "计划.md",
    }),
    interpunct: copy("用了「·」。并列的东西用顿号，或者分成几行"),
    linkLast: copy("链接后面还有字。网页的链接放在最后"),
  },
};
