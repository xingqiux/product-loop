import {
  allRules,
  type BatchItem,
  type ChangedScreen,
  checkPageData,
  type ErrorBody,
  err,
  errorBody,
  formatQueueId,
  formatRoundLabel,
  formatRoundName,
  ok,
  type PageImage,
  type PageIssue,
  type PagePurpose,
  type PageSections,
  parseRoundLabel,
  type Result,
  type Rule,
  type RuleCommand,
  type RuleIssue,
  type RuleRun,
  type RuleScope,
  type RunOptions,
  renderCopy,
  runPageWriting,
  runRules,
  type Stage,
  type WaitingPage,
  whereText,
} from "@product-loop/model";
import { and, asc, eq } from "drizzle-orm";
import { pagesCopy } from "../../copy/pages.ts";
import { parseBlobHash } from "../../store/blobs.ts";
import {
  type BlobHash,
  queueItems,
  type RuleHitLayer,
  type RuleRunMode,
  roundItems,
  type rounds,
  ruleHits,
} from "../../store/schema/index.ts";
import { landStepIssues } from "../land/status.ts";
import { noWritingSpec, projectWritingSpec } from "../mainline.ts";
import { fail, findProject, type Reader, requireWritable } from "../projects.ts";
import { unclearTermsOf, unhandledReplies } from "../replies/pending.ts";
import { findRound, roundLabelIssue } from "../rounds/close.ts";
import { backendRuleList, type PresentContext } from "../rules/index.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { changedScreens } from "../use/screens.ts";
import { pageLookup } from "./lookup.ts";

// 给出信息以前的校验管线，见「07 校验」第一节和「05 接口」第十节第 2 步。
// 三层依次执行，每一层都把问题收齐再返回：
// 1. 数据定义：按阶段校验页面数据，见 model 的 checkPageData。不通过时后两层不执行，
//    因为规则只查通过了定义的数据，见 model 的 rules/cards.ts。
// 2. 校验规则：共用定义里查页面数据的规则，再加后端的规则，只执行这条命令要执行的。
// 3. 写作校验：页面里 AI 写的文字，按项目主线的写作规范查，见 model 的 runPageWriting。
// 拦截和警告按三层的顺序排，同一层按规则给出的顺序。
//
// 历史页面模式用在迁移旧页面，见「07 校验」第七节：没有轮次，阶段和页面的日期由调用的一方写明。
// 起始日期晚于页面日期的规则跳过。后端的规则要看当时的队列和页面，这些已经取不到，
// 所以整批跳过，见约定 0001 第 15 条。
//
// 校验本身只读。每次命中写一条拦截和警告的记录，见「07 校验」第三节，由 recordRuleHits 写。
// ploop page check 用 checkPageAndRecord，在一个写事务里校验并记下。
// 给出信息在自己的写事务里调用 checkPage 和 recordRuleHits，前提在事务里重新确认，见 present.ts。

/** 执行这条管线的两条命令。 */
type PageCommand = Extract<RuleCommand, "page check" | "page present">;

/** 命令行交来的一张截图：页面数据里写的路径，和它的哈希。 */
type ImageInput = { readonly path: string; readonly hash: string };

/** 平时校验挂在一轮上，阶段取这一轮的。历史页面模式没有轮次，写明阶段和页面的日期。 */
type PageCheckRun =
  | { readonly mode: "current"; readonly round: string }
  | { readonly mode: "history"; readonly stage: Stage; readonly pageDate: string };

export type PageCheckInput = {
  /** 页面数据，AI 写的样子，还没有过数据定义。 */
  readonly data: unknown;
  readonly command: PageCommand;
  /** 页面的用途。不写就是要用户点的。 */
  readonly purpose?: PagePurpose | undefined;
  /** 截图的哈希。只校验、不给出时可以不写。 */
  readonly images?: readonly ImageInput[] | undefined;
  readonly run: PageCheckRun;
};

/** 按页面表查的两样。平时用 lookup.ts 的 pageLookup，测试可以换成别的。 */
export type PageLookup = {
  /** 这个项目里在等用户点的页，只看的页不算。 */
  waitingPages(db: Reader, projectId: string): readonly WaitingPage[];
  /** 这一轮已给出、没撤回的页引用过的队列事项：编号和引用它的页。 */
  coveredInRound(db: Reader, roundId: number): ReadonlyMap<string, number>;
};

