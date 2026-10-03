// 中文帮助的格式，见「04 命令行」第四节和「02 技术选型」第五节。commander 自带的帮助有三处不合用：
// 按字符串长度对齐，一个汉字只算一列；只在空白处断行，纯中文的长说明折不了；标题和补充说明是英文。
// 这里换成：
//   1. 按显示宽度对齐，一个汉字算两列，用 string-width 计算；
//   2. 在终端里按终端的宽度折行，能在汉字之间断开，守避头尾的规矩。不是终端时不折行，
//      AI 经 Bash 工具读到的输出不是终端，折行会把命令折成两行；
//   3. 按第四节的结构输出：命令和参数、说明、用法、参数、选项、命令，再加命令定义里另写的几节。
// 做法照开工前的验证代码 spikes/backend/packages/cli/src/help.ts。
import {
  type Argument,
  type CommandUnknownOpts,
  Help,
  type HelpConfiguration,
  type Option,
} from "@commander-js/extra-typings";
import { renderCopy } from "@product-loop/model";
import stringWidth from "string-width";
import { helpGroupCopy, helpHeadingCopy, helpTextCopy, transitionalDate } from "./copy/help.ts";

/** 命令定义里另写的几节帮助。各节出现的顺序按「04 命令行」第四节，这里的字段顺序和它相同。 */
export type CommandHelp = {
  /**
   * 细节：命令一栏里放不下的话，写在这条命令自己的帮助里。命令的说明只是一个不超过二十个字的名字，
   * 细节每项一句，不超过四十个字。
   */
  readonly details?: readonly string[];
  /** 一个阶段怎么走：只有 ploop 自己的帮助有，每项写步骤和它的命令。 */
  readonly steps?: readonly (readonly [step: string, command: string])[];
  /** 会拦截的情况：最常见的两到四种，每种写怎么改。 */
  readonly blocks?: readonly (readonly [situation: string, fix: string])[];
  /** 读哪些文件。 */
  readonly reads?: string;
  /** 写集中存储里的哪些数据、项目缓存里的哪些文件。 */
  readonly writes?: string;
  /** 例子：一到三条，用真实的取值。 */
  readonly examples?: readonly string[];
  /** 做完以后：下一步通常是哪条命令。 */
  readonly after?: readonly string[];
  /** 环境变量：只有 ploop 自己的帮助写，每项是变量名和作用。 */
  readonly envs?: readonly (readonly [name: string, text: string])[];
  /** 退出码：只有 ploop 自己的帮助写，每项是数字和含义、通常怎么做。 */
  readonly exits?: readonly (readonly [code: string, text: string])[];
};

const helpByCommand = new WeakMap<object, CommandHelp>();
const optionsInEveryCommand = new WeakSet<object>();

/**
 * 命令分成四组，见决定 209：日常、按需、维护、过渡。ploop 自己的帮助按组列出命令，
 * docs/命令参考.md 顶上的命令一览也按组写。子命令没有单独指定时跟着它的上一级。
 */
export const helpGroups = ["daily", "onDemand", "maintenance", "transitional"] as const;
export type HelpGroup = (typeof helpGroups)[number];

const groupByCommand = new WeakMap<object, HelpGroup>();

/** 默认不在帮助里列出的两组：维护命令管安装和备份，过渡命令只服务迁移，日常用不到。 */
const hiddenGroups: readonly HelpGroup[] = ["maintenance", "transitional"];

/** 帮助里要不要列出全部命令。ploop --help --all 列全部，命令参考文档生成时也要列全。 */
let listAll = false;

/** 设置帮助里要不要列出维护和过渡命令，返回原来的设置。 */
export function listAllCommands(value: boolean): boolean {
  const before = listAll;
  listAll = value;
  return before;
}

/** 指定命令属于哪一组，返回命令本身。 */
export function inGroup<C extends object>(command: C, group: HelpGroup): C {
  groupByCommand.set(command, group);
  return command;
}

/** 命令属于哪一组：自己指定的，没有就取上一级的。都没有时是 undefined。 */
export function groupOf(command: CommandUnknownOpts): HelpGroup | undefined {
  for (let at: CommandUnknownOpts | null = command; at !== null; at = at.parent) {
    const group = groupByCommand.get(at);
    if (group !== undefined) return group;
  }
  return undefined;
}

