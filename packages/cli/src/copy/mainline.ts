import { copy } from "@product-loop/model";

// ploop mainline 各子命令和每条命令开始时主线同步的文案，见「04 命令行」第二节和「03 数据模型」第五节。
// 暂时放在命令行里，以后并进共用定义的文案表。

export const mainlineCopy = {
  help: {
    description: copy("主线的查看、检查和同步"),
    show: {
      description: copy("查看主线的一次修订"),
      details: { what: copy("写第几次修订、什么时候交的、缺哪几个部分、有哪些场景。") },
      revision: copy("修订的次数，从 1 数，不写就看最新的一次，例如 3"),
      text: copy("另外打印这次修订的全文"),
      examples: { latest: copy("ploop mainline show"), old: copy("ploop mainline show 3 --text") },
      after: copy("改主线：直接改主线.md，再运行 ploop mainline push"),
    },
    check: {
      description: copy("检查最新交上去的主线"),
      details: {
        what: copy("查主线的 10 个部分在不在、场景的写法、设计规范的 12 个部分。"),
        only: copy("只检查，不交新的修订。"),
        push: copy("要交上去，用 ploop mainline push。"),
      },
      example: copy("ploop mainline check"),
      after: copy("按输出补主线.md，再运行 ploop mainline push"),
    },
    push: {
      description: copy("把主线.md 交成新修订"),
      details: {
        scenes: copy("补上的场景编号写回文件。"),
        merged: copy("合并完冲突以后也用它交。"),
      },
      blocks: {
        conflict: {
          situation: copy("别的会话先交了一次修订"),
          fix: copy("把主线.远端.md 合进主线.md，再运行 ploop mainline push"),
        },
        missing: {
          situation: copy("项目缓存里没有主线.md"),
          fix: copy("写好主线.md，或者运行 ploop mainline pull"),
        },
      },
      example: copy("ploop mainline push"),
      after: copy("ploop mainline check"),
    },
    pull: {
      description: copy("取回最新的主线修订"),
      details: {
        what: copy("用集中存储里最新的修订覆盖主线.md。"),
        force: copy("主线.md 有没交的改动时拦下，加 --force 才丢掉。"),
      },
      force: copy("主线.md 里没交的改动不要了，直接丢掉"),
      blocks: {
        discards: {
          situation: copy("主线.md 里有还没交上去的改动"),
          fix: copy("先 ploop mainline push 交上去；不要了就加 --force"),
        },
      },
      example: copy("ploop mainline pull"),
      after: copy("ploop mainline show"),
    },
    history: {
      description: copy("列出主线的历次修订"),
      details: { what: copy("每次写第几次、时间、来源和阶段。") },
      example: copy("ploop mainline history"),
      after: copy("ploop mainline diff <从> <到>"),
    },
    diff: {
      description: copy("比较主线的两次修订"),
      details: {
        what: copy("逐行比较。"),
        default: copy("不写修订的次数，就比最新一次和它的上一次。"),
      },
      from: copy("从哪一次修订比，不写就是到的那一次的上一次，例如 2"),
      to: copy("比到哪一次修订，不写就是最新的一次，例如 3"),
      examples: { latest: copy("ploop mainline diff"), pair: copy("ploop mainline diff 2 5") },
      after: copy("ploop mainline show <修订>"),
    },
    revisionInvalid: copy("修订的次数要写从 1 起的整数，例如 3。"),
    blocks: {
      noProject: {
        situation: copy("往上找不到 project.json"),
        fix: copy("到项目根目录运行，或者用 --project 指定项目"),
      },
      remote: {
        situation: copy("有主线.远端.md，冲突还没合并"),
        fix: copy("合并以后运行 ploop mainline push"),
      },
    },
    reads: copy("项目缓存的 project.json、主线.md"),
    readsOnly: copy("项目缓存的 project.json、主线.md，集中存储的主线"),
    writes: copy("集中存储的主线，主线.md、project.json；冲突时写主线.远端.md"),
    writesNone: copy("不写"),
  },
  /** 每条命令开始时同步主线，给人看的一行，写到标准错误。 */
  sync: {
    pushed: copy("同步了主线：主线.md 交成了修订 {revision}。", { revision: 4 }),
    assigned: copy("补上了场景编号 {scenes}，已写回主线.md。", { scenes: "S4 看队列、S5 改设置" }),
    pulled: copy("同步了主线：用集中存储里的修订 {revision} 覆盖了主线.md。", { revision: 4 }),
    problems: copy("主线有 {count} 处写法的问题，运行 ploop mainline check 查看。", { count: 2 }),
    /** 两边都改了：集中存储里的写进主线.远端.md。报错的第一行沿用后端写的冲突。 */
    conflictHint: copy(
      "集中存储里的修订 {latest} 写进了主线.远端.md。把它合进主线.md，再运行 ploop mainline push。",
      { latest: 4 },
    ),
    /** 上一次冲突写的主线.远端.md 还在。 */
    pending: {
      message: copy("主线.远端.md 还在，上次同步主线时的冲突还没有合并。"),
      hint: copy(
        "把主线.远端.md 合进主线.md，再运行 ploop mainline push。要放弃本地的改动，运行 ploop mainline pull。",
      ),
    },
    /** 读命令不交新的修订，主线.md 却有改动：提醒显示的是上一次交上去的那次修订。 */
    unpushed: {
      message: copy("主线.md 有还没交上去的改动，这里显示的是已经交上去的那次修订。"),
      hint: copy("运行 ploop mainline push，把它交成新的修订。"),
    },
    /** check 查的是主线.md 现在的内容，它和上一次交上去的不同：提醒交上去。 */
    checkUnpushed: {
      message: copy("查的主线.md 还没交上去。"),
      hint: copy("运行 ploop mainline push，把它交成新的修订。"),
    },
    /** ploop mainline pull 时主线.md 里有没交的改动，取回会丢掉。 */
    pullDiscards: {
      message: copy("主线.md 里有还没交上去的改动，取回会把它们丢掉。"),
      hint: copy(
        "先运行 ploop mainline push 交上去。确定不要这些改动，运行 ploop mainline pull --force。",
      ),
    },
    /** ploop mainline pull 时上次冲突的主线.远端.md 还在，本地的改动还没合并。 */
    pullUnmerged: {
      message: copy("主线.md 和主线.远端.md 还没有合并，取回会丢掉主线.md 里的改动。"),
      hint: copy(
        "合并以后运行 ploop mainline push。确定放弃本地的改动，运行 ploop mainline pull --force。",
      ),
    },
    /** ploop mainline push 时项目缓存里没有主线.md。 */
    missing: {
      message: copy("项目缓存里没有主线.md。"),
      hint: copy("在主线.md 里写好主线再交。要取回集中存储里的主线，运行 ploop mainline pull。"),
    },
    /** 要读写主线.md 的命令，--project 却写了项目名。 */
    byId: {
      message: copy("{command} 要读写主线.md，--project 写的「{value}」是项目名。", {
        command: "ploop mainline push",
        value: "app",
      }),
      hint: copy("到项目根目录下运行，或者写 --project ./app 这样的路径。"),
    },
  },
  output: {
    pushed: copy("交上了：主线修订 {revision}", { revision: 4 }),
    unchanged: copy("主线没有改动：已是修订 {revision}", { revision: 4 }),
    pulled: copy("取回了：主线修订 {revision}，覆盖了主线.md", { revision: 4 }),
    none: copy("集中存储里还没有主线。"),
    write: copy("先在项目缓存的主线.md 里写好主线，再交上去。"),
    discarded: copy("主线.md 里没交的改动已丢掉。"),
    removed: copy("这次修订里没有了场景 {scenes}。", { scenes: "S3、S7" }),
    file: copy("文件：{file}", { file: ".product-loop/主线.md" }),
    remoteRemoved: copy("删掉了主线.远端.md。"),
    head: copy("主线修订 {revision}：{time}，来自{source}{round}", {
      revision: 4,
      time: "2026-09-28 10:05",
      source: "项目缓存",
      round: "，在第 1 版的构思阶段交的",
    }),
    round: copy("，在{round}交的", { round: "第 1 版的构思阶段" }),
    scenesHead: copy("场景 {count} 个：", { count: 2 }),
    scenesNone: copy("场景清单里还没有场景。"),
    scene: copy("  {id}  {name}", { id: "S4", name: "看队列" }),
    sceneNoId: copy("  没有编号  {name}", { name: "看队列" }),
    textHead: copy("全文："),
    checked: copy("查了主线修订 {revision}", { revision: 4 }),
    /** 项目缓存里有主线.md：查它现在的内容，不交新的修订。 */
    checkedFile: copy("查了主线.md 现在的内容，没有交新的修订。"),
    historyHead: copy("主线有 {count} 次修订：", { count: 3 }),
    historyRow: copy("  修订 {revision}  {time}  {source}{round}", {
      revision: 3,
      time: "2026-09-28 10:05",
      source: "项目缓存",
      round: "  第 1 版的构思阶段",
    }),
    diffHead: copy("比较了主线修订 {from} 和修订 {to}", { from: 2, to: 3 }),
    diffSame: copy("两次修订的全文相同。"),
    diffSingle: copy("主线只有修订 {revision}，没有可以比较的修订。", { revision: 1 }),
    gap: copy("  …"),
  },
  next: {
    check: copy("ploop mainline check"),
    push: copy("ploop mainline push"),
    history: copy("ploop mainline history"),
    show: copy("ploop mainline show"),
  },
};
