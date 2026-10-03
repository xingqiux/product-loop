import { type CommandUnknownOpts, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  type ErrorBody,
  err,
  type Issue,
  ifMatchHeader,
  ok,
  parseCopy,
  parseQueueId,
  proposer,
  queueStatus,
  renderCopy,
  roundNameOfLabel,
  type StageLabel,
  stage,
} from "@product-loop/model";
import type { CommandEnv } from "../connect.ts";
import { queueCopy } from "../copy/queue.ts";
import { usageCopy } from "../copy/usage.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import {
  beijingTime,
  defaultListLimit,
  globalProject,
  helpOf,
  limitOption,
  maxWidth,
  openProject,
  padWidth,
} from "./shared.ts";

// ploop queue list|show|add|edit|wait|reopen|done|drop，见「04 命令行」第二节、第三节和第九节。
// 队列只在集中存储里，命令行不写项目缓存。枚举在接口上写中文，输出照原样写。
// 改内容要带修改计数：先取这件事，用它的修改计数去改，别的会话同时改过就返回冲突，退出码 3。
// 改状态的三条命令各有一个必填的选项：等待写依赖，已完成写证据，已取消写原因。
// 不写时 commander 报用法错误，退出码 2。只写空白的由后端拦截，退出码 1。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type QueueItemView = DataOf<Awaited<ReturnType<Pid["queue"]["$post"]>>>;
type QueueDetail = DataOf<Awaited<ReturnType<Pid["queue"][":qid"]["$get"]>>>;
type QueueEventView = QueueDetail["events"][number];
type StatusLabel = (typeof queueStatus.labels)[number];
type ProposerLabel = (typeof proposer.labels)[number];

const { output } = queueCopy;

/**
 * add 和 edit 里内容超过 40 个字被拦截：后端说「细节写进备注」，
 * 命令里备注是 --note 这个选项，写成它，AI 照着敲就放得进去（主线 S18 第 2 步）。
 */
function noteOptionHint<E extends ErrorBody>(error: E): E {
  const swap = <I extends Issue>(issue: I): I =>
    issue.rule === "queue.content.tooLong" && issue.hint !== undefined
      ? {
          ...issue,
          hint: issue.hint.replace(renderCopy(output.noteWord), renderCopy(output.noteOption)),
        }
      : issue;
  return {
    ...swap(error),
    ...(error.issues === undefined ? {} : { issues: error.issues.map(swap) }),
  };
}

/** 没写筛选时只列没做完的，见「04 命令行」第二节的 queue list。 */
const unfinished: readonly StatusLabel[] = ["待办", "进行中", "等待"];

/** 列表的各行：编号、状态、阶段按各列最宽的一项对齐。 */
export function listLines(items: readonly QueueItemView[]): string[] {
  const idWidth = maxWidth(items.map((item) => item.id));
  const statusWidth = maxWidth(items.map((item) => item.status));
  return items.map((item) =>
    renderCopy(output.listRow, {
      id: padWidth(item.id, idWidth),
      status: padWidth(item.status, statusWidth),
      stage: item.stage,
      content: item.content,
    }).trimEnd(),
  );
}

/** 「，在第 1 版的检查阶段」：阶段的标识不写给用户看。 */
const roundSuffix = (round: string | undefined) =>
  round === undefined ? "" : renderCopy(output.proposedIn, { round: roundNameOfLabel(round) });

function eventLine(event: QueueEventView): string {
  const time = beijingTime(event.at);
  const round = roundSuffix(event.round);
  if (event.from === undefined)
    return renderCopy(output.eventCreated, { time, to: event.to, round });
  const note = event.note === undefined ? "" : renderCopy(output.eventNote, { note: event.note });
  return renderCopy(output.eventMoved, { time, from: event.from, to: event.to, round, note });
}

/**
 * 备注写成几行：一行的接在「备注：」后面，多行的先写「备注：」，每一行缩进两格，空行留着。
 * 备注没写时不出。
 */
