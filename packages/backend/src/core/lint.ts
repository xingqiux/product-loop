import {
  type ErrorBody,
  formatRoundName,
  ok,
  type ProjectWritingSpec,
  type Result,
  type RuleCommand,
  type RuleIssue,
  renderCopy,
  runRules,
  type WritingSubject,
  writingRuleList,
} from "@product-loop/model";
import { lintCopy } from "../copy/skill.ts";
import { projectWritingSpec } from "./mainline.ts";
import { findProject, type Reader } from "./projects.ts";
import { latestRoundOf } from "./skill-issues.ts";

// 写作校验：ploop lint text 和 ploop lint reply，接口是 POST /lint/text 和 POST /lint/reply。
// 查法是共用定义的写作规则，见「07 校验」第五节。写了项目时用主线「写作规范」一节的停用说法和例外。
// 查回复时另查首行是不是以项目当前的阶段开头，例如「第 2 版的落地阶段：……」，见「04 命令行」第九节 check-reply.py 一行。
// 阶段写成「第 2 版的检查阶段」，见决定 211；v2-检查-1 这样的内部编号不认。
// 只读，不记拦截。

/** 写在用例里的规矩编号，登记在 model 的 inlineRuleInfo。 */
export const lintRules = {
  /** 会话回复的首行以当前的阶段开头。 */
  replyRound: "writing.reply.round",
} as const;

const noWritingSpec: ProjectWritingSpec = { banned: [], exceptions: [] };

export type LintInput = {
  readonly text: string;
  /** 项目编号。不写就不看主线的写作规范，也不查阶段。 */
  readonly project?: string | undefined;
};

export type LintResult = {
  readonly block: readonly RuleIssue[];
  readonly warn: readonly RuleIssue[];
};

function lint(
  db: Reader,
  kind: WritingSubject["kind"],
  input: LintInput,
): Result<LintResult, ErrorBody<"NOT_FOUND">> {
  if (input.project !== undefined) {
    const project = findProject(db, input.project);
    if (!project.ok) return project;
  }
  const command: RuleCommand = kind === "reply" ? "lint reply" : "lint text";
  const rules = writingRuleList.filter((rule) => rule.scope.commands.includes(command));
  const writingSpec =
    input.project === undefined ? noWritingSpec : projectWritingSpec(db, input.project);
  const run = runRules(rules, { kind, text: input.text }, { writingSpec });
  let block =
    kind === "reply" ? run.block.map((issue) => located(issue, input.text)) : [...run.block];
  if (kind === "reply" && input.project !== undefined) {
    const round = latestRoundOf(db, input.project);
    const first = input.text.trimStart().split("\n")[0] ?? "";
    // 只认「第 2 版的检查阶段」这样的写法，v2-检查-1 是内部编号，不许对用户写，见决定 211。
    if (round !== undefined && !first.startsWith(formatRoundName(round))) {
      const name = formatRoundName(round);
      // 同一件事只报一处：首行没写当前的阶段。通用的「首行要写阶段」不另报，
      // 只留这一条，它写明了阶段的叫法、位置和怎么改，见审查报告 P23。
      block = block.filter((issue) => issue.rule !== "writing.reply.firstLine");
      block.push({
        rule: lintRules.replyRound,
        message: renderCopy(lintCopy.round.message, { round: name }),
        hint: renderCopy(lintCopy.round.hint, { round: name }),
        where: "第 1 行",
      });
    }
  }
  return ok({ block, warn: run.warn });
}

/** 引号里的第一段，例如「主线.md」里的 主线.md。 */
const firstQuoted = /「([^」]*)」/u;

/** 会话回复里第几行有这个字，last 为 true 时取最后一处。找不到时返回 undefined。 */
function lineWith(text: string, needle: string, last = false): string | undefined {
  const lines = text.trimStart().split("\n");
  const has = (line: string) => line.includes(needle);
  const at = last ? lines.findLastIndex(has) : lines.findIndex(has);
  return at === -1 ? undefined : `第 ${at + 1} 行`;
}

/**
 * 回复自查的几项写明在第几行：首行是第 1 行，文件名和间隔号找到有它们的那一行，
 * 链接找最后一行有链接的，见审查报告 N26。
 */
function located(issue: RuleIssue, text: string): RuleIssue {
  if (issue.where !== undefined) return issue;
  const name = firstQuoted.exec(issue.message)?.[1];
  const where =
    issue.rule === "writing.reply.firstLine"
      ? "第 1 行"
      : issue.rule === "writing.reply.fileName" && name !== undefined
        ? lineWith(text, name)
        : issue.rule === "writing.reply.interpunct"
          ? lineWith(text, "·")
          : issue.rule === "writing.reply.linkLast"
            ? lineWith(text, "http", true)
            : undefined;
  return where === undefined ? issue : { ...issue, where };
}

/** 查一段文字，给页面、队列事项以外的文字用。 */
export function lintText(db: Reader, input: LintInput): Result<LintResult, ErrorBody<"NOT_FOUND">> {
  return lint(db, "text", input);
}

/** 查一份会话回复。 */
export function lintReply(
  db: Reader,
  input: LintInput,
): Result<LintResult, ErrorBody<"NOT_FOUND">> {
  return lint(db, "reply", input);
}
