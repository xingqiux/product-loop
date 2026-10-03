import { decisionCopy, queueCopy } from "../copy/records.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { Issue } from "../envelope.ts";
import { writingLength } from "../writing/check.ts";
import { lengthSamples } from "./length.samples.ts";
import { defineRule, sinceRelease } from "./rule.ts";
import { runRules } from "./run.ts";

// 队列事项的内容和决定的「决定」一项写成名字：超过 40 个字就拦下，见决定 224 和决定 226。
// 工作台和命令行把这两项整句显示，写长了就成了一段话。放不下的细节，队列写进备注，决定写进原因。
// 原因、案例、备注不限长度。
// 字数按写作校验量一句话的算法，见 writing/check.ts 的 writingLength。
// 只对新写入和修改生效：读取已有的数据不校验，迁移导入的旧数据也不校验。

/** 内容和「决定」一项最多几个字。 */
export const shortTextLimit = 40;

/** 超出时的一次命中：位置写字段名，参数写现在的字数和上限。 */
function tooLong(text: string, where: string) {
  const length = writingLength(text);
  return length > shortTextLimit ? [{ where, params: { length, limit: shortTextLimit } }] : [];
}

/** 规矩 queue.content.tooLong：队列事项的内容不超过 40 个字。放进和修改时查。 */
export const queueContentTooLong = defineRule({
  id: "queue.content.tooLong",
  level: "block",
  scope: { subjects: ["queue"], commands: ["queue add", "queue edit", "reply handle"] },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.queue.content.tooLong,
  copy: queueCopy.tooLong,
  check: (content: string) => tooLong(content, "content"),
  samples: lengthSamples.queueContent,
});

/** 规矩 decision.decision.tooLong：决定的「决定」一项不超过 40 个字。新增和修改时查。 */
export const decisionTooLong = defineRule({
  id: "decision.decision.tooLong",
  level: "block",
  scope: {
    subjects: ["decision"],
    commands: ["decision add", "decision edit", "reply handle"],
  },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.decision.decision.tooLong,
  copy: decisionCopy.tooLong,
  check: (decision: string) => tooLong(decision, "decision"),
  samples: lengthSamples.decision,
});

/** 长度的两条规则，登记在共用定义里。 */
export const lengthRuleList = [queueContentTooLong, decisionTooLong] as const;

/** 跑规矩 queue.content.tooLong，返回全部拦截。位置写字段名 content。 */
export function checkQueueContentLength(content: string): Issue[] {
  return [...runRules([queueContentTooLong], content, {}).block];
}

/** 跑规矩 decision.decision.tooLong，返回全部拦截。位置写字段名 decision。 */
export function checkDecisionLength(decision: string): Issue[] {
  return [...runRules([decisionTooLong], decision, {}).block];
}
