import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  designSpecItem,
  type ErrorBody,
  err,
  errorBody,
  landPlanSection,
  mainlinePart,
  ok,
  parseRoundLabel,
  projectCacheDirName,
  type Result,
  renderCopy,
  roundNameOfLabel,
  roundStatus,
  type StageLabel,
  stage,
  useCodeDir,
} from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { roundCopy } from "../copy/round.ts";
import { usageCopy } from "../copy/usage.ts";
import { versionCopy } from "../copy/version.ts";
import { headCommit, uncommittedFiles } from "../git.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { mainlineFileName } from "../project/mainline-sync.ts";
import { cardLabels, lineText } from "./reply.ts";
import {
  beijingTime,
  globalProject,
  helpOf,
  maxWidth,
  openProject,
  padWidth,
  projectInfo,
  projectRoots,
} from "./shared.ts";
import { screenRows } from "./use.ts";
import { versionShow } from "./version.ts";

// ploop round start|show|close，见「04 命令行」第二到五节，S14 第 2 步和 S15。
// 开始阶段时，落地阶段交上各个根目录的 HEAD，这一批改动从它算起，见约定 0001 第 12 条。
// 开始以后在项目缓存里建好这个阶段的工作区 rounds/<阶段的标识>/。
// show 和 close 不写阶段时取当前的阶段，也就是 ploop status 里的那一个。
// 路径里的阶段要编码：阶段的标识和叫法里有中文，迁移前的文件名里可能有斜杠。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type Started = DataOf<Awaited<ReturnType<Pid["rounds"]["$post"]>>>;
type Detail = DataOf<Awaited<ReturnType<Pid["rounds"][":rid"]["$get"]>>>;
type Closed = DataOf<Awaited<ReturnType<Pid["rounds"][":rid"]["close"]["$post"]>>>;
type QueueItemView = Started["taken"][number];

const { output } = roundCopy;

// ── 选项的取值 ──

/** --defer 的一项：Q9=等构思定下场景 S4。 */
type DeferOption = { readonly id: string; readonly dependsOn: string };
/** --done 和 --return 的一项。退回可以写阶段：Q15:构思=定义不对。 */
type ResultOption = {
  readonly id: string;
  readonly result: "做完" | "退回";
  readonly note: string;
  readonly stage?: StageLabel;
};

/** 阶段写中文。不用 commander 的 choices，帮助的写法要和「04 命令行」第四节的样例相同。 */
function stageArgument(text: string): StageLabel {
  const found = stage.labels.find((label) => label === text);
  if (found !== undefined) return found;
  throw new InvalidArgumentError(
    renderCopy(usageCopy.choices, { choices: stage.labels.join("、") }),
  );
}

/** 在第一个等号处分成两段。没有等号或等号前是空的，返回 undefined。 */
function splitPair(text: string): readonly [string, string] | undefined {
  const at = text.indexOf("=");
  if (at <= 0) return undefined;
  return [text.slice(0, at).trim(), text.slice(at + 1)];
}

/** --take 用逗号隔开，也收全角逗号和顿号，可以写多次。编号写得对不对由后端查。 */
export function collectTake(value: string, previous: string[] | undefined): string[] {
  const ids = value
    .split(/[,，、]/u)
    .map((id) => id.trim())
    .filter((id) => id !== "");
  if (ids.length === 0)
    throw new InvalidArgumentError(renderCopy(roundCopy.help.start.takeInvalid));
  return [...(previous ?? []), ...ids];
}

export function collectDefer(value: string, previous: DeferOption[] | undefined): DeferOption[] {
  const pair = splitPair(value);
  if (pair === undefined) {
    throw new InvalidArgumentError(renderCopy(roundCopy.help.start.deferInvalid));
  }
  return [...(previous ?? []), { id: pair[0], dependsOn: pair[1] }];
}

