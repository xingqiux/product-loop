import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import { renderCopy } from "@product-loop/model";
import { commandOverviewCopy, helpGroupNameCopy, transitionalDate } from "./copy/help.ts";
import { commandPath, groupOf, type HelpGroup, helpGroups, listAllCommands } from "./help.ts";
import { buildProgram } from "./program.ts";

// 命令参考和正文的一致性，见第一期计划第 67 步和「09 skill 与软件」第一节。
// 命令的说明只有一个来源，就是 --help。docs/命令参考.md 由这里按命令树生成，
// skill 正文和参考文件里写到的每条 ploop 命令和选项，都要在命令树里找得到。

/** 命令树里的一条命令：完整写法、它的选项，和它的帮助。 */
export type CommandEntry = {
  readonly path: string;
  readonly options: readonly string[];
  readonly help: string;
  /** 一句话说明它做什么，就是帮助开头的那一段。 */
  readonly purpose: string;
  /** 属于哪一组，见决定 209。ploop 自己没有。 */
  readonly group: HelpGroup | undefined;
};

/** 不连后端、不输出任何东西的命令树，只用来读命令和帮助。 */
function quietProgram(): CommandUnknownOpts {
  const program: CommandUnknownOpts = buildProgram({
    cwd: "/",
    env: {},
    userHome: "/",
    columns: undefined,
    notice: () => {},
    settle: () => {},
  });
  // 运行时不认 commander 自带的 help 子命令，生成文档时也要关掉，文档里才不会多出一条不存在的命令。
  const close = (command: CommandUnknownOpts) => {
    command.helpCommand(false);
    for (const sub of command.commands) close(sub as CommandUnknownOpts);
  };
  close(program);
  return program;
}

function optionNames(command: CommandUnknownOpts): string[] {
  const names: string[] = [];
  for (let at: CommandUnknownOpts | null = command; at !== null; at = at.parent) {
    for (const option of at.options) {
      if (option.long !== undefined) names.push(option.long);
      if (option.short !== undefined) names.push(option.short);
    }
  }
  return [...new Set([...names, "--help", "-h"])];
}

/** 按命令树的顺序列出每一条命令，根命令在最前。 */
export function commandEntries(): CommandEntry[] {
  const entries: CommandEntry[] = [];
  const walk = (command: CommandUnknownOpts) => {
    entries.push({
      path: commandPath(command),
      options: optionNames(command),
      help: command.helpInformation().trimEnd(),
      purpose: command.description().replace(/\s+/gu, " "),
      group: groupOf(command),
    });
    for (const sub of command.commands) walk(sub as CommandUnknownOpts);
  };
  // 文档是全部命令的参考，帮助里默认不列的维护和过渡命令也要写进去。
  const before = listAllCommands(true);
  try {
    walk(quietProgram());
  } finally {
    listAllCommands(before);
  }
  return entries;
}

/** 命令一览：除了 ploop 自己，每条命令一行，写它的作用和分组，按组排，同一组里按命令树的顺序。 */
function overviewRows(entries: readonly CommandEntry[]): string[] {
  const cell = (text: string) => text.replaceAll("|", "\\|");
  const rank = (group: HelpGroup | undefined) => helpGroups.indexOf(group ?? "daily");
  const listed = entries.filter((entry) => entry.group !== undefined);
  const sorted = listed
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => rank(a.entry.group) - rank(b.entry.group) || a.index - b.index);
  return sorted.map(({ entry }) => {
    const group = entry.group === undefined ? "" : renderCopy(helpGroupNameCopy[entry.group]);
    return `| \`${entry.path}\` | ${cell(entry.purpose)} | ${group} |`;
  });
}

