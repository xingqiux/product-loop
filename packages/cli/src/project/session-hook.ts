import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// 把「会话开始时运行 ploop prime」写进项目的 .claude/settings.local.json，见「13 待定」第 8 项。
// 只在用户同意以后写（决定 197）。写的是合并：文件里别的键原样留着，已经有这条钩子就不再写。
// Claude Code 的写法：hooks.SessionStart 是一个数组，每项有 matcher 和 hooks，
// hooks 里每项是 { type: "command", command }。

/**
 * 早先写的命令：靠 PATH 找 ploop。~/.local/bin 不在 PATH 里的机器上钩子什么也不输出，
 * 现在改写成绝对路径。早先写下的钩子不会自己变，重跑 ploop init --hook 是 才换成新的。
 */
export const legacyPrimeCommandLine = "ploop prime";

/** 路径里有空格或特殊字符时加单引号，让 shell 当成一个词。 */
function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/u.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** 钩子运行的命令：ploop 装好以后的绝对路径 ~/.local/bin/ploop 加 prime。 */
export function primeCommandLineOf(home: string): string {
  return `${shellQuote(join(home, ".local", "bin", "ploop"))} prime`;
}

/** 设置文件在项目根目录下的位置。 */
const settingsFileParts = [".claude", "settings.local.json"] as const;

/** 哪几种会话开始都运行：新开、恢复、清空和压缩以后。压缩以后正是 AI 最容易忘的时候。 */
const sessionSources = "startup|resume|clear|compact";

/** 钩子最多运行几秒，超了 Claude Code 自己放弃，不拖慢会话。 */
const hookTimeoutSeconds = 10;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 合并的结果：已经有；合并好了，带新的设置；早先写的相对写法换成了绝对路径，带新的设置；
 * 或者文件的结构合不进去，带原因。
 */
export type Merged =
  | { readonly kind: "present" }
  | { readonly kind: "legacy"; readonly settings: Json }
  | { readonly kind: "merged"; readonly settings: Json }
  | { readonly kind: "unusable"; readonly reason: UnusableReason };

export type UnusableReason = "notObject" | "hooksNotObject" | "sessionStartNotArray";

/** 一条命令是不是在运行 ploop prime，前面带路径、路径带引号、后面带参数也算。 */
function runsPrime(command: unknown): boolean {
  return typeof command === "string" && /(^|[\s/'"])ploop['"]?\s+prime(\s|$)/u.test(command);
}

/** 设置里有没有会话开始运行 ploop prime 的钩子。 */
function hasPrimeHook(groups: readonly unknown[]): boolean {
  return groups.some(
    (group) =>
      isObject(group) &&
      Array.isArray(group.hooks) &&
      group.hooks.some((hook) => isObject(hook) && runsPrime(hook.command)),
  );
}

/** 把 SessionStart 里早先写的相对写法换成 commandLine，别的钩子原样留着。 */
function upgraded(groups: readonly unknown[], commandLine: string): unknown[] {
  return groups.map((group) =>
    isObject(group) && Array.isArray(group.hooks)
      ? {
          ...group,
          hooks: group.hooks.map((hook: unknown) =>
            isObject(hook) && hook.command === legacyPrimeCommandLine
              ? { ...hook, command: commandLine }
              : hook,
          ),
        }
      : group,
  );
}

/**
 * 把钩子合进已有的设置。不改传进来的对象。已经有 commandLine 这一条就不再写；
 * 只有早先写的相对写法时，换成 commandLine。用户自己写的别的样子的 ploop prime 钩子不动，算已经有。
 */
export function mergeSessionHook(
  settings: unknown,
  commandLine: string = legacyPrimeCommandLine,
): Merged {
  if (!isObject(settings)) return { kind: "unusable", reason: "notObject" };
  const { hooks } = settings;
  if (hooks !== undefined && !isObject(hooks))
    return { kind: "unusable", reason: "hooksNotObject" };
  const groups = hooks?.SessionStart;
  if (groups !== undefined && !Array.isArray(groups)) {
    return { kind: "unusable", reason: "sessionStartNotArray" };
  }
  if (groups !== undefined && hasPrimeHook(groups)) {
    const isLegacy = (hook: unknown) => isObject(hook) && hook.command === legacyPrimeCommandLine;
    const hasCurrent = groups.some(
      (group: unknown) =>
        isObject(group) &&
        Array.isArray(group.hooks) &&
        group.hooks.some((hook: unknown) => isObject(hook) && hook.command === commandLine),
    );
    const onlyLegacy =
      !hasCurrent &&
      commandLine !== legacyPrimeCommandLine &&
      groups.some(
        (group: unknown) =>
          isObject(group) && Array.isArray(group.hooks) && group.hooks.some(isLegacy),
      );
    if (!onlyLegacy) return { kind: "present" };
    const settingsUpgraded = {
      ...settings,
      // biome-ignore lint/style/useNamingConvention: SessionStart 是 Claude Code 定的键名。
      hooks: { ...hooks, SessionStart: upgraded(groups, commandLine) },
    };
    return { kind: "legacy", settings: settingsUpgraded };
  }
  const added = {
    matcher: sessionSources,
    hooks: [{ type: "command", command: commandLine, timeout: hookTimeoutSeconds }],
  };
  return {
    kind: "merged",
    settings: {
      ...settings,
      // biome-ignore lint/style/useNamingConvention: SessionStart 是 Claude Code 定的键名。
      hooks: { ...hooks, SessionStart: [...(groups ?? []), added] },
    },
  };
}

/** 读设置文件。没有文件当成空设置；读不出来或不是 JSON 时是 notJson。 */
async function readSettings(file: string): Promise<{ readonly value: unknown } | "notJson"> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { value: {} };
    return "notJson";
  }
  if (text.trim() === "") return { value: {} };
  try {
    return { value: JSON.parse(text) as unknown };
  } catch {
    return "notJson";
  }
}