export function collectDone(value: string, previous: ResultOption[] | undefined): ResultOption[] {
  const pair = splitPair(value);
  if (pair === undefined)
    throw new InvalidArgumentError(renderCopy(roundCopy.help.close.doneInvalid));
  return [...(previous ?? []), { id: pair[0], result: "做完", note: pair[1] }];
}

/** --return 的等号前写编号，或者编号、冒号、阶段。 */
export function collectReturn(value: string, previous: ResultOption[] | undefined): ResultOption[] {
  const pair = splitPair(value);
  const [id = "", stageText, ...extra] = pair?.[0].split(/[:：]/u) ?? [];
  if (pair === undefined || id.trim() === "" || extra.length > 0) {
    throw new InvalidArgumentError(renderCopy(roundCopy.help.close.backInvalid));
  }
  const entry = { id: id.trim(), result: "退回" as const, note: pair[1] };
  if (stageText === undefined) return [...(previous ?? []), entry];
  return [...(previous ?? []), { ...entry, stage: stageArgument(stageText.trim()) }];
}

// ── 开始一个阶段 ──

/** 起点提交：只有一个根目录时只写提交号，有几个根目录才写路径。 */
function baseRows(
  commits: readonly { readonly root: string; readonly commit: string }[],
): string[] {
  return commits.map(({ root, commit }) =>
    commits.length === 1
      ? renderCopy(output.baseRowOne, { commit: commit.slice(0, 12) })
      : renderCopy(output.baseRow, { root, commit: commit.slice(0, 12) }),
  );
}

/** 落地阶段开始时各个根目录的 HEAD。只交是 git 仓库、有提交的根目录，见约定 0001 第 12 条。 */
async function baseCommits(
  backend: Backend,
  pid: string,
): Promise<Result<{ root: string; commit: string }[], ErrorBody>> {
  const roots = await projectRoots(backend, pid);
  if (!roots.ok) return roots;
  const found: { root: string; commit: string }[] = [];
  for (const root of roots.value) {
    const commit = await headCommit(root);
    if (commit !== undefined) found.push({ root, commit });
  }
  return ok(found);
}

/**
 * 主线一行：两样都齐时写齐了。有缺的不写这一行：缺几个部分由警告和「先做」各写一次，
 * 缺哪几个只在 ploop mainline check 里写。
 */
function mainlineLine(mainline: Started["mainline"]): string[] {
  const { missingParts, missingDesignSpec } = mainline;
  if (missingParts.length > 0 || missingDesignSpec.length > 0) return [];
  return [
    renderCopy(output.mainline, {
      total: mainlinePart.keys.length,
      spec: designSpecItem.keys.length,
    }),
  ];
}

const itemRows = (items: readonly QueueItemView[]) =>
  items.map((item) => renderCopy(output.itemRow, { id: item.id, content: item.content }));

/** 这个阶段还在等待的事：这次没有拿出来，写明怎么改回待办。 */
function waitingLines(waiting: Started["waiting"]): string[] {
  const [first] = waiting;
  if (first === undefined) return [];
  return [
    renderCopy(output.waitingHead),
    ...waiting.map((item) =>
      renderCopy(output.waitingRow, {
        id: item.id,
        content: item.content,
        dependsOn: item.dependsOn ?? "",
      }),
    ),
    renderCopy(output.waitingHow, { id: first.id }),
  ];
}

/** 检查阶段要看的屏：这一版新出现或变过的，加 --all-screens 时是全部的屏。别的阶段不列。 */
function screensLines(screens: Started["screens"], all: boolean): string[] {
  if (screens === null) return [];
  if (screens.scenes.length === 0)
    return [renderCopy(all ? output.screensAllHead : output.screensNone)];
  return [renderCopy(all ? output.screensAllHead : output.screensHead), ...screenRows(screens)];
}

/**
 * 开始以后这个阶段先做什么，指到命令上：主线缺哪样、页面怎么写、使用代码怎么跑。
 * 只写现在要做的，写不下的细节留给命令的输出和帮助。
 */