function noteLines(note: string | undefined): string[] {
  if (note === undefined) return [];
  const lines = note.split(/\r\n?|\n/u).map((line) => line.trimEnd());
  const [only, ...rest] = lines;
  if (only !== undefined && rest.length === 0) return [renderCopy(output.note, { text: only })];
  return [
    renderCopy(output.noteHead),
    ...lines.map((text) => (text === "" ? "" : renderCopy(output.noteLine, { text }))),
  ];
}

/** 一件事的全部字段和状态变化。没写的字段不出。 */
export function detailLines({ item, events }: QueueDetail): [string, ...string[]] {
  const optional = (value: string | undefined, entry: CopyEntry<`${string}{text}`>) =>
    value === undefined ? [] : [renderCopy(entry, { text: value })];
  return [
    renderCopy(output.head, { id: item.id, content: item.content }),
    ...noteLines(item.note),
    renderCopy(output.status, { status: item.status }),
    renderCopy(output.stage, { stage: item.stage }),
    renderCopy(output.proposer, {
      proposer: item.proposer,
      time: beijingTime(item.createdAt),
      round: roundSuffix(item.proposedIn),
    }),
    // 状态说明和证据相同时只写证据一行。
    ...(item.statusNote === undefined || item.statusNote === item.evidence
      ? []
      : [renderCopy(output.statusNote, { note: item.statusNote })]),
    ...optional(item.dependsOn, output.dependsOn),
    ...optional(item.acceptance, output.acceptance),
    ...(item.subItems.length === 0
      ? []
      : [
          renderCopy(output.subItemsHead),
          ...item.subItems.map((text, i) => renderCopy(output.subItem, { n: i + 1, text })),
        ]),
    ...optional(item.source, output.source),
    ...optional(item.evidence, output.evidence),
    ...(item.fromLine === undefined ? [] : [renderCopy(output.fromLine, item.fromLine)]),
    ...(events.length === 0 ? [] : [renderCopy(output.eventsHead), ...events.map(eventLine)]),
  ];
}

type ListOptions = {
  readonly stage: readonly StageLabel[] | undefined;
  readonly status: readonly StatusLabel[] | undefined;
  readonly all: boolean;
  readonly limit: number;
};

