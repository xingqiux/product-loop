import type { CommanderError, CommandUnknownOpts } from "@commander-js/extra-typings";
import { type ErrorBody, errorBody, renderCopy } from "@product-loop/model";
import { usageCopy } from "./copy/usage.ts";
import { commandPath, helpExtras } from "./help.ts";

// commander 自带的报错是英文，退出码是 1。这里按报错的种类换成中文的用法错误：
// 错误码是 BAD_REQUEST，按错误码表退出码是 2，见「02 技术选型」第五节和「04 命令行」第七节。
// commander 只给出英文的报错文字，取值要从文字里取回来。commander 的版本在依赖目录里写死，
// 测试逐种核对，换版本以后文字变了，测试会失败。

const patterns = {
  unknownOption: /^error: unknown option '(.*)'(?:\n\(Did you mean (?:one of )?(.*)\?\))?$/su,
  unknownCommand: /^error: unknown command '(.*)'(?:\n\(Did you mean (?:one of )?(.*)\?\))?$/su,
  missingArgument: /^error: missing required argument '(.*)'$/su,
  optionMissingArgument: /^error: option '(.*)' argument missing$/su,
  missingMandatoryOption: /^error: required option '(.*)' not specified$/su,
  conflictingOption: /^error: (.*) cannot be used with (.*)$/su,
  conflictingSide: /^(option|environment variable) '(.*)'$/su,
  invalidEnvVar: /^error: option '.*' value '(.*)' from env '(.*)' is invalid\. (.*)$/su,
  invalidOption: /^error: option '(.*)' argument '(.*)' is invalid\. (.*)$/su,
  invalidArgument: /^error: command-argument value '(.*)' is invalid for argument '(.*)'\. (.*)$/su,
  choices: /^Allowed choices are (.*)\.$/su,
};

/** commander 在列表里用逗号加空格隔开，中文里改用顿号。 */
function toChineseList(list: string): string {
  return list.split(", ").join("、");
}

/** 参数写成帮助里的样子：必填的用尖括号，选填的用方括号。 */
function argumentTerm(command: CommandUnknownOpts, name: string): string {
  const argument = command.registeredArguments.find((registered) => registered.name() === name);
  return argument === undefined ? `<${name}>` : command.createHelp().argumentTerm(argument);
}

/** 取值不对的原因：commander 限定取值时写的是英文，处理取值的函数写的已经是中文。 */
function reasonText(reason: string): string {
  const [, choices] = patterns.choices.exec(reason) ?? [];
  return choices === undefined
    ? reason
    : renderCopy(usageCopy.choices, { choices: toChineseList(choices) });
}

function conflictingSide(side: string): string {
  const [, kind, name = side] = patterns.conflictingSide.exec(side) ?? [];
  return kind === "environment variable"
    ? renderCopy(usageCopy.envVar, { name })
    : renderCopy(usageCopy.option, { flags: name });
}

type Translated = { readonly message: string; readonly suggestion?: string };

/** 两个词之间的编辑距离，相邻两个字母换位算一步：stauts 和 status 只差一步。 */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number) => rows[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      (rows[i] as number[])[j] = best;
    }
  }
  return at(a.length, b.length);
}

/** 和写错的命令名最像的命令：差两步以内，而且不到名字长度的一半。 */
function similar(name: string, candidates: readonly string[]): string[] {
  return candidates
    .map((candidate) => ({ candidate, steps: distance(name, candidate) }))
    .filter(
      ({ candidate, steps }) => steps <= 2 && steps * 2 < Math.max(name.length, candidate.length),
    )
    .sort((a, b) => a.steps - b.steps)
    .map(({ candidate }) => candidate);
}

