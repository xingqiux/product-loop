import { type CopyEntry, type ParamArgs, renderCopy } from "../copy/define.ts";
import { writingCopy, writingHintCopy } from "../copy/writing.ts";
import type { RuleLevel } from "../names.ts";

// 写作校验的每条规矩：编号、级别和报错，见「07 校验」第五节的拦截五项和警告五项。
// 编号就是报错在文案表里的键。「露出来」按第五节第 3 条归入语境相关的旧说法，只警告。

type RuleDef = {
  readonly level: RuleLevel;
  readonly copy: CopyEntry;
  /** 怎么改。报错句子里没写改法的规矩才有。 */
  readonly hint?: CopyEntry;
};

export const writingRules = {
  /** 术语表里停用的说法，出现在引号外面。 */
  "writing.term.banned": {
    level: "block",
    copy: writingCopy.term.banned,
    hint: writingHintCopy.banned,
  },
  /** 停用的说法只出现在引号里，可能是照录的原话，只警告。 */
  "writing.term.quoted": { level: "warn", copy: writingCopy.term.quoted },
  /** 语境相关的旧说法，在别的语境里是正常用词。 */
  "writing.term.soft": { level: "warn", copy: writingCopy.term.soft },
  "writing.sentence.tooLong": { level: "block", copy: writingCopy.sentence.tooLong },
  "writing.sentence.long": { level: "warn", copy: writingCopy.sentence.long },
  "writing.sentence.semicolons": { level: "block", copy: writingCopy.sentence.semicolons },
  "writing.paren.list": { level: "block", copy: writingCopy.paren.list },
  "writing.paren.items": { level: "warn", copy: writingCopy.paren.items },
  "writing.demonstrative.dense": { level: "warn", copy: writingCopy.demonstrative.dense },
  /** 措辞一类，从 build-report.py 的措辞提醒移过来，都只警告。 */
  "writing.wording.redBlue": {
    level: "warn",
    copy: writingCopy.wording.redBlue,
    hint: writingHintCopy.wording,
  },
  "writing.wording.interpunct": {
    level: "warn",
    copy: writingCopy.wording.interpunct,
    hint: writingHintCopy.wording,
  },
  "writing.wording.spoken": {
    level: "warn",
    copy: writingCopy.wording.spoken,
    hint: writingHintCopy.wording,
  },
  "writing.wording.numberRef": {
    level: "warn",
    copy: writingCopy.wording.numberRef,
    hint: writingHintCopy.wording,
  },
  "writing.wording.statistics": {
    level: "warn",
    copy: writingCopy.wording.statistics,
    hint: writingHintCopy.wording,
  },
  /** 会话回复的自查另外查的四项，从 check-reply.py 移过来，都拦截。 */
  "writing.reply.firstLine": {
    level: "block",
    copy: writingCopy.reply.firstLine,
    hint: writingHintCopy.firstLine,
  },
  "writing.reply.fileName": {
    level: "block",
    copy: writingCopy.reply.fileName,
    hint: writingHintCopy.fileName,
  },
  "writing.reply.interpunct": { level: "block", copy: writingCopy.reply.interpunct },
  "writing.reply.linkLast": { level: "block", copy: writingCopy.reply.linkLast },
} as const satisfies Record<string, RuleDef>;

export type WritingRule = keyof typeof writingRules;

/** 写作校验查出的一处问题。 */
export type WritingIssue = {
  readonly rule: WritingRule;
  /** 渲染好的报错。在页面上的位置由调用的地方另写。 */
  readonly message: string;
  /** 怎么改，只有几条规矩写了。 */
  readonly hint?: string;
};

/** 写作校验的结果。和旧脚本一样分拦截和警告两组，各按查出的顺序排。 */
export type WritingResult = {
  readonly block: readonly WritingIssue[];
  readonly warn: readonly WritingIssue[];
};

type Params<R extends WritingRule> = ParamArgs<(typeof writingRules)[R]["copy"]["text"]>;

/** 往结果里记一处问题。级别由规矩决定，参数按报错的文字检查。 */
export type Report = <R extends WritingRule>(rule: R, ...params: Params<R>) => void;

export function collect(): { readonly result: WritingResult; readonly report: Report } {
  const block: WritingIssue[] = [];
  const warn: WritingIssue[] = [];
  const report: Report = (rule, ...params) => {
    const def: RuleDef = writingRules[rule];
    const message = renderCopy(def.copy, ...(params as ParamArgs<string>));
    const hint =
      def.hint === undefined
        ? {}
        : { hint: renderCopy(def.hint, ...(params as ParamArgs<string>)) };
    (def.level === "block" ? block : warn).push({ rule, message, ...hint });
  };
  return { result: { block, warn }, report };
}