async function list(ctx: CommandEnv, project: string | undefined, options: ListOptions) {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const statuses = options.status ?? (options.all ? undefined : unfinished);
  const query = {
    ...(options.stage === undefined ? {} : { stage: [...options.stage] }),
    ...(statuses === undefined ? {} : { status: [...statuses] }),
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue.$get({ param: { pid }, query }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  // 事多的时候文字只列最近放进来的几件，仍按编号从小到大排；--json 里仍是全部。
  const shown =
    options.limit === 0 || data.length <= options.limit ? data : data.slice(-options.limit);
  const lines: [string, ...string[]] =
    data.length === 0
      ? [renderCopy(output.listEmpty)]
      : [
          shown.length === data.length
            ? renderCopy(output.listHead, { count: data.length })
            : renderCopy(output.listHeadLimited, { shown: shown.length, count: data.length }),
          ...listLines(shown),
          ...(shown.length === data.length
            ? []
            : [renderCopy(output.listMore, { rest: data.length - shown.length })]),
        ];
  return ok({ kind: "queue.list", data, lines, next: [], warnings });
}

async function show(ctx: CommandEnv, project: string | undefined, qid: string): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue[":qid"].$get({ param: { pid, qid } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  return ok({ kind: "queue.item", data, lines: detailLines(data), next: [], warnings });
}

type AddOptions = {
  readonly stage: StageLabel;
  readonly proposer: ProposerLabel;
  readonly acceptance?: string | undefined;
  readonly item?: readonly string[] | undefined;
  readonly source?: string | undefined;
  readonly note?: string | undefined;
};

async function add(
  ctx: CommandEnv,
  project: string | undefined,
  content: string,
  options: AddOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project, { sync: true });
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const json = {
    content,
    stage: options.stage,
    proposer: options.proposer,
    ...(options.acceptance === undefined ? {} : { acceptance: options.acceptance }),
    ...(options.item === undefined ? {} : { subItems: [...options.item] }),
    ...(options.source === undefined ? {} : { source: options.source }),
    ...(options.note === undefined ? {} : { note: options.note }),
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue.$post({ param: { pid }, json }),
  );
  if (!result.ok) return err(noteOptionHint(result.error));
  const { data, warnings } = result.value;
  return ok({
    kind: "queue.added",
    data,
    lines: [
      renderCopy(output.added, { id: data.id }),
      renderCopy(output.addedDetail, {
        stage: data.stage,
        status: data.status,
        content: data.content,
      }),
    ],
    next: [renderCopy(queueCopy.next.list)],
    warnings,
  });
}

type EditOptions = {
  readonly content?: string | undefined;
  readonly stage?: StageLabel | undefined;
  readonly statusNote?: string | undefined;
  readonly evidence?: string | undefined;
  readonly dependsOn?: string | undefined;
  readonly acceptance?: string | false | undefined;
  readonly item?: readonly string[] | undefined;
  readonly items: boolean;
  readonly source?: string | false | undefined;
  readonly note?: string | false | undefined;
};

/** 选项写成 PATCH 的请求体：写了 --no-… 的写 null，子项写了就整份替换。 */
export function patchOf(options: EditOptions) {
  const nullable = (value: string | false | undefined) =>
    value === undefined ? undefined : value === false ? null : value;
  const acceptance = nullable(options.acceptance);
  const source = nullable(options.source);
  const note = nullable(options.note);
  const subItems = options.item ?? (options.items ? undefined : []);
  return {
    ...(options.content === undefined ? {} : { content: options.content }),
    ...(options.stage === undefined ? {} : { stage: options.stage }),
    ...(options.statusNote === undefined ? {} : { statusNote: options.statusNote }),
    ...(options.evidence === undefined ? {} : { evidence: options.evidence }),
    ...(options.dependsOn === undefined ? {} : { dependsOn: options.dependsOn }),
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(subItems === undefined ? {} : { subItems: [...subItems] }),
    ...(source === undefined ? {} : { source }),
    ...(note === undefined ? {} : { note }),
  };
}

async function edit(
  ctx: CommandEnv,
  project: string | undefined,
  qid: string,
  options: EditOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project, { sync: true });
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const current = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue[":qid"].$get({ param: { pid, qid } }),
  );
  if (!current.ok) return current;
  const headers = { [ifMatchHeader]: String(current.value.data.item.editCount) };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue[":qid"].$patch(
      { param: { pid, qid }, json: patchOf(options) },
      { headers },
    ),
  );
  if (!result.ok) return err(noteOptionHint(result.error));
  const { data, warnings } = result.value;
  return ok({
    kind: "queue.edited",
    data,
    lines: [
      renderCopy(output.edited, { id: data.id }),
      renderCopy(output.addedDetail, {
        stage: data.stage,
        status: data.status,
        content: data.content,
      }),
    ],
    next: [renderCopy(queueCopy.next.show, { id: data.id })],
    warnings,
  });
}

/** 改状态的四种，用状态的英文键区分。 */
type TransitionTo = "waiting" | "done" | "dropped" | "todo";

/** 改状态的请求体：等待写依赖，已完成写证据，已取消写原因，改回待办可以写一句说明。 */
function transitionBody(to: TransitionTo, text: string | undefined) {
  switch (to) {
    case "waiting":
      return { to: queueStatus.label("waiting"), dependsOn: text ?? "" };
    case "done":
      return { to: queueStatus.label("done"), evidence: text ?? "" };
    case "dropped":
      return { to: queueStatus.label("dropped"), reason: text ?? "" };
    case "todo":
      return { to: queueStatus.label("todo"), ...(text === undefined ? {} : { note: text }) };
  }
}

