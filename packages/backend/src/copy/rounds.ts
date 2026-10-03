import { copy } from "@product-loop/model";

// 开始阶段和收尾的文案：报错写什么不对、怎么改，下一步写完整的命令，见「04 命令行」第四到六节。
// 队列事项找不到、状态图的报错用队列的文案，根目录没登记用项目的文案，这里只补阶段自己的。
// 文案里的 {round} 是阶段的叫法，例如「第 2 版的构思阶段」，见 model 的 formatRoundName。命令里写它要加引号。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const round = "第 2 版的构思阶段";
const root = "/Users/someone/proj/app";

export const roundsCopy = {
  /** 已有一个阶段没收尾，见「01 架构」第七节：写明是哪个阶段、什么时候、哪个会话开的。 */
  open: {
    message: copy("{round}还没收尾，是会话 {session} 在 {at} 开始的。", {
      round,
      session: "7f3a9c2e",
      at: "2026-09-28 16:05",
    }),
    /** 开它的请求没带会话的标识（PLOOP_SESSION 可以不设），或者是迁移进来的阶段：不提会话。 */
    messageNoSession: copy("{round}还没收尾，它在 {at} 开始。", {
      round,
      at: "2026-09-28 16:05",
    }),
    hint: copy(
      '怕别的会话在做，先运行 ploop round show "{round}"。没人在做，运行 ploop round close 收尾，再开始新的阶段。',
      { round },
    ),
  },
  take: {
    /** 只有落地阶段用 --take 定这一批，别的阶段拿出这个阶段全部待办的事。 */
    notLand: {
      message: copy("只有落地阶段用 --take 定这一批，{stage}阶段拿出全部待办的事。", {
        stage: "检查",
      }),
      hint: copy("去掉 --take 再重跑。这个阶段不做的事，用 --defer 改成等待并写明依赖。"),
    },
    empty: {
      message: copy("--take 没有写编号。"),
      hint: copy("写上这一批的编号，例如 --take Q12,Q15。不写 --take 就拿出落地全部待办的事。"),
    },
    /** 规矩 round.take.stage：落地阶段这一批只拿落地的事，见「08 版本与迁移」第二节。 */
    stage: {
      message: copy("{id} 要在{stage}阶段做，不能拿进落地阶段。", { id: "Q12", stage: "检查" }),
      hint: copy("从 --take 里去掉 {id}，它留到{stage}阶段再做。", { id: "Q12", stage: "检查" }),
    },
  },
  defer: {
    /** 改成等待没写依赖。怎么改用队列的 waitingDependsOn。 */
    dependsOnBlank: {
      message: copy("{id} 改成等待要写明依赖。", { id: "Q9" }),
    },
    duplicate: {
      message: copy("{id} 在 --defer 里写了不止一次。", { id: "Q9" }),
      hint: copy("每件事只写一次 --defer，依赖合成一句。"),
    },
  },
  /** 同一件事写在 --take 和 --defer 两处。 */
  takeAndDefer: {
    message: copy("{id} 同时写在 --take 和 --defer 里。", { id: "Q12" }),
    hint: copy("这一批要做的写进 --take，要等别的事的写进 --defer，一件事只写一处。"),
  },
  /** 落地阶段开始时各个根目录的提交，见约定 0001 第 12 条。 */
  base: {
    notLand: {
      message: copy("{stage}阶段不记开始时的提交，只有落地阶段记。", { stage: "检查" }),
      hint: copy("开始{stage}阶段时不交各个根目录的提交号。", { stage: "检查" }),
    },
    commit: {
      message: copy("根目录「{root}」的提交号「{commit}」写得不对。", { root, commit: "HEAD" }),
      hint: copy("写 git rev-parse HEAD 打印的完整提交号，是四十位或六十四位的小写十六进制。"),
    },
    duplicate: {
      message: copy("根目录「{root}」的提交号交了不止一次。", { root }),
      hint: copy("每个根目录只交一个提交号。"),
    },
  },
  mainline: {
    /** 规矩 mainline.ten 的警告：还没交过主线。 */
    none: {
      message: copy("项目还没有主线，10 个部分都缺。"),
      hint: copy("在项目缓存的主线.md 里写主线，缺哪个部分补哪个。"),
    },
    /** 规矩 mainline.ten 的警告：十个部分有缺的。缺哪几个只在 ploop mainline check 里写一次。 */
    partsMissing: {
      message: copy("主线缺 {count} 个部分。", { count: 2 }),
      hint: copy("运行 ploop mainline check，看缺哪几个；已经写好的不用重写。"),
    },
    /** 规矩 mainline.spec.twelve 的拦截：进入检查阶段时，设计规范的十二个部分有缺的。 */
    specMissing: {
      message: copy("设计规范缺 {count} 个部分，进入检查阶段前要补上。", { count: 3 }),
      hint: copy(
        "运行 ploop mainline check 看缺哪几个。每个部分一个三级标题，这个产品没有的写「无」和原因。",
      ),
    },
    /** 位置：主线在项目缓存里的文件。 */
    where: copy("主线.md"),
  },
  /** 收尾：拿出的每件事都有结果，见「00 总览」第一节。 */
  close: {
    /** 落地阶段收尾的两条检查，见规矩 land.commit.clean。 */
    land: {
      noWorktree: {
        message: copy("落地阶段收尾要带上工作区的状态。"),
        hint: copy("用 ploop round close 收尾，命令会查各个根目录有没有没提交的改动。"),
      },
      dirty: {
        message: copy("{root} 里有 {count} 个文件没有提交：{files}。", {
          root: "/Users/me/proj/app",
          count: 2,
          files: "src/app.ts、README.md",
        }),
        hint: copy("提交或还原这些改动，再收尾。"),
      },
      noPage: {
        message: copy("{round}还没有给用户看过要点的页，也没有给看过更改，不能收尾。", { round }),
        hint: copy(
          "运行 ploop page present 给出验收页，用户看过以后再收尾。这个阶段不做了，运行 ploop round close --abort <原因>。",
        ),
      },
      returnStage: {
        message: copy("落地阶段退回的 {id} 没写退回哪个阶段。", { id: "Q12" }),
        hint: copy("写成 --return {id}:构思=<原因>。阶段是构思、使用、检查、落地、提升之一。", {
          id: "Q12",
        }),
      },
      /** 规矩 land.change.rejected：用户对更改点了不认可，对应的事要退回，不能记成做完。 */
      rejected: {
        message: copy("用户对「{card}」点了不认可，{id} 不能记成做完。", {
          card: "看板放到首页",
          id: "Q3",
        }),
        hint: copy(
          "运行 ploop round close --return {id}:落地=<原因>，退回队列，改好以后再给用户看。",
          { id: "Q3" },
        ),
      },
    },
    /** 放弃一个阶段：拿出的事退回待办，不要求给页，见 A05。 */
    abort: {
      blank: {
        message: copy("放弃这个阶段要写原因。"),
        hint: copy("写明为什么放弃，例如「计划要改」。"),
      },
      withResults: {
        message: copy("放弃不和逐件写结果、收尾说明一起写。"),
        hint: copy("放弃时拿出的事都退回待办。去掉 --done、--return 和 --summary 再重跑。"),
      },
      changes: {
        message: copy("{round}已经给用户看过更改，不能放弃。", { round }),
        hint: copy(
          "用 ploop round close 收尾：做完的写 --done，不做的写 --return <编号>:落地=<原因>。",
        ),
      },
      /** 收尾说明：放弃的原因。 */
      summary: copy("放弃：{reason}", { reason: "计划要改" }),
    },
    /** 规矩 think.leave：构思阶段收尾时，主线十个部分缺得太多。 */
    think: {
      message: copy("主线十个部分只写了 {have} 个，缺 {missing} 个，{round}不能收尾。", {
        have: 3,
        missing: 7,
        round,
      }),
      hint: copy(
        "缺的部分：{parts}。先把主线补到至少 {least} 个部分，改完运行 ploop mainline push。还不想收尾，就不必收尾，接着做这个阶段。",
        { parts: "场景清单、交付线", least: 5 },
      ),
      /** 还没交过主线。 */
      none: {
        message: copy("还没有交过主线，{round}不能收尾。", { round }),
        hint: copy(
          "写好项目缓存里的主线.md，运行 ploop mainline push。至少要写到十个部分里的 {least} 个。",
          {
            least: 5,
          },
        ),
      },
    },
    use: {
      noRun: {
        message: copy("{round}还没有收进使用代码的运行，看不出有没有断点。", { round }),
        hint: copy("运行 ploop use run -- <命令>，或用 ploop use ingest 收下结果。"),
        hintKnown: copy("运行 ploop use run -- {command}，把使用代码跑一遍。", {
          command: "node scripts/use/run.mjs",
        }),
      },
      broken: {
        message: copy("这个阶段最近一次运行有 {count} 步断了：{steps}。", {
          count: 2,
          steps: "S3 第 2 步、S5 第 1 步",
        }),
        step: copy("{scene} 第 {step} 步", { scene: "S3", step: 2 }),
        hint: copy(
          "把这几步在产品里断掉的地方修好，再运行一次使用代码，直到没有断点。确认是环境的问题，在使用记录里把这一步写成「环境」并写明原因。放进队列不能让断点清零，使用阶段收不了尾。",
        ),
      },
      /** 主线里有、最近一次运行没走到的步：每个场景都要真用一遍，见决定 215。 */
      unreached: {
        message: copy("主线里有 {count} 步最近一次运行没走到：{steps}。", {
          count: 3,
          steps: "S2 第 2、3 步，S4 第 1 步",
        }),
        scene: copy("{scene} 第 {steps} 步", { scene: "S2", steps: "2、3" }),
        more: copy("{list}，还有 {count} 个场景", { list: "S2 第 2 步", count: 2 }),
        hint: copy("让使用代码把这几步走到，再运行一次。主线里已经不用的步，先改主线。"),
      },
      noCoverage: {
        message: copy("这个阶段最近一次运行没有覆盖表，看不出有没有缺口。"),
        hint: copy("写好 {file}，再运行一次使用代码。", { file: "scripts/use/覆盖表.md" }),
      },
      gaps: {
        message: copy("覆盖表有 {count} 行没有场景用到：{items}。", {
          count: 1,
          items: "导出按钮",
        }),
        hint: copy("给这几行补上用到它的场景，或者删掉产品里已经没有的东西，再运行一次。"),
      },
    },
    /** 这个阶段还有一页在等用户点。先取回回复或撤回那一页，见 core/pages/withdraw.ts。 */
    waiting: {
      message: copy("{round}的第 {page} 页还在等用户点，现在不能收尾。", { round, page: 2 }),
      hint: copy(
        "先运行 ploop reply wait 取回用户的回复。用户不再回复这一页时，运行 ploop page withdraw 撤回它，再收尾。",
      ),
    },
    /** 按阶段的写法找不到这个阶段。 */
    notFound: {
      message: copy("项目「{project}」没有{round}。", { project: "app", round }),
      hint: copy("运行 ploop round list，查看这一版有哪几个阶段。"),
    },
    closed: {
      message: copy("{round}已经收尾了。", { round }),
      hint: copy("不用再收尾。运行 ploop status，查看下一步。"),
    },
    /** 规矩 round.close.result：还在进行中的事，请求里没写结果。 */
    noResult: {
      message: copy("{id} 还没有结果，{round}不能收尾。", { id: "Q12", round }),
      hint: copy(
        "写明 {id} 做完还是退回。做完运行 ploop round close --done {id}=<证据>。退回运行 ploop round close --return {id}=<原因>。",
        { id: "Q12" },
      ),
      /** 落地阶段退回要写退回哪个阶段，第一次就写对。 */
      hintLand: copy(
        "写明 {id} 做完还是退回。做完运行 ploop round close --done {id}=<证据>。退回运行 ploop round close --return {id}:落地=<原因>，冒号后写退回哪个阶段。",
        { id: "Q12" },
      ),
      /** 提升阶段选中的事改标阶段，选不改的取消，都不用 --done。 */
      hintImprove: copy(
        "选中的事运行 ploop reply handle <行> 队列 {id} --stage <阶段名>，改标阶段。不改的运行 ploop queue drop {id} --reason <原因>。",
        { id: "Q12" },
      ),
    },
    /** 规矩 round.close.result：这个阶段里已经改过状态的事，请求里又写了结果。 */
    settled: {
      message: copy("{id} 在这个阶段里已经有了结果：{result}。", {
        id: "Q15",
        result: "开始时取消",
      }),
      hint: copy("从请求里去掉 {id}，收尾时照已有的结果记下。", { id: "Q15" }),
    },
    /** 请求里写的事不是这个阶段拿出来的。 */
    notTaken: {
      message: copy("{round}拿出的事里没有 {id}。", { round, id: "Q9" }),
      hint: copy('运行 ploop round show "{round}"，查看这个阶段拿出了哪几件。', { round }),
    },
    duplicate: {
      message: copy("{id} 的结果写了不止一次。", { id: "Q12" }),
      hint: copy("每件事只写一个结果：做完或退回。"),
    },
    /** 做完没写完成证据。怎么改用队列的 doneEvidence。 */
    evidenceBlank: {
      message: copy("{id} 做完要写完成证据。", { id: "Q12" }),
    },
    reasonBlank: {
      message: copy("退回 {id} 要写原因。", { id: "Q12" }),
      hint: copy("写明为什么退回，例如「定义不对，先回到构思」。"),
    },
    /** 做完的事写了退回到哪个阶段。 */
    stageNotReturned: {
      message: copy("{id} 是做完的事，不写退回到哪个阶段。", { id: "Q12" }),
      hint: copy("去掉 {id} 的阶段再重跑。只有退回的事可以写阶段。", { id: "Q12" }),
    },
    summaryBlank: {
      message: copy("收尾说明是空的。"),
      hint: copy("写一句这个阶段做了什么，或者不写收尾说明。"),
    },
    /** 开始新的阶段时，已回复的上一个阶段还有进行中的事，不能自动收尾，见「04 命令行」第三节。 */
    auto: {
      message: copy("{round}还没收尾，{ids} 还没有结果，不能自动收尾。", {
        round,
        ids: "Q12、Q15",
      }),
      hint: copy(
        "先运行 ploop round close，{ids} 每件写一个结果。做完写 --done {first}=<证据>。退回写 --return {first}=<原因>。",
        { ids: "Q12、Q15", first: "Q12" },
      ),
    },
  },
  /** 看一个阶段，见 core/rounds/show.ts。找不到时用收尾的 notFound。 */
  show: {
    /** 只写了阶段名，这一版里还没有这个阶段。 */
    stageNotFound: {
      message: copy("项目「{project}」这一版还没有{stage}。", {
        project: "app",
        stage: "落地阶段",
      }),
      hint: copy("运行 ploop round list，查看这一版有哪几个阶段。"),
    },
    /** 迁移前的文件名对不上任何阶段。 */
    legacyNotFound: {
      message: copy("项目「{project}」没有迁移前的文件名是「{legacy}」的阶段。", {
        project: "app",
        legacy: "fix-13",
      }),
      hint: copy("运行 ploop round list，查看这一版有哪几个阶段。"),
    },
    /** 迁移前的文件名可以重名，对上了不止一个阶段。 */
    legacyAmbiguous: {
      message: copy("迁移前的文件名「{legacy}」对上了 {count} 个阶段：{labels}。", {
        legacy: "fix-13",
        count: 2,
        labels: "第 1 版的落地阶段（第 13 次）、第 1 版的落地阶段（第 14 次）",
      }),
      hint: copy(
        '改用阶段的写法，从上面几个里选一个，例如 ploop round show "第 1 版的落地阶段（第 13 次）"。',
      ),
    },
  },
  version: {
    /**
     * 提升阶段收尾以后，下一次开始阶段时结束这一版，这句写进结束的原因。
     * 见「08 版本与迁移」第二节。
     */
    improveClosed: copy("{round}已收尾。", { round: "第 2 版的提升阶段" }),
  },
};
