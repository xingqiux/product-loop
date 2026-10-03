import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  describeMainlineProblems,
  designSpecItem,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  mainlineParseSchema,
  mainlinePart,
  missingOfParse,
  ok,
  parseMainline,
  projectCacheDirName,
  renderCopy,
  roundNameOfLabel,
  type TextDiffRow,
} from "@product-loop/model";
import { type CommandEnv, connect } from "../connect.ts";
import { mainlineCopy } from "../copy/mainline.ts";
import { withHelp } from "../help.ts";
import type { Outcome, Report } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { currentProject } from "../project/current.ts";
import {
  backendRemote,
  hasUnpushedChange,
  localMainlineText,
  mainlineFileName,
  type Synced,
  type SyncMode,
  sceneList,
  syncMainline,
} from "../project/mainline-sync.ts";
import {
  beijingTime,
  globalProject,
  helpOf,
  openProject,
  statusNext,
  unpushedWarning,
} from "./shared.ts";
import { mainlineLines } from "./status.ts";

// ploop mainline show|check|push|pull|history|diff，见「04 命令行」第二节和「03 数据模型」第五节。
// 主线的工作副本是项目缓存的主线.md，AI 直接改它，每条命令开始时自动同步，见 project/mainline-sync.ts。
// show、check、history、diff 只读集中存储，开始时照常同步。
// push 和 pull 自己就是同步：push 在冲突合并以后交上去，pull 丢掉本地的改动，取回最新的修订。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type Mainline = DataOf<Awaited<ReturnType<Pid["mainline"]["$get"]>>>;
type Revision = NonNullable<Mainline["latest"]>;
type RevisionSummary = DataOf<Awaited<ReturnType<Pid["mainline"]["revisions"]["$get"]>>>[number];

const { output } = mainlineCopy;

/** 「，在第 1 版的构思阶段交的」。两个阶段之间交的不写。 */
const roundText = (round: string | null) =>
  round === null ? "" : renderCopy(output.round, { round: roundNameOfLabel(round) });

/**
 * 从解析结果算出缺哪几个部分，用的是状态和检查主线的同一个算法，见 model 的 missingOfParse。
 * 接口上的解析结果写的是中文，先还原成英文键再算，算完写回中文。
 */
function missingOf(parsed: Revision["parsed"]) {
  const missing = missingOfParse(mainlineParseSchema.parse(parsed));
  return {
    missingParts: missing.parts.map((part) => mainlinePart.label(part)),
    missingDesignSpec: missing.designSpec.map((item) => designSpecItem.label(item)),
  };
}

/** 一次主线修订的概要：第几次、什么时候、来自哪里，缺哪几个部分，场景清单。withText 时接上全文。 */
export function showLines(revision: Revision, withText: boolean): [string, ...string[]] {
  const { scenes } = revision.parsed;
  return [
    renderCopy(output.head, {
      revision: revision.revision,
      time: beijingTime(revision.createdAt),
      source: revision.source,
      round: roundText(revision.round),
    }),
    ...mainlineLines(missingOf(revision.parsed)),
    ...(scenes.length === 0
      ? [renderCopy(output.scenesNone)]
      : [
          renderCopy(output.scenesHead, { count: scenes.length }),
          ...scenes.map((scene) =>
            scene.id === undefined
              ? renderCopy(output.sceneNoId, { name: scene.name })
              : renderCopy(output.scene, { id: scene.id, name: scene.name }),
          ),
        ]),
    ...(withText ? [renderCopy(output.textHead), revision.text.trimEnd()] : []),
  ];
}

/** 历次修订，一次一行。 */
export function historyLines(list: readonly RevisionSummary[]): string[] {
  return list.map((summary) =>
    renderCopy(output.historyRow, {
      revision: summary.revision,
      time: beijingTime(summary.createdAt),
      source: summary.source,
      round: summary.round === null ? "" : `  ${roundNameOfLabel(summary.round)}`,
    }),
  );
}

/** 一行里的几段拼起来，去掉 skip 这一种。 */
function joinParts(parts: TextDiffRow["parts"], skip?: "del" | "ins"): string {
  return parts
    .filter(([kind]) => kind !== skip)
    .map(([, text]) => text)
    .join("");
}

