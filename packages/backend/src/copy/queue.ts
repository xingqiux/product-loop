import { copy } from "@product-loop/model";

// 队列用例的文案：报错写什么不对、怎么改，见「04 命令行」第六节。
// 字段的中文名、状态图的报错、状态和字段对不上的说法在 model 的 queueCopy 里，这里只补用例自己的。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const queueItemsCopy = {
  /** 按编号找不到这件事。 */
  notFound: {
    message: copy("项目「{project}」的队列里没有 {id}。", { project: "app", id: "Q12" }),
    hint: copy("运行 ploop queue list，查看这个项目的队列。"),
  },
  /** 该写字的地方没写字。什么不对用 model 的 textFieldCopy.missing。 */
  blank: {
    hint: copy("补上{field}再重跑。", { field: "内容" }),
  },
  /** 写作校验拦截时的怎么改：停用的说法自带怎么改，别的拦截由报错自己说明什么不对，这里补下一步。 */
  writingHint: copy("按报错改写这段文字，再重跑。"),
  /** 修改时一项都没写。什么不对用 model 的 queueCopy.update.empty。 */
  emptyPatch: {
    hint: copy("写上要改的字段和新的取值，再重跑。"),
  },
  /** If-Match 写的修改计数和库里的对不上，这件事已被别处改过。 */
  editConflict: {
    message: copy("{id} 已被别处改过，修改计数现在是 {current}，请求里写的是 {expected}。", {
      id: "Q12",
      current: 3,
      expected: 2,
    }),
    hint: copy("运行 ploop queue show {id} 看最新的内容，再重新修改。", { id: "Q12" }),
  },
  /** 规矩 queue.content.semicolons，照旧 queue.py 的查法。 */
  semicolons: {
    message: copy("内容里用分号写了几件并列的事。"),
    hint: copy("内容只写这件事是什么，并列的几件放进子项。"),
  },
  /** 规矩 queue.content.duplicate：还没做完的事里已有内容相同的一件。 */
  duplicate: {
    message: copy("队列里已经有内容相同的 {other}，它还没有做完。", { other: "Q3" }),
    hint: copy("接着用 {other}，不要再放一件。要改内容，运行 ploop queue edit {other}。", {
      other: "Q3",
    }),
  },
  /** 规矩 queue.drop.reason，见「07 校验」第四节。 */
  dropReason: {
    message: copy("取消 {id} 要写原因。", { id: "Q15" }),
    hint: copy("写明为什么不做了，例如「已在第 2 版的落地阶段修掉」。"),
  },
  /** 改成已完成却没写证据。什么不对用 model 的 queueCopy.item.doneNeedsEvidence。 */
  doneEvidence: {
    hint: copy("写明看得见的证据，例如改后的截图或验收页所在的阶段。"),
  },
  /** 改成等待却没写依赖。什么不对用 model 的 queueCopy.item.waitingNeedsDependsOn。 */
  waitingDependsOn: {
    hint: copy("写明在等什么，例如「等构思定下场景 S4」。"),
  },
  /**
   * 待办的事直接改成已完成：待办只能被一个阶段拿出来变成进行中，没有别的路。
   * 接在状态图的说明后面，指到能走通的命令。
   */
  todoToDone: copy(
    "先运行 ploop round start {stage}，把它拿成进行中。做完写 ploop round close --done {id}=<证据>。",
    { stage: "构思", id: "Q12" },
  ),
  /** 等待或已取消的事要再做：先改回待办，再由阶段开始时拿出来。 */
  reopenFirst: copy("先运行 ploop queue reopen {id}，改回待办。", { id: "Q9" }),
  /** 处理回复时选中一件进行中的事，改标以后收尾时记成退回。 */
  restage: {
    note: copy("选中，改标{stage}", { stage: "落地" }),
  },
  /** 改阶段、状态说明、证据时状态不合。 */
  edit: {
    stageDoing: {
      message: copy("{id} 正在这个阶段里进行，这里不能改它的阶段。", { id: "Q12" }),
      hint: copy("收尾时运行 ploop round close --return {id}:{stage}=<原因>，退回到别的阶段。", {
        id: "Q12",
        stage: "落地",
      }),
    },
    stageEnded: {
      message: copy("{id} 已经是{status}，不改它的阶段。", { id: "Q12", status: "已取消" }),
      dropped: copy("要再做它，先运行 ploop queue reopen {id}，再改阶段。", { id: "Q12" }),
      done: copy("要重新做，就放进一件新的，在来源里写明接的是 {id}。", { id: "Q12" }),
    },
    noStatusNote: {
      message: copy("{id} 现在是{status}，没有状态说明可改。", { id: "Q12", status: "待办" }),
      hint: copy("状态说明是改状态时写的，从没改过状态的事没有。"),
    },
    noEvidence: {
      message: copy("{id} 现在是{status}，没有证据可改。", { id: "Q12", status: "待办" }),
      hint: copy("证据是做完时写的，只有已完成的事有。"),
    },
    noDependsOn: {
      message: copy("{id} 现在是{status}，没有依赖可改。", { id: "Q12", status: "待办" }),
      hint: copy("依赖是改成等待时写的，要等什么用 ploop queue wait 写。"),
    },
  },
  /** 状态图的报错里「只能改成」后面的几个状态，最后一个前面用「或」。 */
  allowedList: copy("{head}或{last}", { head: "进行中、等待", last: "已取消" }),
};
