import { join } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import {
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  issuesOf,
  ok,
  pageBriefLines,
  pageExample,
  pageFieldCopy,
  pageNameOfLabel,
  pagePurpose,
  projectCacheDirName,
  type Result,
  renderCopy,
  roundNameOfLabel,
  type Stage,
  type StageLabel,
  stage,
} from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { pageCopy } from "../copy/page.ts";
import { usageCopy } from "../copy/usage.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import { checkImages, readExcerpts, uploadImages } from "../page/assets.ts";
import { type PageData, readPageData, shownFrom } from "../page/data.ts";
import type { ProgramContext } from "../program.ts";
import {
  addressOf,
  globalProject,
  helpOf,
  type OpenedProject,
  openProject,
  withoutDatePatterns,
} from "./shared.ts";

// ploop page schema|check|present|withdraw，见「04 命令行」第二、三、六节和 S16。
// 页面数据默认读当前阶段的工作区：.product-loop/rounds/<阶段的标识>/ 下的 page.json 和 cards/*.json。
// 截图的路径相对工作区，文字来源的路径相对项目的根目录。
// check 只校验：有拦截时退出码 1，拦截在后端的响应里，见约定 0002 和第 41 步。
// 它只读：不同步主线，不上传截图，不给出这一页。规矩的命中记录是后端自己记的，不算改了项目。
// present 有一页在等时后端返回冲突，退出码 3。报错的位置按合并前的文件写。

const { output, errors: text } = pageCopy;

/** 当前的阶段：ploop status 里的那个阶段。 */
type RoundOf = { readonly label: string; readonly stage: StageLabel };

async function currentRound(
  backend: Backend,
  pid: string,
): Promise<Result<RoundOf | undefined, ErrorBody>> {
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  const { round } = status.value.data;
  return ok(round === null ? undefined : { label: round.label, stage: round.stage });
}

function noRound(): ErrorBody {
  const issue = { message: renderCopy(text.noRound.message), hint: renderCopy(text.noRound.hint) };
  return errorBody("NOT_FOUND", [issue]);
}

/** 阶段的中文标签换回键。 */
const keyOfLabel = Object.fromEntries(stage.keys.map((key) => [stage.label(key), key])) as Record<
  StageLabel,
  Stage
>;

/** 阶段写中文，和 round start 的写法相同。 */
function stageOption(value: string): StageLabel {
  const found = stage.labels.find((label) => label === value);
  if (found !== undefined) return found;
  throw new InvalidArgumentError(
    renderCopy(usageCopy.choices, { choices: stage.labels.join("、") }),
  );
}

// ── page schema ──

/** 没写阶段时取当前阶段。这一版还没有开始任何阶段，报没有阶段。 */
async function stageOrCurrent(
  ctx: CommandEnv,
  project: string | undefined,
  chosen: StageLabel | undefined,
): Promise<Result<{ stage: StageLabel; backend: Backend }, ErrorBody>> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId } = opened.value;
  if (chosen !== undefined) return ok({ stage: chosen, backend });
  const round = await currentRound(backend, projectId);
  if (!round.ok) return round;
  if (round.value === undefined) return err(noRound());
  return ok({ stage: round.value.stage, backend });
}

async function schema(
  ctx: CommandEnv,
  project: string | undefined,
  stageOptionValue: StageLabel | undefined,
  brief: boolean,
): Promise<Outcome> {
  const picked = await stageOrCurrent(ctx, project, stageOptionValue);
  if (!picked.ok) return picked;
  const { backend, stage: chosen } = picked.value;
  const result = await backend.call((api) =>
    api.api.v1.schema.page.$get({ query: { stage: chosen } }),
  );
  if (!result.ok) return result;
  // 日期时间字段的正则太长，去掉，只留 format。
  const data = withoutDatePatterns(result.value.data);
  if (brief) {
    // 简表：一行一个字段，第一行说明星号和怎么看完整的定义。
    const fields = pageBriefLines(data);
    return ok({
      kind: "page.schemaBrief",
      data: { stage: chosen, fields },
      lines: [renderCopy(output.briefNote, { stage: chosen }), ...fields] as [string, ...string[]],
      next: [],
      warnings: [],
    });
  }
  // 标准输出只有这份定义，可以直接存成文件。
  const [first = "", ...rest] = JSON.stringify(data, null, 2).split("\n");
  return ok({ kind: "page.schema", data, lines: [first, ...rest], next: [], warnings: [] });
}

