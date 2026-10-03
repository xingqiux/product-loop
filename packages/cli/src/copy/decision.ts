import { copy } from "@product-loop/model";

// ploop decision list|add|edit|void 的文案，见「04 命令行」第二节和第十节。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const decisionCopy = {
  help: {
    description: copy("决定的查看、新增、修改和作废"),
    list: {
      description: copy("列出决定"),
      details: { default: copy("默认只列有效的。") },
      all: copy("连已作废的一起列"),
      limit: copy("最多列几条，列最近的；写 0 列出全部"),
      examples: { plain: copy("ploop decision list"), all: copy("ploop decision list --all") },
      after: copy("ploop decision add"),
    },
    add: {
      description: copy("新增一条决定"),
      details: {
        date: copy("日期由命令填。"),
        fields: copy("决定、原因、案例三项必填。"),
        length: copy("决定一项不超过 40 个字，细节写进原因。"),
        doc: copy("写完重写项目缓存的决定.md。"),
      },
      decision: copy("用户看得见的一条行为，不超过 40 个字"),
      reason: copy("为什么这样定"),
      case: copy("引出这条决定的实例，例如哪个阶段的哪一行回复"),
      kind: copy("种类，不写就是决定"),
      blocks: {
        fields: {
          situation: copy("决定、原因、案例缺了一项"),
          fix: copy("三项都写上再运行，规矩是 decision.fields"),
        },
        tooLong: {
          situation: copy("决定超过 40 个字，规矩是 decision.decision.tooLong"),
          fix: copy("缩短决定，细节写进 --reason"),
        },
      },
      examples: {
        plain: copy(
          'ploop decision add --decision "队列看板默认按阶段分列" --reason "用户按阶段找事" --case "第 2 版的检查阶段第 3 行"',
        ),
      },
      after: copy("推翻旧决定时：ploop decision void <编号> --by <新编号>"),
    },
    edit: {
      description: copy("改一条决定的文字"),
      details: {
        what: copy("只改文字，编号和日期不变，已作废的也能改。"),
        fields: copy("写了哪一项就改哪一项，至少写一项。"),
        length: copy("决定一项不超过 40 个字，细节写进原因。"),
        doc: copy("写完重写项目缓存的决定.md。"),
      },
      id: copy("要改的决定的编号，例如 12"),
      decision: copy("新的决定，不超过 40 个字"),
      reason: copy("新的原因"),
      case: copy("新的案例"),
      blocks: {
        empty: {
          situation: copy("什么都没写"),
          fix: copy("--decision、--reason、--case 至少写一个"),
        },
        blank: {
          situation: copy("某一项写成了空白"),
          fix: copy("写上具体的文字，规矩是 decision.fields"),
        },
        tooLong: {
          situation: copy("决定超过 40 个字，规矩是 decision.decision.tooLong"),
          fix: copy("缩短决定，细节写进 --reason"),
        },
      },
      examples: {
        plain: copy('ploop decision edit 12 --reason "用户按阶段找事，按状态分列会来回找"'),
      },
      after: copy("ploop decision list"),
    },
    void: {
      description: copy("作废一条决定"),
      details: {
        by: copy("写明被哪一条推翻。"),
        keep: copy("旧的一条原地留着，写完重写决定.md。"),
        again: copy("已经被同一条推翻的，再运行不算错。"),
      },
      id: copy("要作废的决定的编号，例如 12"),
      by: copy("推翻它的那一条的编号，例如 15"),
      reason: copy("作废的原因"),
      numberInvalid: copy("编号要写从 1 起的整数，例如 12。"),
      blocks: {
        voided: {
          situation: copy("这一条已经作废了"),
          fix: copy("运行 ploop decision list --all 查看"),
        },
        by: {
          situation: copy("推翻它的那一条不存在或已作废"),
          fix: copy("先用 ploop decision add 记下新的一条"),
        },
      },
      examples: { plain: copy("ploop decision void 12 --by 15") },
      after: copy("ploop decision list"),
    },
    reads: copy("项目缓存的 project.json、主线.md，集中存储的决定"),
    writes: copy("集中存储的决定；项目缓存的决定.md"),
    writesNone: copy("不写"),
  },
  output: {
    listHead: copy("列出了 {count} 条决定：", { count: 3 }),
    /** 决定多，只列了最近的：默认最多 30 条，--limit 可以改。 */
    listHeadLimited: copy("列出了最近的 {shown} 条决定，共 {count} 条：", {
      shown: 30,
      count: 200,
    }),
    listMore: copy("还有 {rest} 条没列出，加 --limit 0 重新运行可以列出全部。", { rest: 170 }),
    listEmpty: copy("还没有决定。"),
    listEmptyActive: copy("还没有有效的决定。"),
    row: copy("  {id}  {date}  {kind}  {decision}", {
      id: "12",
      date: "2026-09-28",
      kind: "决定",
      decision: "队列看板默认按阶段分列",
    }),
    voidedRow: copy("  {id}  {date}  {kind}  {decision}  已作废，被第 {by} 条推翻", {
      id: "3",
      date: "2026-09-20",
      kind: "决定",
      decision: "队列看板默认按状态分列",
      by: 12,
    }),
    added: copy("记下了{kind}：第 {id} 条", { kind: "决定", id: 12 }),
    edited: copy("改好了决定：第 {id} 条", { id: 12 }),
    reason: copy("原因：{text}", { text: "用户按阶段找事" }),
    case: copy("案例：{text}", { text: "第 2 版的检查阶段第 3 行" }),
    voided: copy("作废了决定：第 {id} 条，被第 {by} 条推翻", { id: 3, by: 12 }),
    doc: copy("重写了 {file}", { file: ".product-loop/决定.md" }),
  },
  /** 新增以后写在正文里的提醒。命令的下一步只放能直接运行的命令，这句带占位符，不放进去。 */
  next: {
    list: copy("ploop decision list"),
  },
};