function todoLines(
  data: Started,
  workspace: string | undefined,
  next: readonly string[],
  useDir: string,
): string[] {
  const dir = workspace ?? `rounds/${data.round.label}/`;
  const { todo } = output;
  const drop = data.taken[0] === undefined ? [] : [renderCopy(todo.drop, { id: data.taken[0].id })];
  const { missingParts, missingDesignSpec } = data.mainline;
  const mainline = [
    ...(missingParts.length === 0
      ? []
      : [renderCopy(todo.mainline, { file: `${projectCacheDirName}/${mainlineFileName}` })]),
    ...(missingDesignSpec.length === 0
      ? []
      : [renderCopy(todo.spec, { count: missingDesignSpec.length })]),
  ];
  const stageLines = (): string[] => {
    switch (data.round.stage) {
      case "构思":
        return [...mainline, renderCopy(todo.think, { dir })];
      case "使用":
        return [
          next.some((step) => step.startsWith("ploop use run"))
            ? renderCopy(todo.useKnown)
            : renderCopy(todo.useNew, { dir: `${useDir}/` }),
          renderCopy(todo.usePage),
        ];
      case "检查":
        return [renderCopy(todo.check, { dir })];
      case "落地":
        return [
          renderCopy(todo.land, { dir }),
          renderCopy(todo.landSections, { names: landPlanSection.labels.join("、") }),
        ];
      case "提升":
        return [renderCopy(todo.improve, { dir })];
    }
  };
  return [renderCopy(output.todoHead), ...drop, ...stageLines()];
}

/** 开始阶段的文字：第一行写阶段的叫法，接着写替谁收了尾、换了版，再列拿出来的事、主线和先做什么。 */
export function startedLines(
  data: Started,
  workspace: string | undefined,
  allScreens = false,
  next: readonly string[] = [],
  useDir: string = useCodeDir("own"),
): [string, ...string[]] {
  const { versionChange: change } = data;
  return [
    renderCopy(output.started, { round: roundNameOfLabel(data.round.label) }),
    ...(data.autoClosed === null
      ? []
      : [renderCopy(output.autoClosed, { round: roundNameOfLabel(data.autoClosed.label) })]),
    ...(change === null
      ? []
      : [
          renderCopy(output.versionChanged, {
            started: change.started.version,
            ended: change.ended.version,
            reason: change.ended.endReason ?? "",
          }),
        ]),
    ...(data.taken.length === 0
      ? [renderCopy(output.takenNone)]
      : [renderCopy(output.takenHead), ...itemRows(data.taken)]),
    ...(data.deferred.length === 0
      ? []
      : [
          renderCopy(output.deferredHead),
          ...data.deferred.map((item) =>
            renderCopy(output.deferredRow, {
              id: item.id,
              content: item.content,
              dependsOn: item.dependsOn ?? "",
            }),
          ),
        ]),
    ...waitingLines(data.waiting),
    ...(data.baseCommits === null || data.baseCommits.length === 0
      ? []
      : [renderCopy(output.baseHead), ...baseRows(data.baseCommits)]),
    ...screensLines(data.screens, allScreens),
    ...mainlineLine(data.mainline),
    ...(workspace === undefined ? [] : [renderCopy(output.workspace, { path: workspace })]),
    "",
    ...todoLines(data, workspace, next, useDir),
  ];
}

type StartOptions = {
  readonly take?: readonly string[] | undefined;
  readonly defer?: readonly DeferOption[] | undefined;
  readonly allScreens?: boolean | undefined;
};

