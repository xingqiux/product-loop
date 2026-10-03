import { z } from "zod";
import type { CopyEntry, ParamNames, ParamValue } from "../copy/define.ts";
import type { RuleLevel, Stage } from "../names.ts";
import type { PageSection } from "../page/section-names.ts";
import type { ProjectWritingSpec } from "../writing/glossary.ts";
import type {
  BatchItem,
  ChangedScreen,
  PageImage,
  UnclearTerm,
  UnhandledReply,
  WaitingPage,
} from "./backend.ts";

// 规则的写法，见「07 校验」第三节：编号、级别、范围、起始日期、需要的上下文、检查、报错和样本。
// 检查函数只返回命中的位置和参数，报错由 runRules 按文案表填好，报错的文字只在文案表里写一处。
// 只看数据本身的规则放在共用定义里，浏览器和后端都能跑。要查数据库的规则放在后端，
// 由后端把要的上下文取出来传进来，写法相同。
// 编号的写法由第 24 步定下（约定 0002 第三节）：两段或三段，用点隔开，每段是英文小驼峰，第一段是领域。

/** 编号的写法：两段或三段，用点隔开。每段以小写字母开头，只用英文字母和数字。 */
export const ruleIdPattern = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*){1,2}$/u;

/** 新规则的起始写它，指 2.0.0 发布的那一天，见「07 校验」第三节。 */
export const sinceRelease = "2.0.0";

/**
 * 2.0.0 发布的日期。还没有发布，所以空着。
 * 空着时，历史页面模式把起始写 2.0.0 的规则当成比任何页面都新，一律跳过。发布那天在这里填上日期。
 */
export const releaseDay: string | undefined = undefined;

const daySchema = z.iso.date();

/** 是不是 2026-09-21 这样的日期，并且这一天真的存在。 */
export function isDay(text: string): boolean {
  return daySchema.safeParse(text).success;
}

/** 起始的写法对不对：写日期，或者写 2.0.0。 */
export function isRuleSince(since: string): boolean {
  return since === sinceRelease || isDay(since);
}

/**
 * 规则从哪一天起执行。起始写 2.0.0 的取发布的日期，还没发布时返回 undefined。
 * release 只在测试里传，平时用 releaseDay。
 */
export function startDay(
  since: string,
  release: string | undefined = releaseDay,
): string | undefined {
  return since === sinceRelease ? release : since;
}

/**
 * 规则查的数据。队列事项、轮次、主线、回复的各行、落地记录和使用记录，
 * 只有登记在后端的规则查，见 backend.ts。
 */
export const ruleSubjects = [
  "text",
  "reply",
  "decision",
  "page",
  "queue",
  "round",
  "mainline",
  "replyLine",
  "land",
  "use",
] as const;
export type RuleSubject = (typeof ruleSubjects)[number];

/** 规则在哪几条命令里执行，写 ploop 后面的部分。用到新的命令时往这里加。 */
export const ruleCommands = [
  "page check",
  "page present",
  "queue add",
  "queue edit",
  "queue wait",
  "queue done",
  "queue drop",
  "round start",
  "round close",
  "reply handle",
  "decision add",
  "decision edit",
  "land plan",
  "land tidy",
  "land red",
  "land green",
  "land review",
  "use run",
  "use ingest",
  "lint text",
  "lint reply",
] as const;
export type RuleCommand = (typeof ruleCommands)[number];

/**
 * 规则能要的上下文：键是名字，值是它的类型。中文名在文案表的 rulesCopy.context 里。
 * 共用定义里的规则不查数据库，要的东西由执行规则的一方准备好传进来。
 * 后面的步骤要新的上下文时，在这里加一个名字和类型，再在文案表里加中文名。
 */
export type RuleContextTypes = {
  /** 项目主线「写作规范」一节写的停用说法和例外。主线没有这一节时两项都是空的。 */
  readonly writingSpec: ProjectWritingSpec;
  /** 这一轮拿出来、还在进行中的事，由后端从拿出的事和队列取出，见 backend.ts。 */
  readonly batch: readonly BatchItem[];
  /** 这个项目里在等用户点的页，只看的页不算。 */
  readonly waitingPages: readonly WaitingPage[];
  /** 页面数据引用的截图：命令行交来的哈希，和附件库里有没有。 */
  readonly images: readonly PageImage[];
  /** 这个项目里还有行没处理的回复，每份写没处理的行号。 */
  readonly unhandledReplies: readonly UnhandledReply[];
  /** 上一份回复里点了不明白的术语，和那一页上它的意思和例子。 */
  readonly unclearTerms: readonly UnclearTerm[];
  /** 这一版新出现和变过的屏，一个场景的一步一项，几个宽度算一项。 */
  readonly changedScreens: readonly ChangedScreen[];
};
export type RuleContextName = keyof RuleContextTypes;

