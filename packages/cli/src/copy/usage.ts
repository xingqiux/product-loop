import { copy } from "@product-loop/model";

// commander 自带的英文报错换成的中文，见「02 技术选型」第五节。这些都是用法错误，退出码 2。
// {command} 是出错的那条命令，例如 ploop round start。暂时放在命令行里，以后并进共用定义的文案表。

export const usageCopy = {
  unknownOption: copy("{command} 没有选项 {option}。", {
    command: "ploop round start",
    option: "--tkae",
  }),
  unknownCommand: copy("{command} 下面没有命令 {name}。", {
    command: "ploop round",
    name: "strat",
  }),
  missingCommand: copy("{command} 后面缺少命令，可以写 {names}。", {
    command: "ploop round",
    names: "start、show、close",
  }),
  missingArgument: copy("{command} 缺少参数 {argument}。", {
    command: "ploop round start",
    argument: "<阶段名>",
  }),
  excessArguments: copy("{command} 多写了参数：{extras}。", {
    command: "ploop round start",
    extras: "落地",
  }),
  missingOptionValue: copy("选项 {option} 后面缺少取值。", { option: "--take <编号,…>" }),
  missingMandatoryOption: copy("{command} 缺少必填的选项 {option}。", {
    command: "ploop queue drop",
    option: "--reason <原因>",
  }),
  /** 两个不能同时写的选项。取值由 option 或 envVar 渲染而来。 */
  conflictingOptions: copy("{first} 不能和{second} 同时写。", {
    first: "选项 --all",
    second: "选项 --round <阶段>",
  }),
  option: copy("选项 {flags}", { flags: "--all" }),
  envVar: copy("环境变量 {name}", { name: "PLOOP_STAGE" }),
  /** 取值不对。{reason} 是处理取值的函数给的原因，或者下面 choices 的文字。 */
  invalidArgument: copy("参数 {argument} 的取值「{value}」不对。{reason}", {
    argument: "<阶段名>",
    value: "评审",
    reason: "取值只能写下面之一：构思、使用、检查、落地、提升。",
  }),
  invalidOption: copy("选项 {option} 的取值「{value}」不对。{reason}", {
    option: "--stage <阶段名>",
    value: "评审",
    reason: "取值只能写下面之一：构思、使用、检查、落地、提升。",
  }),
  invalidEnvVar: copy("环境变量 {name} 的取值「{value}」不对。{reason}", {
    name: "PLOOP_STAGE",
    value: "评审",
    reason: "取值只能写下面之一：构思、使用、检查、落地、提升。",
  }),
  choices: copy("取值只能写下面之一：{choices}。", { choices: "构思、使用、检查、落地、提升" }),
  /** --limit 的取值不对。列表命令共用。 */
  limit: copy("条数要写从 0 起的整数，例如 30；写 0 是全部列出。"),
  /** commander 认不出来的报错。正常情况下不会出现，测试逐个核对过已知的几种。 */
  unknown: copy("{command} 的写法不对。", { command: "ploop round start" }),
  /** 怎么改：先写可能想写的，再给出看用法的命令。 */
  suggestion: copy("要写的可能是 {candidates}。", { candidates: "--take" }),
  /** 怎么改：这条命令一个能直接运行的写法。 */
  example: copy("写法例如 {example}。", { example: "ploop round start 检查" }),
  help: copy("运行 {command} --help 查看用法。", { command: "ploop round start" }),
};
