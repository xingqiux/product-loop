import { mkdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  commandOutputTail,
  defaultCoveragePath,
  type ErrorBody,
  err,
  errorBody,
  exitCode,
  formatCommand,
  type Issue,
  ok,
  parseCoverage,
  projectCacheDirName,
  type RepoKind,
  type Result,
  renderCopy,
  useOutEnv,
  useRunFile,
  useRunOutputSchema,
} from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { useCopy } from "../copy/use.ts";
import { headCommit } from "../git.ts";
import { inGroup, withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import { uploadImages } from "../page/assets.ts";
import type { ProgramContext } from "../program.ts";
import { errnoOf, programFailure, readFailure } from "../project/read-error.ts";
import { runCommand } from "../spawn.ts";
import {
  globalProject,
  helpOf,
  maxWidth,
  openProject,
  padWidth,
  projectInfo,
  rootOf,
  utcStamp,
} from "./shared.ts";

// ploop use run|ingest|coverage|changed|schema，见「04 命令行」第十一节、「09 skill 与软件」第四节和 S19。
// 使用代码在当前所在的根目录里运行。命令行给它一个输出目录，放在项目缓存的 use/<时间>/ 下，
// 由环境变量 PLOOP_USE_OUT 指定。使用代码把 use-run.json 和截图写进去，命令行读出来，
// 先上传截图，再连同覆盖表的全文交给后端。覆盖表默认在使用代码的文件夹里，
// 自己的仓库是 scripts/use/，共用的仓库是 .product-loop/use-code/，见决定 107。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type ScreenList = DataOf<Awaited<ReturnType<Pid["screens"]["changed"]["$get"]>>>;
type RunView = NonNullable<DataOf<Awaited<ReturnType<Pid["use-runs"]["latest"]["$get"]>>>>;

const { output, errors: text } = useCopy;

const reasonOf = (error: unknown) => readFailure(error).reason;

function issue(entry: { message: CopyEntry; hint: CopyEntry }): Issue {
  return { message: renderCopy(entry.message), hint: renderCopy(entry.hint) };
}

/** 使用命令要的东西：连上的后端、项目、当前所在的根目录和项目缓存所在的目录。 */
type UseContext = {
  readonly backend: Backend;
  readonly pid: string;
  readonly root: string;
  /** 项目有几个根目录。 */
  readonly rootCount: number;
  /** 仓库是自己的还是共用的，决定覆盖表默认放在哪里。 */
  readonly repo: RepoKind;
  /** 项目缓存所在的目录。--project 写编号时没有项目缓存，用当前所在的根目录。 */
  readonly base: string;
};

/** run 和 ingest 收进的运行要对照最新的主线，先同步主线。 */
async function useContext(
  ctx: CommandEnv,
  project: string | undefined,
  sync = false,
): Promise<Result<UseContext, ErrorBody>> {
  const opened = await openProject(ctx, project, { sync });
  if (!opened.ok) return opened;
  const { backend, projectId: pid, local } = opened.value;
  const info = await projectInfo(backend, pid);
  if (!info.ok) return info;
  const root = rootOf(ctx.cwd, info.value.roots, text.outsideRoot);
  if (!root.ok) return root;
  return ok({
    backend,
    pid,
    root: root.value,
    rootCount: info.value.roots.length,
    repo: info.value.repo,
    base: local?.root ?? root.value,
  });
}

// ── 覆盖表 ──

type CoverageFile = {
  /** 写给人看的路径，相对根目录。 */
  readonly shown: string;
  /** 全文。文件不在时为 undefined。 */
  readonly text: string | undefined;
};

/**
 * 读覆盖表。写了 --coverage 却读不出来，报错，退出码 4。
 * 没写时读默认的位置，跟着仓库是谁的走，不在就返回 text 为 undefined，由调用的一方决定怎么办。
 */
async function readCoverage(
  uc: UseContext,
  option: string | undefined,
): Promise<Result<CoverageFile, ErrorBody>> {
  const { root } = uc;
  const file = resolve(root, option ?? defaultCoveragePath(uc.repo));
  const shown = relative(root, file) || file;
  try {
    return ok({ shown, text: await readFile(file, "utf8") });
  } catch (error) {
    if (option === undefined) return ok({ shown, text: undefined });
    const body = {
      message: renderCopy(text.coverageMissing.message, { file: shown, reason: reasonOf(error) }),
      hint: renderCopy(text.coverageMissing.hint),
      where: shown,
    };
    return err(errorBody("NOT_FOUND", [body]));
  }
}

// ── 收下一次运行 ──

/** ploop use run 另外交给后端的：命令、退出码和量到的时间。 */
type RunExtra = {
  readonly command: string[];
  readonly exitCode: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outputTail: string;
};

/** 使用代码没写出结果、或写出的结果不对，按这两条规矩拦截，退出码都是 1，和断了的步一样。 */
const crashedRule = "use.run.crashed";
const formatRule = "use.run.format";

/** 使用代码跑完了却没写 use-run.json：说它自己的退出码，并附上输出的末尾。 */
function notWritten(extra: RunExtra, shown: string): Issue {
  const entry = extra.exitCode === 0 ? text.noFile : text.crashed;
  const head = renderCopy(entry.message, { exitCode: extra.exitCode, file: shown });
  const tail =
    extra.outputTail === "" ? [] : [renderCopy(output.tail), ...indented(extra.outputTail)];
  return { rule: crashedRule, message: [head, ...tail].join("\n"), hint: renderCopy(entry.hint) };
}

const indented = (tail: string) => tail.split("\n").map((line) => `  ${line}`);

/**
 * 读输出目录里的 use-run.json。文件不存在退出码 4；使用代码没写出它、写出的不合格式，
 * 都是内容不对，退出码 1。位置不重复消息里已有的路径。
 */
async function readOutput(
  dir: string,
  shownDir: string,
  extra: RunExtra | undefined,
): Promise<Result<unknown, ErrorBody>> {
  const file = join(dir, useRunFile);
  const shown = `${shownDir}${useRunFile}`;
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    // ploop use run 跑过使用代码：没有 use-run.json 时，真正的原因是使用代码自己的退出码和输出。
    if (extra !== undefined) return err(errorBody("RULE_BLOCKED", [notWritten(extra, shown)]));
    const body = {
      message: renderCopy(text.noOutput.message, { file: shown, reason: reasonOf(error) }),
      hint: renderCopy(text.noOutput.hint),
    };
    return err(errorBody("NOT_FOUND", [body]));
  }
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const body = {
      rule: formatRule,
      message: renderCopy(text.badJson.message, { file: shown, reason }),
      hint: renderCopy(text.badJson.hint),
    };
    return err(errorBody("RULE_BLOCKED", [body]));
  }
  // 先在本地按共用定义查一遍，截图的路径才靠得住。交给后端的仍是文件原样。
  const parsed = useRunOutputSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((found) => {
      const where = found.path
        .map((part, i) =>
          typeof part === "number" ? `[${part}]` : i === 0 ? String(part) : `.${String(part)}`,
        )
        .join("");
      return {
        rule: formatRule,
        message: renderCopy(text.format.message, { where: where || "根", reason: found.message }),
        hint: renderCopy(text.format.hint),
        where: shown,
      };
    });
    const [first, ...rest] = issues;
    if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
  }
  return ok(data);
}