function translate(command: CommandUnknownOpts, exit: CommanderError): Translated | undefined {
  const path = commandPath(command);
  const text = exit.message;
  switch (exit.code) {
    case "commander.unknownOption": {
      const [found, option = "", suggestion] = patterns.unknownOption.exec(text) ?? [];
      if (found === undefined) return undefined;
      const message = renderCopy(usageCopy.unknownOption, { command: path, option });
      return suggestion === undefined ? { message } : { message, suggestion };
    }
    case "commander.unknownCommand": {
      const [found, name = "", suggestion] = patterns.unknownCommand.exec(text) ?? [];
      if (found === undefined) return undefined;
      const message = renderCopy(usageCopy.unknownCommand, { command: path, name });
      return suggestion === undefined ? { message } : { message, suggestion };
    }
    // 有子命令、自己没有处理函数的命令，不写子命令时 commander 显示帮助并以 1 退出。
    case "commander.help": {
      const names = command.commands.map((sub) => sub.name()).join("、");
      return { message: renderCopy(usageCopy.missingCommand, { command: path, names }) };
    }
    case "commander.missingArgument": {
      const [found, name = ""] = patterns.missingArgument.exec(text) ?? [];
      if (found === undefined) return undefined;
      const argument = argumentTerm(command, name);
      return { message: renderCopy(usageCopy.missingArgument, { command: path, argument }) };
    }
    // 多出来的参数从命令上取：出错时 commander 已经把收到的参数放在 args 里。
    case "commander.excessArguments": {
      const [first = "", ...more] = command.args.slice(command.registeredArguments.length);
      // ploop 不带子命令时等于 ploop status，所以顶层写错的命令名落在这里，当作认不出的命令名。
      if (command.parent === null && more.length === 0) {
        const names = command.commands.map((sub) => sub.name());
        const message = renderCopy(usageCopy.unknownCommand, { command: path, name: first });
        const close = similar(first, names);
        return close.length === 0 ? { message } : { message, suggestion: close.join(", ") };
      }
      const extras = [first, ...more].join("、");
      return { message: renderCopy(usageCopy.excessArguments, { command: path, extras }) };
    }
    case "commander.optionMissingArgument": {
      const [found, option = ""] = patterns.optionMissingArgument.exec(text) ?? [];
      if (found === undefined) return undefined;
      return { message: renderCopy(usageCopy.missingOptionValue, { option }) };
    }
    case "commander.missingMandatoryOptionValue": {
      const [found, option = ""] = patterns.missingMandatoryOption.exec(text) ?? [];
      if (found === undefined) return undefined;
      return { message: renderCopy(usageCopy.missingMandatoryOption, { command: path, option }) };
    }
    case "commander.conflictingOption": {
      const [found, first = "", second = ""] = patterns.conflictingOption.exec(text) ?? [];
      if (found === undefined) return undefined;
      return {
        message: renderCopy(usageCopy.conflictingOptions, {
          first: conflictingSide(first),
          second: conflictingSide(second),
        }),
      };
    }
    case "commander.invalidArgument":
      return translateInvalid(command, text);
    // 命令自己用 command.error() 报的错，文字已经是中文。
    case "commander.error":
      return { message: text };
    default:
      return undefined;
  }
}

/** 取值不对有三种：命令行的参数、选项的取值、环境变量给选项的取值。 */
function translateInvalid(command: CommandUnknownOpts, text: string): Translated | undefined {
  const [fromEnv, envValue = "", envVar = "", envReason = ""] =
    patterns.invalidEnvVar.exec(text) ?? [];
  if (fromEnv !== undefined) {
    const reason = reasonText(envReason);
    return {
      message: renderCopy(usageCopy.invalidEnvVar, { name: envVar, value: envValue, reason }),
    };
  }
  const [ofOption, option = "", optionValue = "", optionReason = ""] =
    patterns.invalidOption.exec(text) ?? [];
  if (ofOption !== undefined) {
    const reason = reasonText(optionReason);
    return { message: renderCopy(usageCopy.invalidOption, { option, value: optionValue, reason }) };
  }
  const [ofArgument, value = "", name = "", argumentReason = ""] =
    patterns.invalidArgument.exec(text) ?? [];
  if (ofArgument === undefined) return undefined;
  const argument = argumentTerm(command, name);
  const reason = reasonText(argumentReason);
  return { message: renderCopy(usageCopy.invalidArgument, { argument, value, reason }) };
}

/**
 * 把 commander 的报错换成中文的用法错误。怎么改：可能想写的写在前面，再给出看用法的命令。
 * 认不出来的报错不把英文原样转出去，只说这条命令的写法不对。
 */
export function usageError(
  command: CommandUnknownOpts,
  exit: CommanderError,
): ErrorBody<"BAD_REQUEST"> {
  const path = commandPath(command);
  const { message, suggestion } = translate(command, exit) ?? {
    message: renderCopy(usageCopy.unknown, { command: path }),
  };
  // 命令帮助里的第一个例子是一条能直接运行的写法，写在前面，比只指向 --help 好用。
  const [example] = helpExtras(command).examples ?? [];
  const hint = [
    ...(suggestion === undefined
      ? []
      : [renderCopy(usageCopy.suggestion, { candidates: toChineseList(suggestion) })]),
    ...(example === undefined ? [] : [renderCopy(usageCopy.example, { example })]),
    renderCopy(usageCopy.help, { command: path }),
  ].join("");
  return errorBody("BAD_REQUEST", [{ message, hint }]);
}
