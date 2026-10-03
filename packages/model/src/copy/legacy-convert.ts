import { type CopyEntry, copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";
import type { FormatChangeCopy } from "./page.ts";

// 旧页面数据转成新格式时的文字，见 legacy/convert-page.ts 和「08 版本与迁移」第五节。分四种：
// - 转不了的原因，以及转换以后还要改的地方，见 page、stage、queueRow、where 四组。
//   组名和键连起来就是问题里的 check，例如 legacyPage.queueRow.unknown。
// - 转换自己定的几种改法，写法和新旧格式对照表的一条相同：改成什么和依据，见 change。
// - 备注的说法：转换时删掉了什么、挪到了哪里，见 note。
// - 转换时写进页面的几个词，取自旧格式在页面上显示的字，见 value。

export const legacyPageCopy = {
  page: {
    notObject: {
      message: copy("旧页面数据应写成一个对象，写的是{received}。", { received: "数组" }),
      hint: copy("打开这份文件核对。它不是页面数据时，迁移时不收它。"),
    },
  },
  stage: {
    missing: {
      message: copy("旧页面数据没有写 stage，看不出它属于哪个阶段。"),
      hint: copy("在 stage 里写这一页的阶段：构思、使用、检查、落地或提升。"),
    },
    unknown: {
      message: copy("旧页面数据的 stage 写的是「{value}」，不是一个阶段。", { value: "复盘" }),
      hint: copy("改成构思、使用、检查、落地或提升。写「修复」的按落地转换。"),
    },
  },
  queueRow: {
    unknown: {
      message: copy("queueRow「{text}」在队列迁移对照里对不上任何一件事。", {
        text: "首页的卡片改成列表",
      }),
      hint: copy(
        "在队列迁移对照里找到这件事，把它的编号写进这一项的 queue，例如 Q12。确实不在队列里的，不写。",
      ),
    },
    ambiguous: {
      message: copy("queueRow「{text}」同时对上了几件事：{ids}。", {
        text: "首页的卡片改成",
        ids: "Q3、Q4",
      }),
      hint: copy("在这一项的 queue 里只写它处理的那一件事的编号。"),
    },
    shape: {
      message: copy("queueRow 应写成文字或文字的数组，写的是{received}。", { received: "数字" }),
      hint: copy("在这一项的 queue 里写它处理的事的编号，例如 Q12。"),
    },
  },
  where: {
    sceneName: {
      message: copy("场景「{name}」对不上主线里的场景。", { name: "答疑问" }),
      hint: copy(
        "在场景对照里补上这个名字对应的场景编号，或者在 where 的 scene 里直接写编号，例如 S3。",
      ),
    },
    sceneNumber: {
      message: copy("where 只写了场景的序号 {number}，对不上主线里的场景。", { number: 4 }),
      hint: copy("对照当时的主线，在 where 的 scene 里写这个场景的编号，例如 S3。"),
    },
  },
  /** 转换自己定的改法，新旧格式的对照表里没有这几条。键就是备注里的 change。 */
  change: {
    stanceText: {
      note: copy("看法写成了一句话，按旧模板显示它的读法拆成 pick 和 because。"),
      basis: copy("旧模板对这种写法的处理，由第 28 步定"),
    },
    rethinkAsk: {
      note: copy("回到构思的卡转成疑问卡，标签写「回到构思」，原来的标签不留。"),
      basis: copy("第一期约定第 8 条，这种转法要用户确认"),
    },
    sectionAsk: {
      note: copy(
        "这一阶段不能写的发现问题或提升转成疑问卡，标签写原来区块的名字，原来的标签不留。",
      ),
      basis: copy("决定 189"),
    },
    sawSource: {
      note: copy("卡片上的 saw 转成一条来源，名字写「看到」。"),
      basis: copy("「07 校验」第二节。名字取自旧格式对这个字段的叫法，由第 28 步定"),
    },
    seeDiffs: {
      note: copy("选项的 see 转成 rows 里「结果」这一行的差别，和旧模板的显示相同。"),
      basis: copy("「07 校验」第二节。行名取自旧模板，由第 28 步定"),
    },
  },
  /** 备注的说法。原来的值不写进句子，由调用的地方另外列出。 */
  note: {
    dropped: copy("转换时删掉了 {path}。", { path: "findings[0].where.stepText" }),
    moved: copy("{path} 转换以后在 {now}。", { path: "rethink[0]", now: "asks[2]" }),
  },
  /** 转换时写进页面的几个词。 */
  value: {
    /** 回到构思的卡转成疑问卡以后的标签，就是旧页面上这一区块的名字。 */
    rethinkTag: copy("回到构思"),
    /** 选项的 see 在旧模板上显示在这一行下面。 */
    seeRow: copy("结果"),
    /** 卡片的 saw 在旧格式里的叫法，见旧格式 README 第三版。 */
    sawName: copy("看到"),
  },
} satisfies Record<
  string,
  Record<string, ErrorCopy> | Record<string, FormatChangeCopy> | Record<string, CopyEntry>
>;