export type PageCheckDeps = {
  /** 附件库里有没有这个哈希的完整一份。接口层传 store/blobs.ts 的 hasBlob。 */
  readonly hasBlob: (hash: BlobHash) => boolean;
  readonly pages?: PageLookup | undefined;
};

/** 一层的结果。 */
type LayerRun = {
  readonly layer: RuleHitLayer;
  readonly block: readonly RuleIssue[];
  readonly warn: readonly RuleIssue[];
};

/** 校验挂在哪一轮上。 */
type CheckedRound = { readonly id: number; readonly label: string };

/** 校验的结果。 */
export type PageCheck = {
  readonly stage: Stage;
  readonly mode: RuleRunMode;
  /** 历史页面模式写页面的日期，平时为空。 */
  readonly pageDate: string | null;
  /** 历史页面模式没有轮次。 */
  readonly round: CheckedRound | null;
  /** 数据定义通过时，解析以后的页面数据。没通过时为 undefined，后两层没有执行。 */
  readonly page: PageSections | undefined;
  /** 执行了的几层，按顺序。数据定义不通过时只有这一层。 */
  readonly layers: readonly LayerRun[];
  /** 全部拦截，按三层的顺序。 */
  readonly block: readonly RuleIssue[];
  readonly warn: readonly RuleIssue[];
  /** 跳过的规则的编号：历史页面模式里起始日期更晚的，和整批跳过的后端规则。 */
  readonly skipped: readonly string[];
};

type CheckError = ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT">;

/** 共用定义里查页面数据的规则，按登记的顺序。 */
const sharedPageRules: readonly Rule[] = allRules().filter((rule) =>
  rule.scope.subjects.includes("page"),
);

/** 这条命令要执行的规则。 */
function forCommand<R extends { readonly scope: RuleScope }>(
  rules: readonly R[],
  command: PageCommand,
): R[] {
  return rules.filter((rule) => rule.scope.commands.includes(command));
}

/** 校验一份页面数据，三层依次执行，收齐全部结果。只读，不写记录。 */
export function checkPage(
  db: Reader,
  projectId: string,
  input: PageCheckInput,
  deps: PageCheckDeps,
): Result<PageCheck, CheckError> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const { run } = input;
  let round: CheckedRound | null = null;
  let roundRow: typeof rounds.$inferSelect | undefined;
  let stage: Stage;
  let options: RunOptions;
  if (run.mode === "current") {
    const found = openRound(db, projectId, run.round);
    if (!found.ok) return found;
    roundRow = found.value;
    round = { id: found.value.id, label: formatRoundLabel(found.value) };
    stage = found.value.stage;
    options = { mode: "current", stage };
  } else {
    stage = run.stage;
    options = { mode: "history", pageDate: run.pageDate, stage };
  }
  const head = {
    stage,
    mode: run.mode,
    pageDate: run.mode === "history" ? run.pageDate : null,
    round,
  };

  // 使用阶段的页一律只看，系统填内容，页面数据可以是空的，和给出信息时一致。
  const purpose: PagePurpose = input.purpose ?? (stage === "use" ? "view" : "ask");

  // 第一层：数据定义。
  const parsed = checkPageData(stage, input.data);
  if (!parsed.ok) {
    const failed = { layer: "definition", block: parsed.error.map(toIssue), warn: [] } as const;
    return ok(combine(head, undefined, [failed], []));
  }
  const page: PageSections = parsed.value;
  const definition = { layer: "definition", block: [], warn: [] } as const;
  const writingSpec = projectWritingSpec(db, projectId);

  // 第二层：共用定义的规则，再加后端的规则。
  const shared = runRules(
    forCommand(sharedPageRules, input.command),
    page,
    { writingSpec },
    options,
  );
  const backend = forCommand(backendRuleList, input.command);
  let backendRun: RuleRun;
  if (run.mode === "history" || round === null) {
    backendRun = { block: [], warn: [], skipped: backend.map((rule) => rule.id) };
  } else {
    const context = presentContext(db, projectId, { id: round.id, stage }, input, deps);
    const subject = { page, purpose };
    backendRun = runRules(backend, subject, context, options);
  }
  // 落地轮里要用户点的一页就是验收页：五步都要有记录，见规矩 land.steps。
  const landSteps =
    roundRow?.stage === "land" && purpose === "ask" ? landStepIssues(db, roundRow) : [];
  const rules = {
    layer: "rule",
    block: [...shared.block, ...backendRun.block, ...landSteps],
    warn: [...shared.warn, ...backendRun.warn],
  } as const;

  // 第三层：写作校验。
  const writing = runPageWriting(page, { writingSpec }, options);
  const skipped = [...shared.skipped, ...backendRun.skipped, ...writing.skipped];
  return ok(
    combine(
      head,
      page,
      [definition, rules, { layer: "writing", block: writing.block, warn: writing.warn }],
      [...new Set(skipped)],
    ),
  );
}