/** 断了的步和环境问题的步，各列一段。 */
function stepLines(view: RunView | null): string[] {
  if (view === null) return [];
  const section = (result: string, head: CopyEntry) => {
    const rows = view.scenes.flatMap((scene) =>
      scene.steps
        .filter((step) => step.result === result)
        .map((step) =>
          renderCopy(output.stepRow, {
            scene: scene.scene,
            step: step.step,
            width: step.width === null ? "" : renderCopy(output.width, { width: step.width }),
            error: step.error ?? "",
          }),
        ),
    );
    return rows.length === 0 ? [] : [renderCopy(head), ...rows];
  };
  return [...section("断了", output.brokenHead), ...section("环境", output.environmentHead)];
}

/**
 * 读 use-run.json、上传截图、读覆盖表，交给后端。
 * dir 是输出目录，shownDir 是写给人看的输出目录，以斜杠结尾。
 */
async function ingestDir(
  uc: UseContext,
  dir: string,
  shownDir: string,
  coverageOption: string | undefined,
  extra: RunExtra | undefined,
): Promise<Outcome> {
  const { backend, pid, root, rootCount } = uc;
  const data = await readOutput(dir, shownDir, extra);
  if (!data.ok) return data;
  const uploaded = await uploadImages(backend, {
    data: data.value,
    dir,
    shownDir,
    locate: (where) => `${shownDir}${useRunFile} → ${where}`,
    field: "screenshot",
  });
  if (!uploaded.ok) return uploaded;
  const coverage = await readCoverage(uc, coverageOption);
  if (!coverage.ok) return coverage;
  const commit = await headCommit(root);
  const json = {
    output: data.value as never,
    screenshots: [...uploaded.value.images],
    ...(extra === undefined
      ? {}
      : {
          command: extra.command,
          exitCode: extra.exitCode,
          startedAt: extra.startedAt,
          finishedAt: extra.finishedAt,
        }),
    ...(commit === undefined ? {} : { commit }),
    ...(coverage.value.text === undefined ? {} : { coverage: coverage.value.text }),
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"]["use-runs"].$post({ param: { pid }, json }),
  );
  if (!result.ok) return result;
  const { data: ingested, warnings, next } = result.value;
  const latest = await backend.call((api) =>
    api.api.v1.projects[":pid"]["use-runs"].latest.$get({ param: { pid } }),
  );
  const view = latest.ok ? latest.value.data : null;
  const { results } = ingested.run;
  const counts = { pass: results.pass, broken: results.broken };
  const lines: string[] = [
    extra === undefined
      ? renderCopy(output.ingested, { dir: shownDir, ...counts })
      : renderCopy(output.ran, counts),
  ];
  if (extra !== undefined) {
    lines.push(
      rootCount > 1
        ? renderCopy(output.commandIn, {
            command: formatCommand(extra.command),
            cwd: root,
            exitCode: extra.exitCode,
          })
        : renderCopy(output.command, {
            command: formatCommand(extra.command),
            exitCode: extra.exitCode,
          }),
      renderCopy(output.out, { dir: shownDir }),
    );
  }
  if (results.skipped + results.environment > 0) {
    lines.push(renderCopy(output.counts, results));
  }
  lines.push(...stepLines(view));
  if (ingested.unreached.length > 0) {
    const count = ingested.unreached.reduce((sum, gap) => sum + gap.steps.length, 0);
    lines.push(
      renderCopy(output.unreachedHead, { count }),
      ...ingested.unreached.map((gap) =>
        renderCopy(output.unreachedRow, { scene: gap.scene, steps: gap.steps.join("、") }),
      ),
    );
  }
  lines.push(renderCopy(output.shots, uploaded.value));
  lines.push(
    renderCopy(output.newScreens, {
      count: ingested.newScreens.length,
      changed: ingested.changedScreens.length,
    }),
  );
  const coverageWarnings: Issue[] = [];
  if (coverage.value.text === undefined) {
    lines.push(renderCopy(output.coverageNone, { file: coverage.value.shown }));
    coverageWarnings.push({
      message: renderCopy(text.coverageMissing.message, {
        file: coverage.value.shown,
        reason: "ENOENT",
      }),
      hint: renderCopy(text.coverageMissing.hint),
    });
  } else {
    const parsed = parseCoverage(coverage.value.text);
    lines.push(
      renderCopy(output.coverageSent, {
        file: coverage.value.shown,
        rows: parsed.rows.length,
        gaps: parsed.gaps.length,
      }),
    );
  }
  if (ingested.page !== null) lines.push(renderCopy(output.pageShown, { page: ingested.page }));
  if (extra !== undefined && extra.exitCode !== 0 && extra.outputTail !== "") {
    lines.push(renderCopy(output.tail), ...indented(extra.outputTail));
  }
  const [first = "", ...rest] = lines;
  return ok({
    kind: extra === undefined ? "use.ingested" : "use.ran",
    data: { ...ingested, outDir: shownDir },
    lines: [first, ...rest],
    next,
    warnings: [...warnings, ...coverageWarnings],
    ...(results.broken > 0 || ingested.unreached.length > 0 ? { exit: exitCode.blocked } : {}),
  });
}

