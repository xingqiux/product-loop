import {
  Command,
  type CommanderError,
  type CommandUnknownOpts,
  Option,
} from "@commander-js/extra-typings";
import {
  type ExitCode,
  err,
  exitCode,
  exitCodeCopy,
  ok,
  type Result,
  renderCopy,
  roundStep,
} from "@product-loop/model";
import packageJson from "../package.json" with { type: "json" };
import { backendCommand } from "./commands/backend.ts";
import { backupCommand } from "./commands/backup.ts";
import { decisionCommand } from "./commands/decision.ts";
import { doctorCommand } from "./commands/doctor.ts";
import { exportCommand } from "./commands/export.ts";
import { initCommand } from "./commands/init.ts";
import { landCommand } from "./commands/land.ts";
import { lintCommand } from "./commands/lint.ts";
import { mainlineCommand } from "./commands/mainline.ts";
import { openCommand } from "./commands/open.ts";
import { pageCommand } from "./commands/page.ts";
import { primeCommand } from "./commands/prime.ts";
import { queueCommand } from "./commands/queue.ts";
import { replyCommand } from "./commands/reply.ts";
import { roundCommand } from "./commands/round.ts";
import { setupCommand } from "./commands/setup.ts";
import { skillCommand } from "./commands/skill.ts";
import { showStatus, statusCommand } from "./commands/status.ts";
import { useCommand } from "./commands/use.ts";
import { versionCommand } from "./commands/version.ts";
import { type CommandEnv, cliBuild } from "./connect.ts";
import { helpEnvCopy, programCopy, roundStepCommandCopy, transitionalDate } from "./copy/help.ts";
import {
  chineseHelp,
  type HelpGroup,
  inGroup,
  listAllCommands,
  listInEveryCommand,
  withHelp,
} from "./help.ts";
import { exitCodeOf, type Outcome, type Report, render } from "./output.ts";
import { usageError } from "./usage-error.ts";

// 命令行的骨架：命令树、全局选项、解析、两种输出和退出码，见「04 命令行」第二节、第五节到第七节。
// 以后的步骤把命令加进 buildProgram。命令的处理函数用 context.settle 交回结果，
// 由 run() 按 --json 选一种写法输出，再按错误码定退出码。

/** 命令行和外界打交道的地方。测试换成假的。 */
export type Io = {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  /** 标准输出是终端时写终端的列数。不是终端时写 undefined，帮助不折行。 */
  readonly columns: number | undefined;
  /** 当前目录，往上找项目从这里开始。 */
  readonly cwd: string;
  /** 环境变量：PLOOP_HOME、PLOOP_PORT 这些。 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 用户的家目录，由进程入口取系统的，见约定 0002 第 13 条。 */
  readonly userHome: string;
  /**
   * 在终端里问用户一句话，返回回答。只有标准输入输出都是终端时才有。
   * 没有它的命令不能问，只能靠选项定下来。
   */
  readonly ask?: (question: string) => Promise<string | undefined>;
};

/** 定义命令时要用的东西。 */
export type ProgramContext = CommandEnv & {
  readonly columns: number | undefined;
  /** 见 Io.ask。 */
  readonly ask?: Io["ask"];
  /** 命令做完以后交回结果。 */
  readonly settle: (outcome: Outcome) => void;
};

/** 帮助也按两种写法输出：文字原样输出，--json 时放进 data.text。 */
function helpReport(text: string): Report<{ readonly text: string }> {
  const trimmed = text.trimEnd();
  const [first = "", ...rest] = trimmed.split("\n");
  return { kind: "help", data: { text: trimmed }, lines: [first, ...rest], next: [], warnings: [] };
}

/** 版本号之外再写构建号：版本号全仓库只有一个，靠构建号才看得出装的是不是最新一次构建。 */
function versionReport(
  version: string,
): Report<{ readonly version: string; readonly build: string }> {
  return {
    kind: "version",
    data: { version, build: cliBuild },
    lines: [version, renderCopy(programCopy.build, { build: cliBuild })],
    next: [],
    warnings: [],
  };
}

/**
 * 退出码表，写在 ploop --help 的末尾：数字、含义和通常怎么做，取自 model 的退出码文案。
 * AI 可以只看退出码决定下一步。
 */
function exitLines(): (readonly [string, string])[] {
  return (Object.keys(exitCode) as (keyof typeof exitCode)[]).map((name) => {
    const { meaning, action } = exitCodeCopy[name];
    const todo = renderCopy(action);
    // 没有要做的（被中断）只写含义。
    return [
      String(exitCode[name]),
      todo === "无" ? renderCopy(meaning) : `${renderCopy(meaning)}，${todo}`,
    ];
  });
}

