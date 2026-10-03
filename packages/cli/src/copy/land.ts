import { copy } from "@product-loop/model";

// ploop land 各子命令的文案，见「04 命令行」第十一节和 S18。
// 暂时放在命令行里，以后并进共用定义的文案表。

const round = "第 2 版的落地阶段";
const name = "看板放到首页";
const root = "/Users/me/proj/app";

export const landCopy = {
  help: {
    description: copy("落地五步的记录"),
    name: copy("计划「功能改动」里的一件，写它的名字"),
    command: copy("检查命令，写在 -- 后面，例如 -- pnpm test"),
    plan: {
      description: copy("交计划"),
      details: {
        read: copy("读这个阶段工作区的计划.md。"),
        check: copy("检查每一节都有正文。"),
        names: copy("七节是：要做的事、现状、要不要先重构、功能改动。"),
        namesMore: copy("还有：用什么锁住现有的行为、对应哪个场景、裁决。"),
        short: copy("小改动可以只写要做的事、功能改动、用什么锁住现有的行为。"),
        shortRule: copy("从简的计划不重构；改动超过评审界线要补全七节。"),
        changes: copy("「功能改动」里每件写成一个顶格列表项或三级标题。"),
        item: copy("标题写名字，下面写检查命令和它查什么。"),
      },
      file: copy("计划的文件；不写读工作区的计划.md"),
      blocks: {
        sections: { situation: copy("计划缺节或有节是空的"), fix: copy("按报错补上那一节") },
        tidy: {
          situation: copy("「要不要先重构」没写要或不要"),
          fix: copy("写要，或写不要和理由"),
        },
      },
      reads: copy("工作区的计划.md"),
      writes: copy("集中存储的落地记录"),
      examples: { plain: copy("ploop land plan") },
      after: copy("ploop land status"),
    },
    tidy: {
      description: copy("记重构"),
      details: {
        run: copy("重构提交以后跑一遍检查命令。"),
        skip: copy("计划写了不要重构时写 --skip。"),
      },
      skip: copy("跳过重构，理由取自计划"),
      blocks: {
        skip: { situation: copy("计划写了要重构却写 --skip"), fix: copy("先重构并提交，再记") },
        planned: {
          situation: copy("检查命令没写在计划里"),
          fix: copy("把命令原样写进「用什么锁住现有的行为」"),
        },
      },
      reads: copy("项目的 git 仓库"),
      writes: copy("集中存储的落地记录和命令运行记录"),
      examples: { run: copy("ploop land tidy -- pnpm test"), skip: copy("ploop land tidy --skip") },
      after: copy("ploop land red <名字> -- <检查命令>"),
    },
    red: {
      description: copy("记改之前失败的一次"),
      details: {
        run: copy("在当前所在的根目录里跑检查命令。"),
        fail: copy("它要失败。"),
      },
      blocks: {
        passed: { situation: copy("检查命令没有失败"), fix: copy("改检查命令，让它查到这件改动") },
        planned: {
          situation: copy("名字或命令不在计划里"),
          fix: copy("把这一件和它的检查命令写进计划「功能改动」"),
        },
      },
      reads: copy("项目的 git 仓库"),
      writes: copy("集中存储的落地记录和命令运行记录"),
      examples: { plain: copy(`ploop land red ${name} -- pnpm test board`) },
      after: copy("改好并提交，再运行 ploop land green"),
    },
    green: {
      description: copy("记改之后通过的一次"),
      details: {
        run: copy("跑同一条检查命令，它要通过。"),
        commit: copy("提交要在失败之后。"),
      },
      blocks: {
        same: { situation: copy("命令和失败时的不同"), fix: copy("用失败时的那条命令") },
        later: {
          situation: copy("通过时的提交不在失败之后"),
          fix: copy("先提交这件改动，再运行"),
        },
      },
      reads: copy("项目的 git 仓库和提交说明里的「队列: Q12」"),
      writes: copy("集中存储的落地记录和命令运行记录"),
      examples: { plain: copy(`ploop land green ${name} -- pnpm test board`) },
      after: copy("ploop land review"),
    },
    review: {
      description: copy("记评审"),
      details: {
        read: copy("读评审意见，或写 --skip 跳过。"),
        size: copy("改动的规模从这个阶段开始时的提交算起。"),
        list: copy("review.json 是意见的列表。"),
        fields: copy("每条写 file、line、level、text。"),
        level: copy("level 写阻塞或建议，阻塞的另写 disposition。"),
      },
      file: copy("评审意见的文件；不写读工作区的 review.json"),
      skip: copy("改动在界线以内时跳过评审，写明理由"),
      blocks: {
        required: {
          situation: copy("改动超过界线却写 --skip"),
          fix: copy("让子代理按 ploop land diff 评审，写进 review.json"),
        },
        located: {
          situation: copy("意见没指到文件和行，或阻塞的没写处置"),
          fix: copy("按报错补上"),
        },
      },
      reads: copy("review.json、项目的 git 仓库"),
      writes: copy("集中存储的落地记录"),
      examples: {
        file: copy("ploop land review"),
        skip: copy('ploop land review --skip "只改了一个文件的三行"'),
      },
      after: copy("给出验收页：ploop page present"),
    },
    status: {
      description: copy("查看落地五步的进度"),
      details: { what: copy("写到了哪一步、缺什么。") },
      reads: copy("集中存储的落地记录"),
      writes: copy("不写"),
      examples: { plain: copy("ploop land status") },
      after: copy("按「下一步」运行"),
    },
    diff: {
      description: copy("打印这一批改动的差异"),
      details: {
        head: copy("前面列出每件改动的检查命令和它查什么。"),
        use: copy("给评审用。"),
      },
      reads: copy("集中存储的落地记录，项目的 git 仓库"),
      writes: copy("不写"),
      examples: { plain: copy("ploop land diff > diff.txt") },
      after: copy("评审以后运行 ploop land review"),
    },
  },
  output: {
    planned: copy("交了计划：{round}，功能改动 {count} 件", { round, count: 2 }),
    tidySkipped: copy("跳过了重构：{reason}", { reason: "改动都很小，不碰结构。" }),
    tidied: copy("记了重构：检查通过，提交 {commit}", { commit: "3f2a9c1" }),
    red: copy("记了失败：{name}，退出码 {exitCode}", { name, exitCode: 1 }),
    green: copy("记了通过：{name}，提交 {commit}", { name, commit: "3f2a9c1" }),
    reviewSkipped: copy("跳过了评审：改动 {lines} 行、{files} 个文件，在界线以内", {
      lines: 12,
      files: 2,
    }),
    /** 记通过以后，全部功能改动都通过、改动在界线以内：评审自动跳过，见改进 D03。 */
    reviewAuto: copy("评审：改动 {lines} 行、{files} 个文件，在界线以内，自动跳过", {
      lines: 12,
      files: 2,
    }),
    reviewed: copy("记了评审：阻塞 {block} 条，建议 {suggest} 条", { block: 1, suggest: 2 }),
    ran: copy("运行：{command}", { command: "pnpm test" }),
    /** 项目有几个根目录时，写明在哪个根目录里运行的。 */
    ranIn: copy("运行：{command}（在 {cwd}）", { command: "pnpm test", cwd: root }),
    tail: copy("输出的末尾："),
    /** 检查命令是使用代码、写出了 use-run.json：列出断了的步，不用翻输出找。 */
    brokenHead: copy("使用代码没走完的步（结果在 {file}）：", {
      file: ".product-loop/use/land-20260101T000000Z/use-run.json",
    }),
    brokenRow: copy("  - {scene} 第 {step} 步：{error}", {
      scene: "S1",
      step: 3,
      error: "页面上没有保存按钮",
    }),
    brokenMore: copy("  - 另有 {count} 步", { count: 2 }),
    statusHead: copy("落地五步：{round}", { round }),
    planLine: copy("计划：{state}", { state: "交了，功能改动 2 件" }),
    planMissing: copy("还没交"),
    planDone: copy("交了，功能改动 {count} 件", { count: 2 }),
    tidyLine: copy("重构：{state}", { state: "跳过了" }),
    changesHead: copy("功能改动："),
    changeRow: copy("  {name}  {state}{commit}", {
      name,
      state: "先失败后通过",
      commit: "，提交 3f2a9c1",
    }),
    changeCommit: copy("，提交 {commit}", { commit: "3f2a9c1" }),
    reviewLine: copy("评审：{state}{detail}", {
      state: "跳过了",
      detail: "，改动 12 行、2 个文件",
    }),
    reviewDiff: copy("，改动 {lines} 行、{files} 个文件", { lines: 12, files: 2 }),
    missingHead: copy("缺的："),
    missingRow: copy("  - {message}", { message: "还没交计划。" }),
    /** 前四步有记录都齐了；第五步重用场景没有命令查它，要自己核对，见落地的第五步。 */
    complete: copy("前四步齐了。第五步要自己核对：更改卡上有改前改后。"),
    diffHead: copy("这一批的改动：{round}", { round }),
    diffChange: copy("改动：{name}", { name }),
    diffCommand: copy("  检查命令：{command}", { command: "pnpm test board" }),
    diffNoCommand: copy("  检查命令：还没有记"),
    diffWhat: copy("  查什么：{text}", {
      text: "对应 Q1。检查 `pnpm test board`，查看板在第一屏。",
    }),
    diffRoot: copy("差异：{root}（从 {base} 起）", { root, base: "3f2a9c1" }),
    diffNoBase: copy("差异：{root} 没有这个阶段开始时的提交，比不出来", { root }),
    /** 只有一个根目录时，不写路径。 */
    diffOne: copy("差异：从 {base} 起", { base: "3f2a9c1" }),
    diffNoBaseOne: copy("差异：没有这个阶段开始时的提交，比不出来"),
  },
  errors: {
    notLand: {
      message: copy("当前的阶段是{round}，不是落地阶段。", { round: "第 2 版的检查阶段" }),
      hint: copy("先运行 ploop round start 落地。"),
    },
    /** 这一版还没有开始任何阶段：没有阶段可写，不留一个空的位置。 */
    noRound: {
      message: copy("这一版还没有开始任何阶段，没有落地记录可写。"),
      hint: copy("先运行 ploop round start 落地。"),
    },
    outsideRoot: {
      message: copy("当前目录 {cwd} 不在项目的任何一个根目录里。", { cwd: "/tmp" }),
      hint: copy("到项目的根目录里运行，根目录有：{roots}。", { roots: root }),
    },
    noCommand: {
      message: copy("没有写检查命令。"),
      hint: copy("在 -- 后面写命令，例如 ploop land {verb} -- pnpm test。", { verb: "red 空列表" }),
    },
    skipWithCommand: {
      message: copy("--skip 和检查命令只能写一样。"),
      hint: copy("跳过重构写 --skip，做了重构写 -- <检查命令>。"),
    },
    notStarted: {
      message: copy("检查命令没有跑起来：{reason}。", { reason: "找不到这个程序" }),
      hint: copy("检查命令的程序写对，并且在 PATH 里。"),
    },
    fileMissing: {
      message: copy("{file} 读不出来：{reason}。", {
        file: ".product-loop/rounds/v2-落地-3/计划.md",
        reason: "文件不存在",
      }),
      hint: copy("把内容写进这个文件，或在命令后面写文件的路径。"),
      triedHint: copy("先按当前目录、再按项目缓存找过，试过：{tried}。写对文件的路径。", {
        tried: "rounds/v2-落地-3/计划.md、.product-loop/rounds/v2-落地-3/计划.md",
      }),
    },
    /** 默认位置的文件还没写：说明先写什么、写在哪，再运行哪条命令。 */
    planNotWritten: {
      message: copy("还没有写计划：{file} 不存在。", {
        file: ".product-loop/rounds/v2-落地-3/计划.md",
      }),
      hint: copy(
        "把计划写进这个文件，共七节，再运行 ploop land plan。写在别处，运行 ploop land plan <文件>。",
      ),
    },
    reviewNotWritten: {
      message: copy("还没有评审意见：{file} 不存在。", {
        file: ".product-loop/rounds/v2-落地-3/review.json",
      }),
      hint: copy(
        "改动超过界线要评审：让子代理按 ploop land diff 评审，意见写进这个文件。写好运行 ploop land review。界线以内，运行 ploop land review --skip <理由>。",
      ),
    },
    reviewFile: {
      message: copy("评审意见不是合法的 JSON，或不是意见的列表。"),
      hint: copy(
        "写成列表，每条写 file、line、level、text。level 写阻塞或建议，阻塞的另写 disposition。",
      ),
    },
    noRed: {
      message: copy("{name} 还没有失败的记录。", { name }),
      hint: copy("先运行 ploop land red {name} -- <检查命令>。", { name }),
    },
  },
};