/**
 * 历史页面模式，不挂在项目上：迁移以前的体检和迁移的导入用，接口是 POST /legacy/pages/check。
 * 项目这时可能还没登记，写作规范取空的，也不记命中。后端的规则整批跳过，理由同上。
 */
export function checkHistoryPage(data: unknown, stage: Stage, pageDate: string): PageCheck {
  const options: RunOptions = { mode: "history", pageDate, stage };
  const head = { stage, mode: "history" as const, pageDate, round: null };
  const parsed = checkPageData(stage, data);
  if (!parsed.ok) {
    const failed = { layer: "definition", block: parsed.error.map(toIssue), warn: [] } as const;
    return combine(head, undefined, [failed], []);
  }
  const page: PageSections = parsed.value;
  const context = { writingSpec: noWritingSpec };
  const shared = runRules(forCommand(sharedPageRules, "page check"), page, context, options);
  const backend = forCommand(backendRuleList, "page check").map((rule) => rule.id);
  const writing = runPageWriting(page, context, options);
  const layers = [
    { layer: "definition", block: [], warn: [] },
    { layer: "rule", block: shared.block, warn: shared.warn },
    { layer: "writing", block: writing.block, warn: writing.warn },
  ] as const;
  const skipped = [...new Set([...shared.skipped, ...backend, ...writing.skipped])];
  return combine(head, page, layers, skipped);
}

/** 校验的结果写成 ploop page check 的样子。 */
export function checkReport(check: PageCheck): PageCheckReport {
  return {
    stage: check.stage,
    round: check.round?.label ?? null,
    block: check.block,
    warn: check.warn,
    skipped: check.skipped,
  };
}

/** 把几层的结果合起来。 */
function combine(
  head: Pick<PageCheck, "stage" | "mode" | "pageDate" | "round">,
  page: PageSections | undefined,
  layers: readonly LayerRun[],
  skipped: readonly string[],
): PageCheck {
  return {
    ...head,
    page,
    layers,
    block: layers.flatMap((layer) => layer.block),
    warn: layers.flatMap((layer) => layer.warn),
    skipped,
  };
}

/** 数据定义的一条问题写成一条拦截。规矩的编号写定义里那一项的编号。 */
function toIssue(issue: PageIssue): RuleIssue {
  const where = whereText(issue.path);
  return {
    rule: issue.check,
    message: issue.message,
    hint: issue.hint,
    ...(where === "" ? {} : { where }),
  };
}

/** 按阶段的写法找这个项目的一个阶段，还没收尾才能给出信息。 */
function openRound(
  db: Reader,
  projectId: string,
  text: string,
): Result<typeof rounds.$inferSelect, CheckError> {
  const label = parseRoundLabel(text);
  if (!label.ok) return err(errorBody("BAD_REQUEST", [roundLabelIssue(text, label.error)]));
  const row = findRound(db, projectId, label.value);
  if (row === undefined) {
    const entry = pagesCopy.round.notFound;
    return fail("NOT_FOUND", {
      message: renderCopy(entry.message, {
        project: projectId,
        round: formatRoundName(label.value),
      }),
      hint: renderCopy(entry.hint),
      where: formatRoundName(label.value),
    });
  }
  if (row.status === "closed") {
    const entry = pagesCopy.round.closed;
    const round = formatRoundName(row);
    return fail("CONFLICT", {
      message: renderCopy(entry.message, { round }),
      hint: renderCopy(entry.hint),
      where: round,
    });
  }
  return ok(row);
}

/** 后端的规则要的上下文，从数据库和请求里取。 */
function presentContext(
  db: Reader,
  projectId: string,
  round: { readonly id: number; readonly stage: Stage },
  input: PageCheckInput,
  deps: PageCheckDeps,
): PresentContext {
  const roundId = round.id;
  const pages = deps.pages ?? pageLookup;
  const covered = pages.coveredInRound(db, roundId);
  const batch: BatchItem[] = inProgress(db, roundId).map((row) => {
    const id = formatQueueId(row.number);
    return { id, content: row.content, coveredBy: covered.get(id) };
  });
  const images: PageImage[] = (input.images ?? []).map(({ path, hash }) => {
    const parsed = parseBlobHash(hash);
    return { path, hash, stored: parsed.ok && deps.hasBlob(parsed.value) };
  });
  return {
    batch,
    waitingPages: pages.waitingPages(db, projectId),
    images,
    unhandledReplies: unhandledReplies(db, projectId),
    unclearTerms: unclearTermsOf(db, projectId),
    changedScreens: round.stage === "check" ? changedScreenKeys(db, projectId) : [],
  };
}