/**
 * 每条顶层命令属于哪一组，见决定 209。新加的顶层命令要在这里归组，program.test.ts 会核对。
 * 过渡命令只服务旧 skill 的迁移和退回，到 2026-12-31 删除，日期见 copy/help.ts。
 */
export const commandGroups: Readonly<Record<HelpGroup, readonly string[]>> = {
  daily: ["init", "status", "round", "page", "reply", "queue", "use", "land", "mainline"],
  onDemand: ["prime", "decision", "open", "version", "lint", "skill"],
  maintenance: ["backend", "backup", "storage", "export", "setup"],
  transitional: ["doctor"],
};

/** 建出 ploop 的命令树。 */
export function buildProgram(context: ProgramContext) {
  // 帮助、输出和退出的设置要在 .command() 之前做，子命令只在创建时复制父命令的设置。
  const program = new Command("ploop")
    .configureHelp(chineseHelp)
    .configureOutput({
      // 帮助和版本号都由 run() 输出，这样 --json 时也只有一个 JSON 对象。
      writeOut: () => {},
      writeErr: () => {},
      // commander 自带的报错是英文，不写，由 run() 换成中文。
      outputError: () => {},
      // 不是终端时宽度不限，帮助不折行。commander 在不是终端时按八十列折行。
      getOutHelpWidth: () => context.columns ?? Number.POSITIVE_INFINITY,
      getErrHelpWidth: () => context.columns ?? Number.POSITIVE_INFINITY,
    })
    .exitOverride()
    .helpOption("-h, --help", renderCopy(programCopy.help))
    .description(renderCopy(programCopy.description))
    .addOption(listInEveryCommand(new Option("--json", renderCopy(programCopy.json))))
    .option("--project <项目名或路径>", renderCopy(programCopy.project))
    .version(packageJson.version, "-V, --version", renderCopy(programCopy.version));
  withHelp(program, {
    details: [
      renderCopy(programCopy.details.bare),
      renderCopy(programCopy.details.hidden),
      renderCopy(programCopy.details.time),
      renderCopy(programCopy.details.fileTime),
    ],
    steps: roundStep.keys.map((key) => [
      roundStep.label(key),
      renderCopy(roundStepCommandCopy[key]),
    ]),
    envs: helpEnvCopy.map(({ name, text }) => [name, renderCopy(text)]),
    exits: exitLines(),
  });
  // 命令按「04 命令行」第二节命令树的顺序挂上，一组命令一个文件，放在 commands/ 下。
  initCommand(program, context);
  statusCommand(program, context);
  primeCommand(program, context);
  doctorCommand(program, context);
  roundCommand(program, context);
  pageCommand(program, context);
  replyCommand(program, context);
  openCommand(program, context);
  queueCommand(program, context);
  decisionCommand(program, context);
  mainlineCommand(program, context);
  landCommand(program, context);
  useCommand(program, context);
  lintCommand(program, context);
  skillCommand(program, context);
  backendCommand(program, context);
  backupCommand(program, context);
  versionCommand(program, context);
  exportCommand(program, context);
  setupCommand(program, context);
  for (const [group, names] of Object.entries(commandGroups) as [HelpGroup, readonly string[]][]) {
    for (const command of program.commands) {
      if (names.includes(command.name())) inGroup(command, group);
    }
  }
  // 不带子命令时等同 ploop status，见「04 命令行」第二节。
  program.action(async (options) => context.settle(await showStatus(context, options.project)));
  return program;
}

/** commander 要退出时抛出它，带着出错或要显示帮助的那条命令。 */
class CommanderExit extends Error {
  readonly command: CommandUnknownOpts;
  readonly exit: CommanderError;

  constructor(command: CommandUnknownOpts, exit: CommanderError) {
    super(exit.message);
    this.command = command;
    this.exit = exit;
  }
}

function* withSubcommands(command: CommandUnknownOpts): Generator<CommandUnknownOpts> {
  yield command;
  for (const sub of command.commands) yield* withSubcommands(sub);
}

/**
 * 解析以前把每条命令都设好：退出时带上是哪条命令，报错才能写出命令的全名。
 * commander 自带的 help 子命令不要，「04 命令行」第二节的命令树里没有它，看帮助用 --help。
 */
function prepare(program: CommandUnknownOpts): void {
  for (const command of withSubcommands(program)) {
    command.helpCommand(false);
    command.exitOverride((exit) => {
      throw new CommanderExit(command, exit);
    });
  }
}

