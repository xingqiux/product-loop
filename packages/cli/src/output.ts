import {
  type ErrorBody,
  type ErrorCode,
  type ExitCode,
  errorCodeInfo,
  exitCode,
  type Issue,
  issuesOf,
  type Result,
  renderCopy,
  toCliEnvelope,
} from "@product-loop/model";
import { errorLineCopy, outputCopy } from "./copy/output.ts";

// 命令的两种输出，见「04 命令行」第五节到第七节：给人和 AI 读的中文文字，和加 --json 以后的机读结果。
// 文字输出：第一行写结果，中间写 AI 下一步要用的信息，最后一段以「下一步：」开头；警告写到标准错误。
// 机读输出：标准输出只有一个 JSON 对象，出错时也是同一种外壳。退出码按错误码表取。

/** 一条命令成功以后要输出的东西。 */
export type Report<D = unknown> = {
  /** 机读结果的种类，例如 round.started。 */
  readonly kind: string;
  /** 机读结果的数据。 */
  readonly data: D;
  /** 文字输出的正文。第一行写结果，以动词短语开头，例如「开始了：第 2 版的检查阶段」。 */
  readonly lines: readonly [string, ...string[]];
  /** 下一步：一到三条能直接运行的完整命令。说明性的话写进 lines，不放在这里。 */
  readonly next: readonly string[];
  readonly warnings: readonly Issue[];
  /**
   * 成功以外的退出码，结果照常输出：
   * - 还在等：到了时限用户还没提交，退出码是 7，见「04 命令行」第七节。
   * - 拦截：使用代码的运行有断了的步，退出码是 1，靠退出码判断使用有没有通过的脚本不会误认为通过。
   */
  readonly exit?: typeof exitCode.stillWaiting | typeof exitCode.blocked;
  /**
   * 文字输出什么都不写，机读输出照常。给会话开始的钩子用：
   * 不在项目里、后端一时连不上时，不能打断会话，也不能往里塞东西。
   */
  readonly quiet?: true;
};

/** 一条命令的结果：成功时是要输出的东西，失败时是带错误码的 error。 */
export type Outcome = Result<Report, ErrorBody>;

/** 要写到标准输出和标准错误的文字。空字符串表示不写。 */
export type Written = { readonly stdout: string; readonly stderr: string };

type ErrorLine = (typeof errorLineCopy)[number]["line"];

const errorLineByCode: ReadonlyMap<ErrorCode, ErrorLine> = new Map(
  errorLineCopy.map(({ code, line }) => [code, line]),
);

/** 问题里的一个名字：队列编号加事项名，或者引号里的名字。 */
const nameSpan = /Q\d+(?:「[^」]*」)?|「[^」]*」/gu;
const queueId = /Q\d+/gu;

/** 几条问题只差名字或位置，至少这么多条才合成一条。 */
const mergeFrom = 2;
/** 合成一条时最多列几个名字，多的写总数。 */
const mergeNames = 6;

/**
 * 消息里只有一个名字的问题：合并的依据（名字换成空的消息、怎么改里的编号换成占位、规矩）、
 * 那个名字，和怎么改里的队列编号（至多一个，多了没法合并）。
 */
function shapeOf(
  issue: Issue,
): { readonly key: string; readonly name: string; readonly id?: string } | undefined {
  const found = [...issue.message.matchAll(nameSpan)];
  const [only] = found;
  if (found.length !== 1 || only === undefined) return undefined;
  const hint = issue.hint ?? "";
  const ids = [...hint.matchAll(queueId)];
  if (ids.length > 1) return undefined;
  const key = [
    issue.message.replace(nameSpan, "「」"),
    hint.replace(queueId, "Q#"),
    issue.rule,
  ].join("\0");
  const [id] = ids;
  return { key, name: only[0], ...(id === undefined ? {} : { id: id[0] }) };
}

/** 「主线.md 第 23 行」「主线.md 第 25 行」这样只差行号的位置，合成「主线.md 第 23、25 行」。 */
const lineWhere = /^(.*?)第 (\d+) 行$/u;

function joinWheres(wheres: readonly string[]): string {
  const found = wheres.map((where) => lineWhere.exec(where));
  const prefix = found[0]?.[1];
  const same = prefix !== undefined && found.every((each) => each?.[1] === prefix);
  if (!same || wheres.length < 2) return wheres.join("；");
  return `${prefix}第 ${found.map((each) => each?.[2]).join("、")} 行`;
}

/** 几个位置合成一处：只列前几个，多的写总数。 */
function whereOf(wheres: readonly string[]): string {
  const unique = [...new Set(wheres)];
  const listed = joinWheres(unique.slice(0, mergeNames));
  return unique.length > mergeNames
    ? `${listed}${renderCopy(outputCopy.moreNames, { count: unique.length })}`
    : listed;
}

/**
 * 同类的问题合成一条，免得同一句话重复十几遍：
 * - 消息、怎么改、规矩都一样，只有位置不同的，合成一条并列出位置。
 * - 消息只差一个名字（引号里的名字，或队列编号加事项名），怎么改和规矩也相同的，合成一条并列出名字；
 *   怎么改里写了那件事的编号时，一并写成全部编号。
 * 合不了的照原样写，每条的「怎么改」都写全，不写「同上」。
 */
