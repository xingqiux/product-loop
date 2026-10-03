import type { WritingRule } from "../writing/rules.ts";
import type { RuleSamples } from "./rule.ts";
import type { WritingContext, WritingSubject } from "./writing.ts";

// 写作规则的样本，见「07 校验」第六节。每条一份合格的写法作基础数据，再写会命中的写法。
// 句子的截取和旧脚本逐字对照的用例在 writing/ 的测试里，这里只写每条规则最典型的一处。

const text = (value: string): WritingSubject => ({ kind: "text", text: value });
const reply = (value: string): WritingSubject => ({ kind: "reply", text: value });

/** 主线没有写作规范一节。 */
const context: WritingContext = { writingSpec: { banned: [], exceptions: [] } };

type Samples = RuleSamples<WritingSubject, WritingContext>;

const replyHead = "第 2 版的落地阶段：接着做。\n";

/** 超过四十字、不到六十字的一句。 */
const longSentence =
  "这次新增一个写作校验模块，构建校验和回复自查脚本都调用它，所以页面和回复执行的是同一套规则。";
/** 超过六十字的一句。 */
const tooLongSentence =
  "这次新增一个写作校验模块，构建校验和回复自查脚本都调用它，页面和回复因此执行的是同一套规则，不再各查各的，也不会出现两边的判定不一致的情况。";
const sentenceHead = "这次新增一个写作校验模块，构建校验和回复";

