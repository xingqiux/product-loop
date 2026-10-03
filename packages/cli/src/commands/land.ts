import { mkdir, readFile, rmdir } from "node:fs/promises";
import { join } from "node:path";
import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  commandOutputTail,
  type ErrorBody,
  err,
  errorBody,
  formatCommand,
  type Issue,
  ok,
  parseRoundLabel,
  projectCacheDirName,
  type Result,
  renderCopy,
  roundNameOfLabel,
  useOutEnv,
  useRunFile,
  useRunOutputSchema,
} from "@product-loop/model";
import { type Backend, type CommandEnv, cliBuild } from "../connect.ts";
import { landCopy } from "../copy/land.ts";
import { changedFiles, commitsBetween, diffText, headCommit, queueIdsInCommits } from "../git.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import { type Shown, shownFrom } from "../page/data.ts";
import type { ProgramContext } from "../program.ts";
import { locateInput } from "../project/input-path.ts";
import { errnoOf, readFailure } from "../project/read-error.ts";
import { runCommand } from "../spawn.ts";
import { globalProject, helpOf, openProject, projectRoots, rootOf, utcStamp } from "./shared.ts";

// ploop land plan|tidy|red|green|review|status|diff，见「04 命令行」第十一节和 S18。
// 检查命令由命令行在当前所在的项目根目录里运行，提交号也从那里取，当前在哪个子目录不影响结果。
// 后端不跑命令，也不碰 git，运行记录、提交和改动的规模都由这里交给后端，见 core/land/steps.ts。
// 评审界线按这一批的改动算：从这个阶段开始时各个根目录的提交，到现在的工作区。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type LandRoute = Pid["rounds"][":rid"]["land"];
type Status = DataOf<Awaited<ReturnType<LandRoute["$get"]>>>;

const { output, errors: text } = landCopy;

/** 落地命令要的东西：连上的后端、项目、当前的落地阶段和项目缓存。 */
type LandContext = {
  readonly backend: Backend;
  readonly pid: string;
  /** 当前的阶段的标识，例如 v2-落地-3，只用在路径、网址和 --json 里。 */
  readonly round: string;
  /** 路径里的阶段标识，按 URL 的写法编码。 */
  readonly rid: string;
  /** 这个阶段的工作区。--project 写编号时没有项目缓存，按当前目录找。 */
  readonly workspace: string;
  /** 项目缓存：写了相对路径时，当前目录里找不到就按它找。 */
  readonly cache: string;
  readonly roots: readonly string[];
  /** 报错里给人看的路径：项目根目录下的写成 .product-loop/… 这样的相对路径。 */
  readonly show: Shown;
};

function issue(entry: { message: CopyEntry; hint: CopyEntry }): {
  message: string;
  hint: string;
} {
  return { message: renderCopy(entry.message), hint: renderCopy(entry.hint) };
}

async function landContext(
  ctx: CommandEnv,
  project: string | undefined,
): Promise<Result<LandContext, ErrorBody>> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  const current = status.value.data.round;
  const parsed = current === null ? undefined : parseRoundLabel(current.label);
  if (current === null || parsed === undefined || !parsed.ok || parsed.value.stage !== "land") {
    const entry = current === null ? text.noRound : text.notLand;
    const round = current === null ? "" : roundNameOfLabel(current.label);
    const body = {
      message: renderCopy(entry.message, { round }),
      hint: renderCopy(entry.hint),
    };
    return err(errorBody("CONFLICT", [body]));
  }
  const roots = await projectRoots(backend, pid);
  if (!roots.ok) return roots;
  const base = local?.root ?? ctx.cwd;
  return ok({
    backend,
    pid,
    round: current.label,
    rid: encodeURIComponent(current.label),
    workspace: join(base, projectCacheDirName, "rounds", current.label),
    cache: join(base, projectCacheDirName),
    roots: roots.value,
    show: shownFrom(base),
  });
}

