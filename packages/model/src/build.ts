// 构建号，见约定 0001 第 22 条：版本、提交短号和构建时间，开发时写 dev。
// 打包时由 tsdown 的 define 把 PLOOP_BUILD 换成构建号，命令行和后端打进同一个值，见第一期计划第 15 步。
// 开发时直接运行源码，这个名字没有定义，typeof 得到 undefined。

declare const PLOOP_BUILD: string | undefined;

export const buildNumber: string = typeof PLOOP_BUILD === "string" ? PLOOP_BUILD : "dev";
