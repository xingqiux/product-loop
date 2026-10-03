import { copy } from "@product-loop/model";

// ploop round start|show|close 的文案，见「04 命令行」第二到五节。
// 对用户显示的文字里，阶段写成「第 2 版的落地阶段」，页写成「第 2 版的落地阶段的第 2 页」，见决定 211。
// round start 的帮助照第四节的样例逐字写。暂时放在命令行里，以后并进共用定义的文案表。

const round = "第 2 版的检查阶段";
const label = "v2-检查-1";

export const roundCopy = {
  help: {
    description: copy("阶段的开始、查看和收尾"),
    start: {
      description: copy("开始一个阶段"),
      details: {
        take: copy("从队列拿出这个阶段的事，编好第几版和第几次。"),
        mainline: copy("主线缺几个部分也会写出来。"),
      },
      stage: copy("构思、使用、检查、落地、提升之一"),
      take: copy("落地阶段定这一批，例如 Q12,Q15；不写拿全部待办"),
      defer: copy("这件事要等别的事，改成等待并写明依赖；可以写多次"),
      allScreens: copy("检查时列出全部的屏，不只列这一版新出现或变过的"),
      blocks: {
        reply: {
          situation: copy("上一个阶段的回复还有行没有处理"),
          fix: copy("先运行 ploop reply show，再用 ploop reply handle 处理"),
        },
        open: {
          situation: copy("另一个阶段还开着且不能自动收尾"),
          fix: copy("先运行 ploop round close"),
        },
        doctor: { situation: copy("项目停在旧版本的 skill"), fix: copy("先运行 ploop doctor") },
        spec: {
          situation: copy("进入检查阶段时主线的设计规范缺部分"),
          fix: copy("按输出补主线，再开始"),
        },
      },
      reads: copy("项目缓存的 project.json、主线.md"),
      writes: copy("集中存储的阶段和队列，项目缓存的工作区；主线.md 有改动先交成新修订"),
      examples: {
        check: copy("ploop round start 检查"),
        land: copy('ploop round start 落地 --take Q12,Q15 --defer Q9="等构思定下场景 S4"'),
      },
      after: {
        drop: copy("不成立的事：ploop queue drop <编号> --reason <原因>"),
        present: copy("页面数据写进 page.json，再运行 ploop page present"),
      },
      /** --defer 的取值写错了。 */
      deferInvalid: copy("写成 <编号>=<依赖>，例如 Q9=等构思定下场景 S4。"),
      takeInvalid: copy("写成用逗号隔开的编号，例如 Q12,Q15。"),
    },
    list: {
      description: copy("列出这一版的阶段"),
      details: { same: copy("和 ploop version show 相同。") },
      example: copy("ploop round list"),
      after: copy('ploop round show "第 2 版的落地阶段"'),
    },
    show: {
      description: copy("查看一个阶段"),
      details: {
        what: copy("写状态、拿出来的事、给出过的页和收到的回复，回复的每一行带去处。"),
        current: copy("不写阶段就看当前的阶段。"),
        short: copy("只写「落地」，指这一版里最近一次的落地阶段。"),
        label: copy("也认 --json 输出里 label 的写法。"),
        legacy: copy("迁移前的文件名也认，2026-12-31 删除。"),
      },
      round: copy("阶段，写成「第 2 版的落地阶段」，第二次加「（第 2 次）」"),
      blocks: {
        ambiguous: {
          situation: copy("迁移前的文件名对上了不止一个阶段"),
          fix: copy("按报错列出的几个阶段，改用阶段的写法"),
        },
      },
      reads: copy("项目缓存的 project.json、主线.md，集中存储的阶段和队列"),
      writes: copy("不写"),
      examples: {
        current: copy("ploop round show"),
        label: copy('ploop round show "第 2 版的落地阶段"'),
        again: copy('ploop round show "第 2 版的落地阶段（第 2 次）"'),
        short: copy("ploop round show 落地"),
      },
      after: copy("按 ploop status 的「下一步」运行"),
    },
    close: {
      description: copy("收尾一个阶段"),
      details: {
        results: copy("检查这个阶段拿出来的事都有结果。"),
        land: copy("落地阶段另查代码全部提交。"),
        abort: copy("--abort 放弃一个阶段；给用户看过更改以后不能放弃。"),
      },
      done: copy("这件事做完了，写明证据，例如 Q12=提交 3f2a9c1；可以写多次"),
      back: copy("退回队列并写原因；写 Q15:构思=原因 就退到构思"),
      summary: copy("收尾说明，一句话写这个阶段做了什么"),
      abort: copy("放弃这个阶段，写原因；拿出的事退回待办，不要求给页"),
      blocks: {
        noResult: {
          situation: copy("拿出来的事还没有结果"),
          fix: copy("用 --done 或 --return 写明每件事的结果"),
        },
        waiting: {
          situation: copy("还有一页在等用户点"),
          fix: copy("先运行 ploop reply wait，或用 ploop page withdraw 撤回"),
        },
        unhandled: {
          situation: copy("回复还有行没有处理"),
          fix: copy("先运行 ploop reply show，再用 ploop reply handle 处理"),
        },
        rejected: {
          situation: copy("用户对更改点了不认可，却写了 --done"),
          fix: copy("改写成 --return <编号>:落地=<原因>"),
        },
      },
      reads: copy("项目缓存的 project.json、主线.md"),
      writes: copy("集中存储的阶段、队列"),
      examples: {
        plain: copy("ploop round close"),
        abort: copy('ploop round close --abort "计划要改"'),
        full: copy(
          'ploop round close --done Q12="提交 3f2a9c1" --return Q15:构思="定义不对" --summary "修好了设置页"',
        ),
      },
      after: copy("按输出的「下一步」开始下一个阶段"),
      doneInvalid: copy("写成 <编号>=<证据>，例如 Q12=提交 3f2a9c1。"),
      backInvalid: copy("写成 <编号>=<原因> 或 <编号>:<阶段名>=<原因>，例如 Q15:构思=定义不对。"),
    },
  },
  output: {
    started: copy("开始了：{round}", { round }),
    autoClosed: copy("开始以前替{round}收了尾。", { round: "第 2 版的使用阶段" }),
    versionChanged: copy("进入了第 {started} 版，第 {ended} 版已结束：{reason}", {
      started: 3,
      ended: 2,
      reason: "第 2 版的提升阶段已收尾。",
    }),
    takenHead: copy("拿出来的事："),
    takenNone: copy("这个阶段没有待办的事。"),
    deferredHead: copy("改成等待的事："),
    waitingHead: copy("还在等待的事，这次没有拿出来："),
    waitingRow: copy("  {id}  {content}（等：{dependsOn}）", {
      id: "Q3",
      content: "队列看板加上按阶段筛选",
      dependsOn: "等构思定下场景 S4",
    }),
    waitingHow: copy("  等的事做完了，运行 ploop queue reopen {id}，改回待办。", { id: "Q3" }),
    itemRow: copy("  {id}  {content}", { id: "Q12", content: "设置页的保存按钮在窄屏被挡住" }),
    deferredRow: copy("  {id}  {content}（等：{dependsOn}）", {
      id: "Q9",
      content: "队列看板加上按阶段筛选",
      dependsOn: "等构思定下场景 S4",
    }),
    baseHead: copy("起点提交："),
    /** 只有一个根目录时，不写路径。 */
    baseRow: copy("  {root}  {commit}", { root: "/Users/me/proj/app", commit: "3f2a9c1e5b7d" }),
    baseRowOne: copy("  {commit}", { commit: "3f2a9c1e5b7d" }),
    screensHead: copy("这一版新出现或变过的屏，按场景分组："),
    screensAllHead: copy("这一版的全部屏，按场景分组："),
    screensNone: copy("这一版没有新出现或变过的屏。"),
    mainline: copy("主线：{total} 个部分齐全，设计规范 {spec} 个部分齐全", { total: 10, spec: 12 }),
    workspace: copy("工作区：{path}", { path: `.product-loop/rounds/${label}/` }),
    /**
     * 开始以后先做什么：主线缺哪样、页面怎么写，指到命令上。
     * 对用户显示的文字不用「轮」，也不写阶段的标识，见决定 211。路径里的除外，它是文件夹的名字。
     */
    todoHead: copy("先做："),
    todo: {
      drop: copy("  判断：不成立的，运行 ploop queue drop {id} --reason <原因>。", {
        id: "Q12",
      }),
      mainline: copy(
        "  主线：补 {file}。缺哪几个部分，运行 ploop mainline check。补完运行 ploop mainline push。",
        { file: ".product-loop/主线.md" },
      ),
      spec: copy("  设计规范：缺 {count} 个部分，进入检查阶段前补齐。", { count: 2 }),
      think: copy(
        "  页面：页面数据写进 {dir}page.json。例子运行 ploop page example --stage 构思，字段运行 ploop page schema --brief --stage 构思。写好运行 ploop page check。",
        { dir: `.product-loop/rounds/${label}/` },
      ),
      check: copy(
        "  页面：逐屏看，页面数据写进 {dir}page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。",
        { dir: `.product-loop/rounds/${label}/` },
      ),
      improve: copy(
        "  页面：以产品设计师的眼光，写进 {dir}page.json。例子运行 ploop page example --stage 提升，字段运行 ploop page schema --brief --stage 提升。写好运行 ploop page check。",
        { dir: `.product-loop/rounds/${label}/` },
      ),
      land: copy("  计划：写进 {dir}计划.md，写好运行 ploop land plan。", {
        dir: `.product-loop/rounds/${label}/`,
      }),
      landSections: copy(
        "  七节：{names}。小改动只写要做的事、功能改动、用什么锁住现有的行为三节。",
        {
          names: "要做的事、现状、要不要先重构、功能改动、用什么锁住现有的行为、对应哪个场景、裁决",
        },
      ),
      useKnown: copy("  使用代码：运行过，下一步的命令可以再跑一遍。"),
      useNew: copy(
        "  使用代码：还没运行过。放在 {dir}，覆盖表写在 {dir}覆盖表.md。用 ploop use run -- <命令> 运行。输出格式运行 ploop use schema。",
        { dir: "scripts/use/" },
      ),
      usePage: copy(
        "  页面：使用阶段的页只给用户看，不等回复。没有断点、没有缺口时，运行使用代码以后系统自动给出，下一次开始阶段时自动收尾。",
      ),
    },
    /** round show。 */
    head: copy("{round}：{status}", { round, status: "进行中" }),
    openedBy: copy("开始：{time}，会话 {session}", {
      time: "2026-09-28 16:05",
      session: "7f3a9c2e",
    }),
    /** 没有会话标识时不写会话：标识来自环境变量 PLOOP_SESSION，可以不设。 */
    openedNoSession: copy("开始：{time}", { time: "2026-09-28 16:05" }),
    legacy: copy("迁移前的文件名：{legacy}", { legacy: "fix-13" }),
    closedAt: copy("收尾：{time}", { time: "2026-09-28 18:20" }),
    summary: copy("收尾说明：{summary}", { summary: "修好了设置页" }),
    itemsHead: copy("拿出来的事："),
    itemsNone: copy("拿出来的事：没有"),
    itemState: copy("  {id}  {state}  {content}", {
      id: "Q12",
      state: "进行中",
      content: "设置页的保存按钮在窄屏被挡住",
    }),
    returnedTo: copy("退回{stage}", { stage: "构思" }),
    pagesHead: copy("给出过的页："),
    pagesNone: copy("给出过的页：没有"),
    pageRow: copy("  第 {seq} 页，{purpose}，{status}，{time}", {
      seq: 1,
      purpose: "要用户点",
      status: "已给出",
      time: "2026-09-28 16:40",
    }),
    repliesHead: copy("收到的回复："),
    repliesNone: copy("收到的回复：没有"),
    replyRow: copy("  第 {seq} 页的回复（回复 {id}），{count} 行，还没处理 {pending} 行", {
      seq: 1,
      id: 12,
      count: 4,
      pending: 2,
    }),
    /** round close。 */
    closed: copy("收尾了：{round}", { round }),
    aborted: copy("放弃了：{round}", { round }),
    /** 已经收尾的阶段再收尾，见规矩：重复运行同一条命令不算错。 */
    alreadyClosed: copy("已经收尾了：{round}，不用再收尾。", { round: "第 1 版的检查阶段" }),
    resultsHead: copy("拿出来的事的结果："),
  },
  /** 当前项目还没有阶段，不写阶段的 show 和 close 找不到。 */
  noRound: {
    message: copy("这一版还没开始任何阶段。"),
    hint: copy("运行 ploop round start <阶段名> 开始一个阶段。"),
  },
};
