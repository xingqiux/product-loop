import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import { ok, renderCopy, roundNameOfLabel } from "@product-loop/model";
import type { CommandEnv } from "../connect.ts";
import { versionCopy } from "../copy/version.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { beijingTime, globalProject, helpOf, maxWidth, openProject, padWidth } from "./shared.ts";

// ploop version show|next，见「04 命令行」第二节和「08 版本与迁移」第二节。
// show 看当前的一版和这一版的阶段。next 提前结束这一版并开始下一版，原因必填。
// 不写 --reason 时 commander 报用法错误，退出码 2；只写空白的由后端报，也是退出码 2。
// 提升阶段收尾以后自动进入下一版，由 ploop round start 做，不用这条命令。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type VersionDetail = DataOf<Awaited<ReturnType<Pid["versions"]["current"]["$get"]>>>;

const { output } = versionCopy;

/** 一版写成文字：第几版、状态、开始的时间，结束了写结束的时间和原因，再列这一版的阶段。 */
export function versionLines(data: VersionDetail): [string, ...string[]] {
  const width = maxWidth(data.rounds.map((round) => roundNameOfLabel(round.label)));
  return [
    renderCopy(output.head, {
      version: data.version,
      status: data.status,
      time: beijingTime(data.startedAt),
    }),
    ...(data.endedAt === null
      ? []
      : [renderCopy(output.ended, { time: beijingTime(data.endedAt) })]),
    ...(data.endReason === null ? [] : [renderCopy(output.endReason, { reason: data.endReason })]),
    ...(data.rounds.length === 0
      ? [renderCopy(output.roundsNone)]
      : [
          renderCopy(output.roundsHead),
          ...data.rounds.map((round) =>
            renderCopy(output.roundRow, {
              round: padWidth(roundNameOfLabel(round.label), width),
              status: round.status,
            }),
          ),
        ]),
  ];
}

/** 当前的一版和它的阶段，ploop version show 和 ploop round list 共用。 */
export async function versionShow(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].versions.current.$get({ param: { pid } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  return ok({ kind: "version.current", data, lines: versionLines(data), next: [], warnings });
}

async function next(
  ctx: CommandEnv,
  project: string | undefined,
  reason: string,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].versions.next.$post({ param: { pid }, json: { reason } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const { ended, started } = data;
  return ok({
    kind: "version.next",
    data,
    lines: [
      renderCopy(output.next, { started: started.version, ended: ended.version }),
      renderCopy(output.endReason, { reason: ended.endReason ?? reason }),
    ],
    next: [renderCopy(versionCopy.help.next.after)],
    warnings,
  });
}

/** 挂上 ploop version 和它的两个子命令。 */
export function versionCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = versionCopy;
  const group = program.command("version").description(renderCopy(help.description));

  const showCommand = group
    .command("show")
    .description(renderCopy(help.show.description))
    .action(async (_options, self) => {
      context.settle(await versionShow(context, globalProject(self)));
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

  const nextCommand = group
    .command("next")
    .description(renderCopy(help.next.description))
    .requiredOption("--reason <原因>", renderCopy(help.next.reason))
    .action(async (options, self) => {
      context.settle(await next(context, globalProject(self), options.reason));
    });
  withHelp(
    nextCommand,
    helpOf({
      details: Object.values(help.next.details),
      blocks: Object.values(help.next.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.next.examples),
      after: help.next.after,
    }),
  );
}