/** 读一个文件。读不出来时报出路径和原因，退出码 4。 */
async function readText(
  file: string,
  show: Shown,
  tried: readonly string[] = [],
  notWritten?: { readonly message: CopyEntry; readonly hint: CopyEntry },
): Promise<Result<string, ErrorBody>> {
  try {
    return ok(await readFile(file, "utf8"));
  } catch (error) {
    const { kind, reason } = readFailure(error);
    // 默认位置的文件还没写：不说系统错误码，说明先写什么、再运行哪条命令。
    if (kind === "missing" && tried.length === 0 && notWritten !== undefined) {
      const body = {
        message: renderCopy(notWritten.message, { file: show(file) }),
        hint: renderCopy(notWritten.hint),
      };
      return err(errorBody("NOT_FOUND", [body]));
    }
    // 命令后面写的路径读不出来时，写明先后找过哪几个位置。
    const hint =
      tried.length > 1
        ? renderCopy(text.fileMissing.triedHint, { tried: tried.map(show).join("、") })
        : renderCopy(text.fileMissing.hint);
    const body = {
      message: renderCopy(text.fileMissing.message, { file: show(file), reason }),
      hint,
    };
    return err(errorBody("NOT_FOUND", [body]));
  }
}

// ── 运行检查命令 ──

/** 交给后端的一次运行。 */
type RunInput = {
  readonly command: [string, ...string[]];
  readonly cwd: string;
  readonly exitCode: number;
  readonly outputTail: string;
  readonly commit?: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly cliVersion: string;
};

/** 一次运行：交给后端的记录，和使用代码写出的结果里断了的那几步。 */
type Checked = { readonly run: RunInput; readonly broken: readonly string[] };

/** 最多列几步，多的写个数。 */
const brokenLimit = 5;

/**
 * 检查命令是使用代码时，它把结果写进 PLOOP_USE_OUT 指的目录。这里给它项目缓存里的一个目录，
 * 不再是随手建在系统临时目录里、过后找不到的那个；跑完读出断了的那几步。
 * 检查命令没写结果，就把空目录删掉。
 */
async function makeCheckOut(cache: string): Promise<string> {
  const parent = join(cache, "use");
  await mkdir(parent, { recursive: true });
  const stamp = `land-${utcStamp(new Date())}`;
  for (let n = 1; ; n += 1) {
    const dir = join(parent, n === 1 ? stamp : `${stamp}-${n}`);
    try {
      await mkdir(dir);
      return dir;
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") throw error;
    }
  }
}

async function brokenSteps(dir: string, show: Shown): Promise<string[]> {
  let source: string;
  try {
    source = await readFile(join(dir, useRunFile), "utf8");
  } catch {
    await rmdir(dir).catch(() => undefined);
    return [];
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return [];
  }
  const parsed = useRunOutputSchema.safeParse(data);
  if (!parsed.success) return [];
  const rows = parsed.data.scenes.flatMap(({ scene, steps }) =>
    steps
      .filter((step) => step.result !== "pass" && step.result !== "skipped")
      .map((step) =>
        renderCopy(output.brokenRow, { scene, step: step.step, error: step.error ?? "" }),
      ),
  );
  if (rows.length === 0) return [];
  const shown = rows.slice(0, brokenLimit);
  const rest = rows.length - shown.length;
  return [
    renderCopy(output.brokenHead, { file: show(join(dir, useRunFile)) }),
    ...shown,
    ...(rest > 0 ? [renderCopy(output.brokenMore, { count: rest })] : []),
  ];
}

/**
 * 在根目录里运行检查命令，不经过 shell。程序找不到时记退出码 127，不能执行时记 126，
 * 由后端判断「命令没有跑起来」。运行以后取这个根目录的 HEAD。
 */
async function runCheck(
  root: string,
  command: [string, ...string[]],
  cache: string,
  show: Shown,
): Promise<Checked> {
  const started = new Date();
  const out = await makeCheckOut(cache);
  const { exitCode, stdout, stderr } = await runCommand(command, {
    cwd: root,
    env: { ...process.env, [useOutEnv]: out },
  });
  const commit = await headCommit(root);
  const broken = await brokenSteps(out, show);
  const run: RunInput = {
    command,
    cwd: root,
    exitCode,
    outputTail: commandOutputTail(stdout, stderr),
    ...(commit === undefined ? {} : { commit }),
    startedAt: started.toISOString(),
    durationMs: Date.now() - started.getTime(),
    cliVersion: cliBuild,
  };
  return { run, broken };
}