/** 一份能通过定义的最小页面数据。写了阶段就不需要项目和后端，没写取当前阶段。 */
async function example(
  ctx: CommandEnv,
  project: string | undefined,
  stageArgument: StageLabel | undefined,
): Promise<Outcome> {
  let label = stageArgument;
  if (label === undefined) {
    const picked = await stageOrCurrent(ctx, project, undefined);
    if (!picked.ok) return picked;
    label = picked.value.stage;
  }
  const data = pageExample(keyOfLabel[label]);
  // 标准输出只有这份数据，可以直接存成 page.json。
  const [first = "", ...rest] = JSON.stringify(data, null, 2).split("\n");
  return ok({ kind: "page.example", data, lines: [first, ...rest], next: [], warnings: [] });
}

/** 线稿积木的类名清单，一块一行，不需要项目和后端。 */
function blocks(): Outcome {
  const blockLines = Object.values(pageFieldCopy.sketchBlocks).map((entry) => renderCopy(entry));
  const [first = "", ...rest] = blockLines;
  return ok({
    kind: "page.blocks",
    data: { blocks: blockLines },
    lines: [first, ...rest],
    next: [],
    warnings: [],
  });
}

// ── 读页面数据和取截图、原文 ──

type Loaded = {
  readonly opened: OpenedProject;
  readonly round: RoundOf;
  readonly page: PageData;
  /** 报错里给人看的路径的起点：项目缓存，找不到项目缓存时是当前目录。 */
  readonly showBase: string;
};

async function load(
  ctx: CommandEnv,
  project: string | undefined,
  path: string | undefined,
  /** 给出一页前先把主线.md 的改动交成新的一版。只校验的 page check 不交。 */
  sync: boolean,
): Promise<Result<Loaded, ErrorBody>> {
  const opened = await openProject(ctx, project, { sync });
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const round = await currentRound(backend, pid);
  if (!round.ok) return round;
  if (round.value === undefined) return err(noRound());
  const root = local?.root ?? ctx.cwd;
  const cache = join(root, projectCacheDirName);
  // 报错里的路径从项目根写起，写成 .product-loop/rounds/<阶段的标识>/…，和 round start 打印的相同。
  const showBase = local === undefined ? ctx.cwd : root;
  const page = await readPageData({
    workspace: join(cache, "rounds", round.value.label),
    path,
    cwd: ctx.cwd,
    ...(local === undefined ? {} : { cache }),
    show: shownFrom(showBase),
    // 使用阶段的页由系统从最近一次运行填进去，页面数据可以不写，给出一页空页。
    ...(round.value.stage === stage.label("use") ? { whenMissing: {} } : {}),
  });
  if (!page.ok) return page;
  return ok({ opened: opened.value, round: round.value, page: page.value, showBase });
}

/** 后端给的位置是页面数据里的字段时，写成「文件 → 字段」。别的位置原样。 */
const fieldLike = /^[A-Za-z]+(?:\[\d+\]|\.|$)/u;

function locateIssues(issues: readonly Issue[], page: PageData): Issue[] {
  return issues.map((issue) =>
    issue.where !== undefined && fieldLike.test(issue.where)
      ? { ...issue, where: page.locate(issue.where) }
      : issue,
  );
}

function locateError(error: ErrorBody, page: PageData): ErrorBody {
  const [first, ...rest] = locateIssues(issuesOf(error), page);
  if (first === undefined) return error;
  return errorBody(error.code, [first, ...rest]);
}

