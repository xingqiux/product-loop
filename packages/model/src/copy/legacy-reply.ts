import type { LegacyReplyProblemKind } from "../legacy/reply-text.ts";
import { copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 旧模板复制出的回复文字对不上这一页时的报错，见 legacy/reply-text.ts。
// 报错写什么不对、怎么改，在第几行写在 where 里。行号是回复文字里的行号，从 1 数。

/** 回复文字的问题，键是 parseLegacyReply 返回的问题种类。 */
const problem = {
  headerMissing: {
    message: copy("回复的第一行没有写是第几版的哪个阶段。"),
    hint: copy("第一行写「{expected}」，和这一页所在的阶段相同。", {
      expected: "第 2 版的检查阶段",
    }),
  },
  headerMismatch: {
    message: copy("回复写的是「{written}」，这一页是「{expected}」。", {
      written: "第 2 版的检查阶段",
      expected: "第 2 版的检查阶段（第 2 次）",
    }),
    hint: copy("先确认贴的是这一页的回复。是的话，第一行改成「{expected}」。", {
      expected: "第 2 版的检查阶段（第 2 次）",
    }),
  },
  lineUnknown: {
    message: copy("这一行认不出来：「{text}」。", { text: "好的，就按这个做" }),
    hint: copy("每行开头写：{starts}。", {
      starts: "场景、规范、对齐、队列、疑问、发现、提升、回到构思、想法、图",
    }),
  },
  verdictUnknown: {
    message: copy("「{block} {verdict}」认不出来。", { block: "场景", verdict: "留" }),
    hint: copy("{block}后面写{verdicts}，再加冒号。", {
      block: "场景",
      verdicts: "保留、修改或删除",
    }),
  },
  cardItemUnknown: {
    message: copy("{block}这一行有一段认不出来：「{text}」。", {
      block: "提升",
      text: "，现在进入构思",
    }),
    hint: copy("每一项写卡的序号，后面跟选项或备注，例如「2a」「3（备注）」。项与项之间空两格。"),
  },
  nameItemUnknown: {
    message: copy("{block}这一行有一段认不出来：「{text}」。", { block: "场景", text: "看队列" }),
    hint: copy("每一项的名字写在「」里，修改的在后面加上怎么改。项与项之间空两格。"),
  },
  blockEmpty: {
    message: copy("这一页没有{block}的卡，回复里却有{block} {n}。", { block: "发现", n: 2 }),
    hint: copy("先确认贴的是这一页的回复，再删掉这一项。"),
  },
  cardNumber: {
    message: copy("{block}只有 {count} 张卡，回复里写的是{block} {n}。", {
      block: "疑问",
      count: 3,
      n: 5,
    }),
    hint: copy("{block}的序号是 1 到 {count}，按页面上的顺序数。", { block: "疑问", count: 3 }),
  },
  optionUnknown: {
    message: copy("{block} {n} 没有选项 {option}，只有 {options}。", {
      block: "疑问",
      n: 2,
      option: "d",
      options: "a、b、c",
    }),
    hint: copy("改成页面上这张卡有的选项。"),
  },
  optionNone: {
    message: copy("{block} {n} 只有备注框，没有选项 {option}。", {
      block: "疑问",
      n: 2,
      option: "a",
    }),
    hint: copy("这张卡只写备注，例如「{block} {n}（备注）」。", { block: "疑问", n: 2 }),
  },
  onlyWord: {
    message: copy("{block} {n} 不是只有一个方向的卡，不能写「{word}」。", {
      block: "疑问",
      n: 2,
      word: "否决",
    }),
    hint: copy("「同意」和「否决」只用在只有一个方向的卡上。这张卡写选项的字母。"),
  },
  itemEmpty: {
    message: copy("{block} {n} 后面既没有选项，也没有备注。", { block: "疑问", n: 3 }),
    hint: copy("写上选的选项或备注，或者删掉这一项。"),
  },
  nameUnknown: {
    message: copy("这一页的{section}里没有「{name}」。", { section: "场景清单", name: "看队列" }),
    hint: copy("名字要和页面上的一字不差。"),
  },
  queueUnknown: {
    message: copy("看板上没有「{text}」。", { text: "Q12 队列看板的等待列" }),
    hint: copy("照看板上的文字写，开头的编号不能改。"),
  },
  cardDuplicate: {
    message: copy("{block} {n} 回复了两次，第一次在第 {first} 行。", {
      block: "疑问",
      n: 2,
      first: 2,
    }),
    hint: copy("一张卡只回复一次，删掉多出的一次。"),
  },
  nameDuplicate: {
    message: copy("{block}「{name}」回复了两次，第一次在第 {first} 行。", {
      block: "场景",
      name: "看队列",
      first: 2,
    }),
    hint: copy("每一项只回复一次，删掉多出的一次。"),
  },
  noteUnclosed: {
    message: copy("备注的括号没有配对：「{text}」。", { text: "2（先不改" }),
    hint: copy("备注写在一对全角括号里。右括号后面空两格接下一项，或者换行。"),
  },
  ideaEmpty: {
    message: copy("「想法：」后面是空的。"),
    hint: copy("写上想法，或者删掉这一行。"),
  },
  imageUnknown: {
    message: copy("〔图 {n}〕在最后一行「图：」里没有标识。", { n: 2 }),
    hint: copy("在最后一行补上图 {n} 的标识，或者删掉〔图 {n}〕。", { n: 2 }),
  },
  imageLine: {
    message: copy("最后一行「图：」的写法不对：「{text}」。", { text: "图：图1 c232f3" }),
    hint: copy("写成「图：图 1=c232f3  图 2=d2c5e2」。序号不重复，图与图之间空两格。"),
  },
} satisfies Record<LegacyReplyProblemKind, ErrorCopy>;

export const legacyReplyCopy = {
  problem,
  /** 问题在回复文字的第几行。 */
  where: copy("回复文字第 {line} 行", { line: 3 }),
  /** 回复文字存成了文件时，写文件和行号，例如 ploop reply ingest 读的文件。 */
  fileWhere: copy("{file} 第 {line} 行", { file: "rounds/v2-检查-3/reply.txt", line: 3 }),
};