/** 这一版新出现和变过的屏，每个场景的每一步只列一次，不看宽度。 */
function changedScreenKeys(db: Reader, projectId: string): ChangedScreen[] {
  const list = changedScreens(db, projectId);
  if (!list.ok) return [];
  return list.value.scenes.flatMap((scene) =>
    [...new Set(scene.screens.map((screen) => screen.step))].map((step) => ({
      scene: scene.scene,
      step,
    })),
  );
}

/**
 * 这一轮拿出来、还在进行中的事，按编号排。开始一轮时拿出的事都改成进行中。
 * 开始时取消的、做完的、退回待办或改成等待的，状态都不再是进行中，见 rounds/close.ts 的开头。
 */
function inProgress(db: Reader, roundId: number) {
  return db
    .select({ number: queueItems.number, content: queueItems.content })
    .from(roundItems)
    .innerJoin(queueItems, eq(roundItems.queueItemId, queueItems.id))
    .where(and(eq(roundItems.roundId, roundId), eq(queueItems.status, "doing")))
    .orderBy(asc(queueItems.number))
    .all();
}

// ── 拦截和警告的记录 ──

/** 记录挂在哪里：项目、命令，以及给出信息存成的页面。 */
export type HitTarget = {
  readonly projectId: string;
  readonly command: PageCommand;
  /** 给出信息存成的页面。只校验时不写。 */
  readonly pageId?: number | undefined;
};

/**
 * 把一次校验的每条拦截和警告记一行，返回记了几行。在调用的一方的写事务里执行。
 * 给出信息被拦截时也要记，所以那个事务要提交，不能靠返回失败回滚。
 * 数据定义那一层也记，规矩的编号写定义里那一项的编号，层写数据定义。
 */
export function recordRuleHits(w: WriteScope, check: PageCheck, target: HitTarget): number {
  const base = {
    createdAt: w.now,
    projectId: target.projectId,
    roundId: check.round?.id ?? null,
    pageId: target.pageId ?? null,
    command: target.command,
    mode: check.mode,
    pageDate: check.pageDate,
  };
  const rows = check.layers.flatMap((layer) =>
    (["block", "warn"] as const).flatMap((level) =>
      layer[level].map((issue) => ({
        ...base,
        layer: layer.layer,
        rule: issue.rule,
        level,
        where: issue.where ?? null,
        message: issue.message,
        hint: issue.hint ?? null,
      })),
    ),
  );
  if (rows.length > 0) w.tx.insert(ruleHits).values(rows).run();
  return rows.length;
}

/** ploop page check 的结果：阶段、轮次，和全部拦截、警告。都能存成 JSON。 */
export type PageCheckReport = {
  readonly stage: Stage;
  /** 轮次的写法。历史页面模式没有轮次。 */
  readonly round: string | null;
  readonly block: readonly RuleIssue[];
  readonly warn: readonly RuleIssue[];
  readonly skipped: readonly string[];
};

/**
 * 只校验，不给出：`ploop page check`，接口是 POST /projects/:pid/rounds/:rid/pages/check。
 * 在一个写事务里校验并记下每条命中。有拦截时照常提交，拦截在结果里，由接口层决定怎么回。
 * 平时要求项目不用先体检，因为校验完就要给出。历史页面模式正是在迁移完成以前用，不要求。
 */
export function checkPageAndRecord(
  ctx: WriteContext,
  projectId: string,
  input: PageCheckInput,
  deps: PageCheckDeps,
): Result<PageCheckReport, ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR">> {
  type Failure = ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR">;
  return writeTx<PageCheckReport, Failure>(ctx, (w) => {
    if (input.run.mode === "current") {
      const writable = requireWritable(w.tx, projectId);
      if (!writable.ok) return writable;
    }
    const checked = checkPage(w.tx, projectId, input, deps);
    if (!checked.ok) return checked;
    const { value } = checked;
    recordRuleHits(w, value, { projectId, command: input.command });
    return ok(checkReport(value));
  });
}