/** 运行记录写成给人看的几行：命令、目录、输出的末尾，使用代码断了的步。 */
function runLines({ run, broken }: Checked, roots: readonly string[]): string[] {
  const command = formatCommand(run.command);
  const lines = [
    roots.length > 1
      ? renderCopy(output.ranIn, { command, cwd: run.cwd })
      : renderCopy(output.ran, { command }),
  ];
  if (run.outputTail !== "") {
    lines.push(renderCopy(output.tail), ...run.outputTail.split("\n").map((line) => `  ${line}`));
  }
  return [...lines, ...broken];
}

/** -- 后面写的检查命令。没写时报用法错误。 */
function commandOf(
  words: readonly string[],
  verb: string,
): Result<[string, ...string[]], ErrorBody> {
  const [program, ...args] = words;
  if (program !== undefined) return ok([program, ...args]);
  const body = {
    message: renderCopy(text.noCommand.message),
    hint: renderCopy(text.noCommand.hint, { verb }),
  };
  return err(errorBody("BAD_REQUEST", [body]));
}

// ── plan ──

async function plan(ctx: CommandEnv, project: string | undefined, file: string | undefined) {
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, workspace, show } = land.value;
  const path =
    file === undefined
      ? { path: join(workspace, "计划.md"), tried: [] }
      : await locateInput(ctx.cwd, land.value.cache, file);
  const planText = await readText(path.path, show, path.tried, text.planNotWritten);
  if (!planText.ok) return planText;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.plan.$put({
      param: { pid, rid },
      json: { text: planText.value },
    }),
  );
  if (!result.ok) return result;
  const { data, warnings, next } = result.value;
  return ok({
    kind: "land.planned",
    data,
    lines: [
      renderCopy(output.planned, {
        round: roundNameOfLabel(data.round),
        count: data.plan.changes.length,
      }),
    ] as [string],
    next,
    warnings,
  });
}

// ── tidy ──

async function tidy(
  ctx: CommandEnv,
  project: string | undefined,
  skip: boolean,
  words: readonly string[],
): Promise<Outcome> {
  if (skip && words.length > 0) return err(errorBody("BAD_REQUEST", [issue(text.skipWithCommand)]));
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, roots, cache, show } = land.value;
  let checked: Checked | undefined;
  if (!skip) {
    const command = commandOf(words, "tidy");
    if (!command.ok) return command;
    const root = rootOf(ctx.cwd, roots, text.outsideRoot);
    if (!root.ok) return root;
    checked = await runCheck(root.value, command.value, cache, show);
  }
  const json = checked === undefined ? { skip: true as const } : { run: checked.run };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.tidy.$post({ param: { pid, rid }, json }),
  );
  if (!result.ok) return result;
  const { data, next } = result.value;
  const first =
    data.tidy.run === null
      ? renderCopy(output.tidySkipped, { reason: data.tidy.reason ?? "" })
      : renderCopy(output.tidied, { commit: (data.tidy.run.commit ?? "").slice(0, 7) });
  return ok({
    kind: "land.tidied",
    data,
    lines: [first, ...(checked === undefined ? [] : runLines(checked, roots))],
    next,
    warnings: [],
  });
}

// ── red 和 green ──

async function red(
  ctx: CommandEnv,
  project: string | undefined,
  name: string,
  words: readonly string[],
): Promise<Outcome> {
  const command = commandOf(words, `red ${name}`);
  if (!command.ok) return command;
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, roots, cache, show } = land.value;
  const root = rootOf(ctx.cwd, roots, text.outsideRoot);
  if (!root.ok) return root;
  const checked = await runCheck(root.value, command.value, cache, show);
  const { run } = checked;
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.changes[":name"].red.$post({
      param: { pid, rid, name: encodeURIComponent(name) },
      json: { run },
    }),
  );
  if (!result.ok) return err(withRun(result.error, checked));
  const { data, warnings, next } = result.value;
  return ok({
    kind: "land.red",
    data,
    lines: [
      renderCopy(output.red, { name: data.change.name, exitCode: run.exitCode }),
      ...runLines(checked, roots),
    ],
    next,
    warnings,
  });
}

/** 被拦下的一次运行，报错后面附上运行的输出，AI 才知道检查命令说了什么。 */
function withRun(error: ErrorBody, { run, broken }: Checked): ErrorBody {
  const tail = run.outputTail === "" ? [] : [renderCopy(output.tail), run.outputTail];
  const more = [...tail, ...broken];
  return more.length === 0 ? error : { ...error, message: [error.message, ...more].join("\n") };
}