/** 给命令挂上另写的几节帮助，返回命令本身，方便接着定义。 */
export function withHelp<C extends object>(command: C, help: CommandHelp): C {
  helpByCommand.set(command, help);
  return command;
}

/** 命令另写的几节帮助。没有写的命令返回空对象。 */
export function helpExtras(command: object): CommandHelp {
  return helpByCommand.get(command) ?? {};
}

/** 标出在每条子命令的帮助里也列出的全局选项。「04 命令行」第四节的样例只列 --json。 */
export function listInEveryCommand<O extends object>(option: O): O {
  optionsInEveryCommand.add(option);
  return option;
}

/** 命令的完整写法，例如 ploop round start。 */
export function commandPath(command: CommandUnknownOpts): string {
  const names: string[] = [];
  for (let at: CommandUnknownOpts | null = command; at !== null; at = at.parent) {
    names.unshift(at.name());
  }
  return names.join(" ");
}

// ---- 断行 ----
// 空白处可以断。两侧有一个是宽字符（汉字、全角标点）时也可以断，但避头尾的标点前后不断。
// 占位的写法 <编号>、[选项] 整个不拆。其余切成空白、单个宽字符和连续的窄字符，连续的窄字符不拆。

const wide =
  "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef";
const piecePattern = new RegExp(
  `<[^<>\\s]*>|\\[[^\\[\\]\\s]*\\]|\\s+|[${wide}]|[^\\s<\\[${wide}]+|[<\\[]`,
  "gu",
);
const widePattern = new RegExp(`^[${wide}]$`, "u");
const noLineStart = /^[，。、；：！？）》」』】〉”’]/u;
const noLineEnd = /[（《「『【〈“‘]$/u;

function canBreakBetween(before: string, after: string): boolean {
  if (/^\s/u.test(before) || /^\s/u.test(after)) return true;
  if (!widePattern.test(before) && !widePattern.test(after)) return false;
  return !noLineStart.test(after) && !noLineEnd.test(before);
}

