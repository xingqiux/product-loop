import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import { ok } from "@product-loop/model";
import type { Report } from "./output.ts";
import { buildProgram, type Io, type ProgramContext, run } from "./program.ts";

// 测试共用的命令和运行方法，只给测试用。
// round start 用真的参数、选项和帮助，处理函数换成只交回「04 命令行」第五节样例的结果，
// 用来核对两种输出，不连后端。

/**
 * 「04 命令行」第四节 ploop round start --help 的样例。
 * 命令的说明只写名字，细节写在「细节」一节里（决定 224）；样例里没有 --all-screens，
 * 命令树里有（第二节），这里按命令树加上这一行。
 */
export const roundStartHelp = `ploop round start <阶段名>

开始一个阶段

用法
  ploop round start <阶段名> [选项]

参数
  <阶段名>               构思、使用、检查、落地、提升之一

选项
  --take <编号,…>        落地阶段定这一批，例如 Q12,Q15；不写拿全部待办
  --defer <编号>=<依赖>  这件事要等别的事，改成等待并写明依赖；可以写多次
  --all-screens          检查时列出全部的屏，不只列这一版新出现或变过的
  --json                 输出机读的结果

细节
  从队列拿出这个阶段的事，编好第几版和第几次。
  主线缺几个部分也会写出来。

会拦截的情况
  上一个阶段的回复还有行没有处理        先运行 ploop reply show，再用 ploop reply handle 处理
  另一个阶段还开着且不能自动收尾        先运行 ploop round close
  项目停在旧版本的 skill                先运行 ploop doctor
  进入检查阶段时主线的设计规范缺部分    按输出补主线，再开始

读和写
  读  项目缓存的 project.json、主线.md
  写  集中存储的阶段和队列，项目缓存的工作区；主线.md 有改动先交成新修订

例子
  ploop round start 检查
  ploop round start 落地 --take Q12,Q15 --defer Q9="等构思定下场景 S4"

做完以后
  不成立的事：ploop queue drop <编号> --reason <原因>
  页面数据写进 page.json，再运行 ploop page present`;

/**
 * 「04 命令行」第五节 ploop round start 检查 的文字输出。
 * 开始以后先做什么写在正文的「先做」里，「下一步」只放能直接运行的命令。
 */
export const roundStartedText = `开始了：第 2 版的检查阶段
拿出来的事：
  Q12  设置页的保存按钮在窄屏被挡住
  Q15  队列看板的等待行和列里的卡重复
这一版新出现或变过的屏，按场景分组：
  S3 逐条点选项并提交    第 2 步
  S9 看队列              第 1、2 步
主线：10 个部分齐全，设计规范 12 个部分齐全
工作区：.product-loop/rounds/v2-检查-1/
先做：
  判断：不成立的，运行 ploop queue drop Q12 --reason <原因>。
  页面：逐屏看，页面数据写进 .product-loop/rounds/v2-检查-1/page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。

下一步：
  1. ploop page present`;

/** 第五节的文字输出拆回成结果，数据取第五节 JSON 样例里的。 */
export const roundStartedReport: Report = {
  kind: "round.started",
  data: {
    round: "v2-检查-1",
    taken: ["Q12", "Q15"],
    changedScreens: [{ scene: "S1", steps: [2, 3] }],
  },
  lines: [
    "开始了：第 2 版的检查阶段",
    "拿出来的事：",
    "  Q12  设置页的保存按钮在窄屏被挡住",
    "  Q15  队列看板的等待行和列里的卡重复",
    "这一版新出现或变过的屏，按场景分组：",
    "  S3 逐条点选项并提交    第 2 步",
    "  S9 看队列              第 1、2 步",
    "主线：10 个部分齐全，设计规范 12 个部分齐全",
    "工作区：.product-loop/rounds/v2-检查-1/",
    "先做：",
    "  判断：不成立的，运行 ploop queue drop Q12 --reason <原因>。",
    "  页面：逐屏看，页面数据写进 .product-loop/rounds/v2-检查-1/page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。",
  ],
  next: ["ploop page present"],
  warnings: [],
};

/**
 * ploop，round start 的处理函数换成不做事的：只交回第五节样例的结果，用来核对两种输出。
 * 参数、选项和帮助用真的命令，帮助和第四节的样例逐行相同。
 */
export function buildWithRoundStart(context: ProgramContext) {
  const program = buildProgram(context);
  const start = program.commands
    .find((command) => command.name() === "round")
    ?.commands.find((command) => command.name() === "start");
  if (start === undefined) throw new Error("命令树里没有 ploop round start。");
  start.action(() => context.settle(ok(roundStartedReport)));
  return program;
}

/**
 * 测试默认的目录：一个不存在的路径。要找项目、找集中存储的测试自己传临时目录，
 * 忘了传的在找目录这一步就报错，碰不到真实的家目录和后端。
 */
const nowhere = "/nonexistent/ploop-test";

/** 在进程里运行一次命令行，收下两路输出和退出码。columns 不写表示标准输出不是终端。 */
export async function ploop(
  argv: readonly string[],
  options: {
    readonly columns?: number;
    readonly build?: (context: ProgramContext) => CommandUnknownOpts;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly userHome?: string;
  } = {},
) {
  let stdout = "";
  let stderr = "";
  const io: Io = {
    out: (text) => {
      stdout += text;
    },
    err: (text) => {
      stderr += text;
    },
    columns: options.columns,
    cwd: options.cwd ?? nowhere,
    env: options.env ?? {},
    userHome: options.userHome ?? nowhere,
  };
  const code = await run(argv, io, options.build ?? buildWithRoundStart);
  return { code, stdout, stderr };
}