async function green(
  ctx: CommandEnv,
  project: string | undefined,
  name: string,
  words: readonly string[],
): Promise<Outcome> {
  const command = commandOf(words, `green ${name}`);
  if (!command.ok) return command;
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, roots, cache, show } = land.value;
  const root = rootOf(ctx.cwd, roots, text.outsideRoot);
  if (!root.ok) return root;
  const status = await landStatus(backend, pid, rid);
  if (!status.ok) return status;
  const change = status.value.data.changes.find((entry) => entry.name === name.trim());
  const redCommit = change?.red?.commit ?? null;
  const checked = await runCheck(root.value, command.value, cache, show);
  const { run } = checked;
  const after =
    redCommit === null || run.commit === undefined
      ? []
      : await commitsBetween(root.value, redCommit, run.commit);
  const queue = await queueIdsInCommits(root.value, after);
  // 这一批改到的文件一起交去：全部功能改动都通过、改动在评审界线以内时，评审自动跳过。
  const bases = await baseCommits(backend, pid, rid);
  if (!bases.ok) return bases;
  const changed = (
    await Promise.all(bases.value.map(({ root, commit }) => changedFiles(root, commit)))
  ).flat();
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.changes[":name"].green.$post({
      param: { pid, rid, name: encodeURIComponent(name) },
      json: { run, commitsAfterRed: after, changed, ...(queue.length === 0 ? {} : { queue }) },
    }),
  );
  if (!result.ok) return err(withRun(result.error, checked));
  const { data, warnings, next } = result.value;
  return ok({
    kind: "land.green",
    data,
    lines: [
      renderCopy(output.green, {
        name: data.change.name,
        commit: (data.change.commit ?? "").slice(0, 7),
      }),
      ...runLines(checked, roots),
      ...(data.reviewSkipped === null
        ? []
        : [
            renderCopy(output.reviewAuto, {
              lines: data.reviewSkipped.lines,
              files: data.reviewSkipped.files,
            }),
          ]),
    ],
    next,
    warnings,
  });
}

function landStatus(backend: Backend, pid: string, rid: string) {
  return backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.$get({ param: { pid, rid } }),
  );
}

// ── review ──

/** 这个阶段开始时各个根目录的提交。 */
async function baseCommits(
  backend: Backend,
  pid: string,
  rid: string,
): Promise<Result<readonly { root: string; commit: string }[], ErrorBody>> {
  const detail = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].$get({ param: { pid, rid } }),
  );
  if (!detail.ok) return detail;
  return ok(detail.value.data.baseCommits ?? []);
}

type Opinion = {
  file: string;
  line: number;
  level: "阻塞" | "建议";
  text: string;
  disposition?: string;
};

/** 评审意见的文件读不成意见的列表，按这条规矩拦截：意见没法指到文件和行。 */
const reviewFileRule = "land.review.located";

/** 评审意见的文件：意见的列表，或者带 opinions 的对象。写法由后端细查。 */
function opinionsOf(source: string): Opinion[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return undefined;
  }
  const list = Array.isArray(value) ? value : (value as { opinions?: unknown } | null)?.opinions;
  return Array.isArray(list) ? (list as Opinion[]) : undefined;
}