async function start(
  ctx: CommandEnv,
  project: string | undefined,
  stageLabel: StageLabel,
  options: StartOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project, { sync: true });
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  let commits: { root: string; commit: string }[] = [];
  if (stageLabel === stage.label("land")) {
    const found = await baseCommits(backend, pid);
    if (!found.ok) return found;
    commits = found.value;
  }
  const json = {
    stage: stageLabel,
    ...(options.take === undefined ? {} : { take: [...options.take] }),
    ...(options.defer === undefined ? {} : { defer: [...options.defer] }),
    ...(commits.length === 0 ? {} : { baseCommits: commits }),
    ...(options.allScreens === true ? { allScreens: true } : {}),
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds.$post({ param: { pid }, json }),
  );
  if (!result.ok) return result;
  const { data, warnings, next } = result.value;
  // 使用阶段要说使用代码放在哪里，这跟仓库是谁的有关，见决定 107。
  let useDir: string | undefined;
  if (data.round.stage === stage.label("use")) {
    const info = await projectInfo(backend, pid);
    if (info.ok) useDir = useCodeDir(info.value.repo);
  }
  // 这个阶段的工作区：AI 把页面数据写在这里，见「04 命令行」第三节。--project 写编号时没有项目缓存。
  let workspace: string | undefined;
  if (local !== undefined) {
    const relative = join(projectCacheDirName, "rounds", data.round.label);
    await mkdir(join(local.root, relative), { recursive: true });
    workspace = `${relative}/`;
  }
  return ok({
    kind: "round.started",
    data: { ...data, workspace: workspace ?? null },
    lines: startedLines(data, workspace, options.allScreens === true, next, useDir),
    next,
    warnings,
  });
}

// ── 看一个阶段和收尾 ──

/** 当前的一个阶段：ploop status 里的那一个阶段，它是不是已经收尾了，和 status 给的下一步。 */
type Current = {
  readonly label: string;
  readonly closed: boolean;
  readonly next: readonly string[];
};

/** 当前的一个阶段：ploop status 里的那一个阶段。这一版还没有阶段时返回 NOT_FOUND。 */
async function currentRoundOf(backend: Backend, pid: string): Promise<Result<Current, ErrorBody>> {
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  const { round } = status.value.data;
  if (round !== null) {
    const closed = round.status === roundStatus.label("closed");
    return ok({ label: round.label, closed, next: status.value.next });
  }
  const text = roundCopy.noRound;
  return err(
    errorBody("NOT_FOUND", [{ message: renderCopy(text.message), hint: renderCopy(text.hint) }]),
  );
}

async function currentRound(backend: Backend, pid: string): Promise<Result<string, ErrorBody>> {
  const current = await currentRoundOf(backend, pid);
  return current.ok ? ok(current.value.label) : current;
}

/** 一件事在这个阶段的状态：有结果写结果，退回到别的阶段写明，没有结果写队列里的状态。 */
function stateOf(entry: Detail["items"][number]): string {
  if (entry.result === null) return entry.item.status;
  if (entry.returnedTo !== null) return renderCopy(output.returnedTo, { stage: entry.returnedTo });
  return entry.result;
}

/** 拿出来的事，一件一行，编号和状态按各列最宽的一项对齐。 */
function stateRows(items: readonly Detail["items"][number][]): string[] {
  const idWidth = maxWidth(items.map((entry) => entry.item.id));
  const stateWidth = maxWidth(items.map(stateOf));
  return items.map((entry) =>
    renderCopy(output.itemState, {
      id: padWidth(entry.item.id, idWidth),
      state: padWidth(stateOf(entry), stateWidth),
      content: entry.item.content,
    }),
  );
}

