import { describe, expect, it } from "vitest";
import {
  type CommandRun,
  checkRedGreen,
  commandOutputTail,
  commandRunSchema,
  describeRedGreenViolation,
  formatCommand,
  type RedGreenViolation,
} from "./command-run.ts";
import { renderCopy } from "./copy/define.ts";
import { parseCopy } from "./copy/errors.ts";
import * as model from "./index.ts";

const redCommit = `3f9c2e1${"a".repeat(33)}`;
const greenCommit = `a1b2c3d${"b".repeat(33)}`;

/** 改之前跑的一次：检查失败。 */
const red: CommandRun = {
  project: "product-loop",
  round: "v2-落地-3",
  purpose: "red",
  command: ["pnpm", "vitest", "run", "src/list.test.ts"],
  cwd: "/Users/me/proj/product-loop",
  exitCode: 1,
  outputTail: "FAIL src/list.test.ts > 空的列表显示一句提示",
  commit: redCommit,
  startedAt: "2026-09-28T10:00:00+08:00",
  durationMs: 1840,
  cliVersion: "2.0.0",
};

/** 改之后跑的同一条命令：检查通过，提交在失败之后。 */
const green: CommandRun = {
  ...red,
  purpose: "green",
  exitCode: 0,
  outputTail: "PASS src/list.test.ts",
  commit: greenCommit,
  startedAt: "2026-09-28T10:20:00+08:00",
};

/** 接口上的这两次运行：用途写中文标签。 */
const redWire = { ...red, purpose: "改前失败" };
const greenWire = { ...green, purpose: "改后通过" };

/** 失败以后到通过时为止的提交，由命令行用 git rev-list --ancestry-path 查出。 */
const oneCommitAfter = [greenCommit];