/** 声明了要这几样上下文的规则，拿到的上下文就是这个样子。什么都不要时是空对象。 */
export type RuleContextOf<N extends RuleContextName> = { readonly [K in N]: RuleContextTypes[K] };

/** 规则的范围：查哪种数据、哪些阶段、哪些区块、在哪几条命令里执行。 */
export type RuleScope = {
  readonly subjects: readonly [RuleSubject, ...RuleSubject[]];
  /** 只在这几个阶段查。不写就是每个阶段都查。执行时由调用的一方写明阶段，别的阶段跳过。 */
  readonly stages?: readonly [Stage, ...Stage[]];
  /** 查页面数据的哪几个区块。不写就是全部区块。只有查页面数据的规则写。 */
  readonly sections?: readonly [PageSection, ...PageSection[]];
  readonly commands: readonly [RuleCommand, ...RuleCommand[]];
};

/** 报错的文案：message 写什么不对，hint 写怎么改。写作校验的报错只有一句，改法写在句子里。 */
export type RuleCopy = { readonly message: CopyEntry; readonly hint?: CopyEntry };

/** 规则查什么、依据是什么，文字放在文案表的 rulesCopy.about 里，键和编号相同。维护说明的规则表由它生成。 */
export type RuleAbout = { readonly summary: CopyEntry; readonly basis: CopyEntry };

/** 填进报错的参数。 */
export type HitParams = Readonly<Record<string, ParamValue>>;

/** 报错的两句文案里的全部参数名。 */
type CopyNames<K extends RuleCopy> =
  | ParamNames<K["message"]["text"]>
  | (NonNullable<K["hint"]> extends CopyEntry<infer H> ? ParamNames<H> : never);

/** 一条命中要给的参数：两句文案里有几个参数就给几个，不能少。 */
export type CopyParams<K extends RuleCopy> = { readonly [N in CopyNames<K>]: ParamValue };

/** 在哪里：字段的路径，例如 ["asks", 0, "sources", 1]，或者写好的位置，例如 Q12。 */
export type RuleWhere = string | readonly (string | number)[];

/** 一次命中：在哪里，和填进报错的参数。不写位置时，由调用的一方写。 */
export type RuleHit<P = HitParams> = {
  readonly where?: RuleWhere;
  readonly params: P;
};

/** 一份会命中的样本：在基础数据上改一处，写明预期的命中。 */
export type RuleSample<S, C> = {
  /** 改了什么，写成测试的描述。 */
  readonly why: string;
  readonly subject: S;
  /** 这一份的上下文。不写就用基础数据的。 */
  readonly context?: C;
  /** 预期的全部命中，顺序和检查函数给出的相同。 */
  readonly expect: readonly [RuleHit, ...RuleHit[]];
};

/** 一条规则的样本，见「07 校验」第六节。 */
export type RuleSamples<S, C> = {
  /** 基础数据：合格的数据和上下文，规则在它上面不命中。 */
  readonly base: { readonly subject: S; readonly context: C };
  /** 会命中的样本，至少一份。 */
  readonly hits: readonly [RuleSample<S, C>, ...RuleSample<S, C>[]];
};

/** 一条规则。S 是它查的数据，C 是它拿到的上下文。 */
export type Rule<S = unknown, C = unknown> = {
  readonly id: string;
  readonly level: RuleLevel;
  readonly scope: RuleScope;
  /** 从哪一天起执行，写 2026-09-21 这样的日期。新规则写 sinceRelease。 */
  readonly since: string;
  /** 需要的上下文。什么都不要时写空数组。 */
  readonly needs: readonly RuleContextName[];
  readonly about: RuleAbout;
  readonly copy: RuleCopy;
  /** 返回全部命中，不在第一处停下。没有命中时返回空数组。 */
  check(subject: S, context: C): readonly RuleHit[];
  readonly samples: RuleSamples<S, C>;
};

/** defineRule 收的写法：命中的参数按文案检查，上下文按 needs 推出。 */
export type RuleDef<S, N extends RuleContextName, K extends RuleCopy> = Omit<
  Rule<S, RuleContextOf<N>>,
  "needs" | "copy" | "check"
> & {
  readonly needs: readonly N[];
  readonly copy: K;
  check(subject: S, context: RuleContextOf<N>): readonly RuleHit<CopyParams<K>>[];
};

/** 写一条规则。类型检查保证命中给的参数和文案对得上，检查函数只拿到 needs 里写的上下文。 */
export function defineRule<S, N extends RuleContextName = never, K extends RuleCopy = RuleCopy>(
  rule: RuleDef<S, N, K>,
): Rule<S, RuleContextOf<N>> {
  return rule;
}