function rowLines(row: TextDiffRow): string[] {
  switch (row.k) {
    case "same":
      return [`  ${joinParts(row.parts)}`];
    case "del":
      return [`- ${joinParts(row.parts)}`];
    case "ins":
      return [`+ ${joinParts(row.parts)}`];
    case "mix":
      return [`- ${joinParts(row.parts, "ins")}`, `+ ${joinParts(row.parts, "del")}`];
    case "gap":
      return [renderCopy(output.gap)];
  }
}

/**
 * 逐行比较写成文字：没变的行前面空两格，删掉的写 -，加上的写 +。
 * 改了一部分的行拆成改前、改后两行。折起来的没变的一段写成省略号。行尾的空白去掉。
 */
export function diffLines(rows: readonly TextDiffRow[]): string[] {
  return rows.flatMap(rowLines).map((line) => line.trimEnd());
}

const noMainline = (): Outcome =>
  ok({
    kind: "mainline.none",
    data: null,
    lines: [renderCopy(output.none), renderCopy(output.write)],
    next: [renderCopy(mainlineCopy.next.check)],
    warnings: [],
  });

async function show(
  ctx: CommandEnv,
  project: string | undefined,
  revision: number | undefined,
  withText: boolean,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  if (revision === undefined) {
    const result = await backend.call((api) =>
      api.api.v1.projects[":pid"].mainline.$get({ param: { pid } }),
    );
    if (!result.ok) return result;
    const { data, warnings } = result.value;
    if (data.latest === null) return noMainline();
    const lines = showLines(data.latest, withText);
    return ok({
      kind: "mainline.revision",
      data: data.latest,
      lines,
      next: [],
      warnings: [...warnings, ...(await unpushedWarning(opened.value))],
    });
  }
  const rev = String(revision);
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].mainline.revisions[":rev"].$get({ param: { pid, rev } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const lines = showLines(data, withText);
  const unpushed = await unpushedWarning(opened.value);
  return ok({
    kind: "mainline.revision",
    data,
    lines,
    next: [],
    warnings: [...warnings, ...unpushed],
  });
}

/**
 * 只检查，不交新的修订（交上去是 mainline push）。
 * 在项目里查项目缓存的主线.md 现在的内容，和交上去时用的是同一套解析；没有项目缓存，或者还没有这个文件时，
 * 查最新交上去的那一次。主线.md 有没交的改动时提醒去 push。
 */
async function check(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const text = local === undefined ? undefined : await localMainlineText(local.root);
  if (local !== undefined && text !== undefined && text.trim() !== "") {
    const parsed = parseMainline(text);
    const missing = missingOfParse(parsed);
    const data = {
      revision: local.identity.mainlineBase?.revision ?? null,
      source: "file" as const,
      missingParts: missing.parts.map((part) => mainlinePart.label(part)),
      missingDesignSpec: missing.designSpec.map((item) => designSpecItem.label(item)),
    };
    const unpushed = (await hasUnpushedChange(local.root, local.identity))
      ? [
          {
            message: renderCopy(mainlineCopy.sync.checkUnpushed.message),
            hint: renderCopy(mainlineCopy.sync.checkUnpushed.hint),
            where: mainlineFileName,
          },
        ]
      : [];
    return ok({
      kind: "mainline.checked",
      data,
      lines: [renderCopy(output.checkedFile), ...mainlineLines(data)],
      next: unpushed.length === 0 ? [] : [renderCopy(mainlineCopy.next.push)],
      warnings: [...describeMainlineProblems(parsed.problems, mainlineFileName), ...unpushed],
    });
  }
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].mainline.check.$get({ param: { pid } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  if (data.revision === null) return noMainline();
  const unpushed = await unpushedWarning(opened.value);
  return ok({
    kind: "mainline.checked",
    data,
    lines: [renderCopy(output.checked, { revision: data.revision }), ...mainlineLines(data)],
    next: unpushed.length === 0 ? [] : [renderCopy(mainlineCopy.next.push)],
    warnings: [...warnings, ...unpushed],
  });
}

async function history(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].mainline.revisions.$get({ param: { pid } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  if (data.length === 0) return noMainline();
  return ok({
    kind: "mainline.history",
    data,
    lines: [renderCopy(output.historyHead, { count: data.length }), ...historyLines(data)],
    next: [],
    warnings,
  });
}

async function diff(
  ctx: CommandEnv,
  project: string | undefined,
  from: number | undefined,
  to: number | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  let target = to;
  if (target === undefined) {
    const list = await backend.call((api) =>
      api.api.v1.projects[":pid"].mainline.revisions.$get({ param: { pid } }),
    );
    if (!list.ok) return list;
    target = list.value.data.at(-1)?.revision;
    if (target === undefined) return noMainline();
  }
  const base = from ?? target - 1;
  if (base < 1) {
    return ok({
      kind: "mainline.diff",
      data: null,
      lines: [renderCopy(output.diffSingle, { revision: target })],
      next: [],
      warnings: [],
    });
  }
  const query = { from: String(base), to: String(target) };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].mainline.diff.$get({ param: { pid }, query }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const changed = data.rows.some((row) => row.k !== "same" && row.k !== "gap");
  return ok({
    kind: "mainline.diff",
    data,
    lines: [
      renderCopy(output.diffHead, { from: data.from, to: data.to }),
      ...(changed ? diffLines(data.rows) : [renderCopy(output.diffSame)]),
    ],
    next: [],
    warnings,
  });
}

/** push 和 pull 的结果写成文字。 */
export function syncReport(synced: Synced, file: string): Report {
  const fileLine = renderCopy(output.file, { file });
  switch (synced.kind) {
    case "same":
      return {
        kind: "mainline.same",
        data: synced,
        lines: [renderCopy(output.none), renderCopy(output.write)],
        next: [renderCopy(mainlineCopy.next.check)],
        warnings: [],
      };
    case "pulled":
      return {
        kind: "mainline.pulled",
        data: synced,
        lines: [
          renderCopy(output.pulled, { revision: synced.revision }),
          ...(synced.discarded ? [renderCopy(output.discarded)] : []),
          ...(synced.remoteRemoved ? [renderCopy(output.remoteRemoved)] : []),
          fileLine,
        ],
        next: [renderCopy(mainlineCopy.next.show)],
        warnings: [],
      };
    case "pushed": {
      const { pushed } = synced;
      const revision = pushed.revision.revision;
      const warnings: Issue[] = [...pushed.warnings];
      return {
        kind: "mainline.pushed",
        data: synced,
        lines: [
          pushed.created
            ? renderCopy(output.pushed, { revision })
            : renderCopy(output.unchanged, { revision }),
          ...(pushed.assignedScenes.length === 0
            ? []
            : [
                renderCopy(mainlineCopy.sync.assigned, {
                  scenes: sceneList(pushed.assignedScenes),
                }),
              ]),
          ...(pushed.removedScenes.length === 0
            ? []
            : [renderCopy(output.removed, { scenes: pushed.removedScenes.join("、") })]),
          ...(synced.remoteRemoved ? [renderCopy(output.remoteRemoved)] : []),
          fileLine,
        ],
        next: [renderCopy(mainlineCopy.next.check)],
        warnings,
      };
    }
  }
}

/** push 和 pull：要在项目目录里，读写项目缓存的主线.md。 */
async function syncCommand(
  ctx: CommandEnv,
  project: string | undefined,
  mode: Exclude<SyncMode, "auto">,
  force = false,
): Promise<Outcome> {
  const backend = connect(ctx);
  const current = await currentProject(ctx, backend, project);
  if (!current.ok) return current;
  const { projectId, local } = current.value;
  if (local === undefined) return err(byIdError(mode, projectId));
  const synced = await syncMainline({
    root: local.root,
    identity: local.identity,
    remote: backendRemote(backend, projectId),
    mode,
    force,
  });
  if (!synced.ok) return synced;
  // 项目里的文件一律写相对项目根的路径。
  const file = `${projectCacheDirName}/${mainlineFileName}`;
  const report = syncReport(synced.value.synced, file);
  // 交上去时已经校验过了，不再让人回头检查一遍：下一步照项目状态给。
  if (synced.value.synced.kind !== "pushed") return ok(report);
  return ok({ ...report, next: (await statusNext(backend, projectId)) ?? report.next });
}

function byIdError(mode: Exclude<SyncMode, "auto">, value: string): ErrorBody<"BAD_REQUEST"> {
  const { message, hint } = mainlineCopy.sync.byId;
  const command = `ploop mainline ${mode}`;
  return errorBody("BAD_REQUEST", [
    { message: renderCopy(message, { command, value }), hint: renderCopy(hint) },
  ]);
}

/** 修订的次数：从 1 起的整数。写得不对时是用法错误，退出码 2。 */
function revisionNumber(value: string): number {
  if (/^[1-9]\d*$/u.test(value)) return Number(value);
  throw new InvalidArgumentError(renderCopy(mainlineCopy.help.revisionInvalid));
}

/** 挂上 ploop mainline 和它的六个子命令。 */
export function mainlineCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = mainlineCopy;
  const group = program.command("mainline").description(renderCopy(help.description));
  const readOnly = { reads: help.readsOnly, writes: help.writesNone };

  const showCommand = group
    .command("show")
    .description(renderCopy(help.show.description))
    .argument("[修订]", renderCopy(help.show.revision), revisionNumber)
    .option("--text", renderCopy(help.show.text))
    .action(async (revision, options, self) => {
      const project = globalProject(self);
      context.settle(await show(context, project, revision, options.text === true));
    });
  withHelp(
    showCommand,
    helpOf({
      details: Object.values(help.show.details),
      ...readOnly,
      examples: Object.values(help.show.examples),
      after: help.show.after,
    }),
  );

  const checkCommand = group
    .command("check")
    .description(renderCopy(help.check.description))
    .action(async (_options, self) => {
      context.settle(await check(context, globalProject(self)));
    });
  withHelp(
    checkCommand,
    helpOf({
      details: Object.values(help.check.details),
      blocks: [help.blocks.remote],
      reads: help.readsOnly,
      writes: help.writesNone,
      examples: [help.check.example],
      after: help.check.after,
    }),
  );

  const pushCommand = group
    .command("push")
    .description(renderCopy(help.push.description))
    .action(async (_options, self) => {
      context.settle(await syncCommand(context, globalProject(self), "push"));
    });
  withHelp(
    pushCommand,
    helpOf({
      details: Object.values(help.push.details),
      blocks: Object.values(help.push.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: [help.push.example],
      after: help.push.after,
    }),
  );

  const pullCommand = group
    .command("pull")
    .description(renderCopy(help.pull.description))
    .option("--force", renderCopy(help.pull.force))
    .action(async (options, self) => {
      context.settle(
        await syncCommand(context, globalProject(self), "pull", options.force === true),
      );
    });
  withHelp(
    pullCommand,
    helpOf({
      details: Object.values(help.pull.details),
      blocks: [...Object.values(help.pull.blocks), help.blocks.noProject],
      reads: help.reads,
      writes: help.writes,
      examples: [help.pull.example],
      after: help.pull.after,
    }),
  );

  const historyCommand = group
    .command("history")
    .description(renderCopy(help.history.description))
    .action(async (_options, self) => {
      context.settle(await history(context, globalProject(self)));
    });
  withHelp(
    historyCommand,
    helpOf({
      details: Object.values(help.history.details),
      ...readOnly,
      examples: [help.history.example],
      after: help.history.after,
    }),
  );

  const diffCommand = group
    .command("diff")
    .description(renderCopy(help.diff.description))
    .argument("[从]", renderCopy(help.diff.from), revisionNumber)
    .argument("[到]", renderCopy(help.diff.to), revisionNumber)
    .action(async (from, to, _options, self) => {
      context.settle(await diff(context, globalProject(self), from, to));
    });
  withHelp(
    diffCommand,
    helpOf({
      details: Object.values(help.diff.details),
      ...readOnly,
      examples: Object.values(help.diff.examples),
      after: help.diff.after,
    }),
  );
}