export const writingSamples = {
  "writing.term.banned": {
    base: { subject: text("走查脚本走完了全部场景。"), context },
    hits: [
      {
        why: "引号外面写了停用的说法",
        subject: text("替人用的脚本走完了全部场景。"),
        expect: [{ params: { phrase: "替人用的脚本", replacement: "走查脚本" } }],
      },
      {
        why: "会话回复里写了停用的说法",
        subject: reply(`${replyHead}替人用的脚本走完了全部场景。`),
        expect: [{ params: { phrase: "替人用的脚本", replacement: "走查脚本" } }],
      },
      {
        why: "写了项目主线停用的说法",
        subject: text("看板上写了负责人。"),
        context: {
          writingSpec: { banned: [{ phrase: "看板", replacement: "队列" }], exceptions: [] },
        },
        expect: [{ params: { phrase: "看板", replacement: "队列" } }],
      },
    ],
  },
  "writing.term.quoted": {
    base: { subject: text("他说「折叠」不好用。"), context },
    hits: [
      {
        why: "停用的说法只出现在引号里",
        subject: text("他说「收起来」不好用。"),
        expect: [{ params: { phrase: "收起来", replacement: "折叠" } }],
      },
    ],
  },
  "writing.term.soft": {
    base: { subject: text("重构做完了。"), context },
    hits: [
      {
        why: "写了语境相关的旧说法",
        subject: text("整理做完了。"),
        expect: [{ params: { phrase: "整理", replacement: "重构" } }],
      },
    ],
  },
  "writing.sentence.tooLong": {
    base: { subject: text(longSentence), context },
    hits: [
      {
        why: "一句超过六十字",
        subject: text(tooLongSentence),
        expect: [{ params: { head: sentenceHead } }],
      },
    ],
  },
  "writing.sentence.long": {
    base: {
      subject: text("写作校验模块由构建校验和回复自查共用，页面和回复执行同一套规则。"),
      context,
    },
    hits: [
      {
        why: "一句超过四十字",
        subject: text(longSentence),
        expect: [{ params: { head: sentenceHead } }],
      },
    ],
  },
  "writing.sentence.semicolons": {
    base: { subject: text("改了正文和脚本；模板没有改。"), context },
    hits: [
      {
        why: "一句里有三个分号",
        subject: text("改了正文；改了脚本；改了模板。"),
        expect: [{ params: { head: "改了正文；改了脚本；改了模板。" } }],
      },
      {
        why: "会话回复的一句里有三个分号",
        subject: reply(`${replyHead}改了正文；改了脚本；改了模板。`),
        expect: [{ params: { head: "改了正文；改了脚本；改了模板。" } }],
      },
    ],
  },
  "writing.paren.list": {
    base: { subject: text("页面上有几块，见下面的列表。"), context },
    hits: [
      {
        why: "括号里嵌了超过三十字的清单",
        subject: text(
          "页面上有几块（首页的项目列表、项目页的队列看板、设计规范的样张墙、场景清单的格子）。",
        ),
        expect: [{ params: { head: "首页的项目列表、项目页的队列看板" } }],
      },
    ],
  },
  "writing.paren.items": {
    base: { subject: text("页面上有四块（先对齐、场景清单和设计规范）。"), context },
    hits: [
      {
        why: "括号里有三项并列",
        subject: text("页面上有四块（先对齐、场景清单、设计规范）。"),
        expect: [{ params: { head: "先对齐、场景清单、设计规范" } }],
      },
    ],
  },
  "writing.demonstrative.dense": {
    base: { subject: text("页面、区块和卡片都要写名称。"), context },
    hits: [
      {
        why: "一句里有四个指示词",
        subject: text("这个、那个、这些、那些都要写名称。"),
        expect: [{ params: {} }],
      },
    ],
  },
  "writing.wording.redBlue": {
    base: { subject: text("候选的方案更好。"), context },
    hits: [
      { why: "写了红方", subject: text("红方的方案更好。"), expect: [{ params: { hit: "红方" } }] },
    ],
  },
  "writing.wording.interpunct": {
    base: { subject: text("状态和字段都定了。"), context },
    hits: [
      { why: "用了间隔号", subject: text("状态·字段都定了。"), expect: [{ params: { hit: "·" } }] },
    ],
  },
  "writing.wording.spoken": {
    base: { subject: text("再跑一遍使用代码。"), context },
    hits: [
      {
        why: "写了口头说法",
        subject: text("接着跑一遍使用代码。"),
        expect: [{ params: { hit: "接着跑" } }],
      },
    ],
  },
  "writing.wording.numberRef": {
    base: { subject: text("会话中途接手这个场景改了。"), context },
    hits: [
      {
        why: "拿编号指代场景",
        subject: text("场景 3 改了。"),
        expect: [{ params: { hit: "场景 3" } }],
      },
    ],
  },
  "writing.wording.statistics": {
    base: { subject: text("改完的页面见改前改后的截图。"), context },
    hits: [
      { why: "报了统计数字", subject: text("改了 7 处。"), expect: [{ params: { hit: "7 处" } }] },
    ],
  },
  "writing.reply.firstLine": {
    base: { subject: reply(`${replyHead}计划已经写好。`), context },
    hits: [
      {
        why: "首行没写阶段",
        subject: reply("接着做。\n计划已经写好。"),
        expect: [{ params: {} }],
      },
    ],
  },
  "writing.reply.fileName": {
    base: { subject: reply(`${replyHead}计划已经写好。`), context },
    hits: [
      {
        why: "写了文件名",
        subject: reply(`${replyHead}计划写在 计划.md 里。`),
        expect: [{ params: { name: "计划.md" } }],
      },
    ],
  },
  "writing.reply.interpunct": {
    base: { subject: reply(`${replyHead}状态、字段、文案都定了。`), context },
    hits: [
      {
        why: "并列的东西用了间隔号",
        subject: reply(`${replyHead}状态 · 字段 · 文案都定了。`),
        expect: [{ params: {} }],
      },
    ],
  },
  "writing.reply.linkLast": {
    base: { subject: reply(`${replyHead}另外还有一件事。\nhttps://example.com/a`), context },
    hits: [
      {
        why: "链接后面还有字",
        subject: reply(`${replyHead}https://example.com/a\n另外还有一件事。`),
        expect: [{ params: {} }],
      },
    ],
  },
} satisfies Record<WritingRule, Samples>;
