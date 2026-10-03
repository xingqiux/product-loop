import { type CommandUnknownOpts, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  decisionKind,
  decisionListSchema,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  issuesOf,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { decisionCopy } from "../copy/decision.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import { shownFrom } from "../page/data.ts";
import type { ProgramContext } from "../program.ts";
import { writeDecisionDoc } from "../project/cache.ts";
import {
  defaultListLimit,
  globalProject,
  helpOf,
  limitOption,
  maxWidth,
  openProject,
  padWidth,
} from "./shared.ts";

// ploop decision list|add|edit|void，见「04 命令行」第二节和第十节。
// 决定、原因、案例三项必填，缺的由后端按规矩 decision.fields 拦截，一次报齐，退出码 1。
// 所以这三项在命令行里都是选填的选项，缺了不按用法错误报。
// edit 只改写了的项，编号和日期不变，已作废的也能改；「决定」一项超过 40 个字的，后端按
// 规矩 decision.decision.tooLong 拦截，add 也一样。
// 每次写了决定，就按集中存储里的全部决定重写项目缓存的决定.md，含已作废的。
// 决定.md 是只读视图，命令从不回读它，见「03 数据模型」第五节。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type DecisionView = DataOf<Awaited<ReturnType<Pid["decisions"]["$post"]>>>;
type KindLabel = (typeof decisionKind.labels)[number];

const { output } = decisionCopy;

/** 列表的各行：编号和种类按最宽的一项对齐，已作废的写明被哪一条推翻。 */
export function listLines(decisions: readonly DecisionView[]): string[] {
  const idWidth = maxWidth(decisions.map((d) => String(d.id)));
  const kindWidth = maxWidth(decisions.map((d) => d.kind));
  return decisions.map((d) => {
    const cells = {
      id: padWidth(String(d.id), idWidth),
      date: d.date,
      kind: padWidth(d.kind, kindWidth),
      decision: d.decision,
    };
    return d.voidedBy === undefined
      ? renderCopy(output.row, cells)
      : renderCopy(output.voidedRow, { ...cells, by: d.voidedBy });
  });
}

/** 后端报错里的位置是字段名，命令行里改成用户敲的选项名：reason 写成 --reason。 */
const optionNames: Readonly<Record<string, string>> = {
  decision: "--decision",
  reason: "--reason",
  case: "--case",
  kind: "--kind",
  by: "--by",
};

function withOptionNames<T>(result: Result<T, ErrorBody>): Result<T, ErrorBody> {
  if (result.ok) return result;
  const issues = issuesOf(result.error).map(
    (issue): Issue => ({ ...issue, where: optionNames[issue.where ?? ""] ?? issue.where }),
  );
  const [first, ...rest] = issues;
  return first === undefined ? result : err(errorBody(result.error.code, [first, ...rest]));
}

/**
 * 按集中存储里的全部决定重写决定.md。--project 写编号时没有项目缓存，不写。
 * 决定已经存下了，重写失败只算警告：重跑这条命令会再记一条。
 */
async function rewriteDoc(
  backend: Backend,
  pid: string,
  root: string | undefined,
): Promise<{ readonly lines: string[]; readonly warnings: Issue[] }> {
  if (root === undefined) return { lines: [], warnings: [] };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].decisions.$get({
      param: { pid },
      query: { includeVoided: "true" },
    }),
  );
  if (!result.ok) return { lines: [], warnings: [...issuesOf(result.error)] };
  const written = await writeDecisionDoc(root, decisionListSchema.parse(result.value.data));
  return { lines: [renderCopy(output.doc, { file: shownFrom(root)(written) })], warnings: [] };
}

async function list(
  ctx: CommandEnv,
  project: string | undefined,
  all: boolean,
  limit: number,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const query = all ? { includeVoided: "true" } : {};
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].decisions.$get({ param: { pid }, query }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const empty = all ? output.listEmpty : output.listEmptyActive;
  // 决定多的时候文字只列最近的几条；--json 里仍是全部。
  const shown = limit === 0 ? data : data.slice(-limit);
  const lines: [string, ...string[]] =
    data.length === 0
      ? [renderCopy(empty)]
      : [
          shown.length === data.length
            ? renderCopy(output.listHead, { count: data.length })
            : renderCopy(output.listHeadLimited, { shown: shown.length, count: data.length }),
          ...listLines(shown),
          ...(shown.length === data.length
            ? []
            : [renderCopy(output.listMore, { rest: data.length - shown.length })]),
        ];
  return ok({ kind: "decision.list", data, lines, next: [], warnings });
}

type AddOptions = {
  readonly decision?: string | undefined;
  readonly reason?: string | undefined;
  readonly case?: string | undefined;
  readonly kind?: KindLabel | undefined;
};