/** 把一行按显示宽度折成几行。一个放不下的单位，例如一条路径，独占一行，不拆开。 */
export function wrapLine(line: string, width: number): string[] {
  const units: string[] = [];
  let before: string | undefined;
  for (const piece of line.match(piecePattern) ?? []) {
    if (before === undefined || canBreakBetween(before, piece)) units.push(piece);
    else units[units.length - 1] += piece;
    before = piece;
  }
  const lines: string[] = [];
  let current = "";
  for (const unit of units) {
    const blank = unit.trim() === "";
    // 续行开头的空白去掉。
    if (current === "" && blank && lines.length > 0) continue;
    if (!blank && current.trim() !== "" && stringWidth(current + unit) > width) {
      lines.push(current.trimEnd());
      current = unit;
    } else {
      current += unit;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

// ---- 参数和选项的说明 ----

/** 说明后面补上取值、默认值、环境变量。commander 自带的写法是英文，例如 (default: 540)。 */
function withExtras(description: string, extras: readonly (string | undefined)[]): string {
  const present = extras.filter((extra) => extra !== undefined);
  if (present.length === 0) return description;
  return renderCopy(helpTextCopy.extras, { description, extras: present.join("，") });
}

function choicesExtra(choices: readonly string[] | undefined): string | undefined {
  return choices === undefined
    ? undefined
    : renderCopy(helpTextCopy.choices, { choices: choices.join("、") });
}

function defaultExtra(value: unknown, description: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const shown = description ?? (typeof value === "string" ? value : JSON.stringify(value));
  return renderCopy(helpTextCopy.defaultValue, { value: shown });
}

// ---- 帮助的各个部分 ----

/** 二元组的一节：各节按自己最长的一项对齐。gap 是两栏之间的空格数。 */
function pairItems(
  helper: Help,
  pairs: readonly (readonly [string, string])[],
  gap: number,
): string[] {
  const termWidth = Math.max(0, ...pairs.map(([term]) => helper.displayWidth(term)));
  // formatItem 在两栏之间固定空两格，多出的部分补在左栏的宽度上。
  return pairs.map(([term, text]) => helper.formatItem(term, termWidth + gap - 2, text, helper));
}

function section(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [] : [title, ...items, ""];
}

/** 会拦截的情况两栏都是中文的句子，空两格读起来像一句话，所以照第四节的样例空四格。 */
const blockGap = 4;
const itemGap = 2;

/**
 * 命令一节。ploop 自己的帮助里命令分了组，就一组一节，组的标题写明用处；
 * 没有分组的命令和子命令的帮助照旧写一节「命令」。
 */
function commandSections(
  command: CommandUnknownOpts,
  commands: readonly CommandUnknownOpts[],
  item: (term: string, text: string) => string,
  helper: Help,
): string[] {
  const row = (sub: CommandUnknownOpts) =>
    item(helper.subcommandTerm(sub), helper.subcommandDescription(sub));
  const shown = (sub: CommandUnknownOpts) => {
    const group = groupByCommand.get(sub);
    return listAll || group === undefined || !hiddenGroups.includes(group);
  };
  const grouped = command.parent === null && commands.some((sub) => groupByCommand.has(sub));
  if (!grouped) {
    return section(renderCopy(helpHeadingCopy.commands), commands.filter(shown).map(row));
  }
  const others = commands.filter((sub) => !groupByCommand.has(sub));
  return [
    ...section(renderCopy(helpHeadingCopy.commands), others.map(row)),
    ...helpGroups
      .filter((group) => listAll || !hiddenGroups.includes(group))
      .flatMap((group) =>
        section(
          group === "transitional"
            ? renderCopy(helpGroupCopy.transitional, { date: transitionalDate })
            : renderCopy(helpGroupCopy[group]),
          commands.filter((sub) => groupByCommand.get(sub) === group).map(row),
        ),
      ),
  ];
}

function formatHelp(command: CommandUnknownOpts, helper: Help): string {
  const width = helper.helpWidth ?? Number.POSITIVE_INFINITY;
  const termWidth = helper.padWidth(command, helper);
  const item = (term: string, text: string) => helper.formatItem(term, termWidth, text, helper);
  const path = commandPath(command);
  const argumentTerms = command.registeredArguments.map((argument) =>
    helper.argumentTerm(argument),
  );
  const options = [...helper.visibleOptions(command), ...helper.visibleGlobalOptions(command)];
  const commands = helper.visibleCommands(command);
  const extra = helpByCommand.get(command) ?? {};
  const heading = (entry: keyof typeof helpHeadingCopy) => renderCopy(helpHeadingCopy[entry]);

  // 必填的选项写在用法里，不然用法一行写 [选项]，看起来可以省略。
  const mandatory = options
    .filter((option) => option.mandatory)
    .map((option) => option.flags.split(/,\s*/u).at(-1) ?? option.flags);
  const usage = [
    path,
    ...argumentTerms,
    ...mandatory,
    ...(options.some((option) => !option.mandatory) ? [renderCopy(helpTextCopy.usageOptions)] : []),
    ...(commands.length > 0 ? [renderCopy(helpTextCopy.usageCommand)] : []),
  ];
  const description = helper.commandDescription(command);
  const readsAndWrites: [string, string][] = [];
  if (extra.reads !== undefined) readsAndWrites.push([renderCopy(helpTextCopy.reads), extra.reads]);
  if (extra.writes !== undefined) {
    readsAndWrites.push([renderCopy(helpTextCopy.writes), extra.writes]);
  }

  return [
    [path, ...argumentTerms].join(" "),
    "",
    ...(description === "" ? [] : [helper.boxWrap(description, width), ""]),
    ...section(heading("usage"), [`  ${usage.join(" ")}`]),
    ...section(
      heading("arguments"),
      helper
        .visibleArguments(command)
        .map((argument) =>
          item(helper.argumentTerm(argument), helper.argumentDescription(argument)),
        ),
    ),
    ...section(
      heading("options"),
      options.map((option) => item(helper.optionTerm(option), helper.optionDescription(option))),
    ),
    ...commandSections(command, commands, item, helper),
    ...section(
      heading("details"),
      // 细节每项一句，在终端里按宽度折行，续行缩进和第一行对齐。
      (extra.details ?? []).flatMap((line) =>
        helper
          .boxWrap(
            line,
            Math.max((helper.helpWidth ?? Number.POSITIVE_INFINITY) - 2, helper.minWidthToWrap),
          )
          .split("\n")
          .map((wrapped) => `  ${wrapped}`),
      ),
    ),
    ...section(heading("steps"), pairItems(helper, extra.steps ?? [], itemGap)),
    ...section(heading("blocks"), pairItems(helper, extra.blocks ?? [], blockGap)),
    ...section(heading("readsAndWrites"), pairItems(helper, readsAndWrites, itemGap)),
    // 例子和做完以后是完整的命令，折开以后没法照抄，所以不折行。
    ...section(
      heading("examples"),
      (extra.examples ?? []).map((line) => `  ${line}`),
    ),
    ...section(
      heading("after"),
      (extra.after ?? []).map((line) => `  ${line}`),
    ),
    // 环境变量和退出码写在 ploop 自己的帮助末尾，AI 和人查它们都从 ploop --help 起。
    ...section(heading("env"), pairItems(helper, extra.envs ?? [], itemGap)),
    ...section(heading("exits"), pairItems(helper, extra.exits ?? [], itemGap)),
  ].join("\n");
}

/** 交给 configureHelp 的设置。要在定义子命令之前设置，子命令只在创建时复制父命令的设置。 */
export const chineseHelp: HelpConfiguration = {
  // 在终端里按终端的宽度折行，不是终端时不折行。commander 在不是终端时按八十列折行。
  prepareContext(this: Help, context: { helpWidth?: number }) {
    this.helpWidth = this.helpWidth ?? context.helpWidth ?? Number.POSITIVE_INFINITY;
  },

  displayWidth: (text: string) => stringWidth(text),

  boxWrap(this: Help, text: string, width: number): string {
    if (!Number.isFinite(width) || width < this.minWidthToWrap) return text;
    return text
      .split("\n")
      .flatMap((line) => wrapLine(line, width))
      .join("\n");
  },

  optionDescription: (option: Option) =>
    withExtras(option.description, [
      option.mandatory ? renderCopy(helpTextCopy.mandatory) : undefined,
      choicesExtra(option.argChoices),
      // 只有带取值的选项才写默认值。开关选项的默认值是给写程序的人看的，commander 也不写。
      option.required || option.optional
        ? defaultExtra(option.defaultValue, option.defaultValueDescription)
        : undefined,
      option.envVar === undefined
        ? undefined
        : renderCopy(helpTextCopy.envVar, { name: option.envVar }),
    ]),

  argumentDescription: (argument: Argument) =>
    withExtras(argument.description, [
      choicesExtra(argument.argChoices),
      defaultExtra(argument.defaultValue, argument.defaultValueDescription),
    ]),

  // 参数带上尖括号或方括号，和用法里的写法一致。commander 默认只写名字。
  argumentTerm: (argument: Argument) => {
    const name = `${argument.name()}${argument.variadic ? "..." : ""}`;
    return argument.required ? `<${name}>` : `[${name}]`;
  },

  // 子命令一栏只写名字和参数，不写英文的 [options]。
  subcommandTerm(this: Help, sub: CommandUnknownOpts): string {
    const [alias] = sub.aliases();
    const name = alias === undefined ? sub.name() : `${sub.name()}|${alias}`;
    return [name, ...sub.registeredArguments.map((argument) => this.argumentTerm(argument))].join(
      " ",
    );
  },

  // 子命令的帮助不列 --help，照第四节的样例。ploop 自己的帮助照 commander 的原样列出。
  visibleOptions(this: Help, command: CommandUnknownOpts): Option[] {
    if (command.parent === null) return Help.prototype.visibleOptions.call(this, command);
    return command.options.filter((option) => !option.hidden);
  },

  // 全局选项里只有标出来的几个列进子命令的帮助，和子命令自己的选项放在同一节。
  visibleGlobalOptions(command: CommandUnknownOpts): Option[] {
    const options: Option[] = [];
    for (let at = command.parent; at !== null; at = at.parent) {
      options.push(...at.options.filter((option) => optionsInEveryCommand.has(option)));
    }
    return options;
  },

  formatHelp,
};
