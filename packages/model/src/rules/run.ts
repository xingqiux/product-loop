import { renderCopy } from "../copy/define.ts";
import type { Issue } from "../envelope.ts";
import { type Stage, stage as stageNames } from "../names.ts";
import { isDay, type Rule, type RuleHit, type RuleWhere, startDay } from "./rule.ts";

// 执行一组规则，见「07 校验」第一节和第三节：每条规则都跑完，把全部命中收齐再返回。
// 报错按文案表填好，形状和响应外壳里的一条问题相同，见 envelope.ts。
// 顺序是确定的：先按传进来的规则的顺序，同一条规则按检查函数给出的顺序。
// 历史页面模式按页面的日期，跳过起始日期更晚的规则，见「07 校验」第七节。

/** 规则报的一条问题。规矩的编号一定有。 */
export type RuleIssue = Issue & { readonly rule: string };

/**
 * 执行的方式。current 是平时：每条规则都执行。
 * history 是迁移旧页面时：起始日期不早于页面日期的规则跳过：起始日期只精确到天，同一天生成的页面可能早于规则。
 * stage 写这一页或这一轮的阶段。只在某些阶段查的规则，要写明阶段才能执行。
 */
export type RunOptions =
  | { readonly mode: "current"; readonly stage?: Stage }
  | { readonly mode: "history"; readonly pageDate: string; readonly stage?: Stage };

/** 执行的结果：拦截和警告各一组，顺序见文件开头。 */
export type RuleRun = {
  readonly block: readonly RuleIssue[];
  readonly warn: readonly RuleIssue[];
  /** 历史页面模式跳过的规则的编号：它们的起始日期晚于页面的日期。 */
  readonly skipped: readonly string[];
};

/** 位置写成文字：路径写成 asks[0].sources[1]，写好的位置原样用。 */
export function whereText(where: RuleWhere): string {
  if (typeof where === "string") return where;
  return where
    .map((part, i) => {
      if (typeof part === "number") return `[${part}]`;
      return i === 0 ? part : `.${part}`;
    })
    .join("");
}

/**
 * 执行一组规则，收齐全部命中。拦截不会让别的规则少跑。
 * 规则声明要的上下文都要给，少给是调用的一方写错了，直接报错。
 */
export function runRules<S, C>(
  rules: readonly Rule<S, C>[],
  subject: S,
  context: C,
  options: RunOptions = { mode: "current" },
): RuleRun {
  if (options.mode === "history" && !isDay(options.pageDate)) {
    throw new Error(
      `历史页面模式要写页面的日期，写成 2026-09-21 这样，现在是 ${options.pageDate}。`,
    );
  }
  const given: Readonly<Record<string, unknown>> =
    typeof context === "object" && context !== null ? { ...context } : {};
  const block: RuleIssue[] = [];
  const warn: RuleIssue[] = [];
  const skipped: string[] = [];
  for (const rule of rules) {
    if (!inStage(rule, options.stage)) continue;
    if (options.mode === "history" && !startedBy(rule, options.pageDate)) {
      skipped.push(rule.id);
      continue;
    }
    for (const name of rule.needs) {
      if (given[name] === undefined) {
        throw new Error(`规则 ${rule.id} 要上下文 ${name}，执行时没有给。`);
      }
    }
    const issues = rule.check(subject, context).map((hit) => toIssue(rule, hit));
    (rule.level === "block" ? block : warn).push(...issues);
  }
  return { block, warn, skipped };
}

/** 规则在这个阶段查不查。只在某些阶段查的规则，调用的一方没写阶段时算写错了。 */
function inStage<S, C>(rule: Rule<S, C>, stage: Stage | undefined): boolean {
  const { stages } = rule.scope;
  if (stages === undefined) return true;
  if (stage === undefined) {
    const labels = stages.map((key) => stageNames.label(key)).join("、");
    throw new Error(`规则 ${rule.id} 只在${labels}查，执行时要写明阶段。`);
  }
  return stages.includes(stage);
}

/**
 * 页面生成的那一天，这条规则有没有开始执行。起始日期只精确到天，
 * 同一天生成的页面可能早于这条规则，所以只查起始日期之后生成的页面。
 */
function startedBy<S, C>(rule: Rule<S, C>, pageDate: string): boolean {
  const start = startDay(rule.since);
  return start !== undefined && start < pageDate;
}

/** 一次命中写成一条问题：报错按文案填好，没写的项不带。 */
function toIssue<S, C>(rule: Rule<S, C>, hit: RuleHit): RuleIssue {
  const { message, hint } = rule.copy;
  const where = hit.where === undefined ? "" : whereText(hit.where);
  return {
    rule: rule.id,
    message: renderCopy(message, hit.params),
    ...(hint === undefined ? {} : { hint: renderCopy(hint, hit.params) }),
    ...(where === "" ? {} : { where }),
  };
}
