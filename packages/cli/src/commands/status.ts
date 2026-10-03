import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  designSpecItem,
  mainlinePart,
  ok,
  pageNameOfLabel,
  pagePurpose,
  queueStatus,
  renderCopy,
  roundNameOfLabel,
  roundStatus,
  stage,
} from "@product-loop/model";
import { type Backend, type CommandEnv, connect } from "../connect.ts";
import { statusCopy } from "../copy/status.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { globalProject, openProject, unpushedWarning } from "./shared.ts";

// ploop status [--all]，和不带子命令的 ploop，见「04 命令行」第二节、S13 第 3 步和 S14 第 1 步。
// 写出第几版的哪个阶段，哪一页在等，队列剩什么，主线缺哪几个部分。
// 下一步和警告由后端算好，放在响应外壳里，这里照原样输出。
// Time Machine 的警告和产品循环无关：后端对命令行的状态请求不带它，只在 ploop backup list 里写（P29）。

/** 收尾的命令，后端在下一步里给的原文。 */
const closeCommandText = "ploop round close";
const replyShowCommand = "ploop reply show";

type StatusResponse = Awaited<ReturnType<Api["api"]["v1"]["projects"][":pid"]["status"]["$get"]>>;
/** 一个项目的状态，枚举是接口上的中文。 */
export type ProjectStatus = DataOf<StatusResponse>;

/** 项目的称呼：名称和编号相同时只写一个，不同时编号写在括号里。 */
export function projectName(name: string, id: string): string {
  return name === id ? id : renderCopy(statusCopy.project, { name, id });
}

export function queueText(status: ProjectStatus): string {
  const counts = status.queue.filter(({ count }) => count > 0);
  if (counts.length === 0) return renderCopy(statusCopy.queueNone);
  const parts = counts.map(({ stage, count }) =>
    renderCopy(statusCopy.queueCount, { stage, count }),
  );
  return renderCopy(statusCopy.queue, { counts: parts.join("、") });
}

/** 缺得不多时直接写出名字的上限。 */
const namedLimit = 3;

/** 主线缺几个部分：缺得不多时写名字，多了只写件数。主线一行，设计规范一行。status 和 round start 用，缺哪几个见 mainline check。 */
export function mainlineCounts(
  mainline: Pick<ProjectStatus["mainline"], "missingParts" | "missingDesignSpec">,
): string[] {
  const { missingParts, missingDesignSpec } = mainline;
  const designInParts = missingParts.includes(mainlinePart.label("designSpec"));
  return [
    missingParts.length === 0
      ? renderCopy(statusCopy.mainlineComplete, { total: mainlinePart.keys.length })
      : missingParts.length <= namedLimit
        ? renderCopy(statusCopy.mainlineMissingNames, {
            count: missingParts.length,
            names: missingParts.join("、"),
          })
        : renderCopy(statusCopy.mainlineMissing, { count: missingParts.length }),
    missingDesignSpec.length === 0
      ? renderCopy(statusCopy.designComplete, { total: designSpecItem.keys.length })
      : renderCopy(designInParts ? statusCopy.designMissingWithin : statusCopy.designMissing, {
          count: missingDesignSpec.length,
        }),
  ];
}

/** 缺的部分一个一行。 */
function missingList(head: string, names: readonly string[]): string[] {
  return [head, ...names.map((name) => renderCopy(statusCopy.mainlineNames, { name }))];
}

/** 主线缺哪几个部分：缺的名字一个一行列出来，名单只在这里写。ploop mainline show 和 check 用。 */
export function mainlineLines(
  mainline: Pick<ProjectStatus["mainline"], "missingParts" | "missingDesignSpec">,
): string[] {
  const { missingParts, missingDesignSpec } = mainline;
  const [parts = "", design = ""] = mainlineCounts(mainline);
  return [
    ...(missingParts.length === 0
      ? [parts]
      : missingList(
          renderCopy(statusCopy.mainlineList, { count: missingParts.length }),
          missingParts,
        )),
    ...(missingDesignSpec.length === 0
      ? [design]
      : missingList(
          renderCopy(statusCopy.designList, { count: missingDesignSpec.length }),
          missingDesignSpec,
        )),
  ];
}