// ── page check ──

async function check(
  ctx: CommandEnv,
  project: string | undefined,
  path: string | undefined,
): Promise<Outcome> {
  const loaded = await load(ctx, project, path, false);
  if (!loaded.ok) return loaded;
  const { opened, round, page, showBase } = loaded.value;
  const { backend, projectId: pid } = opened;
  const shownDir = `${shownFrom(showBase)(page.dir)}/`;
  // 只读：截图查在不在、算哈希，不上传；后端的 page check 不查截图是否已上传。
  const found = await checkImages({ ...page, shownDir });
  if (!found.ok) return found;
  const json = { round: round.label, data: page.data, images: [...found.value.images] };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].pages.check.$post({ param: { pid }, json }),
  );
  if (!result.ok) return err(locateError(result.error, page));
  const { data } = result.value;
  // 拦截和警告在后端按 issueSchema 编码过，类型经过 JSON 以后变宽了。
  const warnings = locateIssues(data.warn as readonly Issue[], page);
  const [first, ...rest] = locateIssues(data.block as readonly Issue[], page);
  if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
  // 数据没有拦截以后，文字来源的文件和行号也读一遍：检查通过的页，给出时不会再因为读不到原文失败。
  const excerpts = await readExcerpts({ ...page, root: opened.local?.root ?? ctx.cwd });
  if (!excerpts.ok) return excerpts;
  return ok({
    kind: "page.checked",
    data: { ...data, files: page.files },
    lines: [renderCopy(output.passed, { round: roundNameOfLabel(round.label) })],
    next: ["ploop page present"],
    warnings,
  });
}

// ── page present ──

async function present(
  ctx: CommandEnv,
  project: string | undefined,
  path: string | undefined,
  view: boolean,
): Promise<Outcome> {
  const loaded = await load(ctx, project, path, true);
  if (!loaded.ok) return loaded;
  const { opened, round, page, showBase } = loaded.value;
  const { backend, projectId: pid, local } = opened;
  const shownDir = `${shownFrom(showBase)(page.dir)}/`;
  const uploaded = await uploadImages(backend, { ...page, shownDir });
  if (!uploaded.ok) return uploaded;
  const excerpts = await readExcerpts({ ...page, root: local?.root ?? ctx.cwd });
  if (!excerpts.ok) return excerpts;
  const json = {
    round: round.label,
    data: page.data,
    ...(view ? { purpose: pagePurpose.label("view") } : {}),
    images: [...uploaded.value.images],
    excerpts: excerpts.value,
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].pages.$post({ param: { pid }, json }),
  );
  if (!result.ok) return err(locateError(result.error, page));
  const { data, warnings, next } = result.value;
  const url = addressOf(backend, data.path);
  return ok({
    kind: "page.presented",
    data: { ...data, url },
    lines: [
      renderCopy(output.presented, {
        page: pageNameOfLabel(data.page.round, data.page.seq),
        purpose: data.page.purpose,
      }),
      renderCopy(output.address, { url }),
      ...(data.page.purpose === pagePurpose.label("view") ? [renderCopy(output.viewOnly)] : []),
      renderCopy(output.cards, { count: data.cards }),
      ...(uploaded.value.images.length === 0
        ? []
        : [
            renderCopy(output.images, {
              uploaded: uploaded.value.uploaded,
              kept: uploaded.value.kept,
            }),
          ]),
      ...(excerpts.value.length === 0
        ? []
        : [renderCopy(output.excerpts, { count: excerpts.value.length })]),
    ],
    next,
    warnings: locateIssues(warnings, page),
  });
}

// ── page withdraw ──

const closeCommandText = "ploop round close";