async function makeOutDir(base: string): Promise<{ dir: string; shown: string }> {
  const stamp = utcStamp(new Date());
  const parent = join(base, projectCacheDirName, "use");
  await mkdir(parent, { recursive: true });
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? stamp : `${stamp}-${n}`;
    const dir = join(parent, name);
    try {
      await mkdir(dir);
      return { dir, shown: `${projectCacheDirName}/use/${name}/` };
    } catch (error) {
      if (errnoOf(error) !== "EEXIST") throw error;
    }
  }
}

async function run(
  ctx: CommandEnv,
  project: string | undefined,
  words: readonly string[],
  coverageOption: string | undefined,
): Promise<Outcome> {
  const [program, ...args] = words;
  if (program === undefined) return err(errorBody("BAD_REQUEST", [issue(text.noCommand)]));
  const uc = await useContext(ctx, project, true);
  if (!uc.ok) return uc;
  const out = await makeOutDir(uc.value.base);
  const command: [string, ...string[]] = [program, ...args];
  const startedAt = new Date().toISOString();
  const spawned = await runCommand(command, {
    cwd: uc.value.root,
    env: { ...process.env, [useOutEnv]: out.dir },
  });
  const finishedAt = new Date().toISOString();
  if (spawned.notStarted !== undefined) {
    const body = {
      message: renderCopy(text.notStarted.message, {
        reason: programFailure(spawned.notStarted).reason,
      }),
      hint: renderCopy(text.notStarted.hint),
    };
    return err(errorBody("NOT_FOUND", [body]));
  }
  return ingestDir(uc.value, out.dir, out.shown, coverageOption, {
    command,
    exitCode: spawned.exitCode,
    startedAt,
    finishedAt,
    outputTail: commandOutputTail(spawned.stdout, spawned.stderr),
  });
}

