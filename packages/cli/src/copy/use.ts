import { copy } from "@product-loop/model";

// ploop use 各子命令的文案，见「04 命令行」第十一节和 S19。
// 暂时放在命令行里，以后并进共用定义的文案表。

const root = "/Users/me/proj/app";
const out = ".product-loop/use/20260928T160500Z/";

export const useCopy = {
  help: {
    description: copy("使用代码的运行、覆盖表和变过的屏"),
    coverageFile: copy("覆盖表的路径，相对根目录；不写用使用代码文件夹里的"),
    coverageDetails: {
      own: copy("覆盖表.md 默认位置：自己的仓库在 scripts/use/。"),
      shared: copy("共用的仓库在 .product-loop/use-code/。"),
    },
    run: {
      description: copy("运行使用代码"),
      details: {
        cwd: copy("在当前所在的根目录里运行。"),
        store: copy("再把它写的结果收进集中存储。"),
        stamp: copy("输出目录名里的时间是 UTC，以 Z 结尾。"),
      },
      command: copy("使用代码的命令，写在 -- 后面"),
      blocks: {
        shots: {
          situation: copy("use-run.json 引用的截图找不到"),
          fix: copy("把截图写进 PLOOP_USE_OUT 目录，路径相对这个目录"),
        },
        format: {
          situation: copy("use-run.json 不合输出格式"),
          fix: copy("按 ploop use schema 改使用代码"),
        },
        crashed: {
          situation: copy("使用代码没写 use-run.json 就结束了，退出码 1"),
          fix: copy("看报出的退出码和输出末尾，修好使用代码"),
        },
        broken: {
          situation: copy("运行里有断了的步，结果照常收下，退出码 1"),
          fix: copy("修好产品里断掉的地方，再运行一次"),
        },
      },
      reads: copy("使用代码写的 use-run.json 和截图，项目里的覆盖表"),
      writes: copy("use/<时间>/、集中存储的使用记录和屏；主线.md 有改动先交成新修订"),
      examples: { plain: copy("ploop use run -- node scripts/use/run.mjs") },
      after: {
        broken: copy("有断了的步：修好产品，再运行一次"),
        pass: copy("没有断点了：给用户看使用的结果"),
      },
    },
    ingest: {
      description: copy("收下结果（2026-12-31 删除）"),
      details: {
        what: copy("收下一个目录里的 use-run.json 和截图。"),
        run: copy("不运行命令。"),
      },
      dir: copy("use-run.json 所在的目录"),
      reads: copy("目录里的 use-run.json 和截图，项目里的覆盖表"),
      writes: copy("集中存储的使用记录和屏；主线.md 有改动时先交成新的修订"),
      examples: { plain: copy(`ploop use ingest ${out}`) },
      after: copy("ploop use changed"),
    },
    coverage: {
      description: copy("检查使用代码的覆盖表"),
      details: { what: copy("读项目里的覆盖表，列出没有场景用到的行。") },
      blocks: {
        gaps: {
          situation: copy("覆盖表有的行没有场景用到"),
          fix: copy("补上用到它的场景，或删掉这一行"),
        },
      },
      reads: copy("项目里的覆盖表"),
      writes: copy("不写"),
      examples: { plain: copy("ploop use coverage") },
      after: copy("ploop use run -- <命令>"),
    },
    changed: {
      description: copy("列出新出现和变过的屏"),
      details: { what: copy("列出这一版新出现和变过的屏，按场景分组。") },
      version: copy("按产品的第几版算，例如 2；不写用当前的一版"),
      versionInvalid: copy("--product-version 要写从 1 起的整数，例如 2。"),
      all: copy("连没变的屏一起列"),
      reads: copy("集中存储的屏"),
      writes: copy("不写"),
      examples: { plain: copy("ploop use changed"), all: copy("ploop use changed --all") },
      after: copy("开始检查阶段：ploop round start 检查"),
    },
    schema: {
      description: copy("打印使用代码输出格式的定义"),
      details: { what: copy("就是 use-run.json 的 JSON Schema。") },
      reads: copy("后端的共用定义"),
      writes: copy("不写"),
      examples: { plain: copy("ploop use schema > use-run.schema.json") },
      after: copy("按定义写使用代码，再运行 ploop use run"),
    },
  },
  output: {
    ran: copy("收下了使用代码的运行：通过 {pass} 步，断了 {broken} 步", { pass: 5, broken: 1 }),
    ingested: copy("收下了 {dir} 的结果：通过 {pass} 步，断了 {broken} 步", {
      dir: out,
      pass: 5,
      broken: 1,
    }),
    command: copy("运行：{command}，退出码 {exitCode}", {
      command: "node scripts/use/run.mjs",
      exitCode: 0,
    }),
    /** 项目有几个根目录时，写明在哪个根目录里运行的。 */
    commandIn: copy("运行：{command}（在 {cwd}），退出码 {exitCode}", {
      command: "node scripts/use/run.mjs",
      cwd: root,
      exitCode: 0,
    }),
    out: copy("输出目录：{dir}", { dir: out }),
    counts: copy("没走 {skipped} 步，环境问题 {environment} 步", { skipped: 0, environment: 1 }),
    brokenHead: copy("断了的步："),
    stepRow: copy("  {scene} 第 {step} 步{width}：{error}", {
      scene: "S3",
      step: 2,
      width: "（390 宽）",
      error: "提交按钮被挡住",
    }),
    width: copy("（{width} 宽）", { width: 390 }),
    environmentHead: copy("环境问题："),
    /** 使用阶段的运行要把主线的每一步都走到，没走到的步是缺口。 */
    unreachedHead: copy("主线里有 {count} 步这次运行没走到：", { count: 3 }),
    unreachedRow: copy("  {scene} 第 {steps} 步", { scene: "S2", steps: "2、3" }),
    /** 没有断点、没有缺口：后端自动给用户看一页，这个阶段下一次开始阶段时自动收尾。 */
    pageShown: copy("给用户看了一页使用记录：第 {page} 页，不等回复", { page: 1 }),
    shots: copy("截图：上传 {uploaded} 张，后端已有 {kept} 张", { uploaded: 3, kept: 1 }),
    newScreens: copy("新出现的屏 {count} 个，变过的屏 {changed} 个", { count: 2, changed: 1 }),
    coverageSent: copy("覆盖表：{file}，{rows} 行，缺口 {gaps} 行", {
      file: "scripts/use/覆盖表.md",
      rows: 12,
      gaps: 0,
    }),
    coverageNone: copy("覆盖表：{file} 不在，这次运行没有带覆盖表", {
      file: "scripts/use/覆盖表.md",
    }),
    tail: copy("输出的末尾："),
    coverageFull: copy("覆盖表没有缺口：{file}，{rows} 行", {
      file: "scripts/use/覆盖表.md",
      rows: 12,
    }),
    changedHead: copy("第 {version} 版新出现或变过的屏，按场景分组：", { version: 2 }),
    allHead: copy("第 {version} 版的全部屏，按场景分组：", { version: 2 }),
    changedNone: copy("第 {version} 版没有新出现或变过的屏。", { version: 2 }),
    allNone: copy("第 {version} 版还没有屏。", { version: 2 }),
    sceneRow: copy("  {scene}{steps}", { scene: "S3 逐条点选项并提交    ", steps: "第 2 步" }),
    steps: copy("第 {steps} 步", { steps: "1、2" }),
    schema: copy("使用代码输出格式的定义"),
  },
  errors: {
    outsideRoot: {
      message: copy("当前目录 {cwd} 不在项目的任何一个根目录里。", { cwd: "/tmp" }),
      hint: copy("到项目的根目录里运行，根目录有：{roots}。", { roots: root }),
    },
    noCommand: {
      message: copy("没有写使用代码的命令。"),
      hint: copy("在 -- 后面写命令，例如 ploop use run -- node run.mjs。"),
    },
    notStarted: {
      message: copy("使用代码没有跑起来：{reason}。", { reason: "找不到这个程序" }),
      hint: copy("命令的程序写对，并且在 PATH 里。"),
    },
    /** 使用代码跑完了，可是没有写出 use-run.json：把它自己的退出码和输出末尾报出来。 */
    crashed: {
      message: copy("使用代码以退出码 {exitCode} 结束，没有写出 {file}。", {
        exitCode: 3,
        file: `${out}use-run.json`,
      }),
      hint: copy(
        "先看输出末尾的报错，修好使用代码再运行。结果要写的格式运行 ploop use schema 查看。",
      ),
    },
    /** 使用代码正常结束了，可是没有写出 use-run.json。 */
    noFile: {
      message: copy("使用代码正常结束了，可是没有写出 {file}。", { file: `${out}use-run.json` }),
      hint: copy(
        "结果写进 PLOOP_USE_OUT 指的目录，文件名 use-run.json。格式运行 ploop use schema 查看。",
      ),
    },
    noOutput: {
      message: copy("{file} 读不出来：{reason}。", {
        file: `${out}use-run.json`,
        reason: "文件不存在",
      }),
      hint: copy(
        "先确认目录的路径写对了，里面要有使用代码写出的 use-run.json。直接运行使用代码用 ploop use run -- <命令>，输出目录由它设好。",
      ),
    },
    badJson: {
      message: copy("{file} 不是合法的 JSON：{reason}。", {
        file: `${out}use-run.json`,
        reason: "Unexpected token",
      }),
      hint: copy("按 ploop use schema 给出的定义写。"),
    },
    format: {
      message: copy("use-run.json 的 {where} 不对：{reason}", {
        where: "scenes[0].steps[1].result",
        reason: "结果只能写通过、断了、没走、环境。",
      }),
      hint: copy("按 ploop use schema 给出的定义改使用代码。"),
    },
    coverageMissing: {
      message: copy("覆盖表 {file} 读不出来：{reason}。", {
        file: "scripts/use/覆盖表.md",
        reason: "文件不存在",
      }),
      hint: copy("在这个位置写覆盖表，或用 --coverage 写它的路径。"),
    },
    gap: {
      message: copy("覆盖表第 {line} 行「{item}」没有场景用到。", { line: 5, item: "导出按钮" }),
      hint: copy("写上用到它的场景编号，例如 S3。产品里已经没有这样东西，就删掉这一行。"),
    },
  },
};
