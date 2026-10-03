import { copy } from "@product-loop/model";

// 落地五步的文案：报错写什么不对、怎么改，下一步写完整的命令，见「04 命令行」第四到六节。
// 计划七节的问题、先失败后通过的对不上，用 model 的 landCopy，这里只补用例自己的。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const round = "第 2 版的落地阶段（第 3 次）";
const label = "v2-落地-3";
const name = "空列表显示一句提示";
const command = "pnpm vitest run src/list.test.ts";

export const landStepsCopy = {
  /** 找这个阶段，和这个阶段能不能记落地的五步。 */
  round: {
    notFound: {
      message: copy("项目「{project}」没有{round}。", { project: "app", round }),
      hint: copy("运行 ploop status，查看现在是哪个阶段。"),
    },
    notLand: {
      message: copy("{round}不是落地阶段，不记落地的五步。", { round: "第 2 版的检查阶段" }),
      hint: copy("落地的五步只在落地阶段里记。运行 ploop status，查看现在是哪个阶段。"),
    },
    closed: {
      message: copy("{round}已经收尾，不能再记落地的五步。", { round }),
      hint: copy("还要接着改的，运行 ploop round start 落地，开始新的阶段。"),
    },
  },
  /** 计划文件在项目缓存里的位置，见「03 数据模型」第五节。文件夹用阶段的标识。 */
  planFile: copy(".product-loop/rounds/{label}/计划.md", { label }),
  /** 交计划时的警告：功能改动里认不出任何一件。 */
  noItems: {
    message: copy("计划「功能改动」里没有列出任何一件。"),
    hint: copy(
      "每件写成一个顶格的列表项或三级标题。标题写这一件的名字，下面写检查命令和它查的是什么。",
    ),
  },
  /** 规矩 land.order：上一步的记录不在，不进下一步。 */
  order: {
    noPlan: {
      message: copy("{round}还没有交计划。", { round }),
      hint: copy("先在项目缓存里写好计划.md，再运行 ploop land plan。"),
    },
    noTidy: {
      message: copy("还没有记重构。"),
      hint: copy(
        "做了重构的，运行 ploop land tidy -- <检查命令>。计划写了不要重构的，运行 ploop land tidy --skip。",
      ),
    },
    noRed: {
      message: copy("「{name}」没有改之前失败的记录。", { name }),
      hint: copy("先运行 ploop land red {name} -- <检查命令>，看到它失败，再动手改。", { name }),
    },
    noChanges: {
      message: copy("还没有记任何一件功能改动。"),
      hint: copy("每件功能改动先运行 ploop land red，改完以后运行 ploop land green。"),
    },
    notPassed: {
      message: copy("还有功能改动没有通过：{names}。", {
        names: "空列表显示一句提示、保存按钮不被挡住",
      }),
      hint: copy(
        "每件改完以后运行 ploop land green <名字> -- <失败时的命令>。全部通过以后再评审。",
      ),
    },
  },
  tidy: {
    /** 规矩 land.tidy.skip。 */
    skipWanted: {
      message: copy("计划写的是要重构，不能跳过。"),
      hint: copy("确实不用重构的，先把计划改成「不要」并写理由，运行 ploop land plan 以后再跳过。"),
    },
    /** 规矩 land.tidy.passed。 */
    failed: {
      message: copy("重构以后检查没有通过，退出码是 {exitCode}。", { exitCode: 1 }),
      hint: copy("重构不该改变任何行为。改到检查通过，再运行 ploop land tidy。"),
    },
    /** 规矩 land.commit.recorded。 */
    commitMissing: {
      message: copy("重构以后的检查没有记下当时的提交。"),
      hint: copy("在项目的 git 仓库里运行 ploop land 的各条命令。"),
    },
    /** 规矩 land.tidy.committed。 */
    notCommitted: {
      message: copy("重构还没有提交：检查时的提交 {commit} 就是这个阶段开始时的提交。", {
        commit: "3f9c2e1",
      }),
      hint: copy("重构单独提交一次，再运行 ploop land tidy。"),
    },
    /** 规矩 land.change.planned：重构的检查命令写在「用什么锁住现有的行为」。 */
    notPlanned: {
      message: copy("重构的检查命令 {command} 没有原样写在计划「用什么锁住现有的行为」里。", {
        command,
      }),
      hint: copy("把这条命令原样写进那一节，运行 ploop land plan，再重跑 ploop land tidy。"),
    },
  },
  /** 规矩 land.change.planned：功能改动在计划里，对应的事在这一批里。 */
  change: {
    nameBlank: {
      message: copy("功能改动的名字是空的。"),
      hint: copy("写上计划「功能改动」里这一件标题那一行的字。"),
    },
    notInPlan: {
      message: copy("计划「功能改动」里没有叫「{name}」的一件。计划里有的是：{names}。", {
        name: "空列表",
        names: "空列表显示一句提示、保存按钮不被挡住",
      }),
      hint: copy(
        "名字写成这一件标题那一行的字。计划里还没有这一件的，先补进计划，运行 ploop land plan。",
      ),
    },
    noneListed: {
      message: copy("计划「功能改动」里没有列出任何一件，找不到「{name}」。", { name }),
      hint: copy(
        "每件写成一个顶格的列表项或三级标题，标题写名字。补好以后运行 ploop land plan，再重跑。",
      ),
    },
    commandNotPlanned: {
      message: copy("检查命令 {command} 没有原样写在计划「{name}」这一件下面。", { command, name }),
      hint: copy(
        "在这一件下面原样写上检查命令，再写一句它查的是什么。然后运行 ploop land plan，再重跑。",
      ),
    },
    queueNotInBatch: {
      message: copy("「{name}」对应的 {ids} 不在这一批里。", { name, ids: "Q15" }),
      hint: copy(
        "这一批只做开始这个阶段时拿出的事。把这件改动对到这一批的事上，别的事留到以后的阶段。",
      ),
    },
  },
  red: {
    /** 规矩 land.red.failed：命令没有跑起来，退出码是 126 或 127。 */
    notStarted: {
      message: copy("检查命令 {command} 没有跑起来，退出码是 {exitCode}。没跑起来不算失败。", {
        command,
        exitCode: 127,
      }),
      hint: copy("确认程序的名字和路径写对了，再重跑 ploop land red。"),
    },
  },
  green: {
    /** 规矩 land.oneCommit 的警告，见「04 命令行」第十节。 */
    oneCommit: {
      message: copy("「{name}」失败和通过之间有 {count} 个提交。", { name, count: 3 }),
      hint: copy("一件功能改动只提交一次。多出来的提交如果是别的改动，拆成另一件记。"),
    },
  },
  /** 请求本身写错的地方，返回 BAD_REQUEST。 */
  request: {
    commit: {
      message: copy("提交号「{commit}」写得不对。", { commit: "HEAD" }),
      hint: copy("写 git rev-list 打印的完整提交号，是四十位或六十四位的小写十六进制。"),
    },
    queueId: {
      message: copy("队列编号「{text}」写得不对。", { text: "q12" }),
      hint: copy("写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。"),
    },
    fileLines: {
      message: copy("改动的文件「{path}」的行数写得不对。", { path: "src/list.ts" }),
      hint: copy("增加和删除的行数都写成不小于 0 的整数，二进制文件写 0。"),
    },
    skipReasonBlank: {
      message: copy("跳过评审要写理由。"),
      hint: copy("写明这一批为什么不用评审，例如「只改了一句文案」。"),
    },
    opinionTextBlank: {
      message: copy("第 {index} 条评审意见没有写内容。", { index: 2 }),
      hint: copy("写明这一条意见说的是什么。"),
    },
  },
  review: {
    /** 规矩 land.review.located。 */
    notLocated: {
      message: copy("第 {index} 条评审意见没有指到文件和行。", { index: 2 }),
      hint: copy("每条意见写 file 和 line，line 是从 1 数的行号。指不到具体位置的意见不收。"),
    },
    /** 规矩 land.review.disposed。 */
    notDisposed: {
      message: copy("{file} 第 {line} 行的阻塞意见没有写处置。", { file: "src/list.ts", line: 12 }),
      hint: copy("在 disposition 里写明改了什么，或者为什么不改。"),
    },
    /** 规矩 land.review.required：超过界线却跳过评审。 */
    required: {
      message: copy("这一批的改动超过了评审界线，不能跳过评审：{reasons}。", {
        reasons: "改了 85 行，界线是 60 行",
      }),
      hint: copy(
        "另开一个没看过过程的子代理，只给它 ploop land diff 的输出。再用 ploop land review 交评审意见。",
      ),
    },
    /** 规矩 land.plan.sections：计划从简，改动却超过了评审界线，计划要补全七节。 */
    planShort: {
      message: copy("这一批的改动超过了评审界线，计划要写全七节，还缺：{names}。", {
        names: "现状、要不要先重构、对应哪个场景、裁决",
      }),
      hint: copy("补全这几节，运行 ploop land plan，再重新评审。"),
    },
    /** 改动在界线以内，评审自动跳过，理由记成这一句，见改进 D03。 */
    autoSkip: copy("自动跳过评审：改动 {lines} 行、{files} 个文件，在界线以内。", {
      lines: 12,
      files: 2,
    }),
    /** 超过界线的几种情况，拼进上面的 reasons，用逗号隔开。 */
    over: {
      lines: copy("改了 {lines} 行，界线是 {max} 行", { lines: 85, max: 60 }),
      files: copy("改了 {files} 个文件，界线是 {max} 个", { files: 5, max: 3 }),
      dependency: copy("改了依赖的文件 {files}", { files: "/work/app/package.json" }),
      dataFormat: copy("改了数据格式的文件 {files}", {
        files: "/work/app/packages/backend/drizzle/0008_land.sql",
      }),
    },
  },
  /** ploop land status 列出的缺口：什么还没做，怎么做。 */
  missing: {
    plan: {
      message: copy("还没有交计划。"),
      hint: copy("在项目缓存里写好计划.md，再运行 ploop land plan。"),
    },
    tidyStale: {
      message: copy("计划改成了要重构，之前记的是跳过重构。"),
      hint: copy("做完重构并提交以后，运行 ploop land tidy -- <检查命令>。"),
    },
    notStarted: {
      message: copy("「{name}」还没有改之前失败的记录。", { name }),
      hint: copy("运行 ploop land red {name} -- <检查命令>。", { name }),
    },
    failedOnly: {
      message: copy("「{name}」只有失败的记录，还没有通过。", { name }),
      hint: copy("改完并提交以后，运行 ploop land green {name} -- <失败时的命令>。", { name }),
    },
    unplanned: {
      message: copy("「{name}」不在现在的计划里。", { name }),
      hint: copy("把它补回计划「功能改动」里，再运行 ploop land plan。"),
    },
    review: {
      message: copy("还没有评审，也没有写明跳过评审的理由。"),
      hint: copy("运行 ploop land diff 交给评审，再运行 ploop land review。"),
    },
    reviewStale: {
      message: copy("评审以后又记了功能改动：{names}。", { names: name }),
      hint: copy("把新的改动也交给评审，再运行 ploop land review。"),
    },
  },
  /** 下一步，每条是一条完整的命令，见「04 命令行」第五节。 */
  next: {
    plan: copy("ploop land plan"),
    /** 计划里「用什么锁住现有的行为」写了命令，就填进去；没写命令时才留占位。 */
    tidy: copy("ploop land tidy -- {command}", { command: "pnpm test" }),
    tidySkip: copy("ploop land tidy --skip"),
    /** 名字取自计划的功能改动，检查命令取自那一件下面写的命令。 */
    red: copy("ploop land red {name} -- {command}", { name: "空列表", command: "node check.js" }),
    /** 失败时的命令就是记下的那一次，名字和命令都是已知的。 */
    green: copy("ploop land green {name} -- {command}", {
      name: "空列表",
      command: "node check.js",
    }),
    diff: copy("ploop land diff"),
    review: copy("ploop land review"),
    status: copy("ploop land status"),
    /** 已经收尾的落地阶段，五步不用再做，下一步看项目的状态。 */
    projectStatus: copy("ploop status"),
    /** 前四步齐了，下一步写验收页：更改卡的写法看例子，写好再给出。 */
    pageExample: copy("ploop page example --stage 落地"),
  },
};