async function withdraw(
  ctx: CommandEnv,
  project: string | undefined,
  reason: string | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  // 要用户点的页优先，其次是最近给出的只看的页，见约定 0001 第 20 条。
  const waiting = [...status.value.data.waitingPages].sort((a, b) =>
    b.presentedAt.localeCompare(a.presentedAt),
  );
  const target = waiting.find((page) => page.purpose === pagePurpose.label("ask")) ?? waiting.at(0);
  if (target === undefined) {
    const issue = {
      message: renderCopy(text.noWaiting.message),
      hint: renderCopy(text.noWaiting.hint),
    };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  const id = String(target.id);
  const json = reason === undefined ? {} : { reason };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].pages[":id"].withdraw.$post({ param: { pid, id }, json }),
  );
  if (!result.ok) return result;
  const { data, next } = result.value;
  return ok({
    kind: "page.withdrawn",
    data,
    lines: [
      renderCopy(output.withdrawn, { page: pageNameOfLabel(data.page.round, data.page.seq) }),
      ...(next.includes(closeCommandText) ? [renderCopy(output.withdrawnNote)] : []),
    ],
    next,
    warnings: [],
  });
}

// ── 挂上命令 ──

/** 挂上 ploop page 和它的五个子命令。 */
export function pageCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = pageCopy;
  const text = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("page").description(text(help.description));

  const schemaCommand = group
    .command("schema")
    .description(text(help.schema.description))
    .option("--stage <阶段名>", text(help.schema.stage), stageOption)
    .option("--brief", text(help.schema.briefOption))
    .option("--blocks", text(help.schema.blocksOption))
    .action(async (options, self) => {
      if (options.blocks === true) {
        context.settle(blocks());
        return;
      }
      context.settle(
        await schema(context, globalProject(self), options.stage, options.brief === true),
      );
    });
  withHelp(
    schemaCommand,
    helpOf({
      details: Object.values(help.schema.details),
      blocks: Object.values(help.schema.blocks),
      reads: help.schema.reads,
      writes: help.schema.writes,
      examples: Object.values(help.schema.examples),
      after: help.schema.after,
    }),
  );

  const exampleCommand = group
    .command("example")
    .description(text(help.example.description))
    .option("--stage <阶段名>", text(help.example.stage), stageOption)
    .action(async (options, self) => {
      context.settle(await example(context, globalProject(self), options.stage));
    });
  withHelp(
    exampleCommand,
    helpOf({
      details: Object.values(help.example.details),
      blocks: Object.values(help.example.blocks),
      reads: help.example.reads,
      writes: help.example.writes,
      examples: Object.values(help.example.examples),
      after: help.example.after,
    }),
  );

  const checkCommand = group
    .command("check")
    .description(text(help.check.description))
    .argument("[路径]", text(help.path))
    .action(async (path, _options, self) => {
      context.settle(await check(context, globalProject(self), path));
    });
  withHelp(
    checkCommand,
    helpOf({
      details: Object.values(help.check.details),
      blocks: Object.values(help.check.blocks),
      reads: help.check.reads,
      writes: help.check.writes,
      examples: Object.values(help.check.examples),
      after: help.check.after,
    }),
  );

  const presentCommand = group
    .command("present")
    .description(text(help.present.description))
    .argument("[路径]", text(help.path))
    .option("--view", text(help.present.view))
    .action(async (path, options, self) => {
      context.settle(await present(context, globalProject(self), path, options.view === true));
    });
  withHelp(
    presentCommand,
    helpOf({
      details: Object.values(help.present.details),
      blocks: Object.values(help.present.blocks),
      reads: help.present.reads,
      writes: help.present.writes,
      examples: Object.values(help.present.examples),
      after: help.present.after,
    }),
  );

  const withdrawCommand = group
    .command("withdraw")
    .description(text(help.withdraw.description))
    .option("--reason <原因>", text(help.withdraw.reason))
    .action(async (options, self) => {
      context.settle(await withdraw(context, globalProject(self), options.reason));
    });
  withHelp(
    withdrawCommand,
    helpOf({
      details: Object.values(help.withdraw.details),
      reads: help.withdraw.reads,
      writes: help.withdraw.writes,
      examples: Object.values(help.withdraw.examples),
      after: help.withdraw.after,
    }),
  );
}
