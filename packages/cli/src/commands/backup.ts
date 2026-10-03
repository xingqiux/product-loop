import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  beijingMinute,
  type CopyEntry,
  exitCode,
  ok,
  renderCopy,
  resolveHome,
} from "@product-loop/model";
import { type Backend, type CommandEnv, connect } from "../connect.ts";
import { backupCmdCopy } from "../copy/backup-cmd.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { formatSize, helpOf, maxWidth, padWidth, shellWord } from "./shared.ts";

// ploop backup now|list|restore|gc，见「03 数据模型」第七节。
// 这几条都是集中存储的事，不看当前项目。恢复由后端做：期间写请求返回忙，
// 恢复以后后端做一次完整性检查，查出的问题作为警告写到标准错误。

type Admin = Api["api"]["v1"]["admin"];
type BackupList = DataOf<Awaited<ReturnType<Admin["backups"]["$get"]>>>;

const { output } = backupCmdCopy;

async function now(ctx: CommandEnv): Promise<Outcome> {
  const result = await connect(ctx).call((api) => api.api.v1.admin.backup.$post());
  if (!result.ok) return result;
  const { data } = result.value;
  return ok({
    kind: "backup.taken",
    data,
    lines: [renderCopy(output.taken, { name: data.name, size: formatSize(data.bytes) })],
    next: [],
    warnings: [],
  });
}

/**
 * 快照是什么时候的，一律写北京时间。每日快照的名字里只有日期（也是北京时间的日期），写日期；
 * 其余的名字里是 UTC 时间 20260928T080500123Z，换成北京时间写到分钟。
 */