async function parse(
  program: CommandUnknownOpts,
  argv: readonly string[],
): Promise<Result<void, CommanderExit>> {
  try {
    await program.parseAsync([...argv], { from: "user" });
    return ok(undefined);
  } catch (thrown) {
    if (thrown instanceof CommanderExit) return err(thrown);
    throw thrown;
  }
}

/**
 * -V 和 --version 写在子命令前面时才是 ploop 的版本号。写在子命令后面的交给子命令，
 * 例如 ploop setup --version 0.0.1 和 ploop use changed --version 2。
 * commander 解析时总是先认父命令的选项，所以这时把版本号选项的 is() 换成不认。
 */
function versionOnlyBeforeCommand(program: CommandUnknownOpts, argv: readonly string[]): void {
  const names = new Set(
    program.commands.flatMap((command) => [command.name(), ...command.aliases()]),
  );
  const first = argv.findIndex((arg) => names.has(arg));
  if (first === -1) return;
  const before = argv.slice(0, first);
  if (before.includes("-V") || before.includes("--version")) return;
  const option = program.options.find((candidate) => candidate.long === "--version");
  if (option !== undefined) Reflect.set(option, "is", () => false);
}

/** commander 自己结束的几种：显示了帮助、显示了版本号，其余都是用法错误。 */
function fromExit({ command, exit }: CommanderExit): Outcome {
  if (exit.code === "commander.version") return ok(versionReport(exit.message));
  const helpAsked =
    exit.code === "commander.helpDisplayed" ||
    (exit.code === "commander.help" && exit.exitCode === 0);
  return helpAsked ? ok(helpReport(command.helpInformation())) : err(usageError(command, exit));
}

/**
 * --json 写在 -- 之前的任何位置都算，和 commander 解析全局选项的规则一样。
 * 直接看参数，因为解析失败时也要按它选输出的写法。
 */
function wantsJson(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
}

/** 写了 --help（或 -h）又写了 --all：要看全部命令。--all 写在 -- 之前才算。 */
function wantsAllHelp(argv: readonly string[]): boolean {
  const end = argv.indexOf("--");
  const before = end === -1 ? argv : argv.slice(0, end);
  return before.includes("--all") && (before.includes("--help") || before.includes("-h"));
}

/**
 * ploop help 是很多人的习惯写法，命令树里没有这条命令，把它当作 --help：
 * ploop help 显示 ploop 的帮助，ploop help round 显示 ploop round 的帮助。
 * 只认写在最前面的 help，全局选项可以在它前面，写在别的命令后面的 help 是那条命令的参数。
 */
function helpAsFlag(argv: readonly string[]): readonly string[] {
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i] ?? "";
    if (arg === "--json") i += 1;
    else if (arg === "--project") i += 2;
    else if (arg.startsWith("--project=")) i += 1;
    else break;
  }
  if (argv[i] !== "help") return argv;
  return [...argv.slice(0, i), ...argv.slice(i + 1), "--help"];
}

/** 解析命令行，执行命令，按 --json 选一种写法输出，返回退出码。 */
export async function run(
  args: readonly string[],
  io: Io,
  build: (context: ProgramContext) => CommandUnknownOpts = buildProgram,
): Promise<ExitCode> {
  const argv = helpAsFlag(args);
  // ploop --help --all：帮助里也列出默认不列的维护和过渡命令。每次运行都重设，不留给下一次。
  listAllCommands(wantsAllHelp(argv));
  const settled: { outcome?: Outcome } = {};
  const json = wantsJson(argv);
  const program = build({
    columns: io.columns,
    cwd: io.cwd,
    env: io.env,
    userHome: io.userHome,
    ...(io.ask === undefined ? {} : { ask: io.ask }),
    // --json 时标准错误也不写，标准输出只有最后的一个 JSON 对象。
    notice: (line) => {
      if (!json) io.err(`${line}\n`);
    },
    settle: (outcome) => {
      settled.outcome = outcome;
    },
  });
  prepare(program);
  versionOnlyBeforeCommand(program, argv);
  const parsed = await parse(program, argv);
  const outcome = parsed.ok ? settled.outcome : fromExit(parsed.error);
  // 每条命令的处理函数都用 context.settle 交回结果。走到这里是定义命令时漏了，属于程序的错误。
  if (outcome === undefined) throw new Error("命令没有交回结果：处理函数要调用 context.settle。");
  const { stdout, stderr } = render(outcome, json);
  if (stdout !== "") io.out(stdout);
  if (stderr !== "") io.err(stderr);
  return exitCodeOf(outcome);
}