const transitionLine = {
  waiting: output.waiting,
  done: output.done,
  dropped: output.dropped,
  todo: output.reopened,
};

async function transition(
  ctx: CommandEnv,
  project: string | undefined,
  qid: string,
  to: TransitionTo,
  text: string | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].queue[":qid"].transitions.$post({
      param: { pid, qid },
      json: transitionBody(to, text),
    }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  return ok({
    kind: `queue.${to}`,
    data,
    lines: [
      renderCopy(transitionLine[to], { id: data.id }),
      renderCopy(output.addedDetail, {
        stage: data.stage,
        status: data.status,
        content: data.content,
      }),
      ...(to === "todo" && data.status === queueStatus.label("todo")
        ? [renderCopy(output.reopenedNext, { stage: data.stage })]
        : []),
    ],
    // 做完的事要在收尾时记进这个阶段，先接着收尾；别的改动回到队列看。
    next: [renderCopy(to === "done" ? queueCopy.next.close : queueCopy.next.list)],
    warnings,
  });
}

/** 编号用共用定义解析，写错时是用法错误，报共用定义里的文案。 */
function queueIdArgument(text: string): string {
  const parsed = parseQueueId(text);
  if (parsed.ok) return text;
  throw new InvalidArgumentError(renderCopy(parseCopy.queueId[parsed.error].hint));
}

const collect = (value: string, previous: string[] | undefined) => [...(previous ?? []), value];

