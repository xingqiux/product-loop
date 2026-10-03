import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  err,
  errorBody,
  ok,
  renderCopy,
  roundNameOfLabel,
  skillIssueStatus,
} from "@product-loop/model";
import { type CommandEnv, connect } from "../connect.ts";
import { skillCopy } from "../copy/skill.ts";
import { usageCopy } from "../copy/usage.ts";
import { inGroup, withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { optionalProject } from "../project/current.ts";
import { globalProject, helpOf, openProject } from "./shared.ts";

// ploop skill report|issues，见「04 命令行」第十一节。
// report 在项目里运行，后端带上项目、阶段和 skill 的版本。
// issues 列出全部项目报上来的问题，给维护 skill 的会话看。issues reply 回复理解。

type Issues = Api["api"]["v1"]["skill"]["issues"];
type IssueView = DataOf<Awaited<ReturnType<Issues["$post"]>>>;
type StatusLabel = (typeof skillIssueStatus.labels)[number];

const { output } = skillCopy;

/** 状态写中文。 */
function statusArgument(text: string): StatusLabel {
  const found = skillIssueStatus.labels.find((label) => label === text);
  if (found !== undefined) return found;
  throw new InvalidArgumentError(
    renderCopy(usageCopy.choices, { choices: skillIssueStatus.labels.join("、") }),
  );
}

/** 问题的编号是正整数。 */
function idArgument(text: string): number {
  const id = Number(text);
  if (Number.isSafeInteger(id) && id > 0) return id;
  throw new InvalidArgumentError(renderCopy(skillCopy.errors.idInvalid));
}

async function report(
  ctx: CommandEnv,
  project: string | undefined,
  options: { readonly aspect: string; readonly class: string; readonly example: string },
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId } = opened.value;
  const json = {
    project: projectId,
    aspect: options.aspect,
    issueClass: options.class,
    example: options.example,
  };
  const result = await backend.call((api) => api.api.v1.skill.issues.$post({ json }));
  if (!result.ok) return result;
  const { data, next, warnings } = result.value;
  const unknown = renderCopy(output.unknown);
  return ok({
    kind: "skill.reported",
    data,
    lines: [
      renderCopy(output.reported, { id: data.id }),
      renderCopy(output.detail, data),
      renderCopy(output.context, {
        project: data.project,
        round: data.round === null ? unknown : roundNameOfLabel(data.round),
        version: data.skillVersion ?? unknown,
      }),
      renderCopy(output.tell, { id: data.id }),
    ],
    // 报了以后 AI 要做的是告诉用户编号，不是再运行命令：ploop skill issues 是维护 skill 的人用的。
    next: next.filter((command) => command !== issuesCommandText),
    warnings,
  });
}

function issueLines(issue: IssueView): string[] {
  return [
    renderCopy(output.row, {
      ...issue,
      round: issue.round === null ? renderCopy(output.unknown) : roundNameOfLabel(issue.round),
    }),
    renderCopy(output.example, issue),
    ...(issue.note === null ? [] : [renderCopy(output.note, { note: issue.note })]),
  ];
}

async function issues(
  ctx: CommandEnv,
  options: { readonly status?: StatusLabel | undefined },
): Promise<Outcome> {
  const backend = connect(ctx);
  const query = options.status === undefined ? {} : { status: options.status };
  const result = await backend.call((api) => api.api.v1.skill.issues.$get({ query }));
  if (!result.ok) return result;
  const { data } = result.value;
  const head =
    data.length === 0 ? renderCopy(output.none) : renderCopy(output.listed, { count: data.length });
  return ok({
    kind: "skill.issues",
    data,
    lines: [head, ...data.flatMap(issueLines)],
    next: [],
    warnings: [],
  });
}

async function reply(
  ctx: CommandEnv,
  project: string | undefined,
  id: number,
  note: string,
): Promise<Outcome> {
  const blocked = await maintainerGate(ctx, project);
  if (blocked !== undefined) return blocked;
  const backend = connect(ctx);
  const result = await backend.call((api) =>
    api.api.v1.skill.issues[":id"].$patch({
      param: { id: String(id) },
      json: { status: "已理解", note },
    }),
  );
  if (!result.ok) return result;
  const { data } = result.value;
  return ok({
    kind: "skill.replied",
    data,
    lines: [renderCopy(output.replied, { id: data.id }), ...issueLines(data)],
    next: [],
    warnings: [],
  });
}