/** 一个阶段的详情写成文字：状态、谁开的、迁移前的文件名、收尾，拿出来的事，给出过的页。 */
export function detailLines(data: Detail): [string, ...string[]] {
  const { round } = data;
  const time = beijingTime(round.startedAt);
  return [
    renderCopy(output.head, { round: roundNameOfLabel(round.label), status: round.status }),
    data.openedBySession === null
      ? renderCopy(output.openedNoSession, { time })
      : renderCopy(output.openedBy, { time, session: data.openedBySession }),
    ...(round.legacyId === null ? [] : [renderCopy(output.legacy, { legacy: round.legacyId })]),
    ...(round.closedAt === null
      ? []
      : [renderCopy(output.closedAt, { time: beijingTime(round.closedAt) })]),
    ...(data.summary === null ? [] : [renderCopy(output.summary, { summary: data.summary })]),
    ...(data.baseCommits === null || data.baseCommits.length === 0
      ? []
      : [renderCopy(output.baseHead), ...baseRows(data.baseCommits)]),
    ...(data.items.length === 0
      ? [renderCopy(output.itemsNone)]
      : [renderCopy(output.itemsHead), ...stateRows(data.items)]),
    ...(data.pages.length === 0
      ? [renderCopy(output.pagesNone)]
      : [
          renderCopy(output.pagesHead),
          ...data.pages.map((page) =>
            renderCopy(output.pageRow, {
              seq: page.seq,
              purpose: page.purpose,
              status: page.status,
              time: beijingTime(page.presentedAt),
            }),
          ),
        ]),
    ...replyRows(data.replies),
  ];
}

/** 收到的回复：每份回复一个标题行，接着每一行和它的去处。图不写，要看运行 ploop reply show。 */
function replyRows(replies: Detail["replies"]): string[] {
  if (replies.length === 0) return [renderCopy(output.repliesNone)];
  return [
    renderCopy(output.repliesHead),
    ...replies.flatMap((reply) => [
      renderCopy(output.replyRow, {
        seq: reply.pageSeq,
        id: reply.id,
        count: reply.lines.length,
        pending: reply.lines.filter((line) => line.handled === undefined).length,
      }),
      ...reply.lines.flatMap((line) =>
        lineText({ ...line, images: [] }, new Map(), cardLabels(reply.lines)).map(
          (text) => `    ${text}`,
        ),
      ),
    ]),
  ];
}

async function show(
  ctx: CommandEnv,
  project: string | undefined,
  ref: string | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const label = ref === undefined ? await currentRound(backend, pid) : ok(ref);
  if (!label.ok) return label;
  const rid = encodeURIComponent(label.value);
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].$get({ param: { pid, rid } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  return ok({ kind: "round.detail", data, lines: detailLines(data), next: [], warnings });
}

/** 收尾的文字：第一行写阶段，接着列每件事的结果和收尾说明。 */
export function closedLines(data: Closed, aborted = false): [string, ...string[]] {
  return [
    renderCopy(aborted ? output.aborted : output.closed, {
      round: roundNameOfLabel(data.round.label),
    }),
    ...(data.items.length === 0 ? [] : [renderCopy(output.resultsHead), ...stateRows(data.items)]),
    ...(data.summary === null ? [] : [renderCopy(output.summary, { summary: data.summary })]),
  ];
}

type CloseOptions = {
  readonly done?: readonly ResultOption[] | undefined;
  readonly return?: readonly ResultOption[] | undefined;
  readonly summary?: string | undefined;
  readonly abort?: string | undefined;
};

async function close(
  ctx: CommandEnv,
  project: string | undefined,
  options: CloseOptions,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const current = await currentRoundOf(backend, pid);
  if (!current.ok) return current;
  const label = ok(current.value.label);
  const results = [...(options.done ?? []), ...(options.return ?? [])];
  // 已经收尾的一个阶段再收尾，什么都不用做：重复运行同一条命令不是错，退出码 0。
  if (
    current.value.closed &&
    results.length === 0 &&
    options.summary === undefined &&
    options.abort === undefined
  ) {
    const name = roundNameOfLabel(label.value);
    return ok({
      kind: "round.alreadyClosed",
      data: { round: label.value },
      lines: [renderCopy(output.alreadyClosed, { round: name })],
      next: current.value.next,
      warnings: [],
    });
  }
  // 落地阶段收尾时交上各个根目录没提交的文件，见规矩 land.commit.clean。
  let worktree: { root: string; files: string[] }[] | undefined;
  const parsed = parseRoundLabel(label.value);
  if (parsed.ok && parsed.value.stage === "land" && options.abort === undefined) {
    const roots = await projectRoots(backend, pid);
    if (!roots.ok) return roots;
    worktree = [];
    for (const root of roots.value) {
      const files = await uncommittedFiles(root);
      if (files !== undefined) worktree.push({ root, files });
    }
  }
  const json = {
    ...(results.length === 0 ? {} : { results }),
    ...(options.summary === undefined ? {} : { summary: options.summary }),
    ...(options.abort === undefined ? {} : { abort: options.abort }),
    ...(worktree === undefined ? {} : { worktree }),
  };
  const rid = encodeURIComponent(label.value);
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].close.$post({ param: { pid, rid }, json }),
  );
  if (!result.ok) return result;
  const { data, warnings, next } = result.value;
  const aborted = options.abort !== undefined;
  return ok({
    kind: aborted ? "round.aborted" : "round.closed",
    data,
    lines: closedLines(data, aborted),
    next,
    warnings,
  });
}