/** 第一行：项目、第几版的哪个阶段和它的状态。这一版已结束时不写阶段。 */
export function headLine(status: ProjectStatus): string {
  const project = projectName(status.project.name, status.project.id);
  const version = status.version.version;
  if (status.version.status === "已结束") {
    return renderCopy(statusCopy.headClosed, { project, version });
  }
  if (status.round === null) return renderCopy(statusCopy.headNoRound, { project, version });
  return renderCopy(statusCopy.head, {
    project,
    round: roundNameOfLabel(status.round.label),
    status: status.round.status,
  });
}

/** 在等用户点的页：只看的页不算，它不等回复。 */
function asksOf(status: ProjectStatus) {
  return status.waitingPages.filter((page) => page.purpose === pagePurpose.label("ask"));
}

const startOf = (key: Parameters<typeof stage.label>[0]) => `ploop round start ${stage.label(key)}`;

/**
 * 下一步为什么是这一条：回复还有行没处理；已收尾的阶段以后，队列里这个阶段还有事、要先补设计规范，
 * 或者某个阶段队列里没有事被跳过。
 */
function whyNext(status: ProjectStatus, next: readonly string[]): string[] {
  const unhandled = next.includes(replyShowCommand) ? [renderCopy(statusCopy.unhandled)] : [];
  const { round } = status;
  const skipThink = next.includes(startOf("use")) ? [renderCopy(statusCopy.skipThink)] : [];
  // 这一版已结束或还没开始任何阶段：下一步开新的一版，构思没有内容时从使用开始。
  if (round === null || status.version.status === "已结束") return [...unhandled, ...skipThink];
  if (round.status === roundStatus.label("replied")) {
    // 回复处理完、事都有结果：下一步直接开下一个阶段，这个阶段随之自动收尾。
    const auto = !next.includes(closeCommandText) && !next.includes(replyShowCommand);
    return [...unhandled, ...(auto ? [renderCopy(statusCopy.autoClose)] : [])];
  }
  if (round.status !== roundStatus.label("closed")) return unhandled;
  if (round.stage === stage.label("improve")) {
    return [
      ...unhandled,
      renderCopy(statusCopy.newVersionNext, { version: status.version.version + 1 }),
      ...skipThink,
    ];
  }
  const count = status.queue.find((entry) => entry.stage === round.stage)?.count ?? 0;
  return [
    ...unhandled,
    ...(next.includes(`ploop round start ${round.stage}`) && count > 0
      ? [renderCopy(statusCopy.sameStageFirst, { count, stage: round.stage })]
      : []),
    ...(next.includes("ploop mainline check") ? [renderCopy(statusCopy.specFirst)] : []),
    ...(round.stage === stage.label("check") && next.includes(startOf("improve"))
      ? [renderCopy(statusCopy.skipLand)]
      : []),
  ];
}

/** 进行中的事：收尾前各写一个结果，做完和退回的完整写法都写出来。落地退回要写退回哪个阶段。 */
function unfinishedLines(status: ProjectStatus, unfinished: readonly string[]): string[] {
  const [first] = unfinished;
  if (first === undefined) return [];
  const back =
    status.round?.stage === stage.label("land") ? `${first}:落地=<原因>` : `${first}=<原因>`;
  return [
    renderCopy(statusCopy.closeFirst.ids, { ids: unfinished.join("、") }),
    renderCopy(statusCopy.closeFirst.done, { first }),
    renderCopy(statusCopy.closeFirst.back, { back }),
  ];
}

/** 一个项目的状态写成文字：第一行写第几版的哪个阶段，下面逐行写在等的页、队列、主线。 */
export function statusLines(
  status: ProjectStatus,
  next: readonly string[] = [],
  unfinished: readonly string[] = [],
): [string, ...string[]] {
  const head = headLine(status);
  const asks = asksOf(status);
  const views = status.waitingPages.filter((page) => !asks.includes(page));
  const waiting =
    asks.length === 0
      ? [renderCopy(statusCopy.waitingNone)]
      : asks.map((page) =>
          renderCopy(statusCopy.waiting, {
            page: pageNameOfLabel(page.round, page.seq),
            purpose: page.purpose,
          }),
        );
  return [
    head,
    ...waiting,
    ...views.map((page) =>
      renderCopy(statusCopy.viewing, { page: pageNameOfLabel(page.round, page.seq) }),
    ),
    queueText(status),
    ...mainlineCounts(status.mainline),
    ...whyNext(status, next),
    ...unfinishedLines(status, unfinished),
    ...(status.skill.newerRules ? [renderCopy(statusCopy.newerRules)] : []),
    ...(status.idleDays > 0 ? [renderCopy(statusCopy.idle, { days: status.idleDays })] : []),
  ];
}

