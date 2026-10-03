import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { parseCopy } from "./copy/errors.ts";
import { landCopy } from "./copy/land.ts";
import type { Issue } from "./envelope.ts";
import { type CommandRunPurpose, commandRunPurpose } from "./names.ts";
import { parseRoundLabel } from "./round-label.ts";

// 命令运行记录：命令行替 AI 在项目里跑的一次命令，见「03 数据模型」第二节。
// 命令行在项目的根目录里运行命令，把结果交给后端。落地的失败和通过只收命令行跑出来的记录，不收手写的。
// 用途在接口上写中文标签，解析以后是英文键，见「05 接口」第一节。

export type CommandRun = {
  /** 项目编号。 */
  readonly project: string;
  /** 轮次的写法，例如 v2-落地-3。不在任何一轮里跑的，例如定时跑的使用代码，不写。 */
  readonly round?: string;
  readonly purpose: CommandRunPurpose;
  /** 程序和参数，原样记下，不经过 shell。比较两次运行是不是同一条命令时，逐项比较。 */
  readonly command: readonly [string, ...string[]];
  /** 在哪个目录里运行，是项目的某个根目录。 */
  readonly cwd: string;
  /** 被信号终止时，按 shell 的惯例记 128 加信号的编号。 */
  readonly exitCode: number;
  /** 输出的末尾，见 commandOutputTail。 */
  readonly outputTail: string;
  /** 运行时的 HEAD，写完整的提交号。项目不在 git 仓库里时不写。 */
  readonly commit?: string;
  /** 开始时间，带时区的 ISO 8601。 */
  readonly startedAt: string;
  readonly durationMs: number;
  /** 执行它的命令行的版本，也就是构建号，开发时是 dev。 */
  readonly cliVersion: string;
};

/** 完整的提交号：SHA-1 是四十位，SHA-256 的仓库是六十四位。 */
const commitPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

const roundLabelSchema = z.string().superRefine((text, ctx) => {
  if (!parseRoundLabel(text).ok) {
    ctx.addIssue({
      code: "custom",
      message: renderCopy(parseCopy.roundLabel.shape.message, { text }),
    });
  }
});

/**
 * 命令运行记录的定义。严格：多出不认识的字段就拒绝。
 * 保持为普通的对象定义，接口的请求体可以用 omit 去掉由路径决定的项目、轮次和用途。
 */
export const commandRunSchema = z.strictObject({
  project: z.string().min(1),
  round: roundLabelSchema.optional(),
  purpose: commandRunPurpose.codec,
  command: z.tuple([z.string().min(1)], z.string()),
  cwd: z.string().min(1),
  exitCode: z.int().min(0),
  outputTail: z.string(),
  commit: z.string().regex(commitPattern).optional(),
  startedAt: z.iso.datetime({ offset: true }),
  durationMs: z.int().min(0),
  cliVersion: z.string().min(1),
}) satisfies z.ZodType<CommandRun>;

/** 输出只留末尾几行，沿用旧 land.py 的四十行。 */
const outputTailLines = 40;

/**
 * 输出的末尾，沿用旧 land.py 的算法：标准输出在前、标准错误在后接起来，
 * 去掉首尾的空白，留最后四十行。
 */
export function commandOutputTail(stdout: string, stderr: string): string {
  return (stdout + stderr)
    .trim()
    .split(/\r\n|\r|\n/u)
    .slice(-outputTailLines)
    .join("\n");
}

/** 不用加引号的参数，和 Python 的 shlex.quote 相同。 */
const plainArg = /^[\w@%+=:,./-]+$/u;

