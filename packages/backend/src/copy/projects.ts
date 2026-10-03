import { copy, type ErrorCopy } from "@product-loop/model";
import type { DoctorReason } from "../core/projects.ts";

// 项目、版本和状态的文案：报错写什么不对、怎么改，下一步写完整的命令，见「04 命令行」第五、六节。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const projectsCopy = {
  /** 登记项目、加减根目录时，根目录不合要求。 */
  root: {
    /** 命令行交来的都是绝对路径，这一条只在程序写错时出现。 */
    notAbsolute: {
      message: copy("根目录「{path}」不是绝对路径。", { path: "proj/app" }),
      hint: copy("写成从 / 开始的完整路径。"),
    },
    userHome: {
      message: copy("「{path}」是家目录，不能当项目根目录。", { path: "/Users/someone" }),
      hint: copy("换成项目自己的文件夹，例如 ~/proj/<项目名>。"),
    },
    /** 家目录的上级，例如 / 和 /Users。 */
    aboveHome: {
      message: copy("「{path}」包含家目录，不能当项目根目录。", { path: "/Users" }),
      hint: copy("换成项目自己的文件夹，例如 ~/proj/<项目名>。"),
    },
    /** 这个目录下的 .product-loop 就是集中存储，项目缓存会和它是同一个文件夹。 */
    storeParent: {
      message: copy("「{path}」下的 .product-loop 是集中存储，不能当项目根目录。", {
        path: "/Users/someone/dev",
      }),
      hint: copy("换一个文件夹，或者用 PLOOP_HOME 把集中存储指到别处。"),
    },
    taken: {
      message: copy("根目录「{path}」已经登记给项目「{project}」。", {
        path: "/Users/someone/proj/app",
        project: "app",
      }),
      hint: copy("在那个项目里接着用。要改登记，先从那个项目删掉这个根目录。"),
    },
    notInProject: {
      message: copy("项目「{project}」没有登记根目录「{path}」。", {
        project: "app",
        path: "/Users/someone/proj/app-old",
      }),
      hint: copy("运行 ploop status，查看这个项目登记了哪些根目录。"),
    },
    /** 删完以后一个根目录都不剩。 */
    none: {
      message: copy("项目「{project}」至少要留一个根目录。", { project: "app" }),
      hint: copy("先加上新的根目录，再删旧的。"),
    },
  },
  name: {
    empty: {
      message: copy("项目的名称不能是空的。"),
      hint: copy("写一个名称，它会出现在每一页的页头上。"),
    },
  },
  project: {
    notFound: {
      message: copy("没有叫「{id}」的项目。", { id: "app-2" }),
      hint: copy("运行 ploop status --all，查看已登记的项目。"),
    },
    /** 按路径找项目，这个路径不在任何登记过的根目录里。 */
    notRegistered: {
      message: copy("「{path}」不在任何登记过的项目根目录里。", {
        path: "/Users/someone/proj/app/src",
      }),
      hint: copy("新项目先在根目录运行 ploop init。已登记的项目运行 ploop doctor，检查根目录。"),
    },
  },
  /** 会改数据的操作遇到要先做迁移检查的项目，见「08 版本与迁移」第三、四节。 */
  doctor: {
    migrationIncomplete: {
      message: copy("项目「{project}」的迁移还没完成，要先做迁移检查。", { project: "app" }),
      hint: copy(
        "运行 ploop doctor，按报告做完迁移。迁移完成以前，这个项目的旧文件仍可以用旧的脚本处理。",
      ),
    },
    skillOutdated: {
      message: copy("项目「{project}」停在 skill {version}，现在的软件要求 {minimum} 以上。", {
        project: "app",
        version: "1.9.0",
        minimum: "0.0.1",
      }),
      hint: copy("运行 ploop doctor，把这个项目的数据升级到现在的格式。"),
    },
  } satisfies Record<DoctorReason, ErrorCopy>,
  /** ploop version next 的报错。 */
  version: {
    reasonEmpty: {
      message: copy("提前结束一版要写一句原因。"),
      hint: copy("写明为什么在这里结束，例如「跳过提升，先做下一版」。"),
    },
    roundOpen: {
      message: copy("{round}还没收尾，第 {version} 版现在不能结束。", {
        round: "第 2 版的落地阶段（第 3 次）",
        version: 2,
      }),
      hint: copy("先运行 ploop status，把这个阶段做完并收尾，再结束这一版。"),
    },
    /** 迁移完成时第 1 版已经结束，下一版等开始阶段时才建。 */
    ended: {
      message: copy("第 {version} 版已经结束，下一次开始阶段时自动进入第 {next} 版。", {
        version: 1,
        next: 2,
      }),
      hint: copy("直接运行 ploop round start <阶段名>。"),
    },
  },
  /**
   * 状态里的下一步，每条是一条现在敲了就能成功的完整命令，见「04 命令行」第五节。
   * 已经知道的值直接写进去，不留占位符：使用代码的命令取自最近一次运行。
   */
  next: {
    doctor: copy("ploop doctor"),
    roundStart: copy("ploop round start {stage}", { stage: "构思" }),
    pagePresent: copy("ploop page present"),
    pageExample: copy("ploop page example --stage {stage}", { stage: "构思" }),
    useRun: copy("ploop use run -- {command}", { command: "node scripts/use/run.mjs" }),
    useSchema: copy("ploop use schema"),
    landStatus: copy("ploop land status"),
    /** 落地阶段还没交计划：写好计划.md 以后交。 */
    landPlan: copy("ploop land plan"),
    replyWait: copy("ploop reply wait"),
    replyShow: copy("ploop reply show"),
    roundClose: copy("ploop round close"),
    /** 这个阶段拿出的事还在进行中，收尾要给每件事写结果：先写成做完，证据由 AI 填。 */
    mainlineCheck: copy("ploop mainline check"),
  },
};