/** 产品循环自己的项目。处理 skill 的问题只在这里放行，别处的 AI 只能报问题。 */
const maintainerProject = "product-loop";
const maintainerRule = "skill.issues.maintainer";
/** 报问题的下一步里后端写的命令，维护者才用，报问题的一方不用。 */
const issuesCommandText = "ploop skill issues";

/** 处理问题的两条命令先过这一关：当前项目不是产品循环自己的项目，就拦下。 */
async function maintainerGate(
  ctx: CommandEnv,
  project: string | undefined,
): Promise<Outcome | undefined> {
  const found = await optionalProject(ctx, connect(ctx), project);
  if (!found.ok) return found;
  if (found.value?.projectId === maintainerProject) return undefined;
  const { message, hint } = skillCopy.errors.maintainerOnly;
  const body = {
    rule: maintainerRule,
    message: renderCopy(message),
    hint: renderCopy(hint, { project: maintainerProject }),
  };
  return err(errorBody("RULE_BLOCKED", [body]));
}

/** 状态写「新」以外的中文，新报上来的问题不能改回去。 */
function moveStatusArgument(text: string): Exclude<StatusLabel, "新"> {
  const found = statusArgument(text);
  if (found !== "新") return found;
  throw new InvalidArgumentError(
    renderCopy(usageCopy.choices, {
      choices: skillIssueStatus.labels.filter((label) => label !== "新").join("、"),
    }),
  );
}

async function move(
  ctx: CommandEnv,
  project: string | undefined,
  id: number,
  status: Exclude<StatusLabel, "新">,
  options: { readonly note?: string | undefined; readonly fixedIn?: string | undefined },
): Promise<Outcome> {
  const blocked = await maintainerGate(ctx, project);
  if (blocked !== undefined) return blocked;
  const backend = connect(ctx);
  const result = await backend.call((api) =>
    api.api.v1.skill.issues[":id"].$patch({
      param: { id: String(id) },
      json: {
        status,
        ...(options.note === undefined ? {} : { note: options.note }),
        ...(options.fixedIn === undefined ? {} : { fixedIn: options.fixedIn }),
      },
    }),
  );
  if (!result.ok) return result;
  const { data } = result.value;
  return ok({
    kind: "skill.moved",
    data,
    lines: [renderCopy(output.moved, { id: data.id, status: data.status }), ...issueLines(data)],
    next: [],
    warnings: [],
  });
}

/** 挂上 ploop skill、report、issues、issues reply 和 issues set。 */
export function skillCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = skillCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("skill").description(t(help.description));
  const helpFor = (entry: {
    details: Record<string, CopyEntry>;
    reads: CopyEntry;
    writes: CopyEntry;
    examples: Record<string, CopyEntry>;
    after: CopyEntry;
  }) =>
    helpOf({
      details: Object.values(entry.details),
      reads: entry.reads,
      writes: entry.writes,
      examples: Object.values(entry.examples),
      after: entry.after,
    });

  const reportCommand = group
    .command("report")
    .description(t(help.report.description))
    .requiredOption("--aspect <方面>", t(help.report.aspect))
    .requiredOption("--class <类>", t(help.report.issueClass))
    .requiredOption("--example <原始情况>", t(help.report.example))
    .action(async (options, self) => {
      context.settle(await report(context, globalProject(self), options));
    });
  withHelp(reportCommand, helpFor(help.report));

  // 看和处理报上来的问题是维护 skill 的人做的事，别的项目里的 AI 用的只有 report，所以这一支归维护命令。
  const issuesCommand = inGroup(group.command("issues"), "maintenance")
    .description(t(help.issues.description))
    .option("--status <状态>", t(help.issues.status), statusArgument)
    .action(async (options) => {
      context.settle(await issues(context, options));
    });
  withHelp(issuesCommand, helpFor(help.issues));

  const replyCommand = issuesCommand
    .command("reply")
    .description(t(help.reply.description))
    .argument("<编号>", t(help.reply.id), idArgument)
    .argument("<理解>", t(help.reply.note))
    .action(async (id, note, _options, self) => {
      context.settle(await reply(context, globalProject(self), id, note));
    });
  withHelp(replyCommand, helpFor(help.reply));

  const setCommand = issuesCommand
    .command("set")
    .description(t(help.set.description))
    .argument("<编号>", t(help.set.id), idArgument)
    .argument("<状态>", t(help.set.status), moveStatusArgument)
    .option("--note <说明>", t(help.set.note))
    .option("--fixed-in <skill 版本>", t(help.set.fixedIn))
    .action(async (id, status, options, self) => {
      context.settle(await move(context, globalProject(self), id, status, options));
    });
  withHelp(setCommand, helpFor(help.set));
}
