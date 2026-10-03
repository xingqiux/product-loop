import type { CopyEntry } from "../copy/define.ts";
import { rulesCopy } from "../copy/rules.ts";
import { reportWriting } from "../writing/check.ts";
import type { ProjectWritingSpec } from "../writing/glossary.ts";
import { reportReply } from "../writing/reply.ts";
import { type Report, type WritingRule, writingRules } from "../writing/rules.ts";
import {
  defineRule,
  type HitParams,
  type Rule,
  type RuleAbout,
  type RuleContextOf,
  type RuleScope,
  sinceRelease,
} from "./rule.ts";
import { writingSamples } from "./writing.samples.ts";

// 写作校验的每一项登记成一条规则，见「07 校验」第五节。编号、级别和报错取自 writing/rules.ts，
// 查法还是 writing/ 里的 checkWriting 和 checkReply，这里只把查出的问题按编号分给各条规则。
// 起始日期按约定 0001 第 14 条，在子树导入的提交历史里用 git log -S 查报错的那一行，见下面三个日期。
// 引号里的停用说法只警告，是「07 校验」第五节的有意改动，按新规则写 2.0.0。

/** 写作五项加进构建校验的那一天，提交 38212c7。括号里的短并列改成警告也在这一天，提交 33cafb6。 */
const writingAdded = "2026-09-21";
/** 回复自查的四项加进 check-reply.py 的那一天，提交 284bd29。 */
const replyAdded = "2026-09-21";
/** 措辞提醒在建仓库的提交 75b4c2d 里已经有了，那一天是 2026-09-20。更早的日期查不到。 */
const wordingAdded = "2026-09-20";

/** 写作校验查的一段文字。kind 写 reply 时按会话回复的自查查，另查首行、文件名、间隔号和链接。 */
export type WritingSubject = { readonly kind: "text" | "reply"; readonly text: string };

/** 写作校验要的上下文：主线的写作规范一节。 */
export type WritingContext = RuleContextOf<"writingSpec">;

type Found = { readonly rule: WritingRule; readonly params: HitParams };
type Memo = {
  readonly kind: WritingSubject["kind"];
  readonly text: string;
  readonly spec: ProjectWritingSpec;
  readonly found: readonly Found[];
};

// 同一段文字要交给每一条写作规则。按文字对象记下查出的问题，一段文字只查一遍。
const memo = new WeakMap<WritingSubject, Memo>();

/** 一段文字查出的全部问题，按查出的顺序。 */
function findingsOf(subject: WritingSubject, spec: ProjectWritingSpec): readonly Found[] {
  const known = memo.get(subject);
  if (known?.kind === subject.kind && known.text === subject.text && known.spec === spec) {
    return known.found;
  }
  const found: Found[] = [];
  const report: Report = (rule, ...[params]) => {
    found.push({ rule, params: params ?? {} });
  };
  const check = subject.kind === "reply" ? reportReply : reportWriting;
  check(subject.text, { project: spec }, report);
  memo.set(subject, { kind: subject.kind, text: subject.text, spec, found });
  return found;
}

// 页面、队列事项和 ploop lint text 查的文字。
const textCommands = [
  "page check",
  "page present",
  "queue add",
  "queue edit",
  "reply handle",
  "lint text",
] as const;
const inText: RuleScope = { subjects: ["text"], commands: textCommands };
const inReply: RuleScope = { subjects: ["reply"], commands: ["lint reply"] };
const inBoth: RuleScope = {
  subjects: ["text", "reply"],
  commands: [...textCommands, "lint reply"],
};

/** 每条写作规则的范围、起始日期、查什么和依据。 */
type Setting = { readonly scope: RuleScope; readonly since: string; readonly about: RuleAbout };

const { term, sentence, paren, demonstrative, wording, reply } = rulesCopy.about.writing;

const settings = {
  "writing.term.banned": { scope: inBoth, since: writingAdded, about: term.banned },
  "writing.term.quoted": { scope: inBoth, since: sinceRelease, about: term.quoted },
  "writing.term.soft": { scope: inBoth, since: writingAdded, about: term.soft },
  "writing.sentence.tooLong": { scope: inBoth, since: writingAdded, about: sentence.tooLong },
  "writing.sentence.long": { scope: inBoth, since: writingAdded, about: sentence.long },
  "writing.sentence.semicolons": { scope: inBoth, since: writingAdded, about: sentence.semicolons },
  "writing.paren.list": { scope: inBoth, since: writingAdded, about: paren.list },
  "writing.paren.items": { scope: inBoth, since: writingAdded, about: paren.items },
  "writing.demonstrative.dense": { scope: inBoth, since: writingAdded, about: demonstrative.dense },
  "writing.wording.redBlue": { scope: inBoth, since: wordingAdded, about: wording.redBlue },
  "writing.wording.interpunct": { scope: inText, since: wordingAdded, about: wording.interpunct },
  "writing.wording.spoken": { scope: inBoth, since: wordingAdded, about: wording.spoken },
  "writing.wording.numberRef": { scope: inBoth, since: wordingAdded, about: wording.numberRef },
  "writing.wording.statistics": { scope: inBoth, since: wordingAdded, about: wording.statistics },
  "writing.reply.firstLine": { scope: inReply, since: replyAdded, about: reply.firstLine },
  "writing.reply.fileName": { scope: inReply, since: replyAdded, about: reply.fileName },
  "writing.reply.interpunct": { scope: inReply, since: replyAdded, about: reply.interpunct },
  "writing.reply.linkLast": { scope: inReply, since: replyAdded, about: reply.linkLast },
} satisfies Record<WritingRule, Setting>;

function writingRule(id: WritingRule): Rule<WritingSubject, WritingContext> {
  const message: CopyEntry = writingRules[id].copy;
  const hint: CopyEntry | undefined = (writingRules[id] as { hint?: CopyEntry }).hint;
  return defineRule({
    id,
    level: writingRules[id].level,
    ...settings[id],
    needs: ["writingSpec"],
    copy: hint === undefined ? { message } : { message, hint },
    check: (subject: WritingSubject, context: WritingContext) =>
      findingsOf(subject, context.writingSpec)
        .filter((found) => found.rule === id)
        .map((found) => ({ params: found.params })),
    samples: writingSamples[id],
  });
}

/** 写作校验的十八条规则，顺序和 writingRules 相同。 */
export const writingRuleList: readonly Rule<WritingSubject, WritingContext>[] = (
  Object.keys(writingRules) as WritingRule[]
).map(writingRule);