/** 生成 docs/命令参考.md 的全文：先是命令一览，再是每条命令一节，内容是它的 --help。 */
export function renderCommandReference(entries: readonly CommandEntry[]): string {
  const [columnCommand = "", columnPurpose = "", columnGroup = ""] = renderCopy(
    commandOverviewCopy.columns,
  ).split("、");
  const lines = [
    "# 命令参考",
    "",
    "这份文件由程序生成，不要手改。改了命令以后，在仓库根目录运行：",
    "",
    "```",
    "pnpm --filter @product-loop/cli commands-doc",
    "```",
    "",
    `## ${renderCopy(commandOverviewCopy.title)}`,
    "",
    renderCopy(commandOverviewCopy.intro, { date: transitionalDate }),
    "",
    `| ${columnCommand} | ${columnPurpose} | ${columnGroup} |`,
    "| --- | --- | --- |",
    ...overviewRows(entries),
    "",
    "下面每一节是一条命令的 `--help`，和敲命令看到的相同。",
  ];
  for (const entry of entries) {
    lines.push("", `## ${entry.path}`, "", "```text", entry.help, "```");
  }
  return `${lines.join("\n")}\n`;
}

/** 正文里写到的一条命令：在哪一行，写了什么。 */
export type CommandMention = {
  readonly line: number;
  readonly text: string;
  /** 哪一样找不到：命令、子命令或选项，和找不到的写法。 */
  readonly problem: { readonly kind: "command" | "subcommand" | "option"; readonly name: string };
};

/** 命令名和子命令名的写法：小写字母开头，可以带短横。 */
const wordPattern = /^[a-z][a-z-]*$/u;

/**
 * 查一段文字里写到的每条 ploop 命令。按命令树从 ploop 往下认子命令，认不出的词算参数，
 * 同一段里出现的选项要是这条命令的选项。返回对不上的地方，全都对上时是空的。
 * 只看行内代码和代码块里的写法，正文里顺口提到的 ploop 不算。
 */
export function checkMentions(text: string, entries: readonly CommandEntry[]): CommandMention[] {
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const problems: CommandMention[] = [];
  const lines = text.split(/\r\n|\r|\n/u);
  let inBlock = false;
  for (const [i, line] of lines.entries()) {
    if (/^\s*```/u.test(line)) {
      inBlock = !inBlock;
      continue;
    }
    const pieces = inBlock ? [line] : [...line.matchAll(/`([^`]+)`/gu)].map((m) => m[1] ?? "");
    for (const piece of pieces) {
      for (const m of piece.matchAll(/(?:^|[\s(（])(ploop(?:\s+[^\s`|;&]+)*)/gu)) {
        const mention = (m[1] ?? "").trim();
        const problem = mentionProblem(mention, byPath);
        if (problem !== undefined) problems.push({ line: i + 1, text: mention, problem });
      }
    }
  }
  return problems;
}

function mentionProblem(
  mention: string,
  byPath: ReadonlyMap<string, CommandEntry>,
): CommandMention["problem"] | undefined {
  const words = mention.split(/\s+/u);
  let path = "ploop";
  let rest = words.slice(1);
  while (rest.length > 0) {
    const [next = "", ...after] = rest;
    if (!wordPattern.test(next)) break;
    const longer = `${path} ${next}`;
    if (byPath.has(longer)) {
      path = longer;
      rest = after;
      continue;
    }
    // 有子命令的命令后面跟着认不出的词，是写错了子命令
    const entry = [...byPath.keys()].some((known) => known.startsWith(`${path} `));
    if (entry) return { kind: path === "ploop" ? "command" : "subcommand", name: longer };
    break;
  }
  const entry = byPath.get(path);
  if (entry === undefined) return { kind: "command", name: path };
  // --help --all 列出全部命令，--all 不是这条命令自己的选项，见 program.ts 的 wantsAllHelp。
  const help = rest.some((word) => word === "--help" || word === "-h");
  for (const word of rest) {
    const option = /^(--?[a-zA-Z][a-zA-Z-]*)/u.exec(word)?.[1];
    if (help && option === "--all") continue;
    if (option !== undefined && !entry.options.includes(option)) {
      return { kind: "option", name: `${path} ${option}` };
    }
  }
  return undefined;
}