async function review(
  ctx: CommandEnv,
  project: string | undefined,
  options: { readonly skip?: string | undefined; readonly file?: string | undefined },
): Promise<Outcome> {
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, workspace, show } = land.value;
  const bases = await baseCommits(backend, pid, rid);
  if (!bases.ok) return bases;
  const changed = (
    await Promise.all(bases.value.map(({ root, commit }) => changedFiles(root, commit)))
  ).flat();
  let json:
    | { skip: string; changed: typeof changed }
    | { opinions: Opinion[]; changed: typeof changed };
  if (options.skip !== undefined) {
    json = { skip: options.skip, changed };
  } else {
    const located =
      options.file === undefined
        ? { path: join(workspace, "review.json"), tried: [] }
        : await locateInput(ctx.cwd, land.value.cache, options.file);
    const path = located.path;
    const source = await readText(path, show, located.tried, text.reviewNotWritten);
    if (!source.ok) return source;
    const opinions = opinionsOf(source.value);
    if (opinions === undefined) {
      // 文件的内容不对，和页面数据写坏一样退出码 1。
      const body = { ...issue(text.reviewFile), rule: reviewFileRule, where: show(path) };
      return err(errorBody("RULE_BLOCKED", [body]));
    }
    json = { opinions, changed };
  }
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].rounds[":rid"].land.review.$post({ param: { pid, rid }, json }),
  );
  if (!result.ok) return result;
  const { data, next } = result.value;
  const opinions = data.review.opinions ?? [];
  const first =
    data.review.diff !== null && options.skip !== undefined
      ? renderCopy(output.reviewSkipped, {
          lines: data.review.diff.lines,
          files: data.review.diff.files,
        })
      : renderCopy(output.reviewed, {
          block: opinions.filter((o) => o.level === "阻塞").length,
          suggest: opinions.filter((o) => o.level === "建议").length,
        });
  return ok({ kind: "land.reviewed", data, lines: [first], next, warnings: [] });
}

// ── status ──

/** 五步的状态写成文字。 */
function statusLines(data: Status): [string, ...string[]] {
  const planState =
    data.plan === null
      ? renderCopy(output.planMissing)
      : renderCopy(output.planDone, { count: data.plan.changes.length });
  const tidyState =
    data.tidy.state === "跳过了" && data.tidy.reason !== null
      ? `${data.tidy.state}：${data.tidy.reason}`
      : data.tidy.state;
  const diff = data.review.diff;
  return [
    renderCopy(output.statusHead, { round: roundNameOfLabel(data.round) }),
    renderCopy(output.planLine, { state: planState }),
    renderCopy(output.tidyLine, { state: tidyState }),
    ...(data.changes.length === 0
      ? []
      : [
          renderCopy(output.changesHead),
          ...data.changes.map((change) =>
            renderCopy(output.changeRow, {
              name: change.name,
              state: change.state,
              commit:
                change.commit === null
                  ? ""
                  : renderCopy(output.changeCommit, { commit: change.commit.slice(0, 7) }),
            }),
          ),
        ]),
    renderCopy(output.reviewLine, {
      state: data.review.state,
      detail:
        diff === null
          ? ""
          : renderCopy(output.reviewDiff, { lines: diff.lines, files: diff.files }),
    }),
    ...(data.missing.length === 0
      ? [renderCopy(output.complete)]
      : [
          renderCopy(output.missingHead),
          // 缺的地方在后端按 issueSchema 编码过，类型经过 JSON 以后变宽了。
          ...(data.missing as readonly Issue[]).map((entry) =>
            renderCopy(output.missingRow, { message: entry.message }),
          ),
        ]),
  ];
}

async function status(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid } = land.value;
  const result = await landStatus(backend, pid, rid);
  if (!result.ok) return result;
  const { data, next } = result.value;
  return ok({ kind: "land.status", data, lines: statusLines(data), next, warnings: [] });
}

// ── diff ──

/**
 * 「查什么」：计划里这件改动的说明。去掉标题或列表项那一行，去掉检查命令那一句，
 * 只留说明的文字。什么都没剩时用整段说明。
 */
