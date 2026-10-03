import { isAbsolute, relative } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import { readRunInfo } from "@product-loop/client/node";
import {
  beijingMinute,
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type RepoKind,
  type Result,
  renderCopy,
  repoKind,
} from "@product-loop/model";
import stringWidth from "string-width";
import { type Backend, type CommandEnv, connect } from "../connect.ts";
import { mainlineCopy } from "../copy/mainline.ts";
import { usageCopy } from "../copy/usage.ts";
import type { CommandHelp } from "../help.ts";
import { type CurrentProject, currentProject } from "../project/current.ts";
import {
  backendRemote,
  hasUnpushedChange,
  mainlineFileName,
  syncMainline,
  syncNotices,
} from "../project/mainline-sync.ts";

// 各条命令共用的小工具。

/** 全局选项 --project 的取值。写在子命令前后都算，所以连同上级命令的选项一起取。 */
export function globalProject(command: CommandUnknownOpts): string | undefined {
  const value: unknown = command.optsWithGlobals().project;
  return typeof value === "string" ? value : undefined;
}

/** 打开的项目：连上的后端和当前项目。 */
export type OpenedProject = CurrentProject & { readonly backend: Backend };

/** 打开项目时要不要先同步主线。 */
type OpenOptions = {
  /**
   * 结果要看最新主线的命令写 true：开始时先把主线.md 的改动交成新的一版，
   * 集中存储里有更新的一版就覆盖主线.md。别的命令不写，读一读不会悄悄交出一版。
   */
  readonly sync?: boolean;
};

/**
 * 要用到当前项目的命令都从这里开始：找到当前项目。
 * 结果要看最新主线的命令写 sync，按目录找到的先同步主线，见「03 数据模型」第五节。
 * 同步做了什么，写成给人看的几行，写到标准错误。两边都改了时返回冲突，退出码 3。
 * --project 写编号时没有项目缓存，不同步。
 */
export async function openProject(
  ctx: CommandEnv,
  projectOption: string | undefined,
  options: OpenOptions = {},
): Promise<Result<OpenedProject, ErrorBody>> {
  const backend = connect(ctx);
  const current = await currentProject(ctx, backend, projectOption);
  if (!current.ok) return current;
  const { projectId, local } = current.value;
  if (local === undefined || options.sync !== true) {
    return ok({ projectId, backend, ...(local === undefined ? {} : { local }) });
  }
  const synced = await syncMainline({
    root: local.root,
    identity: local.identity,
    remote: backendRemote(backend, projectId),
    mode: "auto",
  });
  if (!synced.ok) return synced;
  for (const line of syncNotices(synced.value.synced)) ctx.notice(line);
  return ok({ projectId, backend, local: { ...local, identity: synced.value.identity } });
}

/** 主线.md 有没交的改动时的提醒。读命令不交新的一版，显示的是上一次交上去的那一版。 */
export async function unpushedWarning(opened: OpenedProject): Promise<Issue[]> {
  const { local } = opened;
  if (local === undefined || !(await hasUnpushedChange(local.root, local.identity))) return [];
  const { message, hint } = mainlineCopy.sync.unpushed;
  return [{ message: renderCopy(message), hint: renderCopy(hint), where: mainlineFileName }];
}

/** 项目状态里的下一步：这条命令自己算不出下一步时，照状态给。取不到就返回 undefined。 */
export async function statusNext(backend: Backend, pid: string): Promise<string[] | undefined> {
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  return status.ok ? [...status.value.next] : undefined;
}

/** 工作台里一页的完整地址：本机后端的端口，加上后端给的路径。 */
export function addressOf(backend: Backend, path: string): string {
  const port = readRunInfo(backend.files.runInfo)?.port;
  return port === undefined ? path : `http://127.0.0.1:${port}${path}`;
}

/** 后端记的项目：登记过的根目录，和仓库是自己的还是共用的。 */
export async function projectInfo(
  backend: Backend,
  pid: string,
): Promise<Result<{ readonly roots: readonly string[]; readonly repo: RepoKind }, ErrorBody>> {
  const project = await backend.call((api) => api.api.v1.projects[":pid"].$get({ param: { pid } }));
  if (!project.ok) return project;
  const { roots, repoKind: label } = project.value.data;
  return ok({ roots, repo: repoKind.key(label) as RepoKind });
}

/** 项目登记过的根目录。 */
export async function projectRoots(
  backend: Backend,
  pid: string,
): Promise<Result<readonly string[], ErrorBody>> {
  const info = await projectInfo(backend, pid);
  return info.ok ? ok(info.value.roots) : info;
}

/**
 * 当前目录所在的根目录：登记过的根目录里，包含当前目录的最深的一个。
 * 不在任何一个根目录里时，按 text 报用法错误，写明有哪些根目录。
 */
