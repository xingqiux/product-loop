import { copy } from "./define.ts";

// 页面规则第一批的报错，见第一期计划第 25 步和「07 校验」第四节。
// 查的是卡片的来源、only 和 dropped、行名、看法，以及选项的每一格和选项的长短。
// 标题写成名字的一条 card.title.name 是后加的，见决定 212。它查卡片、选项、更改和图表的标题。
// 键加上前缀 card 就是规矩的编号，例如 card.source.visual。
// message 写什么不对，hint 写怎么改，见「04 命令行」第六节。在哪里由规则给出，不写进文字。

/** 样例参数里的那张卡。 */
const ask = { section: "疑问", title: "队列看板放在哪里" };

/** 页面规则第一批的报错。 */
export const cardRulesCopy = {
  source: {
    visual: {
      message: copy("{section}「{title}」的来源「{name}」没有写 img、file 或 quote。", {
        ...ask,
        name: "报告网页现在的样子",
      }),
      hint: copy(
        "界面的来源写 img，值是截图的路径。文字的来源写 file 和 lines，原文由命令摘录。用户的原话写 quote: true，原话写在 saw 里。",
      ),
    },
  },
  only: {
    one: {
      message: copy("{section}「{title}」写了 only，却有 {count} 个选项。", { ...ask, count: 2 }),
      hint: copy(
        "only 表示只有这一个方向，options 里只放这一个选项。几个方向都站得住时，删掉 only。",
      ),
    },
    dropped: {
      message: copy("{section}「{title}」写了 only，却没有写 dropped。", ask),
      hint: copy("在 dropped 里列出想过、排除掉的方向，每项写 name 和 because。"),
    },
    needed: {
      message: copy("{section}「{title}」只有一个选项，却没有写 only。", ask),
      hint: copy(
        "真的只有这一个方向时，写 only: true，并在 dropped 里列出排除掉的方向和原因。不要为了凑数再写一个选项。",
      ),
    },
  },
  shared: {
    required: {
      message: copy("{section}「{title}」有 {count} 个选项，却没有写 shared。", {
        ...ask,
        count: 3,
      }),
      hint: copy("shared 写几个选项共同的部分，只写一遍。"),
    },
  },
  row: {
    width: {
      message: copy("{section}「{title}」的行名「{row}」有 {width} 个字，超过八个字。", {
        ...ask,
        row: "页面上会出现的变化",
        width: 9,
      }),
      hint: copy(
        "一个汉字算一个字，两个英文字母或数字算一个字。行名是一处差别的名称，写成短语。一个名字说不完，多半是混了两处差别，拆成两行。",
      ),
    },
  },
  title: {
    name: {
      message: copy("{kind}的标题「{title}」不是一个名字。{problem}", {
        kind: "更改",
        title: "队列看板下面横着列出这个阶段做完的事",
        problem: "标题有 19 个字，超过 16 个字。",
      }),
      hint: copy(
        "改成一个名字，例如「看板下方的完成列表」，解释放进正文。名字不超过 16 个字，不带「，。；：」。",
      ),
    },
    /** 拼进报错的 problem：标题太长。 */
    tooLong: copy("标题有 {width} 个字，超过 16 个字。", { width: 19 }),
    /** 拼进报错的 problem：标题里有句子才有的标点。 */
    hasMark: copy("标题里有「{marks}」，是一句话。", { marks: "，" }),
  },
  cell: {
    length: {
      message: copy("{section}「{title}」选项 {key} 有一格差别写了 {length} 个字，超过六十字。", {
        ...ask,
        key: "a",
        length: 80,
      }),
      hint: copy(
        "一格只写这个选项在这一处的做法，最多两行，共同的内容移到 shared。一串英文或数字算一个字，标点和空白不算。",
      ),
    },
  },
  option: {
    why: {
      message: copy("{section}「{title}」选项 {key} 没有写理由 why。", { ...ask, key: "b" }),
      hint: copy("why 写选这个选项的理由。发现和提升的最后一个选项是「不改」时，可以不写。"),
    },
    cost: {
      message: copy("{section}「{title}」选项 {key} 没有写代价 cost。", { ...ask, key: "b" }),
      hint: copy(
        "cost 写选这个选项放弃了什么，写取舍，不写反驳。发现和提升的最后一个选项是「不改」时，可以不写。",
      ),
    },
    when: {
      message: copy("{section}「{title}」选项 {key} 没有写适用场景 when。", { ...ask, key: "b" }),
      hint: copy(
        "when 写什么情况下该选它。说不出来的选项是凑数的，删掉。只剩一个方向时，写 only 和 dropped。",
      ),
    },
  },
  options: {
    balance: {
      message: copy("{section}「{title}」的几个选项长短相差太多。", ask),
      hint: copy("每个选项写到同样的深度，看完就能动手做。代价写取舍，不写反驳。"),
    },
  },
  stance: {
    pick: {
      message: copy("{section}「{title}」的看法选了 {pick}，卡上没有这个选项。", {
        ...ask,
        pick: "c",
      }),
      hint: copy("stance 的 pick 写卡上一个选项的 key。卡上没有选项时，删掉 stance。"),
    },
  },
};
