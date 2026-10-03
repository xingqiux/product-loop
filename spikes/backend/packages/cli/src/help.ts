// 中文帮助的格式。commander 15 默认按字符串长度（UTF-16 码元数）对齐和折行，
// 一个汉字只算 1 列，实际占 2 列，所以含中文的项会把说明往右推，列就错开了。
// 这里做三件事：
//   1. displayWidth 换成 string-width，按终端的显示宽度算（修对齐，最小的改法只要这一条）；
//   2. boxWrap 换成能在汉字之间断行的版本（commander 只在空白处断行，纯中文的长说明折不了行），
//      并且只在终端里折行，不是终端时不折；
//   3. formatHelp 按「04 命令行」第四节的结构输出：用法、参数、选项、命令，再加命令定义里的附加几节，
//      标题、默认值、取值的说明都用中文。
import type { Argument, CommandUnknownOpts, Help, HelpConfiguration, Option } from '@commander-js/extra-typings';
import stringWidth from 'string-width';

/** 附加的一节，例如「会拦截的情况」「读和写」「例子」「做完以后」。二元组按两列对齐，字符串原样成行。 */
export type HelpSection = { title: string; items: ([term: string, description: string] | string)[] };

const sectionsByCommand = new WeakMap<object, HelpSection[]>();

/** 给命令挂上附加的几节帮助，返回命令本身，方便链式定义。 */
export function withSections<C extends object>(cmd: C, sections: HelpSection[]): C {
  sectionsByCommand.set(cmd, sections);
  return cmd;
}

// ---- 断行：空白处可断；两侧有一个是宽字符（汉字、全角标点）时可断；避头尾的标点前后不断 ----

const WIDE = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\u3000-\\u303f\\uff00-\\uffef';
// 占位符 <编号>、[选项] 整体不拆；其余切成空白、单个宽字符、连续的窄字符
const TOKEN = new RegExp(`<[^<>\\s]*>|\\[[^\\[\\]\\s]*\\]|\\s+|[${WIDE}]|[^\\s<\\[${WIDE}]+|[<\\[]`, 'gu');
const IS_WIDE = new RegExp(`^[${WIDE}]$`, 'u');
const NO_LINE_START = /^[，。、；：！？）》」』】〉]/u;
const NO_LINE_END = /[（《「『【〈]$/u;

function canBreakBetween(prev: string, next: string): boolean {
  if (/^\s/u.test(prev) || /^\s/u.test(next)) return true;
  if (!IS_WIDE.test(prev) && !IS_WIDE.test(next)) return false;
  return !NO_LINE_START.test(next) && !NO_LINE_END.test(prev);
}

function wrapLine(line: string, width: number): string[] {
  const units: string[] = [];
  let prev: string | undefined;
  for (const token of line.match(TOKEN) ?? []) {
    if (prev === undefined || canBreakBetween(prev, token)) units.push(token);
    else units[units.length - 1] += token;
    prev = token;
  }
  const lines: string[] = [];
  let current = '';
  for (const unit of units) {
    const isSpace = unit.trim() === '';
    if (current === '' && isSpace && lines.length > 0) continue; // 续行开头的空白丢掉
    if (!isSpace && current.trim() !== '' && stringWidth(current + unit) > width) {
      lines.push(current.trimEnd());
      current = unit;
    } else {
      current += unit;
    }
  }
  lines.push(current.trimEnd());
  return lines;
}

// ---- 帮助的各个部分 ----

function commandPath(cmd: CommandUnknownOpts): string {
  const names: string[] = [];
  for (let c: CommandUnknownOpts | null = cmd; c; c = c.parent) names.unshift(c.name());
  return names.join(' ');
}

function extraInfo(choices: readonly string[] | undefined, defaultValue: unknown, defaultDescription?: string): string {
  const parts: string[] = [];
  if (choices) parts.push(`取值：${choices.join('、')}`);
  if (defaultValue !== undefined) parts.push(`默认：${defaultDescription ?? JSON.stringify(defaultValue)}`);
  return parts.length > 0 ? `（${parts.join('；')}）` : '';
}

