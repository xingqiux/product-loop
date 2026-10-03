import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import {
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { type CommandEnv, connect } from "../connect.ts";
import { lintCopy } from "../copy/lint.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { optionalProject } from "../project/current.ts";
import { readFailure } from "../project/read-error.ts";
import { globalProject, helpOf, readStdin } from "./shared.ts";

// ploop lint text|reply，见「04 命令行」第九节和第十一节。
// 从文件或标准输入读文字交给后端查。在项目里运行时带上项目，按主线的写作规范查，
// 查回复时另查首行是不是以当前的阶段开头。有拦截时退出码 1，和 ploop page check 相同。

const { output, errors: text } = lintCopy;

/**
 * 没写文件时读标准输入。标准输入是终端时不会有人来输入，马上报用法错误，不挂着等；
 * 管道开着但 5 秒内没有传来内容、读到的是空的，也是用法错误，不挂住。
 */
async function readFromStdin(): Promise<Result<string, ErrorBody>> {
  if (process.stdin.isTTY) {
    const { message, hint } = text.noInput;
    return err(
      errorBody("BAD_REQUEST", [{ message: renderCopy(message), hint: renderCopy(hint) }]),
    );
  }
  const input = await readStdin();
  if (input.trim() === "") {
    const { message, hint } = text.emptyInput;
    return err(
      errorBody("BAD_REQUEST", [{ message: renderCopy(message), hint: renderCopy(hint) }]),
    );
  }
  return ok(input);
}

/** 读要查的文字：写了文件读文件，没写读标准输入。 */
async function readInput(
  ctx: CommandEnv,
  file: string | undefined,
): Promise<Result<string, ErrorBody>> {
  if (file === undefined || file === "-") return readFromStdin();
  try {
    return ok(await readFile(resolve(ctx.cwd, file), "utf8"));
  } catch (error) {
    const { reason } = readFailure(error);
    const body = {
      message: renderCopy(text.fileMissing.message, { file, reason }),
      hint: renderCopy(text.fileMissing.hint),
      where: file,
    };
    return err(errorBody("NOT_FOUND", [body]));
  }
}

async function lint(
  ctx: CommandEnv,
  project: string | undefined,
  kind: "text" | "reply",
  file: string | undefined,
): Promise<Outcome> {
  const input = await readInput(ctx, file);
  if (!input.ok) return input;
  const backend = connect(ctx);
  const found = await optionalProject(ctx, backend, project);
  if (!found.ok) return found;
  const json = {
    text: input.value,
    ...(found.value === undefined ? {} : { project: found.value.projectId }),
  };
  const result = await backend.call((api) =>
    kind === "reply" ? api.api.v1.lint.reply.$post({ json }) : api.api.v1.lint.text.$post({ json }),
  );
  if (!result.ok) return result;
  const { data } = result.value;
  const block = data.block as readonly Issue[];
  const warn = data.warn as readonly Issue[];
  const [first, ...rest] = block;
  if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
  const line =
    warn.length === 0
      ? renderCopy(output.passed)
      : renderCopy(output.passedWithWarnings, { count: warn.length });
  return ok({ kind: `lint.${kind}`, data, lines: [line], next: [], warnings: warn });
}

/** 挂上 ploop lint 和它的两个子命令。 */
export function lintCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = lintCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("lint").description(t(help.description));
  for (const kind of ["text", "reply"] as const) {
    const entry = help[kind];
    const command = group
      .command(kind)
      .description(t(entry.description))
      .argument("[文件]", t(help.file))
      .action(async (file, _options, self) => {
        context.settle(await lint(context, globalProject(self), kind, file));
      });
    withHelp(
      command,
      helpOf({
        details: [...Object.values(entry.details), ...Object.values(help.fileDetails)],
        blocks: Object.values(entry.blocks),
        reads: entry.reads,
        writes: entry.writes,
        examples: Object.values(entry.examples),
        after: entry.after,
      }),
    );
  }
}
