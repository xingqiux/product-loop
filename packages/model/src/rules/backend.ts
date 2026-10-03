import { rulesCopy } from "../copy/rules.ts";
import type { RuleLevel } from "../names.ts";
import { type RuleAbout, type RuleContextName, type RuleScope, sinceRelease } from "./rule.ts";

// 登记在后端的规则，见「07 校验」第三节：要查数据库的规则放在后端的内核里，写法相同。
// 共用定义不引用后端，所以后端的规则在这里只登记说明：编号、级别、范围、起始、上下文、查什么和依据。
// 维护说明的规则表由这里生成，编号也和共用定义里的规则一起查重。
// 检查函数、报错和样本在后端。location 写检查在哪里，后端的总测试逐条核对两边对得上。
// 有两种写法：
// - 写成规则对象的，在后端 core/rules/ 下，展开这里的说明，再加检查、报错和样本。
// - 检查写在用例里的，例如队列的状态图。它们的报错和用例的其他报错一起给出，这里只登记说明。

/** 这一轮拿出来、还在进行中的一件事。给出信息时，每一件都要出现在某张卡上。 */
export type BatchItem = {
  /** 队列事项的编号，写成 Q12。 */
  readonly id: string;
  readonly content: string;
  /** 这一轮之前给出的某一页已经引用过它时，写那一页的编号。 */
  readonly coveredBy?: number | undefined;
};

/** 这一版新出现或变过的一屏：场景编号写成 S14，和步号。 */
export type ChangedScreen = { readonly scene: string; readonly step: number };

/** 在等用户点的一页。只看的页不算。 */
export type WaitingPage = {
  /** 页面的编号，后端生成的全局整数。 */
  readonly id: number;
  /** 这一页在所在阶段里的第几页。 */
  readonly seq: number;
  /** 这一页所在阶段的标识，写成 v2-检查-1。报错里换成阶段的叫法。 */
  readonly round: string;
};

/** 页面数据引用的一张截图：命令行交来的路径和哈希，以及附件库里有没有完整的一份。 */
export type PageImage = {
  /** 页面数据里写的路径，例如 img/before.png。 */
  readonly path: string;
  /** 内容的 SHA-256，写成六十四位小写十六进制。 */
  readonly hash: string;
  /** 附件库里有这个哈希的完整一份。 */
  readonly stored: boolean;
};

/** 还有行没处理的一份回复。 */
export type UnhandledReply = {
  /** 回复的编号，后端生成的全局整数。 */
  readonly submission: number;
  /** 回复的那一页所在的轮次，写成 v1-构思-3。 */
  readonly round: string;
  /** 没处理的行号，从小到大排。 */
  readonly lines: readonly number[];
};

/** 上一份回复里点了不明白的一个术语：那一页先对齐里写的名称、意思和例子。 */
export type UnclearTerm = {
  readonly name: string;
  readonly meaning: string;
  readonly example: string;
  /** 点了不明白的那一页所在的轮次，写成 v1-构思-3。 */
  readonly round: string;
};

/** 处理回复时要处理的一行：行号，带了几张图，读没读过。 */
export type HandledLine = {
  readonly line: number;
  readonly images: number;
  /** 这一行以前已经确认读过图，或者这次处理时写了已读。 */
  readonly imagesRead: boolean;
};

/** 后端一条规则的说明。needs 按字面量推出，后端写规则对象时展开它，上下文的类型对得上。 */
export type BackendRuleInfo<N extends RuleContextName = RuleContextName> = {
  readonly id: string;
  readonly level: RuleLevel;
  readonly scope: RuleScope;
  readonly since: string;
  readonly needs: readonly N[];
  readonly about: RuleAbout;
  /** 检查在哪里，写后端的文件，检查写在用例里的另写是哪个常量。 */
  readonly location: string;
};

function info<const N extends RuleContextName = never>(
  rule: BackendRuleInfo<N>,
): BackendRuleInfo<N> {
  return rule;
}

const about = rulesCopy.about;

/** 旧 build-report.py 的 check_queue_file 在建仓库的提交 75b4c2d 里已经有了。 */
const queueCoverageAdded = "2026-09-20";

/** 旧 queue.py 的取消要写原因、分号、重复和已完成的不能再拿，都在提交 a6c9d9a 里加进来。按 UTC 是 28 日。 */
const queueScriptAdded = "2026-09-28";