/** 检查的结果，合不进去的写明原因。legacy 是只有早先写的相对写法。 */
export type HookState =
  | { readonly kind: "present" | "absent" | "legacy" }
  | { readonly kind: "unusable"; readonly reason: UnusableReason | "notJson" };

/** 项目里设置文件的完整路径。 */
export function settingsFile(root: string): string {
  return join(root, ...settingsFileParts);
}

/** 看一眼项目里有没有这条钩子，不写。 */
export async function inspectSessionHook(
  root: string,
  commandLine: string = legacyPrimeCommandLine,
): Promise<HookState> {
  const read = await readSettings(settingsFile(root));
  if (read === "notJson") return { kind: "unusable", reason: "notJson" };
  const merged = mergeSessionHook(read.value, commandLine);
  if (merged.kind === "unusable") return merged;
  return { kind: merged.kind === "merged" ? "absent" : merged.kind };
}

/** 写进这条钩子。先写临时文件再改名，写到一半不会留下半份设置。 */
export async function installSessionHook(
  root: string,
  commandLine: string = legacyPrimeCommandLine,
): Promise<
  { readonly kind: "written" | "present" | "updated" } | Extract<HookState, { kind: "unusable" }>
> {
  const file = settingsFile(root);
  const read = await readSettings(file);
  if (read === "notJson") return { kind: "unusable", reason: "notJson" };
  const merged = mergeSessionHook(read.value, commandLine);
  if (merged.kind === "present") return merged;
  if (merged.kind === "unusable") return merged;
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(merged.settings, null, 2)}\n`);
  await rename(temp, file);
  return { kind: merged.kind === "legacy" ? "updated" : "written" };
}

/** 去掉钩子的结果：没有、有但不是 ploop 写的样子、去掉了（带新的设置）、或者结构合不进去。 */
export type Removed =
  | { readonly kind: "absent" }
  | { readonly kind: "foreign" }
  | { readonly kind: "removed"; readonly settings: Json }
  | { readonly kind: "unusable"; readonly reason: UnusableReason };

/**
 * 从设置里去掉 ploop 自己写的那一条钩子：运行的命令正好是 commandLine，或早先写的 ploop prime。
 * 同一组里别人的钩子、别的组、别的键都原样留着；去掉以后空了的组、SessionStart、hooks 也去掉。
 * 带路径或参数的 ploop prime 是用户自己写的，不动，返回 foreign。不改传进来的对象。
 */
export function removeSessionHook(
  settings: unknown,
  commandLine: string = legacyPrimeCommandLine,
): Removed {
  if (!isObject(settings)) return { kind: "unusable", reason: "notObject" };
  const { hooks } = settings;
  if (hooks !== undefined && !isObject(hooks))
    return { kind: "unusable", reason: "hooksNotObject" };
  const groups = hooks?.SessionStart;
  if (groups === undefined) return { kind: "absent" };
  if (!Array.isArray(groups)) return { kind: "unusable", reason: "sessionStartNotArray" };
  const ours = (hook: unknown) =>
    isObject(hook) && (hook.command === commandLine || hook.command === legacyPrimeCommandLine);
  let removed = false;
  const kept = groups.flatMap((group: unknown) => {
    if (!isObject(group) || !Array.isArray(group.hooks)) return [group];
    const rest = group.hooks.filter((hook: unknown) => !ours(hook));
    if (rest.length === group.hooks.length) return [group];
    removed = true;
    return rest.length === 0 ? [] : [{ ...group, hooks: rest }];
  });
  if (!removed) return { kind: hasPrimeHook(groups) ? "foreign" : "absent" };
  const { SessionStart: _gone, ...otherEvents } = hooks as Json;
  // biome-ignore lint/style/useNamingConvention: SessionStart 是 Claude Code 定的键名。
  const nextHooks = kept.length === 0 ? otherEvents : { ...otherEvents, SessionStart: kept };
  const { hooks: _hooks, ...others } = settings;
  return {
    kind: "removed",
    settings: Object.keys(nextHooks).length === 0 ? others : { ...others, hooks: nextHooks },
  };
}

/** 去掉钩子的结果。 */
export type RemoveResult =
  | { readonly kind: "removed" | "absent" | "foreign" }
  | Extract<HookState, { kind: "unusable" }>;

/**
 * 从项目的设置文件里去掉 ploop 写的钩子，别的设置原样保留。
 * 去掉以后设置是空的（文件是 ploop 建的），就删掉文件，.claude/ 里没有别的东西时一并删掉。
 */
export async function uninstallSessionHook(
  root: string,
  commandLine: string = legacyPrimeCommandLine,
): Promise<RemoveResult> {
  const file = settingsFile(root);
  const read = await readSettings(file);
  if (read === "notJson") return { kind: "unusable", reason: "notJson" };
  const removed = removeSessionHook(read.value, commandLine);
  if (removed.kind !== "removed") return removed;
  if (Object.keys(removed.settings).length === 0) {
    await rm(file, { force: true });
    // 目录里还有别的文件时删不掉，留着。
    await rmdir(dirname(file)).catch(() => undefined);
    return { kind: "removed" };
  }
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(removed.settings, null, 2)}\n`);
  await rename(temp, file);
  return { kind: "removed" };
}