export const chineseHelp: HelpConfiguration = {
  // 在终端里按终端的宽度折行；不是终端时（AI 经 Bash 工具读、管道、重定向）不折行。
  // commander 默认在不是终端时按 80 列折，会把「做完以后」里的命令折成两行。
  prepareContext(this: Help, contextOptions: { helpWidth?: number }) {
    this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? Number.POSITIVE_INFINITY;
  },

  displayWidth: (str: string) => stringWidth(str),

  boxWrap(this: Help, str: string, width: number): string {
    if (width < this.minWidthToWrap) return str;
    return str
      .split('\n')
      .flatMap((line) => wrapLine(line, width))
      .join('\n');
  },

  // commander 默认在说明后面加英文的 (choices: …) (default: …)，这里换成中文
  optionDescription: (option: Option) =>
    option.description +
    extraInfo(option.argChoices, option.negate ? undefined : option.defaultValue, option.defaultValueDescription),
  argumentDescription: (argument: Argument) =>
    argument.description + extraInfo(argument.argChoices, argument.defaultValue, argument.defaultValueDescription),

  // 参数带上尖括号或方括号，和用法里的写法一致（commander 默认只写名字）
  argumentTerm: (argument: Argument) => {
    const name = argument.name() + (argument.variadic ? '...' : '');
    return argument.required ? `<${name}>` : `[${name}]`;
  },

  // 子命令一栏只写名字和参数，不写英文的 [options]
  subcommandTerm(this: Help, sub: CommandUnknownOpts): string {
    const name = sub.name() + (sub.aliases()[0] ? `|${sub.aliases()[0]}` : '');
    return [name, ...sub.registeredArguments.map((a) => this.argumentTerm(a))].join(' ');
  },

  formatHelp(cmd: CommandUnknownOpts, helper: Help): string {
    const width = helper.helpWidth ?? 80;
    const termWidth = helper.padWidth(cmd, helper);
    const item = (term: string, description: string) => helper.formatItem(term, termWidth, description, helper);
    const argumentList = helper.visibleArguments(cmd);
    const args = argumentList.map((a) => helper.argumentTerm(a)).join(' ');
    const options = helper.visibleOptions(cmd);
    const commands = helper.visibleCommands(cmd);
    const out: string[] = [];

    out.push([commandPath(cmd), args].filter(Boolean).join(' '), '');
    const description = helper.commandDescription(cmd);
    if (description) out.push(helper.boxWrap(description, width), '');

    const usage = [commandPath(cmd), args, options.length > 0 ? '[选项]' : '', commands.length > 0 ? '<命令>' : ''];
    out.push('用法', `  ${usage.filter(Boolean).join(' ')}`, '');

    if (argumentList.length > 0) {
      out.push('参数', ...argumentList.map((a) => item(helper.argumentTerm(a), helper.argumentDescription(a))), '');
    }
    if (options.length > 0) {
      out.push('选项', ...options.map((o) => item(helper.optionTerm(o), helper.optionDescription(o))), '');
    }
    if (commands.length > 0) {
      out.push('命令', ...commands.map((c) => item(helper.subcommandTerm(c), helper.subcommandDescription(c))), '');
    }

    // 附加的几节：二元组各节自己算一栏的宽度；字符串（例子、做完以后）里有完整的命令，不折行
    for (const section of sectionsByCommand.get(cmd) ?? []) {
      const pairs = section.items.filter((i): i is [string, string] => Array.isArray(i));
      const sectionTermWidth = Math.max(0, ...pairs.map(([term]) => helper.displayWidth(term)));
      out.push(section.title);
      for (const i of section.items) {
        out.push(Array.isArray(i) ? helper.formatItem(i[0], sectionTermWidth, i[1], helper) : `  ${i}`);
      }
      out.push('');
    }
    return out.join('\n');
  },
};