async function ingest(
  ctx: CommandEnv,
  project: string | undefined,
  dirArgument: string,
  coverageOption: string | undefined,
): Promise<Outcome> {
  const uc = await useContext(ctx, project, true);
  if (!uc.ok) return uc;
  const dir = resolve(ctx.cwd, dirArgument);
  const shown = dirArgument.endsWith("/") ? dirArgument : `${dirArgument}/`;
  return ingestDir(uc.value, dir, shown, coverageOption, undefined);
}

// ── 覆盖表和屏 ──

async function coverage(
  ctx: CommandEnv,
  project: string | undefined,
  option: string | undefined,
): Promise<Outcome> {
  const uc = await useContext(ctx, project);
  if (!uc.ok) return uc;
  const file = await readCoverage(uc.value, option ?? defaultCoveragePath(uc.value.repo));
  if (!file.ok) return file;
  const parsed = parseCoverage(file.value.text ?? "");
  const gaps = parsed.gaps.map((gap) => ({
    rule: "use.leave",
    message: renderCopy(text.gap.message, { line: gap.line, item: gap.item }),
    hint: renderCopy(text.gap.hint),
    where: `${file.value.shown}:${gap.line}`,
  }));
  const [first, ...rest] = gaps;
  if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
  return ok({
    kind: "use.coverage",
    data: { file: file.value.shown, rows: parsed.rows, gaps: [] },
    lines: [renderCopy(output.coverageFull, { file: file.value.shown, rows: parsed.rows.length })],
    next: [],
    warnings: [],
  });
}

/** 屏按场景分组的几行：场景编号和名字对齐，后面写步号，同一步的几个宽度只写一次。 */
export function screenRows(list: ScreenList): string[] {
  const labels = list.scenes.map((scene) =>
    scene.name === null ? scene.scene : `${scene.scene} ${scene.name}`,
  );
  const width = maxWidth(labels) + 4;
  return list.scenes.map((scene, i) => {
    const steps = [...new Set(scene.screens.map((screen) => screen.step))];
    return renderCopy(output.sceneRow, {
      scene: padWidth(labels[i] ?? scene.scene, width),
      steps: renderCopy(output.steps, { steps: steps.join("、") }),
    });
  });
}

/** 产品的第几版：从 1 起的整数。写得不对是用法错误，写明该怎么写。 */
function versionNumber(value: string): number {
  if (/^[1-9]\d*$/u.test(value)) return Number(value);
  throw new InvalidArgumentError(renderCopy(useCopy.help.changed.versionInvalid));
}