async function add(
  ctx: CommandEnv,
  project: string | undefined,
  options: AddOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const json = {
    ...(options.kind === undefined ? {} : { kind: options.kind }),
    ...(options.decision === undefined ? {} : { decision: options.decision }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.case === undefined ? {} : { case: options.case }),
  };
  const result = withOptionNames(
    await backend.call((api) =>
      api.api.v1.projects[":pid"].decisions.$post({ param: { pid }, json }),
    ),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const doc = await rewriteDoc(backend, pid, local?.root);
  return ok({
    kind: "decision.added",
    data,
    lines: [
      renderCopy(output.added, { kind: data.kind, id: data.id }),
      data.decision,
      renderCopy(output.reason, { text: data.reason }),
      renderCopy(output.case, { text: data.case }),
      ...doc.lines,
    ],
    next: [renderCopy(decisionCopy.next.list)],
    warnings: [...warnings, ...doc.warnings],
  });
}

type EditOptions = {
  readonly decision?: string | undefined;
  readonly reason?: string | undefined;
  readonly case?: string | undefined;
};

/** 选项写成 PATCH 的请求体：只带写了的项，没写的不带。 */
export function editBodyOf(options: EditOptions) {
  return {
    ...(options.decision === undefined ? {} : { decision: options.decision }),
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.case === undefined ? {} : { case: options.case }),
  };
}

async function editOne(
  ctx: CommandEnv,
  project: string | undefined,
  id: number,
  options: EditOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const result = withOptionNames(
    await backend.call((api) =>
      api.api.v1.projects[":pid"].decisions[":id"].$patch({
        param: { pid, id: String(id) },
        json: editBodyOf(options),
      }),
    ),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const doc = await rewriteDoc(backend, pid, local?.root);
  return ok({
    kind: "decision.edited",
    data,
    lines: [
      renderCopy(output.edited, { id: data.id }),
      data.decision,
      renderCopy(output.reason, { text: data.reason }),
      renderCopy(output.case, { text: data.case }),
      ...doc.lines,
    ],
    next: [renderCopy(decisionCopy.next.list)],
    warnings: [...warnings, ...doc.warnings],
  });
}

async function voidOne(
  ctx: CommandEnv,
  project: string | undefined,
  id: number,
  options: { readonly by: number; readonly reason?: string | undefined },
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const json = {
    by: options.by,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  };
  const result = withOptionNames(
    await backend.call((api) =>
      api.api.v1.projects[":pid"].decisions[":id"].void.$post({
        param: { pid, id: String(id) },
        json,
      }),
    ),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const doc = await rewriteDoc(backend, pid, local?.root);
  return ok({
    kind: "decision.voided",
    data,
    lines: [renderCopy(output.voided, { id: data.id, by: options.by }), ...doc.lines],
    next: [renderCopy(decisionCopy.next.list)],
    warnings: [...warnings, ...doc.warnings],
  });
}

/** 决定的编号：从 1 起的整数。写得不对时是用法错误，退出码 2。 */
function decisionNumber(value: string): number {
  if (/^[1-9]\d*$/u.test(value)) return Number(value);
  throw new InvalidArgumentError(renderCopy(decisionCopy.help.void.numberInvalid));
}

/** 挂上 ploop decision 和它的四个子命令。 */
export function decisionCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = decisionCopy;
  const group = program.command("decision").description(renderCopy(help.description));

  const listCommand = group
    .command("list")
    .description(renderCopy(help.list.description))
    .option("--all", renderCopy(help.list.all))
    .option("--limit <条数>", renderCopy(help.list.limit), limitOption, defaultListLimit)
    .action(async (options, self) => {
      context.settle(await list(context, globalProject(self), options.all === true, options.limit));
    });
  withHelp(
    listCommand,
    helpOf({
      details: Object.values(help.list.details),
      reads: help.reads,
      writes: help.writesNone,
      examples: Object.values(help.list.examples),
      after: help.list.after,
    }),
  );

  const addCommand = group
    .command("add")
    .description(renderCopy(help.add.description))
    .option("--decision <决定>", renderCopy(help.add.decision))
    .option("--reason <原因>", renderCopy(help.add.reason))
    .option("--case <案例>", renderCopy(help.add.case))
    .addOption(new Option("--kind <种类>", renderCopy(help.add.kind)).choices(decisionKind.labels))
    .action(async (options, self) => {
      context.settle(await add(context, globalProject(self), options));
    });
  withHelp(
    addCommand,
    helpOf({
      details: Object.values(help.add.details),
      blocks: Object.values(help.add.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.add.examples),
      after: help.add.after,
    }),
  );

  const editCommand = group
    .command("edit")
    .description(renderCopy(help.edit.description))
    .argument("<决定编号>", renderCopy(help.edit.id), decisionNumber)
    .option("--decision <决定>", renderCopy(help.edit.decision))
    .option("--reason <原因>", renderCopy(help.edit.reason))
    .option("--case <案例>", renderCopy(help.edit.case))
    .action(async (id, options, self) => {
      context.settle(await editOne(context, globalProject(self), id, options));
    });
  withHelp(
    editCommand,
    helpOf({
      details: Object.values(help.edit.details),
      blocks: Object.values(help.edit.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.edit.examples),
      after: help.edit.after,
    }),
  );

  const voidCommand = group
    .command("void")
    .description(renderCopy(help.void.description))
    .argument("<被推翻的决定编号>", renderCopy(help.void.id), decisionNumber)
    .addOption(
      new Option("--by <新决定编号>", renderCopy(help.void.by))
        .argParser(decisionNumber)
        .makeOptionMandatory(),
    )
    .option("--reason <原因>", renderCopy(help.void.reason))
    .action(async (id, options, self) => {
      context.settle(await voidOne(context, globalProject(self), id, options));
    });
  withHelp(
    voidCommand,
    helpOf({
      details: Object.values(help.void.details),
      blocks: Object.values(help.void.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.void.examples),
      after: help.void.after,
    }),
  );
}