function mergeIssues(issues: readonly Issue[]): Issue[] {
  const identical = new Map<string, Issue[]>();
  for (const issue of issues) {
    const key = [issue.message, issue.hint, issue.rule].join("\0");
    identical.set(key, [...(identical.get(key) ?? []), issue]);
  }
  // 第一步：完全一样的合成一条。位置一个也不缺才合并位置，缺的说明是同一件事报了两遍，只留一条。
  const seenIdentical = new Set<string>();
  const once: Issue[] = [];
  for (const issue of issues) {
    const key = [issue.message, issue.hint, issue.rule].join("\0");
    const group = identical.get(key) ?? [issue];
    if (group.length < mergeFrom) {
      once.push(issue);
      continue;
    }
    if (seenIdentical.has(key)) continue;
    seenIdentical.add(key);
    const wheres = group.map((each) => each.where);
    if (wheres.every((at): at is string => at !== undefined)) {
      once.push({ ...issue, where: whereOf(wheres) });
    } else {
      once.push(...group.filter((each) => each.where === undefined).slice(0, 1));
      once.push(...group.filter((each) => each.where !== undefined));
    }
  }
  // 第二步：只差一个名字的合成一条。
  const groups = new Map<string, Issue[]>();
  for (const issue of once) {
    const shape = shapeOf(issue);
    if (shape !== undefined) groups.set(shape.key, [...(groups.get(shape.key) ?? []), issue]);
  }
  const done = new Set<string>();
  const out: Issue[] = [];
  for (const issue of once) {
    const shape = shapeOf(issue);
    const group = shape === undefined ? undefined : groups.get(shape.key);
    if (shape === undefined || group === undefined || group.length < mergeFrom) {
      out.push(issue);
      continue;
    }
    if (done.has(shape.key)) continue;
    done.add(shape.key);
    const shapes = group.map((each) => shapeOf(each));
    const names = shapes.map((each) => each?.name ?? "");
    const ids = shapes.map((each) => each?.id).filter((id): id is string => id !== undefined);
    const more =
      names.length > mergeNames ? renderCopy(outputCopy.moreNames, { count: names.length }) : "";
    const wheres = group.map((each) => each.where);
    const where = wheres.every((at): at is string => at !== undefined)
      ? whereOf(wheres)
      : undefined;
    const { where: _dropped, ...rest } = issue;
    out.push({
      ...rest,
      message: issue.message.replace(
        nameSpan,
        () => `${names.slice(0, mergeNames).join("、")}${more}`,
      ),
      ...(issue.hint === undefined || ids.length === 0
        ? {}
        : { hint: issue.hint.replace(queueId, () => ids.join("、")) }),
      ...(where === undefined ? {} : { where }),
    });
  }
  return out;
}

/** 一条拦截、报错或警告写成几行：什么不对、在哪里、怎么改、规矩的编号，没写的不出。 */
function issueText(first: string, { where, hint, rule }: Issue): string {
  // 位置已经写在正文或怎么改里的，不再另写一行，同一条路径不写两遍。
  const repeated = where !== undefined && (first.includes(where) || hint?.includes(where) === true);
  return [
    first,
    ...(where === undefined || repeated ? [] : [renderCopy(outputCopy.where, { where })]),
    ...(hint === undefined ? [] : [renderCopy(outputCopy.hint, { hint })]),
    ...(rule === undefined ? [] : [renderCopy(outputCopy.rule, { rule })]),
  ].join("\n");
}

/** 报错的文字：每条拦截各写一段，段和段之间空一行，写到标准错误。 */
function errorText(error: ErrorBody): string {
  // 每个错误码都有一条，测试逐个核对过，所以一定取得到。
  const line = errorLineByCode.get(error.code) as ErrorLine;
  const blocks = mergeIssues(issuesOf(error)).map((issue) =>
    issueText(renderCopy(line, { message: issue.message }), issue),
  );
  return `${blocks.join("\n\n")}\n`;
}

function reportText({ lines, next, warnings }: Report): Written {
  const steps = next.map((step, i) => `  ${i + 1}. ${step}`);
  const stdout = [
    ...lines,
    ...(steps.length > 0 ? ["", renderCopy(outputCopy.next), ...steps] : []),
  ];
  // 警告另起一段：和标准输出合在一起看时，也和上面的结果隔开一行。
  const stderr = mergeIssues(warnings).map(
    (warning) =>
      `\n${issueText(renderCopy(outputCopy.warning, { message: warning.message }), warning)}\n`,
  );
  return { stdout: `${stdout.join("\n")}\n`, stderr: stderr.join("") };
}

/** 按输出方式把结果写成文字。json 为 true 时，标准输出只有一个 JSON 对象，标准错误不写。 */
export function render(outcome: Outcome, json: boolean): Written {
  if (json) {
    const envelope = outcome.ok
      ? toCliEnvelope(outcome.value.kind, {
          ok: true,
          data: outcome.value.data,
          warnings: outcome.value.warnings,
          next: outcome.value.next,
        })
      : toCliEnvelope("error", { ok: false, error: outcome.error });
    return { stdout: `${JSON.stringify(envelope)}\n`, stderr: "" };
  }
  if (!outcome.ok) return { stdout: "", stderr: errorText(outcome.error) };
  return outcome.value.quiet ? { stdout: "", stderr: "" } : reportText(outcome.value);
}

/** 结果对应的退出码：成功是 0，失败按「05 接口」第九节的错误码表取。 */
export function exitCodeOf(outcome: Outcome): ExitCode {
  if (outcome.ok) return outcome.value.exit ?? exitCode.ok;
  return errorCodeInfo(outcome.error.code).exit;
}