// ── 挂上命令 ──

/** 挂上 ploop round 和它的三个子命令。 */
export function roundCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = roundCopy;
  const text = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("round").description(text(help.description));

  const startCommand = group
    .command("start")
    .description(text(help.start.description))
    .argument("<阶段名>", text(help.start.stage), stageArgument)
    .option("--take <编号,…>", text(help.start.take), collectTake)
    .option("--defer <编号>=<依赖>", text(help.start.defer), collectDefer)
    .option("--all-screens", text(help.start.allScreens))
    .action(async (stageLabel, options, self) => {
      context.settle(await start(context, globalProject(self), stageLabel, options));
    });
  withHelp(startCommand, {
    details: Object.values(help.start.details).map(text),
    blocks: Object.values(help.start.blocks).map(({ situation, fix }) => [
      text(situation),
      text(fix),
    ]),
    reads: text(help.start.reads),
    writes: text(help.start.writes),
    examples: Object.values(help.start.examples).map(text),
    after: Object.values(help.start.after).map(text),
  });

  const listCommand = group
    .command("list")
    .description(text(help.list.description))
    .action(async (_options, self) => {
      context.settle(await versionShow(context, globalProject(self)));
    });
  withHelp(
    listCommand,
    helpOf({
      details: Object.values(help.list.details),
      reads: versionCopy.help.reads,
      writes: versionCopy.help.writesNone,
      examples: [help.list.example],
      after: help.list.after,
    }),
  );

  const showCommand = group
    .command("show")
    .description(text(help.show.description))
    .argument("[阶段]", text(help.show.round))
    .action(async (ref, _options, self) => {
      context.settle(await show(context, globalProject(self), ref));
    });
  withHelp(
    showCommand,
    helpOf({
      details: Object.values(help.show.details),
      blocks: Object.values(help.show.blocks),
      reads: help.show.reads,
      writes: help.show.writes,
      examples: Object.values(help.show.examples),
      after: help.show.after,
    }),
  );

  const closeCommand = group
    .command("close")
    .description(text(help.close.description))
    .option("--done <编号>=<证据>", text(help.close.done), collectDone)
    .option("--return <编号>=<原因>", text(help.close.back), collectReturn)
    .option("--summary <说明>", text(help.close.summary))
    .addOption(
      new Option("--abort <原因>", text(help.close.abort)).conflicts(["done", "return", "summary"]),
    )
    .action(async (options, self) => {
      context.settle(await close(context, globalProject(self), options));
    });
  withHelp(
    closeCommand,
    helpOf({
      details: Object.values(help.close.details),
      blocks: Object.values(help.close.blocks),
      reads: help.close.reads,
      writes: help.close.writes,
      examples: Object.values(help.close.examples),
      after: help.close.after,
    }),
  );
}