/** 旧 build-report.py 查设计规范十二样，提交 a93c3df。 */
const specTwelveAdded = "2026-09-21";

/** 旧 land.py 的计划、重构、先失败后通过和评审的检查，提交 f7f60eb 和 33cafb6。 */
const landScriptAdded = "2026-09-21";

/** 收尾落地轮以前至少给用户看过一页，决定 206。 */
const landPageShownAdded = "2026-09-29";

/**
 * 给出信息的规则，写成规则对象，在后端 core/rules/ 下。
 * reply.line.handled 也在开始一轮时执行，由开始一轮的用例调用。
 */
export const presentRuleInfo = {
  batchCovered: info({
    id: "round.batch.covered",
    level: "block",
    scope: { subjects: ["page"], commands: ["page check", "page present"] },
    since: queueCoverageAdded,
    needs: ["batch"],
    about: about.round.batch.covered,
    location: "后端 core/rules/batch.ts",
  }),
  oneWaiting: info({
    id: "page.oneWaiting",
    level: "block",
    scope: { subjects: ["page"], commands: ["page present"] },
    since: sinceRelease,
    needs: ["waitingPages"],
    about: about.page.oneWaiting,
    location: "后端 core/rules/waiting.ts",
  }),
  cardsNone: info({
    id: "page.cards.none",
    level: "block",
    scope: { subjects: ["page"], commands: ["page check", "page present"] },
    since: sinceRelease,
    needs: [],
    about: about.page.cards.none,
    location: "后端 core/rules/cards.ts",
  }),
  blobPresent: info({
    id: "blob.present",
    level: "block",
    scope: { subjects: ["page"], commands: ["page present"] },
    since: sinceRelease,
    needs: ["images"],
    about: about.blob.present,
    location: "后端 core/rules/blobs.ts",
  }),
  lineHandled: info({
    id: "reply.line.handled",
    level: "block",
    scope: { subjects: ["replyLine"], commands: ["page present", "round start", "round close"] },
    since: sinceRelease,
    needs: ["unhandledReplies"],
    about: about.reply.line.handled,
    location: "后端 core/rules/replies.ts",
  }),
  coverChanged: info({
    id: "screens.coverChanged",
    level: "block",
    scope: {
      subjects: ["page"],
      stages: ["check"],
      sections: ["screens"],
      commands: ["page check", "page present"],
    },
    since: sinceRelease,
    needs: ["changedScreens"],
    about: about.screens.coverChanged,
    location: "后端 core/rules/screens.ts",
  }),
  unclearReworded: info({
    id: "align.unclear.reworded",
    level: "warn",
    scope: { subjects: ["page"], sections: ["align"], commands: ["page check", "page present"] },
    since: sinceRelease,
    needs: ["unclearTerms"],
    about: about.align.unclear.reworded,
    location: "后端 core/rules/align.ts",
  }),
} as const;

/** 处理回复时执行的规则，写成规则对象，在后端 core/rules/ 下。 */
export const handleRuleInfo = {
  imagesRead: info({
    id: "reply.images.read",
    level: "block",
    scope: { subjects: ["replyLine"], commands: ["reply handle"] },
    since: sinceRelease,
    needs: [],
    about: about.reply.images.read,
    location: "后端 core/rules/replies.ts",
  }),
} as const;