describe("命令运行记录的定义", () => {
  it("合格的记录能解析，用途从中文标签换成英文键", () => {
    expect(commandRunSchema.parse(redWire)).toEqual(red);
    expect(commandRunSchema.parse(greenWire)).toEqual(green);
  });

  it("不在任何阶段里跑的不写阶段，项目不在 git 仓库里时不写提交", () => {
    const { round: _round, commit: _commit, ...rest } = redWire;
    const run = { ...rest, purpose: "使用代码", startedAt: "2026-09-28T02:00:00Z" };
    expect(commandRunSchema.safeParse(run).success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ["多出不认识的字段", { ...redWire, name: "一件" }],
    ["旧 land.py 的记录", { cmd: red.command, exit: 1, tail: "", at: "2026-09-21T10:00:00" }],
    ["用途写了英文键", { ...redWire, purpose: "red" }],
    ["用途不在五种之内", { ...redWire, purpose: "评审" }],
    ["轮次用了改过名的阶段", { ...redWire, round: "v2-修复-3" }],
    ["轮次写了旧编号", { ...redWire, round: "fix-13" }],
    ["命令是空的", { ...redWire, command: [] }],
    ["程序名是空的", { ...redWire, command: ["", "test"] }],
    ["命令写成了一整句", { ...redWire, command: "pnpm vitest run" }],
    ["目录是空的", { ...redWire, cwd: "" }],
    ["退出码是负数", { ...redWire, exitCode: -1 }],
    ["退出码不是整数", { ...redWire, exitCode: 1.5 }],
    ["提交号只写了前七位", { ...redWire, commit: "3f9c2e1" }],
    ["提交号用了大写", { ...redWire, commit: redCommit.toUpperCase() }],
    ["开始时间不带时区", { ...redWire, startedAt: "2026-09-28T10:00:00" }],
    ["用时是负数", { ...redWire, durationMs: -1 }],
    ["没写命令行的版本", { ...redWire, cliVersion: "" }],
  ])("拒绝：%s", (_, run) => {
    expect(commandRunSchema.safeParse(run).success).toBe(false);
  });

  it("提交号收 SHA-256 仓库的六十四位", () => {
    expect(commandRunSchema.safeParse({ ...redWire, commit: "c".repeat(64) }).success).toBe(true);
  });

  it("阶段写错时，报错用阶段写法的文案", () => {
    const result = commandRunSchema.safeParse({ ...redWire, round: "v2-落地" });
    expect(result.error?.issues).toMatchObject([
      {
        path: ["round"],
        message: renderCopy(parseCopy.roundLabel.shape.message, { text: "v2-落地" }),
      },
    ]);
  });

  it("接口的请求体可以去掉由路径决定的项目、阶段和用途", () => {
    const body = commandRunSchema.omit({ project: true, round: true, purpose: true });
    const { project: _project, round: _round, purpose: _purpose, ...rest } = redWire;
    expect(body.parse(rest)).toEqual(rest);
  });
});

describe("输出的末尾", () => {
  it("标准输出在前，标准错误在后，只留最后四十行", () => {
    const stdout = `${Array.from({ length: 50 }, (_, i) => `o${i + 1}`).join("\n")}\n`;
    const stderr = "e1\ne2\ne3\n";
    const tail = commandOutputTail(stdout, stderr).split("\n");
    expect(tail).toHaveLength(40);
    expect(tail.slice(0, 2)).toEqual(["o14", "o15"]);
    expect(tail.slice(-4)).toEqual(["o50", "e1", "e2", "e3"]);
  });

  it("去掉首尾的空白，没有输出时是空的", () => {
    expect(commandOutputTail("\n\n  FAIL a.test.ts  \n", "\n")).toBe("FAIL a.test.ts");
    expect(commandOutputTail("", "")).toBe("");
  });

  it("换行写成 \\r\\n 的也按行算", () => {
    expect(commandOutputTail("a\r\nb\r\n", "")).toBe("a\nb");
  });
});

describe("命令写成一行", () => {
  it.each([
    [["pnpm", "vitest", "run", "src/list.test.ts"], "pnpm vitest run src/list.test.ts"],
    [["node", "-e", "process.exit(1)"], "node -e 'process.exit(1)'"],
    [["grep", "it's"], `grep 'it'"'"'s'`],
    [["echo", ""], "echo ''"],
    [["pnpm", "test", "--", "-t", "空的列表"], "pnpm test -- -t '空的列表'"],
    [["git", "log", "--format=%H", "HEAD~1..HEAD"], "git log --format=%H 'HEAD~1..HEAD'"],
  ])("%j 写成 %s", (command, text) => {
    expect(formatCommand(command)).toBe(text);
  });
});

describe("先失败后通过的两次运行", () => {
  it("同一条命令先失败后通过，通过时的提交在失败之后", () => {
    expect(checkRedGreen(red, green, oneCommitAfter)).toEqual([]);
  });

  it("中间隔了几个提交也不算对不上，要不要警告由 land.one-commit 看", () => {
    expect(checkRedGreen(red, green, [greenCommit, `c${"0".repeat(39)}`])).toEqual([]);
  });

  it("旧 check-land.py：该失败的那一次其实通过了", () => {
    expect(checkRedGreen({ ...red, exitCode: 0 }, green, oneCommitAfter)).toEqual([
      { kind: "redPassed" },
    ]);
  });

  it("旧 check-land.py：通过用的不是失败时的那条命令", () => {
    const other = { ...green, command: ["pnpm", "vitest", "run"] as const };
    expect(checkRedGreen(red, other, oneCommitAfter)).toEqual([
      { kind: "commandDiffers", red: red.command, green: other.command },
    ]);
  });

  it("参数相同、顺序不同，也不是同一条命令", () => {
    const swapped = { ...green, command: ["pnpm", "run", "vitest", "src/list.test.ts"] as const };
    expect(checkRedGreen(red, swapped, oneCommitAfter).map((v) => v.kind)).toEqual([
      "commandDiffers",
    ]);
  });

  it("只比命令，不比目录：同一个项目的另一个根目录也行", () => {
    const elsewhere = { ...green, cwd: "/Users/me/proj/product-loop-wt/step-22" };
    expect(checkRedGreen(red, elsewhere, oneCommitAfter)).toEqual([]);
  });

  it("通过的那一次其实没有通过", () => {
    expect(checkRedGreen(red, { ...green, exitCode: 2 }, oneCommitAfter)).toEqual([
      { kind: "greenFailed", exitCode: 2 },
    ]);
  });

  it("通过时的提交早于失败时的提交", () => {
    const earlier = { ...green, commit: `0badc0d${"e".repeat(33)}` };
    expect(checkRedGreen(red, earlier, [])).toEqual([
      { kind: "commitNotAfter", red: redCommit, green: earlier.commit },
    ]);
  });

  it("改动还没有提交就记通过，两次的提交相同", () => {
    expect(checkRedGreen(red, { ...green, commit: redCommit }, [])).toEqual([
      { kind: "sameCommit", commit: redCommit },
    ]);
  });

  it("没有记下提交的，报出是哪一次，不再比先后", () => {
    const { commit: _red, ...redWithout } = red;
    const { commit: _green, ...greenWithout } = green;
    expect(checkRedGreen(redWithout, greenWithout, [])).toEqual([
      { kind: "redCommitMissing" },
      { kind: "greenCommitMissing" },
    ]);
    expect(checkRedGreen(red, greenWithout, [])).toEqual([{ kind: "greenCommitMissing" }]);
  });

  it("对不上的地方一次全部报出", () => {
    const wrong = { ...green, command: ["pnpm", "test"] as const, exitCode: 1, commit: redCommit };
    expect(checkRedGreen({ ...red, exitCode: 0 }, wrong, []).map((v) => v.kind)).toEqual([
      "commandDiffers",
      "redPassed",
      "greenFailed",
      "sameCommit",
    ]);
  });
});

describe("两次运行对不上时的报错", () => {
  const violations: readonly RedGreenViolation[] = [
    { kind: "commandDiffers", red: red.command, green: ["pnpm", "test"] },
    { kind: "redPassed" },
    { kind: "greenFailed", exitCode: 2 },
    { kind: "redCommitMissing" },
    { kind: "greenCommitMissing" },
    { kind: "sameCommit", commit: redCommit },
    { kind: "commitNotAfter", red: redCommit, green: greenCommit },
  ];

  it.each(violations)("$kind 写清什么不对、怎么改，没有残留的 {…}", (violation) => {
    const { message, hint } = describeRedGreenViolation(violation);
    expect(message).not.toBe("");
    expect(hint).toMatch(/ploop land/u);
    expect(`${message}${hint}`).not.toMatch(/[{}]/u);
  });

  it("命令不同时写出两条命令，提交号只写前七位", () => {
    expect(describeRedGreenViolation(violations[0] as RedGreenViolation).message).toBe(
      "通过时运行的命令和失败时的不是同一条。失败时是 pnpm vitest run src/list.test.ts，通过时是 pnpm test。",
    );
    expect(describeRedGreenViolation(violations[6] as RedGreenViolation).message).toBe(
      "通过时的提交 a1b2c3d 不在失败时的提交 3f9c2e1 之后。",
    );
  });

  it("从共用定义的入口导出", () => {
    expect(model.checkRedGreen).toBe(checkRedGreen);
    expect(model.commandRunSchema).toBe(commandRunSchema);
  });
});
