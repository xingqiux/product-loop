// 写作校验：页面数据里 AI 写的文字、会话回复的自查、队列事项的文字和文案表都用它，
// 见「07 校验」第五节。从旧 skill 的 writing.py、check-reply.py 移植，和旧脚本逐条对照。

export { checkWriting, type WritingOptions, writingLength } from "./check.ts";
export { builtInGlossary, type GlossaryEntry, type ProjectWritingSpec } from "./glossary.ts";
export { displayWidth, readingLength } from "./measure.ts";
export { checkReply } from "./reply.ts";
export { type WritingIssue, type WritingResult, type WritingRule, writingRules } from "./rules.ts";