/** 检查写在用例里的规则。它们在写事务里和别的前提一起查，报错和用例的其他报错一起给出。 */
export const inlineRuleInfo = {
  queueStatusGraph: info({
    id: "queue.status.graph",
    level: "block",
    scope: {
      subjects: ["queue"],
      commands: ["queue wait", "queue done", "queue drop", "round start", "round close"],
    },
    since: queueScriptAdded,
    needs: [],
    about: about.queue.status.graph,
    location: "后端 core/queue.ts 的 queueRules",
  }),
  queueDropReason: info({
    id: "queue.drop.reason",
    level: "block",
    scope: { subjects: ["queue"], commands: ["queue drop"] },
    since: queueScriptAdded,
    needs: [],
    about: about.queue.drop.reason,
    location: "后端 core/queue.ts 的 queueRules",
  }),
  queueContentSemicolons: info({
    id: "queue.content.semicolons",
    level: "block",
    scope: { subjects: ["queue"], commands: ["queue add", "queue edit", "reply handle"] },
    since: queueScriptAdded,
    needs: [],
    about: about.queue.content.semicolons,
    location: "后端 core/queue.ts 的 queueRules",
  }),
  queueContentDuplicate: info({
    id: "queue.content.duplicate",
    level: "block",
    scope: { subjects: ["queue"], commands: ["queue add", "queue edit", "reply handle"] },
    since: queueScriptAdded,
    needs: [],
    about: about.queue.content.duplicate,
    location: "后端 core/queue.ts 的 queueRules",
  }),
  roundTakeStage: info({
    id: "round.take.stage",
    level: "block",
    scope: { subjects: ["round"], commands: ["round start"] },
    since: sinceRelease,
    needs: [],
    about: about.round.take.stage,
    location: "后端 core/rounds/start.ts 的 roundStartRules",
  }),
  roundCloseResult: info({
    id: "round.close.result",
    level: "block",
    scope: { subjects: ["round"], commands: ["round close", "round start"] },
    since: sinceRelease,
    needs: [],
    about: about.round.close.result,
    location: "后端 core/rounds/close.ts 的 roundCloseRules",
  }),
  useLeave: info({
    id: "use.leave",
    level: "block",
    scope: { subjects: ["round"], stages: ["use"], commands: ["round close"] },
    since: sinceRelease,
    needs: [],
    about: about.use.leave,
    location: "后端 core/rounds/close.ts 的 roundCloseRules",
  }),
  thinkLeave: info({
    id: "think.leave",
    level: "block",
    scope: { subjects: ["round"], stages: ["think"], commands: ["round close", "round start"] },
    since: sinceRelease,
    needs: [],
    about: about.think.leave,
    location: "后端 core/rounds/close.ts 的 roundCloseRules",
  }),
  mainlineSpecTwelve: info({
    id: "mainline.spec.twelve",
    level: "block",
    scope: { subjects: ["mainline"], stages: ["check"], commands: ["round start"] },
    since: specTwelveAdded,
    needs: [],
    about: about.mainline.spec.twelve,
    location: "后端 core/rounds/start.ts 的 roundStartRules",
  }),
  mainlineTen: info({
    id: "mainline.ten",
    level: "warn",
    scope: { subjects: ["mainline"], commands: ["round start"] },
    since: sinceRelease,
    needs: [],
    about: about.mainline.ten,
    location: "后端 core/rounds/start.ts 的 roundStartRules",
  }),
  replyRound: info({
    id: "writing.reply.round",
    level: "block",
    scope: { subjects: ["reply"], commands: ["lint reply"] },
    since: sinceRelease,
    needs: [],
    about: about.writing.reply.round,
    location: "后端 core/lint.ts 的 lintRules",
  }),
  replyMainlineNewer: info({
    id: "reply.mainline.newer",
    level: "block",
    scope: { subjects: ["replyLine"], commands: ["reply handle"] },
    since: sinceRelease,
    needs: [],
    about: about.reply.mainline.newer,
    location: "后端 core/replies/handle.ts 的 handleRules",
  }),
} as const;

/** 落地的一条规则：查的是落地记录，不要上下文，检查写在落地的用例里。 */
type LandRuleFields = Pick<BackendRuleInfo<never>, "id" | "level" | "since" | "about"> & {
  readonly commands: RuleScope["commands"];
};

function landRule({ commands, ...fields }: LandRuleFields): BackendRuleInfo<never> {
  return {
    ...fields,
    scope: { subjects: ["land"], commands },
    needs: [],
    location: "后端 core/land/rules.ts 的 landRules",
  };
}

const tidyRedGreen = ["land tidy", "land red", "land green"] as const;

