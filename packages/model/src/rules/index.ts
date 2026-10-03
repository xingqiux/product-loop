// 规则框架：规则的写法、执行和登记，见「07 校验」第三节。

export * from "./backend.ts";
export { checkDecisionLength, checkQueueContentLength, shortTextLimit } from "./length.ts";
export { type PageText, pageTexts, runPageWriting } from "./page-text.ts";
export * from "./registry.ts";
export * from "./rule.ts";
export * from "./run.ts";
export { type WritingContext, type WritingSubject, writingRuleList } from "./writing.ts";