/** 挂上 ploop queue 和它的八个子命令。 */
export function queueCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = queueCopy;
  const group = program.command("queue").description(renderCopy(help.description));
  const idArgument = ["<编号>", renderCopy(help.id), queueIdArgument] as const;

  const listCommand = group
    .command("list")
    .description(renderCopy(help.list.description))
    .addOption(
      new Option("--stage <阶段名>", renderCopy(help.list.stage))
        .choices(stage.labels)
        .argParser(collectChoice(stage.labels)),
    )
    .addOption(
      new Option("--status <状态>", renderCopy(help.list.status))
        .choices(queueStatus.labels)
        .argParser(collectChoice(queueStatus.labels)),
    )
    .option("--all", renderCopy(help.list.all))
    .option("--limit <条数>", renderCopy(help.list.limit), limitOption, defaultListLimit)
    .action(async (options, self) => {
      const listOptions = {
        stage: options.stage,
        status: options.status,
        all: options.all === true,
        limit: options.limit,
      };
      context.settle(await list(context, globalProject(self), listOptions));
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

  const showCommand = group
    .command("show")
    .description(renderCopy(help.show.description))
    .argument(...idArgument)
    .action(async (qid, _options, self) => {
      context.settle(await show(context, globalProject(self), qid));
    });
  withHelp(
    showCommand,
    helpOf({
      details: Object.values(help.show.details),
      reads: help.reads,
      writes: help.writesNone,
      examples: Object.values(help.show.examples),
      after: help.show.after,
    }),
  );

  const addCommand = group
    .command("add")
    .description(renderCopy(help.add.description))
    .argument("<内容>", renderCopy(help.add.content))
    .addOption(
      new Option("--stage <阶段名>", renderCopy(help.add.stage))
        .choices(stage.labels)
        .makeOptionMandatory(),
    )
    .addOption(
      new Option("--proposer <提出者>", renderCopy(help.add.proposer))
        .choices(proposer.labels)
        .default("AI" as const),
    )
    .option("--acceptance <验收标准>", renderCopy(help.add.acceptance))
    .option("--item <子项>", renderCopy(help.add.item), collect)
    .option("--source <来源>", renderCopy(help.add.source))
    .option("--note <备注>", renderCopy(help.add.note))
    .action(async (content, options, self) => {
      context.settle(await add(context, globalProject(self), content, options));
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
    .argument(...idArgument)
    .option("--content <内容>", renderCopy(help.edit.content))
    .addOption(new Option("--stage <阶段名>", renderCopy(help.edit.stage)).choices(stage.labels))
    .option("--status-note <说明>", renderCopy(help.edit.statusNote))
    .option("--evidence <证据>", renderCopy(help.edit.evidence))
    .option("--depends-on <依赖>", renderCopy(help.edit.dependsOn))
    .option("--acceptance <验收标准>", renderCopy(help.edit.acceptance))
    .option("--no-acceptance", renderCopy(help.edit.noAcceptance))
    .option("--item <子项>", renderCopy(help.edit.item), collect)
    .option("--no-items", renderCopy(help.edit.noItems))
    .option("--source <来源>", renderCopy(help.edit.source))
    .option("--no-source", renderCopy(help.edit.noSource))
    .option("--note <备注>", renderCopy(help.edit.note))
    .option("--no-note", renderCopy(help.edit.noNote))
    .action(async (qid, options, self) => {
      context.settle(await edit(context, globalProject(self), qid, options));
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

  const transitionBlocks = Object.values(help.transitionBlocks);

  const waitCommand = group
    .command("wait")
    .description(renderCopy(help.wait.description))
    .argument(...idArgument)
    .requiredOption("--depends-on <依赖>", renderCopy(help.wait.dependsOn))
    .action(async (qid, options, self) => {
      const project = globalProject(self);
      context.settle(await transition(context, project, qid, "waiting", options.dependsOn));
    });
  withHelp(
    waitCommand,
    helpOf({
      details: Object.values(help.wait.details),
      blocks: transitionBlocks,
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.wait.examples),
      after: help.wait.after,
    }),
  );

  const reopenCommand = group
    .command("reopen")
    .description(renderCopy(help.reopen.description))
    .argument(...idArgument)
    .option("--reason <原因>", renderCopy(help.reopen.reason))
    .action(async (qid, options, self) => {
      const project = globalProject(self);
      context.settle(await transition(context, project, qid, "todo", options.reason));
    });
  withHelp(
    reopenCommand,
    helpOf({
      details: Object.values(help.reopen.details),
      blocks: transitionBlocks,
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.reopen.examples),
      after: help.reopen.after,
    }),
  );

  const doneCommand = group
    .command("done")
    .description(renderCopy(help.done.description))
    .argument(...idArgument)
    .requiredOption("--evidence <证据>", renderCopy(help.done.evidence))
    .action(async (qid, options, self) => {
      const project = globalProject(self);
      context.settle(await transition(context, project, qid, "done", options.evidence));
    });
  withHelp(
    doneCommand,
    helpOf({
      details: Object.values(help.done.details),
      blocks: transitionBlocks,
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.done.examples),
      after: help.done.after,
    }),
  );

  const dropCommand = group
    .command("drop")
    .description(renderCopy(help.drop.description))
    .argument(...idArgument)
    .requiredOption("--reason <原因>", renderCopy(help.drop.reason))
    .action(async (qid, options, self) => {
      const project = globalProject(self);
      context.settle(await transition(context, project, qid, "dropped", options.reason));
    });
  withHelp(
    dropCommand,
    helpOf({
      details: Object.values(help.drop.details),
      blocks: transitionBlocks,
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.drop.examples),
      after: help.drop.after,
    }),
  );
}

/**
 * 可以写多次、取值有限定的选项，逐次收进数组。
 * 写在 .choices() 后面，替掉 commander 只收一个取值的解析，帮助里照样列出取值。
 */
function collectChoice<const L extends readonly string[]>(labels: L) {
  return (value: string, previous: L[number][] | undefined): L[number][] => {
    const found = labels.find((label) => label === value);
    if (found === undefined) {
      const choices = labels.join("、");
      throw new InvalidArgumentError(renderCopy(usageCopy.choices, { choices }));
    }
    return [...(previous ?? []), found];
  };
}
