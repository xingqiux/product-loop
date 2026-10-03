import { CommanderError, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import {
  cliEnvelopeSchema,
  ok,
  parseCopy,
  parseQueueId,
  renderCopy,
  stage,
} from "@product-loop/model";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWithRoundStart, ploop } from "./fixture.ts";
import type { Report } from "./output.ts";
import type { ProgramContext } from "./program.ts";
import { usageError } from "./usage-error.ts";

const done: Report = {
  kind: "queue.dropped",
  data: null,
  lines: ["取消了：Q15"],
  next: [],
  warnings: [],
};

/** 编号参数用共用定义解析，写错时报共用定义里的文案。以后的命令都这样处理取值。 */
function queueIdArgument(text: string): string {
  const parsed = parseQueueId(text);
  if (parsed.ok) return text;
  throw new InvalidArgumentError(renderCopy(parseCopy.queueId[parsed.error].hint));
}

/** 在 round start 以外，再加几条用来引出其余几种报错的命令。 */
function build(context: ProgramContext) {
  const program = buildWithRoundStart(context);
  // 名词用 sample，不和真的 queue 重名。
  const queue = program.command("sample").description("引出报错用的命令");
  queue
    .command("drop")
    .description("取消一件事，原因必填")
    .argument("<编号>", "例如 Q15", queueIdArgument)
    .requiredOption("--reason <原因>", "为什么不成立")
    .action(() => context.settle(ok(done)));
  queue
    .command("list")
    .description("列出队列")
    .addOption(new Option("--stage <阶段>", "只列这个阶段").choices(stage.labels))
    .addOption(
      new Option("--round <阶段>", "只列这个阶段").env("PLOOP_TEST_ROUND").choices(["v2-检查-1"]),
    )
    .addOption(new Option("--all", "列出全部，包括已完成的").conflicts(["stage", "round"]))
    .action(() => context.settle(ok(done)));
  // 处理函数自己调用 help()：commander 以 0 结束，照帮助输出，不算用法错误。
  queue
    .command("guide")
    .description("显示这组命令的帮助")
    .action((_options, command) => command.help());
  return program;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

// 每种报错：参数、第一行（去掉「用法错误：」）、怎么改。
const cases: [string, string[], string, string][] = [
  [
    "不认识的选项，给出可能想写的",
    ["round", "start", "检查", "--tkae", "Q12"],
    "ploop round start 没有选项 --tkae。",
    "要写的可能是 --take。写法例如 ploop round start 检查。运行 ploop round start --help 查看用法。",
  ],
  [
    "不认识的全局选项",
    ["--jsno"],
    "ploop 没有选项 --jsno。",
    "要写的可能是 --json。运行 ploop --help 查看用法。",
  ],
  [
    "不认识的子命令，给出可能想写的",
    ["round", "strat"],
    "ploop round 下面没有命令 strat。",
    "要写的可能是 start。运行 ploop round --help 查看用法。",
  ],
  [
    "有子命令的命令后面没写子命令",
    ["sample"],
    "ploop sample 后面缺少命令，可以写 drop、list、guide。",
    "运行 ploop sample --help 查看用法。",
  ],
  [
    "缺参数",
    ["round", "start"],
    "ploop round start 缺少参数 <阶段名>。",
    "写法例如 ploop round start 检查。运行 ploop round start --help 查看用法。",
  ],
  [
    "多写了参数",
    ["round", "start", "检查", "落地", "提升"],
    "ploop round start 多写了参数：落地、提升。",
    "写法例如 ploop round start 检查。运行 ploop round start --help 查看用法。",
  ],
  [
    "选项后面缺少取值",
    ["round", "start", "检查", "--take"],
    "选项 --take <编号,…> 后面缺少取值。",
    "写法例如 ploop round start 检查。运行 ploop round start --help 查看用法。",
  ],
  [
    "缺必填的选项",
    ["sample", "drop", "Q15"],
    "ploop sample drop 缺少必填的选项 --reason <原因>。",
    "运行 ploop sample drop --help 查看用法。",
  ],
  [
    "参数的取值被处理取值的函数拒绝，原因用它给的中文",
    ["sample", "drop", "q15", "--reason", "已修掉"],
    "参数 <编号> 的取值「q15」不对。写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。",
    "运行 ploop sample drop --help 查看用法。",
  ],
  [
    "选项的取值不在限定的几个里",
    ["sample", "list", "--stage", "评审"],
    "选项 --stage <阶段> 的取值「评审」不对。取值只能写下面之一：构思、使用、检查、落地、提升。",
    "运行 ploop sample list --help 查看用法。",
  ],
  [
    "两个不能同时写的选项",
    ["sample", "list", "--all", "--stage", "检查"],
    "选项 --all 不能和选项 --stage <阶段> 同时写。",
    "运行 ploop sample list --help 查看用法。",
  ],
];

describe("commander 自带的英文报错换成中文，退出码 2", () => {
  it.each(cases)("%s", async (_name, argv, message, hint) => {
    const { code, stdout, stderr } = await ploop(argv, { build });
    expect(stderr).toBe(`用法错误：${message}\n怎么改：${hint}\n`);
    expect(stdout).toBe("");
    expect(code).toBe(2);
  });

  it.each(cases)("%s：--json 时标准输出只有一个 JSON 对象", async (_name, argv, message, hint) => {
    const { code, stdout, stderr } = await ploop([...argv, "--json"], { build });
    const parsed = cliEnvelopeSchema.parse(JSON.parse(stdout));
    expect(parsed).toEqual({
      schemaVersion: 1,
      kind: "error",
      ok: false,
      error: { code: "BAD_REQUEST", message, hint },
    });
    expect(stderr).toBe("");
    expect(code).toBe(2);
  });

  it("环境变量给的取值不对，写明是哪个环境变量", async () => {
    vi.stubEnv("PLOOP_TEST_ROUND", "v9-检查-1");
    const { code, stderr } = await ploop(["sample", "list"], { build });
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：环境变量 PLOOP_TEST_ROUND 的取值「v9-检查-1」不对。取值只能写下面之一：v2-检查-1。",
    );
    expect(code).toBe(2);
  });

  it("选项和环境变量给的取值不能同时有，写明是哪个环境变量", async () => {
    vi.stubEnv("PLOOP_TEST_ROUND", "v2-检查-1");
    const { code, stderr } = await ploop(["sample", "list", "--all"], { build });
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：选项 --all 不能和环境变量 PLOOP_TEST_ROUND 同时写。",
    );
    expect(code).toBe(2);
  });

  it("处理函数自己调用 help() 时照帮助输出，退出码 0", async () => {
    const { code, stdout, stderr } = await ploop(["sample", "guide"], { build });
    expect(stdout.startsWith("ploop sample guide\n\n显示这组命令的帮助\n")).toBe(true);
    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  it("写在 -- 以后的 --json 是参数的取值，不改输出的写法", async () => {
    const { stdout, stderr } = await ploop(["round", "start", "--", "--json", "落地"], { build });
    expect(stderr).toBe(
      "用法错误：ploop round start 多写了参数：落地。\n怎么改：写法例如 ploop round start 检查。运行 ploop round start --help 查看用法。\n",
    );
    expect(stdout).toBe("");
  });
});

describe("认不出来的报错", () => {
  const program = buildWithRoundStart({
    columns: undefined,
    cwd: "/nonexistent",
    env: {},
    userHome: "/nonexistent",
    notice: () => {},
    settle: () => {},
  });

  it("命令自己用 command.error() 报的中文照原样写", () => {
    const exit = new CommanderError(1, "commander.error", "这个阶段已经收尾。");
    expect(usageError(program, exit)).toEqual({
      code: "BAD_REQUEST",
      message: "这个阶段已经收尾。",
      hint: "运行 ploop --help 查看用法。",
    });
  });

  it("不把英文原样转出去，只说这条命令的写法不对", () => {
    const exit = new CommanderError(1, "commander.somethingNew", "error: something new");
    expect(usageError(program, exit).message).toBe("ploop 的写法不对。");
    const changed = new CommanderError(1, "commander.unknownOption", "error: unknown flag --x");
    expect(usageError(program, changed).message).toBe("ploop 的写法不对。");
  });
});
