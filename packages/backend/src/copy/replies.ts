import { copy } from "@product-loop/model";

// 提交回复、等回复的文案，见「04 命令行」第八节和「05 接口」第四、六节。
// 旧格式的回复文字拆不开时，报错用 model 的 describeLegacyReplyProblem。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const hash = "2e8f4d";

export const repliesCopy = {
  /** 问题的位置：回复文字的第几行，或者交来的第几行。 */
  where: copy("第 {line} 行", { line: 3 }),
  /** 工作台交来的一行里的第几张图。 */
  lineImage: copy("第 {line} 行的第 {n} 张图", { line: 3, n: 1 }),
  /** 提交的请求本身不对。 */
  request: {
    /** 文字和各行只能交一样。 */
    bodyBoth: {
      message: copy("回复里同时写了文字和各行。"),
      hint: copy("旧格式的回复文字交 text，工作台拆好的各行交 lines，只交一样。"),
    },
    bodyMissing: {
      message: copy("回复里没有文字，也没有各行。"),
      hint: copy("旧格式的回复文字交 text，工作台拆好的各行交 lines。"),
    },
    /** 什么都没点。同一页只能提交一次，空的回复不收，免得这一页被空的回复占掉。 */
    empty: {
      message: copy("回复是空的，一行都没有。"),
      hint: copy("在页面上点选或写备注以后再提交。"),
    },
    imageHash: {
      message: copy("图 {hash} 不是六十四位小写十六进制。", { hash }),
      hint: copy("图写附件的完整哈希，先上传再提交。"),
    },
  },
  /** 草稿的旧版本。 */
  draft: {
    revisionUnknown: {
      message: copy("{page}的草稿里没有第 {rev} 份旧版本。", {
        page: "第 2 版的检查阶段的第 2 页",
        rev: 3,
      }),
      hint: copy("先列出这一页的旧版本，再按列出的编号放回。"),
    },
  },
  /** 工作台交来的各行，对不上这一页的地方。 */
  line: {
    cardUnknown: {
      message: copy("第 {line} 行的卡片 {card} 不在这一页上。", { line: 3, card: "queue-board" }),
      hint: copy("卡片编号照这一页的页面数据写。"),
    },
    sectionMismatch: {
      message: copy("第 {line} 行的卡片 {card} 在 {actual} 区块，行里写的是 {section}。", {
        line: 3,
        card: "queue-board",
        actual: "asks",
        section: "findings",
      }),
      hint: copy("区块照卡片所在的区块写，或者不写区块。"),
    },
    optionMissing: {
      message: copy("第 {line} 行选了选项，没有写选的是哪一个。", { line: 3 }),
      hint: copy("在 option 里写选项的 key，例如 a。"),
    },
    noteMissing: {
      message: copy("第 {line} 行是{kind}，没有写备注。", { line: 3, kind: "想法" }),
      hint: copy("在 note 里写用户的原话。"),
    },
    queueMissing: {
      message: copy("第 {line} 行要取消队列事项，没有写是哪一件。", { line: 3 }),
      hint: copy("在 queue 里写队列事项的编号，例如 Q12。"),
    },
    queueUnknown: {
      message: copy("第 {line} 行写的 {queue} 不在这个项目的队列里。", { line: 3, queue: "Q12" }),
      hint: copy("运行 ploop queue list，查看这个项目的队列。"),
    },
  },
  /** 回复里的图对不上附件库。旧模板只写图的哈希的前几位。 */
  image: {
    missing: {
      message: copy("{where}写的 {id} 在附件库里找不到。", { where: "第 3 行〔图 1〕", id: hash }),
      hint: copy("先上传这张图，再提交回复。"),
    },
    ambiguous: {
      message: copy("{where}写的 {id} 对得上附件库里的几张图。", {
        where: "第 3 行〔图 1〕",
        id: hash,
      }),
      hint: copy("图写附件的完整哈希，或者随回复交上这张图的完整哈希。"),
    },
  },
  /** 这一页不能再回复。 */
  page: {
    /** 一页只能提交一次。 */
    replied: {
      message: copy("{page}已经回复过了，同一页只能提交一次。", {
        page: "第 2 版的检查阶段的第 2 页",
      }),
      hint: copy("运行 ploop reply show 查看这份回复。"),
    },
    withdrawn: {
      message: copy("{page}已经撤回了。", { page: "第 2 版的检查阶段的第 2 页" }),
      hint: copy("运行 ploop status，查看现在在等的是哪一页。"),
    },
    closed: {
      message: copy("{round}已经收尾了，它的第 {seq} 页不能再回复。", {
        round: "第 2 版的检查阶段",
        seq: 2,
      }),
      hint: copy("运行 ploop status，查看现在在等的是哪一页。"),
    },
  },
  /** 按编号找不到回复。 */
  notFound: {
    message: copy("项目「{project}」没有编号为 {submission} 的回复。", {
      project: "app",
      submission: 7,
    }),
    hint: copy("运行 ploop reply show，查看最近的一份回复。"),
  },
  /** 后端自动处理的行。 */
  auto: {
    /** 取消队列事项时写进状态说明的原因。工作台会显示它，不写回复和行的编号，用户不用去数。 */
    dropReason: copy("用户在回复里取消了这件事。"),
    /** 认可一条更改：没有要做的事，去处写不处理，原因是这一句。 */
    approvedReason: copy("用户认可了这一条更改。"),
    /** 要取消的事改不成已取消，这一行留给 AI 处理。 */
    dropFailed: {
      message: copy("第 {line} 行要取消的 {queue} 没能自动取消：{reason}", {
        line: 3,
        queue: "Q12",
        reason: "Q12 已经完成了。",
      }),
      hint: copy("运行 ploop reply handle 处理这一行。"),
    },
  },
  /** 处理回复：给一行定去处，见「04 命令行」第三节的 reply handle。 */
  handle: {
    /** 同一次请求里一行只能出现一次。 */
    duplicate: {
      message: copy("第 {line} 行在这次处理里出现了不止一次。", { line: 3 }),
      hint: copy("一行只写一个去处，删掉多出来的几项。"),
    },
    lineUnknown: {
      message: copy("这份回复没有第 {line} 行。", { line: 9 }),
      hint: copy("运行 ploop reply show，查看这份回复的每一行。"),
    },
    handled: {
      message: copy("第 {line} 行已经处理过了，去处是{to}。", { line: 3, to: "队列" }),
      hint: copy("一行只有一个去处。运行 ploop reply show，查看还没处理的行。"),
    },
    /** 必填的文字只写了空白。field 是这一项的中文名。 */
    blank: {
      message: copy("第 {line} 行没有写{field}。", { line: 3, field: "不处理的原因" }),
      hint: copy("补上{field}再处理这一行。", { field: "不处理的原因" }),
    },
    queueId: {
      message: copy("第 {line} 行写的 {id} 不是队列事项的编号。", { line: 3, id: "12" }),
      hint: copy("编号写成 Q12 这样。"),
    },
    queueUnknown: {
      message: copy("第 {line} 行写的 {id} 不在这个项目的队列里。", { line: 3, id: "Q12" }),
      hint: copy("运行 ploop queue list，查看这个项目的队列。放进一件新的写 item。"),
    },
    /** 捞回开始时取消的事，写进状态说明。 */
    restoreNote: copy("用户在回复里点名捞回这件事。"),
    /** 这张卡上已列着还没做完的事，却又放进了新的一件：多半是想改这件事的阶段。 */
    cardHasItems: {
      message: copy("第 {line} 行所在的卡上已有 {ids}，这次又放进了新的 {added}。", {
        line: 2,
        ids: "Q1",
        added: "Q4",
      }),
      hint: copy(
        "要改 {first} 的阶段，运行 ploop reply handle {line} 队列 {first} --stage <阶段名>。",
        {
          first: "Q1",
          line: 2,
        },
      ),
    },
    revisionUnknown: {
      message: copy("主线没有修订 {revision}。", { revision: 5 }),
      hint: copy("运行 ploop mainline history，查看主线的历次修订。不写修订就指最新的一次。"),
    },
    /** 规矩 reply.mainline.newer：去处是主线时，主线要有给出那一页以后的新版本。 */
    mainlineOld: {
      message: copy("主线还没有新的修订，第 {line} 行不能放进主线。", { line: 3 }),
      hint: copy("先改主线.md 里的这个部分，再运行这条命令，命令开始时会交上新的修订。"),
    },
    mainlineMissing: {
      message: copy("第 {line} 行的去处是主线，这个项目还没有交过主线。", { line: 3 }),
      hint: copy("先写好主线.md，再运行这条命令，命令开始时会交上主线。"),
    },
  },
};
