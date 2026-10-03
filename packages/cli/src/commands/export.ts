import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import {
  type CopyEntry,
  err,
  errorBody,
  ok,
  projectCacheDirName,
  renderCopy,
} from "@product-loop/model";
import { type CommandEnv, connect } from "../connect.ts";
import { exportCopy } from "../copy/export.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { formatSize, globalProject, helpOf, openProject, utcStamp } from "./shared.ts";
import { projectName } from "./status.ts";

// ploop export [--legacy] 和 ploop storage，见「03 数据模型」第六节和第九节。
// 导出只在运行命令时进行。后端给出每个文件的路径和全文，命令行写成文件夹。
// --legacy 按旧格式写回项目缓存，覆盖那里的主线.md、决定.md 和队列.json，见「08 版本与迁移」第八节。

const { output, errors: text } = exportCopy;

/**
 * 默认的导出文件夹：集中存储的 exports/ 下的 ploop-export-<项目>-<UTC 时间>，时间以 Z 结尾。
 * 不放在当前目录：那是用户的仓库，多出一个没有忽略规则的文件夹会挡住落地阶段的收尾。
 */
function defaultDir(home: string, pid: string): string {
  return join(home, "exports", `ploop-export-${pid}-${utcStamp(new Date())}`);
}

async function runExport(
  ctx: CommandEnv,
  project: string | undefined,
  options: { readonly legacy?: boolean | undefined; readonly out?: string | undefined },
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const legacy = options.legacy === true;
  let dir: string;
  if (legacy) {
    if (local === undefined) {
      const body = {
        message: renderCopy(text.noCache.message),
        hint: renderCopy(text.noCache.hint),
      };
      return err(errorBody("BAD_REQUEST", [body]));
    }
    dir = join(local.root, projectCacheDirName);
  } else {
    dir = options.out === undefined ? defaultDir(backend.home, pid) : resolve(ctx.cwd, options.out);
    if (existsSync(dir)) {
      const body = {
        message: renderCopy(text.exists.message, { dir }),
        hint: renderCopy(text.exists.hint),
      };
      return err(errorBody("CONFLICT", [body]));
    }
  }
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].export.$get({
      param: { pid },
      query: legacy ? { legacy: "true" } : {},
    }),
  );
  if (!result.ok) return result;
  const { data } = result.value;
  for (const file of data.files) {
    const target = join(dir, ...file.path.split("/"));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.text);
  }
  const head = legacy
    ? renderCopy(output.legacy, { dir: projectCacheDirName })
    : renderCopy(output.exported, { dir, count: data.files.length });
  // 默认的文件夹名里有 UTC 时间，写明一次；--out 自己起的名字不用说。
  const stamped = !legacy && options.out === undefined ? [renderCopy(output.utc)] : [];
  return ok({
    kind: legacy ? "export.legacy" : "export.done",
    data: { dir, files: data.files.map((file) => file.path) },
    lines: [
      head,
      ...stamped,
      ...data.files.map((file) => renderCopy(output.file, { path: file.path })),
    ],
    // 写回以后旧 skill 还读不到：要用户把 skill 的链接改回旧正文，写在下一步里。
    next: legacy ? [renderCopy(output.legacyNext)] : [],
    warnings: [],
  });
}

async function storage(ctx: CommandEnv): Promise<Outcome> {
  const result = await connect(ctx).call((api) => api.api.v1.storage.$get());
  if (!result.ok) return result;
  const { data } = result.value;
  const lines: [string, ...string[]] = [
    renderCopy(output.storage, {
      count: data.blobs.count,
      size: formatSize(data.blobs.bytes),
      database: formatSize(data.database.bytes),
    }),
    ...data.projects.map((entry) =>
      renderCopy(output.projectRow, {
        project: projectName(entry.name, entry.project),
        count: entry.blobs.count,
        size: formatSize(entry.blobs.bytes),
      }),
    ),
    renderCopy(output.unreferenced, {
      count: data.unreferenced.count,
      size: formatSize(data.unreferenced.bytes),
    }),
    renderCopy(output.unreferencedNote),
  ];
  return ok({ kind: "storage", data, lines, next: [], warnings: [] });
}

/** 挂上 ploop export 和 ploop storage。 */
export function exportCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = exportCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const exportLine = program
    .command("export")
    .description(t(help.export.description))
    .option("--legacy", t(help.export.legacy))
    .option("--out <目录>", t(help.export.out))
    .action(async (options, self) => {
      context.settle(await runExport(context, globalProject(self), options));
    });
  withHelp(
    exportLine,
    helpOf({
      details: Object.values(help.export.details),
      blocks: Object.values(help.export.blocks),
      reads: help.export.reads,
      writes: help.export.writes,
      examples: Object.values(help.export.examples),
      after: help.export.after,
    }),
  );
  const storageLine = program
    .command("storage")
    .description(t(help.storage.description))
    .action(async () => {
      context.settle(await storage(context));
    });
  withHelp(
    storageLine,
    helpOf({
      details: Object.values(help.storage.details),
      reads: help.storage.reads,
      writes: help.storage.writes,
      examples: Object.values(help.storage.examples),
      after: help.storage.after,
    }),
  );
}