/** 落地五步的规则，检查写在后端 core/land/steps.ts 里，见「07 校验」第四节和第六节。 */
export const landRuleInfo = {
  planSections: landRule({
    id: "land.plan.sections",
    level: "block",
    commands: ["land plan", "land review"],
    since: landScriptAdded,
    about: about.land.plan.sections,
  }),
  planTidy: landRule({
    id: "land.plan.tidy",
    level: "block",
    commands: ["land plan"],
    since: landScriptAdded,
    about: about.land.plan.tidy,
  }),
  order: landRule({
    id: "land.order",
    level: "block",
    commands: [...tidyRedGreen, "land review"],
    since: landScriptAdded,
    about: about.land.order,
  }),
  tidySkip: landRule({
    id: "land.tidy.skip",
    level: "block",
    commands: ["land tidy"],
    since: landScriptAdded,
    about: about.land.tidy.skip,
  }),
  tidyPassed: landRule({
    id: "land.tidy.passed",
    level: "block",
    commands: ["land tidy"],
    since: landScriptAdded,
    about: about.land.tidy.passed,
  }),
  tidyCommitted: landRule({
    id: "land.tidy.committed",
    level: "block",
    commands: ["land tidy"],
    since: landScriptAdded,
    about: about.land.tidy.committed,
  }),
  changePlanned: landRule({
    id: "land.change.planned",
    level: "block",
    commands: ["land plan", ...tidyRedGreen],
    since: sinceRelease,
    about: about.land.change.planned,
  }),
  redFailed: landRule({
    id: "land.red.failed",
    level: "block",
    commands: ["land red", "land green"],
    since: landScriptAdded,
    about: about.land.red.failed,
  }),
  greenSameCommand: landRule({
    id: "land.green.sameCommand",
    level: "block",
    commands: ["land green"],
    since: landScriptAdded,
    about: about.land.green.sameCommand,
  }),
  greenPassed: landRule({
    id: "land.green.passed",
    level: "block",
    commands: ["land green"],
    since: landScriptAdded,
    about: about.land.green.passed,
  }),
  greenLater: landRule({
    id: "land.green.later",
    level: "block",
    commands: ["land green"],
    since: sinceRelease,
    about: about.land.green.later,
  }),
  commitRecorded: landRule({
    id: "land.commit.recorded",
    level: "block",
    commands: [...tidyRedGreen],
    since: sinceRelease,
    about: about.land.commit.recorded,
  }),
  oneCommit: landRule({
    id: "land.oneCommit",
    level: "warn",
    commands: ["land green"],
    since: sinceRelease,
    about: about.land.oneCommit,
  }),
  reviewLocated: landRule({
    id: "land.review.located",
    level: "block",
    commands: ["land review"],
    since: landScriptAdded,
    about: about.land.review.located,
  }),
  reviewDisposed: landRule({
    id: "land.review.disposed",
    level: "block",
    commands: ["land review"],
    since: landScriptAdded,
    about: about.land.review.disposed,
  }),
  reviewRequired: landRule({
    id: "land.review.required",
    level: "block",
    commands: ["land review"],
    since: sinceRelease,
    about: about.land.review.required,
  }),
  changeRejected: landRule({
    id: "land.change.rejected",
    level: "block",
    commands: ["round close"],
    since: sinceRelease,
    about: about.land.change.rejected,
  }),
  steps: landRule({
    id: "land.steps",
    level: "block",
    commands: ["page check", "page present", "round close"],
    since: landScriptAdded,
    about: about.land.steps,
  }),
  commitClean: landRule({
    id: "land.commit.clean",
    level: "block",
    commands: ["round close"],
    since: sinceRelease,
    about: about.land.commit.clean,
  }),
  pageShown: landRule({
    id: "land.page.shown",
    level: "block",
    commands: ["round close"],
    since: landPageShownAdded,
    about: about.land.page.shown,
  }),
} as const;

/** 收使用记录的规则，检查写在收一次运行的用例里。 */
export const useRuleInfo = {
  shotsPresent: info({
    id: "use.shots.present",
    level: "block",
    scope: { subjects: ["use"], commands: ["use run", "use ingest"] },
    since: sinceRelease,
    needs: [],
    about: about.use.shots.present,
    location: "后端 core/use/ingest.ts 的 useRules",
  }),
  sceneKnown: info({
    id: "use.scene.known",
    level: "warn",
    scope: { subjects: ["use"], commands: ["use run", "use ingest"] },
    since: sinceRelease,
    needs: [],
    about: about.use.scene.known,
    location: "后端 core/use/ingest.ts 的 useRules",
  }),
} as const;

const registered: readonly BackendRuleInfo[] = Object.freeze([
  ...Object.values(presentRuleInfo),
  ...Object.values(handleRuleInfo),
  ...Object.values(inlineRuleInfo),
  ...Object.values(landRuleInfo),
  ...Object.values(useRuleInfo),
]);

/** 登记在后端的全部规则。顺序就是维护说明里的顺序。 */
export function backendRules(): readonly BackendRuleInfo[] {
  return registered;
}