/** --all 的一个项目：第几版的哪个阶段，在等的页、没做完的事、停了几天，根目录。 */
function listSummary(status: ProjectStatus): string {
  const { list } = statusCopy;
  const version = status.version.version;
  const queued = status.queue.reduce((sum, { count }) => sum + count, 0);
  const current =
    status.version.status === "已结束"
      ? [renderCopy(list.closed, { version })]
      : status.round === null
        ? [renderCopy(list.version, { version }), renderCopy(statusCopy.noRound)]
        : [roundNameOfLabel(status.round.label), status.round.status];
  return [
    ...current,
    ...(asksOf(status).length > 0
      ? [renderCopy(list.waiting, { count: asksOf(status).length })]
      : []),
    ...(queued > 0 ? [renderCopy(list.queue, { count: queued })] : []),
    ...(status.idleDays > 0 ? [renderCopy(list.idle, { days: status.idleDays })] : []),
    ...status.project.roots,
  ].join("，");
}

/** --all 的各行：每个项目一行，编号对齐。编号只有 ASCII，按字符数对齐就行。 */
export function listLines(list: readonly ProjectStatus[]): string[] {
  const width = Math.max(0, ...list.map((status) => status.project.id.length));
  return list.map((status) => `  ${status.project.id.padEnd(width)}  ${listSummary(status)}`);
}

/** 下一步是收尾时，这个阶段里还在进行中、没写结果的事，收尾要给它们各写一个结果。 */
async function unfinishedItems(
  backend: Backend,
  pid: string,
  status: ProjectStatus,
  next: readonly string[],
): Promise<string[]> {
  if (status.round === null || !next.includes(closeCommandText)) return [];
  const rid = encodeURIComponent(status.round.label);
  const detail = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].$get({ param: { pid, rid } }),
  );
  if (!detail.ok) return [];
  return detail.value.data.items
    .filter((entry) => entry.result === null && entry.item.status === queueStatus.label("doing"))
    .map((entry) => entry.item.id);
}

/** ploop status：当前项目的状态。 */
export async function showStatus(
  ctx: CommandEnv,
  projectOption: string | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, projectOption);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!result.ok) return result;
  const { data, warnings, next } = result.value;
  const unpushed = await unpushedWarning(opened.value);
  const unfinished = await unfinishedItems(backend, pid, data, next);
  return ok({
    kind: "project.status",
    data,
    lines: statusLines(data, next, unfinished),
    next,
    warnings: [...warnings, ...unpushed],
  });
}

/** ploop status --all：所有项目，有页在等的排在最前。 */
async function showAll(ctx: CommandEnv): Promise<Outcome> {
  const backend = connect(ctx);
  const result = await backend.call((api) => api.api.v1.projects.$get({ query: {} }));
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  // 不写 path 时后端返回状态的列表，写了才是按路径找到的项目。
  if (!Array.isArray(data)) throw new Error("GET /projects 不写 path 时应当返回列表。");
  const list: readonly ProjectStatus[] = data;
  if (list.length === 0) {
    const lines: [string] = [renderCopy(statusCopy.list.empty)];
    return ok({
      kind: "project.list",
      data: list,
      lines,
      next: [renderCopy(statusCopy.list.init)],
      warnings,
    });
  }
  const head = renderCopy(statusCopy.list.head, { count: list.length });
  return ok({
    kind: "project.list",
    data: list,
    lines: [head, ...listLines(list)],
    next: [],
    warnings,
  });
}

/** 挂上 ploop status。不带子命令的 ploop 也由 program.ts 接到这里。 */
export function statusCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = statusCopy;
  const command = program
    .command("status")
    .description(renderCopy(help.description))
    .option("--all", renderCopy(help.all))
    .action(async (options, self) => {
      const outcome = options.all
        ? await showAll(context)
        : await showStatus(context, globalProject(self));
      context.settle(outcome);
    });
  withHelp(command, {
    blocks: Object.values(help.blocks).map(({ situation, fix }) => [
      renderCopy(situation),
      renderCopy(fix),
    ]),
    reads: renderCopy(help.reads),
    writes: renderCopy(help.writes),
    examples: Object.values(help.examples).map((example) => renderCopy(example)),
    after: [renderCopy(help.after)],
  });
}