export function snapshotTime(when: string): string {
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/u.exec(when);
  if (stamp === null) return when;
  const [, year, month, day, hour, minute, second, milli] = stamp;
  return beijingMinute(new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}.${milli}Z`));
}

function listLines(data: BackupList): string[] {
  const kinds = ["daily", "manual", "preMigration", "preRestore"] as const;
  const all = kinds.flatMap((kind) => data[kind]);
  const timeWidth = maxWidth(all.map((entry) => snapshotTime(entry.when)));
  const sizeWidth = maxWidth(all.map((entry) => formatSize(entry.bytes)));
  return kinds.flatMap((kind) => {
    const entries = data[kind];
    if (entries.length === 0) return [];
    return [
      renderCopy(output.section, { kind: renderCopy(output.kinds[kind]) }),
      ...entries.map((entry) =>
        renderCopy(output.row, {
          time: padWidth(snapshotTime(entry.when), timeWidth),
          size: padWidth(formatSize(entry.bytes), sizeWidth),
          name: entry.name,
        }),
      ),
    ];
  });
}

async function list(ctx: CommandEnv): Promise<Outcome> {
  const backend = connect(ctx);
  const result = await backend.call((api) => api.api.v1.admin.backups.$get());
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const count =
    data.daily.length + data.manual.length + data.preMigration.length + data.preRestore.length;
  const head =
    count === 0
      ? renderCopy(output.none)
      : renderCopy(output.listed, { count, dir: backupsDirOf(ctx) });
  return ok({
    kind: "backup.list",
    data,
    lines: [head, ...listLines(data)],
    next: [],
    // 今天的快照没做成、Time Machine 不满足，只在这里写，别的命令不带（P29）。
    warnings,
  });
}

/** 快照所在的目录，写给人看。 */
function backupsDirOf(ctx: CommandEnv): string {
  return `${resolveHome(ctx.env, ctx)}/backups`;
}

/** 集中存储里登记的项目：编号和根目录。查不到时返回 undefined，不挡恢复。 */
async function registeredProjects(
  backend: Backend,
): Promise<{ id: string; roots: readonly string[] }[] | undefined> {
  const listed = await backend.call((api) => api.api.v1.projects.$get({ query: {} }));
  if (!listed.ok || !Array.isArray(listed.value.data)) return undefined;
  return listed.value.data.map(({ project }) => ({ id: project.id, roots: project.roots }));
}

/** 项目写成「编号（根目录）」，没有根目录时只写编号。 */
function projectText({ id, roots }: { id: string; roots: readonly string[] }): string {
  return roots.length === 0 ? id : `${id}（${roots.join("、")}）`;
}

/** 没加 --yes：只告诉用户恢复会怎样，什么都不改，退出码是 1。 */
async function previewRestore(ctx: CommandEnv, snapshot: string): Promise<Outcome> {
  const backend = connect(ctx);
  const before = await registeredProjects(backend);
  const preview = await backend.call((api) =>
    api.api.v1.admin.restore.preview.$get({ query: { snapshot } }),
  );
  if (!preview.ok) return preview;
  const { data } = preview.value;
  const inSnapshot = new Set(data.projects);
  const lost = (before ?? []).filter(({ id }) => !inSnapshot.has(id));
  const text = output.preview;
  const lines: [string, ...string[]] = [
    renderCopy(text.head),
    renderCopy(text.replace, { snapshot: data.snapshot }),
  ];
  if (before === undefined) lines.push(renderCopy(text.unknown));
  else if (lost.length === 0) lines.push(renderCopy(text.allKept));
  else {
    lines.push(renderCopy(text.lost, { count: lost.length }));
    for (const project of lost)
      lines.push(renderCopy(text.lostRow, { project: projectText(project) }));
    lines.push(renderCopy(text.lostWhy), renderCopy(text.lostNote));
  }
  lines.push(renderCopy(text.keep), renderCopy(text.confirm));
  return ok({
    kind: "backup.restorePreview",
    data: { snapshot: data.snapshot, restored: false, lost },
    lines,
    next: [],
    warnings: [],
    exit: exitCode.blocked,
  });
}

async function restore(
  ctx: CommandEnv,
  snapshot: string,
  options: { readonly yes?: true | undefined },
): Promise<Outcome> {
  if (options.yes !== true) return previewRestore(ctx, snapshot);
  const backend = connect(ctx);
  const before = await registeredProjects(backend);
  const result = await backend.call((api) =>
    api.api.v1.admin.restore.$post({ json: { snapshot } }),
  );
  if (!result.ok) return result;
  const { data, warnings } = result.value;
  const lines: [string, ...string[]] = [
    renderCopy(output.restored, { snapshot: data.snapshot }),
    renderCopy(output.kept, { kept: data.kept }),
  ];
  if (data.migrated > 0) lines.push(renderCopy(output.migrated, { count: data.migrated }));
  lines.push(
    data.problems.length === 0
      ? renderCopy(output.healthy)
      : renderCopy(output.unhealthy, { count: data.problems.length }),
  );
  // 快照以后才登记的项目，恢复以后集中存储里没有了，项目缓存还在。列出来，指到重新登记的命令。
  const after = await registeredProjects(backend);
  const kept = new Set((after ?? []).map(({ id }) => id));
  const vanished = after === undefined ? [] : (before ?? []).filter(({ id }) => !kept.has(id));
  if (vanished.length > 0) {
    lines.push(
      renderCopy(output.vanished, { projects: vanished.map(projectText).join("、") }),
      renderCopy(output.vanishedNote),
      renderCopy(output.undo, { kept: data.kept }),
    );
  }
  const root = vanished[0]?.roots[0];
  const next = root === undefined ? ["ploop status"] : [`ploop init --project ${shellWord(root)}`];
  return ok({ kind: "backup.restored", data, lines, next, warnings });
}

async function gc(ctx: CommandEnv): Promise<Outcome> {
  const result = await connect(ctx).call((api) => api.api.v1.admin.gc.$post());
  if (!result.ok) return result;
  const { data } = result.value;
  const line = renderCopy(output.collected, {
    count: data.removed,
    temp: data.tempFiles,
    size: formatSize(data.bytes),
  });
  return ok({ kind: "backup.gc", data, lines: [line], next: [], warnings: [] });
}

/** 挂上 ploop backup 和它的四个子命令。不写子命令时列出快照。 */
export function backupCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = backupCmdCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program
    .command("backup")
    .description(t(help.description))
    .action(async () => {
      context.settle(await list(context));
    });
  withHelp(
    group,
    helpOf({
      details: Object.values(help.details),
      reads: help.list.reads,
      writes: help.list.writes,
      examples: [help.list.examples.plain],
      after: help.list.after,
    }),
  );
  const helpFor = (entry: {
    details: Record<string, CopyEntry>;
    blocks?: Record<string, { situation: CopyEntry; fix: CopyEntry }>;
    reads: CopyEntry;
    writes: CopyEntry;
    examples: Record<string, CopyEntry>;
    after: CopyEntry;
  }) =>
    helpOf({
      details: Object.values(entry.details),
      ...(entry.blocks === undefined ? {} : { blocks: Object.values(entry.blocks) }),
      reads: entry.reads,
      writes: entry.writes,
      examples: Object.values(entry.examples),
      after: entry.after,
    });

  const nowCommand = group
    .command("now")
    .description(t(help.now.description))
    .action(async () => {
      context.settle(await now(context));
    });
  withHelp(nowCommand, helpFor(help.now));

  const listCommand = group
    .command("list")
    .description(t(help.list.description))
    .action(async () => {
      context.settle(await list(context));
    });
  withHelp(listCommand, helpFor(help.list));

  const restoreCommand = group
    .command("restore")
    .description(t(help.restore.description))
    .argument("<快照>", t(help.restore.snapshot))
    .option("--yes", t(help.restore.yes))
    .action(async (snapshot, options) => {
      context.settle(await restore(context, snapshot, options));
    });
  withHelp(restoreCommand, helpFor(help.restore));

  const gcCommand = group
    .command("gc")
    .description(t(help.gc.description))
    .action(async () => {
      context.settle(await gc(context));
    });
  withHelp(gcCommand, helpFor(help.gc));
}