export function whatItChecks(name: string, text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const [head, ...rest] = lines;
  const isHead =
    head !== undefined &&
    (/^#{1,6}\s/u.test(head) || /^(?:[-*+]|\d+[.、)])\s/u.test(head) || head.includes(name));
  const body = (isHead ? rest : lines).join(" ");
  const cleaned = body
    .replace(/检查命令[:：]\s*[^，。\n]+[，。]?/gu, "")
    .replace(/检查\s*`[^`]+`[，。]?/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned === "" ? text.replace(/\s+/gu, " ").trim() : cleaned;
}

function whatLines(name: string, text: string): string[] {
  return [renderCopy(output.diffWhat, { text: whatItChecks(name, text) })];
}

async function diff(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const land = await landContext(ctx, project);
  if (!land.ok) return land;
  const { backend, pid, rid, round, roots } = land.value;
  const result = await landStatus(backend, pid, rid);
  if (!result.ok) return result;
  const bases = await baseCommits(backend, pid, rid);
  if (!bases.ok) return bases;
  const { changes, plan: planned } = result.value.data;
  const lines: string[] = [renderCopy(output.diffHead, { round: roundNameOfLabel(round) })];
  for (const change of changes) {
    const what = planned?.changes.find((entry) => entry.name === change.name)?.text;
    lines.push(
      renderCopy(output.diffChange, { name: change.name }),
      change.red === null
        ? renderCopy(output.diffNoCommand)
        : renderCopy(output.diffCommand, { command: formatCommand(change.red.command) }),
      ...(what === undefined ? [] : whatLines(change.name, what)),
    );
  }
  for (const root of roots) {
    const base = bases.value.find((entry) => entry.root === root)?.commit;
    if (base === undefined) {
      lines.push(
        "",
        roots.length === 1
          ? renderCopy(output.diffNoBaseOne)
          : renderCopy(output.diffNoBase, { root }),
      );
      continue;
    }
    lines.push(
      "",
      roots.length === 1
        ? renderCopy(output.diffOne, { base: base.slice(0, 7) })
        : renderCopy(output.diffRoot, { root, base: base.slice(0, 7) }),
    );
    const text = (await diffText(root, base)).trimEnd();
    if (text !== "") lines.push(...text.split("\n"));
  }
  const [first = "", ...rest] = lines;
  return ok({
    kind: "land.diff",
    data: { round, changes: changes.map((c) => c.name) },
    lines: [first, ...rest],
    next: [renderCopy(landCopy.help.diff.after)],
    warnings: [],
  });
}

// ── 挂上命令 ──

/** 挂上 ploop land 和它的七个子命令。 */
export function landCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = landCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("land").description(t(help.description));
  const helpFor = (entry: {
    details?: Record<string, CopyEntry>;
    blocks?: Record<string, { situation: CopyEntry; fix: CopyEntry }>;
    reads: CopyEntry;
    writes: CopyEntry;
    examples: Record<string, CopyEntry>;
    after: CopyEntry;
  }) =>
    helpOf({
      ...(entry.details === undefined ? {} : { details: Object.values(entry.details) }),
      ...(entry.blocks === undefined ? {} : { blocks: Object.values(entry.blocks) }),
      reads: entry.reads,
      writes: entry.writes,
      examples: Object.values(entry.examples),
      after: entry.after,
    });

  const planCommand = group
    .command("plan")
    .description(t(help.plan.description))
    .argument("[文件]", t(help.plan.file))
    .action(async (file, _options, self) => {
      context.settle(await plan(context, globalProject(self), file));
    });
  withHelp(planCommand, helpFor(help.plan));

  const tidyCommand = group
    .command("tidy")
    .description(t(help.tidy.description))
    .option("--skip", t(help.tidy.skip))
    .argument("[命令...]", t(help.command))
    .action(async (words, options, self) => {
      context.settle(await tidy(context, globalProject(self), options.skip === true, words));
    });
  withHelp(tidyCommand, helpFor(help.tidy));

  const redCommand = group
    .command("red")
    .description(t(help.red.description))
    .argument("<名字>", t(help.name))
    .argument("[命令...]", t(help.command))
    .action(async (name, words, _options, self) => {
      context.settle(await red(context, globalProject(self), name, words));
    });
  withHelp(redCommand, helpFor(help.red));

  const greenCommand = group
    .command("green")
    .description(t(help.green.description))
    .argument("<名字>", t(help.name))
    .argument("[命令...]", t(help.command))
    .action(async (name, words, _options, self) => {
      context.settle(await green(context, globalProject(self), name, words));
    });
  withHelp(greenCommand, helpFor(help.green));

  const reviewCommand = group
    .command("review")
    .description(t(help.review.description))
    .option("--file <文件>", t(help.review.file))
    .option("--skip <理由>", t(help.review.skip))
    .action(async (options, self) => {
      context.settle(await review(context, globalProject(self), options));
    });
  withHelp(reviewCommand, helpFor(help.review));

  const statusCommand = group
    .command("status")
    .description(t(help.status.description))
    .action(async (_options, self) => {
      context.settle(await status(context, globalProject(self)));
    });
  withHelp(statusCommand, helpFor(help.status));

  const diffCommand = group
    .command("diff")
    .description(t(help.diff.description))
    .action(async (_options, self) => {
      context.settle(await diff(context, globalProject(self)));
    });
  withHelp(diffCommand, helpFor(help.diff));
}