export function rootOf(
  cwd: string,
  roots: readonly string[],
  text: { readonly message: CopyEntry; readonly hint: CopyEntry },
): Result<string, ErrorBody> {
  const inside = roots
    .filter((root) => {
      const rel = relative(root, cwd);
      return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    })
    .sort((a, b) => b.length - a.length);
  const [found] = inside;
  if (found !== undefined) return ok(found);
  const body = {
    message: renderCopy(text.message, { cwd }),
    hint: renderCopy(text.hint, { roots: roots.join("、") }),
  };
  return err(errorBody("BAD_REQUEST", [body]));
}

/** 按显示宽度在右边补空格，一个汉字算两列。 */
export function padWidth(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stringWidth(text)));
}

/** 一组文字里最宽的显示宽度。 */
export function maxWidth(texts: readonly string[]): number {
  return Math.max(0, ...texts.map((text) => stringWidth(text)));
}

/** 列表命令默认最多列几条。 */
export const defaultListLimit = 30;

/** --limit 的取值：从 0 起的整数，写 0 是全部列出。写得不对是用法错误，退出码 2。 */
export function limitOption(value: string): number {
  if (/^\d+$/u.test(value)) return Number(value);
  throw new InvalidArgumentError(renderCopy(usageCopy.limit));
}

/** 日期和时间的字段。 */
const dateFormats: ReadonlySet<unknown> = new Set(["date-time", "date", "time"]);

/**
 * JSON Schema 里每个日期时间字段都带一条几百个字的正则，读的人只需要 format。
 * 去掉这些正则，别的照旧，不改传进来的对象。
 */
export function withoutDatePatterns(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutDatePatterns);
  if (typeof schema !== "object" || schema === null) return schema;
  const node = schema as Record<string, unknown>;
  const dated = dateFormats.has(node.format);
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !(dated && key === "pattern"))
      .map(([key, value]) => [key, withoutDatePatterns(value)]),
  );
}

/** 时间写成北京时间的 2026-09-28 10:05（决定 188）。 */
export function beijingTime(iso: string): string {
  return beijingMinute(new Date(iso));
}

/** 帮助里的一种拦截：情况和怎么改。 */
type BlockCopy = { readonly situation: CopyEntry; readonly fix: CopyEntry };

/** 一条文案，或一组文案（文案表里写成有名字的对象，按顺序取）。 */
type OneOrMany = CopyEntry | { readonly [name: string]: CopyEntry };

function isEntry(value: OneOrMany): value is CopyEntry {
  return typeof value.text === "string";
}

/** 帮助里另写的几节，文案表里的条目渲染成文字。做完以后可以写几条。 */
export function helpOf(entries: {
  readonly details?: readonly CopyEntry[];
  readonly blocks?: readonly BlockCopy[];
  readonly reads: CopyEntry;
  readonly writes: CopyEntry;
  readonly examples: readonly CopyEntry[];
  readonly after: OneOrMany;
}): CommandHelp {
  const text = (entry: CopyEntry) => renderCopy(entry);
  const after = isEntry(entries.after) ? [entries.after] : Object.values(entries.after);
  return {
    ...(entries.details === undefined ? {} : { details: entries.details.map(text) }),
    ...(entries.blocks === undefined
      ? {}
      : { blocks: entries.blocks.map(({ situation, fix }) => [text(situation), text(fix)]) }),
    reads: text(entries.reads),
    writes: text(entries.writes),
    examples: entries.examples.map(text),
    after: after.map(text),
  };
}

/** 标准输入这么久没有任何内容就不等了。管道开着却没人写时，命令不能一直挂着。 */
const stdinIdleMs = 5000;

/**
 * 从标准输入读完全部文字。标准输入是终端时不等，当成空的。
 * 管道开着但 stdinIdleMs 内一个字节都没来，也当成空的，不挂住。
 */
export async function readStdin(idleMs = stdinIdleMs): Promise<string> {
  if (process.stdin.isTTY) return "";
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    timer = setTimeout(finish, idleMs);
    process.stdin.on("data", (chunk: Uint8Array) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      chunks.push(Buffer.from(chunk));
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

/** 字节数写成给人看的大小：不到 1 KB 写字节，其余保留一位小数。 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** 命令里的路径带空白时加上引号，照抄就能运行。 */
export function shellWord(value: string): string {
  return /[\s"'$`\\]/u.test(value) ? JSON.stringify(value) : value;
}

const twoDigits = (n: number) => String(n).padStart(2, "0");

/**
 * 文件夹名里的时间：UTC 写成 20260928T160500Z，以 Z 结尾。
 * 文件名里的时间不随本机时区变，输出里写明它是 UTC；输出里的时间一律是北京时间。
 */
export function utcStamp(at: Date): string {
  const date = `${at.getUTCFullYear()}${twoDigits(at.getUTCMonth() + 1)}${twoDigits(at.getUTCDate())}`;
  return `${date}T${twoDigits(at.getUTCHours())}${twoDigits(at.getUTCMinutes())}${twoDigits(at.getUTCSeconds())}Z`;
}