/** 把程序和参数写成一行命令，给人看。要加引号的参数用单引号括起来，和 shlex.quote 相同。 */
export function formatCommand(command: readonly string[]): string {
  return command
    .map((arg) => (plainArg.test(arg) ? arg : `'${arg.replaceAll("'", `'"'"'`)}'`))
    .join(" ");
}

/**
 * 同一件功能改动的两次运行对不上的地方。
 * - commandDiffers：通过时运行的不是失败时的那条命令。
 * - redPassed：失败的那一次其实通过了。
 * - greenFailed：通过的那一次其实没有通过。
 * - redCommitMissing、greenCommitMissing：那一次没有记下当时的提交。
 * - sameCommit：两次的提交相同，这件改动还没有提交。
 * - commitNotAfter：通过时的提交不在失败时的提交之后，可能更早，也可能改写过提交历史。
 */
export type RedGreenViolation =
  | {
      readonly kind: "commandDiffers";
      readonly red: readonly string[];
      readonly green: readonly string[];
    }
  | { readonly kind: "redPassed" }
  | { readonly kind: "greenFailed"; readonly exitCode: number }
  | { readonly kind: "redCommitMissing" }
  | { readonly kind: "greenCommitMissing" }
  | { readonly kind: "sameCommit"; readonly commit: string }
  | { readonly kind: "commitNotAfter"; readonly red: string; readonly green: string };
export type RedGreenViolationKind = RedGreenViolation["kind"];

/**
 * 核对同一件功能改动先失败后通过的两次运行，一次返回全部对不上的地方，全对时返回空列表。
 * 要求同一条命令、先失败后通过、通过时的提交在失败时的提交之后（「03 数据模型」第二节）。
 *
 * 后端不碰 git，提交的先后由命令行查出来传进来。
 * commitsSinceRed 是 `git rev-list --ancestry-path <失败时的提交>..<通过时的提交>` 列出的提交。
 * 它是空的，说明通过时的提交不在失败时的之后。land.one-commit 的警告看的也是这份列表。
 */
export function checkRedGreen(
  red: CommandRun,
  green: CommandRun,
  commitsSinceRed: readonly string[],
): RedGreenViolation[] {
  const violations: RedGreenViolation[] = [];
  const sameCommand =
    red.command.length === green.command.length &&
    red.command.every((arg, i) => arg === green.command[i]);
  if (!sameCommand) {
    violations.push({ kind: "commandDiffers", red: red.command, green: green.command });
  }
  if (red.exitCode === 0) violations.push({ kind: "redPassed" });
  if (green.exitCode !== 0) violations.push({ kind: "greenFailed", exitCode: green.exitCode });
  if (red.commit === undefined) violations.push({ kind: "redCommitMissing" });
  if (green.commit === undefined) violations.push({ kind: "greenCommitMissing" });
  if (red.commit !== undefined && green.commit !== undefined) {
    if (red.commit === green.commit) violations.push({ kind: "sameCommit", commit: red.commit });
    else if (commitsSinceRed.length === 0) {
      violations.push({ kind: "commitNotAfter", red: red.commit, green: green.commit });
    }
  }
  return violations;
}

/** 报错里的提交号只写前七位。 */
const shortCommit = (commit: string): string => commit.slice(0, 7);

/** 一处对不上的报错：什么不对、怎么改。规矩的编号和位置由调用的地方写。 */
export function describeRedGreenViolation(violation: RedGreenViolation): Issue {
  const { redGreen } = landCopy;
  switch (violation.kind) {
    case "commandDiffers":
      return {
        message: renderCopy(redGreen.commandDiffers.message, {
          red: formatCommand(violation.red),
          green: formatCommand(violation.green),
        }),
        hint: renderCopy(redGreen.commandDiffers.hint),
      };
    case "redPassed":
      return {
        message: renderCopy(redGreen.redPassed.message),
        hint: renderCopy(redGreen.redPassed.hint),
      };
    case "greenFailed":
      return {
        message: renderCopy(redGreen.greenFailed.message, { exitCode: violation.exitCode }),
        hint: renderCopy(redGreen.greenFailed.hint),
      };
    case "redCommitMissing":
      return {
        message: renderCopy(redGreen.redCommitMissing.message),
        hint: renderCopy(redGreen.redCommitMissing.hint),
      };
    case "greenCommitMissing":
      return {
        message: renderCopy(redGreen.greenCommitMissing.message),
        hint: renderCopy(redGreen.greenCommitMissing.hint),
      };
    case "sameCommit":
      return {
        message: renderCopy(redGreen.sameCommit.message, { commit: shortCommit(violation.commit) }),
        hint: renderCopy(redGreen.sameCommit.hint),
      };
    case "commitNotAfter":
      return {
        message: renderCopy(redGreen.commitNotAfter.message, {
          green: shortCommit(violation.green),
          red: shortCommit(violation.red),
        }),
        hint: renderCopy(redGreen.commitNotAfter.hint),
      };
  }
}
