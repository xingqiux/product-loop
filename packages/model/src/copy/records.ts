import type { QueueStatus } from "../names.ts";
import type { QueueTransitionError } from "../queue.ts";
import { type CopyEntry, copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 队列事项、决定、回复行这几种数据的报错和说明，见 queue.ts、decision.ts、reply.ts。
// 数据定义的报错只写什么不对，位置由字段的路径给出。字段的中文名也放在这里，报错时填进 {field}。

/** 几种字段共用的报错。 */
export const textFieldCopy = {
  /** 没写、写成 null，或者只写了空白。 */
  missing: copy("没有写{field}。", { field: "验收标准" }),
  notText: copy("{field}要写成文字。", { field: "验收标准" }),
};

export const queueCopy = {
  field: {
    id: copy("队列事项的编号"),
    round: copy("阶段"),
    content: copy("内容"),
    statusNote: copy("状态说明"),
    dependsOn: copy("依赖"),
    acceptance: copy("验收标准"),
    evidence: copy("完成证据"),
    subItem: copy("子项"),
    source: copy("来源"),
    /** 队列事项的备注。队列变动和状态变化里的 note 叫「说明」，是另一个字段。 */
    itemNote: copy("备注"),
    note: copy("说明"),
    actor: copy("执行者"),
  },
  /** 队列事项的状态和字段对不上。 */
  item: {
    waitingNeedsDependsOn: copy("等待的事要写明依赖。"),
    doneNeedsEvidence: copy("已完成的事要写完成证据。"),
    droppedNeedsNote: copy("已取消的事要在状态说明里写取消的原因。"),
  },
  update: {
    empty: copy("至少要改一项：内容、阶段、验收标准、子项、来源、备注、状态说明、证据或依赖。"),
  },
  /** 规矩 queue.content.tooLong：内容整句显示，写成名字，放不下的细节写进备注。 */
  tooLong: {
    message: copy("内容有 {length} 个字，超过 {limit} 个字。", { length: 57, limit: 40 }),
    hint: copy("缩短到 {limit} 个字以内，细节写进备注。", { limit: 40 }),
  },
  event: {
    createdNotTodo: copy("刚放进队列的事，状态只能是待办。"),
    notInGraph: copy("从{from}改成{to}，不在状态图里。", { from: "已完成", to: "待办" }),
  },
  /** 状态图每一条边由什么引起，照「03 数据模型」的表。 */
  cause: {
    todo: {
      doing: copy("开始阶段时拿出来"),
      waiting: copy("写明依赖"),
      dropped: copy("用户或 AI 取消"),
    },
    doing: {
      done: copy("做完并写证据"),
      waiting: copy("发现要等别的事"),
      todo: copy("收尾时退回"),
      dropped: copy("取消"),
    },
    waiting: {
      todo: copy("依赖满足"),
      dropped: copy("取消"),
    },
    dropped: {
      todo: copy("用户点名捞回，或用 ploop queue reopen 改回"),
    },
  } satisfies { readonly [F in QueueStatus]?: { readonly [T in QueueStatus]?: CopyEntry } },
  /** 状态图不允许的变化。键是 canTransition 返回的错误码。 */
  transition: {
    terminal: {
      message: copy("{id} 已经完成，不能再改状态。", { id: "Q12" }),
      hint: copy("要重新做，就放进一件新的，在来源里写明接的是 {id}。", { id: "Q12" }),
    },
    notInGraph: {
      message: copy("{id} 现在是{from}，不能改成{to}。", { id: "Q12", from: "等待", to: "已完成" }),
      hint: copy("{from}只能改成{allowed}。", { from: "等待", allowed: "待办或已取消" }),
    },
    notDroppedAtRoundStart: {
      message: copy("{id} 不是这个阶段开始时取消的，不能捞回。", { id: "Q15" }),
      hint: copy("要重新做它，就放进一件新的，在来源里写明接的是 {id}。", { id: "Q15" }),
    },
    notNamedInReply: {
      message: copy("用户没有在这个阶段的回复里点名 {id}，不能捞回。", { id: "Q15" }),
      hint: copy("用户没有点名的事保持已取消。要再做它，运行 ploop queue reopen {id}。", {
        id: "Q15",
      }),
    },
  } satisfies Record<QueueTransitionError, ErrorCopy>,
};

export const decisionCopy = {
  field: {
    decision: copy("决定"),
    reason: copy("原因"),
    case: copy("案例"),
    voidReason: copy("作废原因"),
  },
  /** 规矩 decision.fields：决定、原因、案例三项必填。 */
  fields: {
    message: copy("决定、原因、案例三项都要写，这里缺了{field}。", { field: "案例" }),
    hint: copy("补上{field}再重跑，日期由命令填。", { field: "案例" }),
  },
  /** 规矩 decision.decision.tooLong：「决定」一项整句显示，放不下的细节写进原因。 */
  tooLong: {
    message: copy("「决定」一项有 {length} 个字，超过 {limit} 个字。", { length: 57, limit: 40 }),
    hint: copy("缩短到 {limit} 个字以内，细节写进原因。", { limit: 40 }),
  },
  /** 改一条决定：决定、原因、案例一项都没写。 */
  edit: {
    empty: copy("至少要改一项：决定、原因或案例。"),
  },
  voidNeedsBy: copy("作废的决定要写明被哪一条推翻。"),
  activeWithVoid: copy("有效的决定不写被哪一条推翻，也不写作废原因。"),
  voidedBySelf: copy("决定不能被自己推翻。"),
};

export const replyCopy = {
  field: {
    part: copy("主线改的是哪个部分"),
    reason: copy("不处理的原因"),
    card: copy("卡片编号"),
    option: copy("选项"),
    note: copy("备注"),
  },
  /** 去处不是五种之一。labels 是五种去处的中文名。 */
  unknownDestination: copy("去处要写这五种之一：{labels}。", {
    labels: "主线、决定、队列、当场做、不处理",
  }),
  /** 回复行的种类和字段对不上。kind 是种类的中文名。 */
  line: {
    optionMissing: copy("选了选项的行要写选的是哪一个。"),
    noteMissing: copy("{kind}的行要写备注。", { kind: "想法" }),
    queueMissing: copy("取消队列事项的行要写取消的是哪一件。"),
  },
  handle: {
    empty: copy("至少要处理一行。"),
    queueTargetMissing: copy("去处是队列时要写 id 或 item：id 指已有的一件，item 放进一件新的。"),
    queueTargetBoth: copy("id 和 item 只能写一样。"),
    queueStageWithItem: copy("放进一件新的时，阶段写在 item 里，不另写 stage。"),
    duplicateLine: copy("第 {line} 行出现了 {count} 次，一行只能有一个去处。", {
      line: 3,
      count: 2,
    }),
  },
};