async function changed(
  ctx: CommandEnv,
  project: string | undefined,
  options: { readonly productVersion?: number | undefined; readonly all?: boolean | undefined },
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const query = {
    ...(options.productVersion === undefined ? {} : { version: String(options.productVersion) }),
    ...(options.all === true ? { all: "true" as const } : {}),
  };
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].screens.changed.$get({ param: { pid }, query }),
  );
  if (!result.ok) return result;
  const { data } = result.value;
  const all = options.all === true;
  const empty = data.scenes.length === 0;
  const head = empty
    ? renderCopy(all ? output.allNone : output.changedNone, { version: data.version })
    : renderCopy(all ? output.allHead : output.changedHead, { version: data.version });
  return ok({
    kind: "use.changed",
    data,
    lines: [head, ...screenRows(data)],
    next: [],
    warnings: [],
  });
}

async function schema(ctx: CommandEnv, project: string | undefined): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const result = await opened.value.backend.call((api) => api.api.v1.schema["use-run"].$get());
  if (!result.ok) return result;
  // 日期时间字段的正则太长，model 生成这份定义时已经去掉，只留 format。
  const { data } = result.value;
  // 标准输出只有这份定义，可以直接存成文件。
  const [first = "", ...rest] = JSON.stringify(data, null, 2).split("\n");
  return ok({ kind: "use.schema", data, lines: [first, ...rest], next: [], warnings: [] });
}

// ── 挂上命令 ──

/** 挂上 ploop use 和它的五个子命令。 */
export function useCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = useCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("use").description(t(help.description));
  const helpFor = (
    entry: {
      details?: Record<string, CopyEntry>;
      blocks?: Record<string, { situation: CopyEntry; fix: CopyEntry }>;
      reads: CopyEntry;
      writes: CopyEntry;
      examples: Record<string, CopyEntry>;
      after: CopyEntry | Record<string, CopyEntry>;
    },
    more: readonly CopyEntry[] = [],
  ) =>
    helpOf({
      details: [...Object.values(entry.details ?? {}), ...more],
      ...(entry.blocks === undefined ? {} : { blocks: Object.values(entry.blocks) }),
      reads: entry.reads,
      writes: entry.writes,
      examples: Object.values(entry.examples),
      after: entry.after,
    });

  const runCommandLine = group
    .command("run")
    .description(t(help.run.description))
    .option("--coverage <文件>", t(help.coverageFile))
    .argument("[命令...]", t(help.run.command))
    .action(async (words, options, self) => {
      context.settle(await run(context, globalProject(self), words, options.coverage));
    });
  withHelp(runCommandLine, helpFor(help.run, Object.values(help.coverageDetails)));

  const ingestCommand = group
    .command("ingest")
    .description(t(help.ingest.description))
    .option("--coverage <文件>", t(help.coverageFile))
    .argument("<目录>", t(help.ingest.dir))
    .action(async (dir, options, self) => {
      context.settle(await ingest(context, globalProject(self), dir, options.coverage));
    });
  withHelp(
    inGroup(ingestCommand, "transitional"),
    helpFor(help.ingest, Object.values(help.coverageDetails)),
  );

  const coverageCommand = group
    .command("coverage")
    .description(t(help.coverage.description))
    .option("--coverage <文件>", t(help.coverageFile))
    .action(async (options, self) => {
      context.settle(await coverage(context, globalProject(self), options.coverage));
    });
  withHelp(coverageCommand, helpFor(help.coverage, Object.values(help.coverageDetails)));

  const changedCommand = group
    .command("changed")
    .description(t(help.changed.description))
    .option("--product-version <第几版>", t(help.changed.version), versionNumber)
    .option("--all", t(help.changed.all))
    .action(async (options, self) => {
      context.settle(await changed(context, globalProject(self), options));
    });
  withHelp(changedCommand, helpFor(help.changed));

  const schemaCommand = group
    .command("schema")
    .description(t(help.schema.description))
    .action(async (_options, self) => {
      context.settle(await schema(context, globalProject(self)));
    });
  withHelp(schemaCommand, helpFor(help.schema));
}
