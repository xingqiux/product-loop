import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError } from "@commander-js/extra-typings";
import type { Api, DataOf } from "@product-loop/client";
import {
  type CopyEntry,
  destination,
  type ErrorBody,
  err,
  errorBody,
  exitCode,
  type Issue,
  ok,
  pageNameOfLabel,
  pagePurpose,
  projectCacheDirName,
  type Result,
  renderCopy,
  replyWaitStatus,
  roundNameOfLabel,
} from "@product-loop/model";
import type { Backend, CommandEnv } from "../connect.ts";
import { replyCopy } from "../copy/reply.ts";
import { inGroup, withHelp } from "../help.ts";
import type { Outcome, Report } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { readFailure } from "../project/read-error.ts";
import { checkEntries, entriesOf, readableError } from "./reply-entries.ts";
import type { OpenedProject } from "./shared.ts";
import {
  beijingTime,
  globalProject,
  helpOf,
  openProject,
  readStdin,
  statusNext,
} from "./shared.ts";

// ploop reply wait|show|handle|ingest，见「04 命令行」第八节和 S17。
// wait 找到在等的那一页，反复发长轮询，每次最多挂起五十秒。
// 连不上后端时按一秒到五秒递增的间隔重试，直到时限。到时退出码 7，页面没了退出码 8。
// 拿到回复以后打印每一行，把图下载到这个阶段的 reply-img/，写好 reply.md。
// 没有在等的页时，取最近一份回复的那一页，所以重复运行立即返回同一份回复。

type Pid = Api["api"]["v1"]["projects"][":pid"];
type Submission = DataOf<Awaited<ReturnType<Pid["submissions"]["latest"]["$get"]>>> & {};
type Line = Submission["lines"][number];
type Handled = DataOf<Awaited<ReturnType<Pid["submissions"][":sid"]["destinations"]["$post"]>>>;
type DestinationLabel = (typeof destination.labels)[number];

const { output, errors } = replyCopy;

/** 等回复默认最多等多少秒。Claude Code 一次调用命令最长十分钟，见「04 命令行」第八节。 */
const defaultTimeoutSeconds = 540;
/** 每次长轮询最多挂起的秒数，见「05 接口」第六节。 */
const pollSeconds = 50;

// ── 长轮询 ──

/** 一次请求的结果：有了回复、还在等、连不上要重试、别的失败。 */
export type PollStep<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "waiting" }
  | { readonly kind: "retry"; readonly error: ErrorBody }
  | { readonly kind: "fail"; readonly error: ErrorBody };

export type PollOptions = {
  /** 最多等多少毫秒。不写就一直等。 */
  readonly timeoutMs: number | undefined;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** 要重试时告诉调用的一方，秒数是这次要等的。 */
  readonly onRetry: (error: ErrorBody, seconds: number) => void;
};

/** 反复发请求，直到有了回复、失败或者到时。连不上时按一、二、三、四、五秒递增，之后每五秒一次。 */
export async function pollUntil<T>(
  poll: (waitSeconds: number) => Promise<PollStep<T>>,
  options: PollOptions,
): Promise<Result<T | undefined, ErrorBody>> {
  const { timeoutMs, now, sleep, onRetry } = options;
  const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : now() + timeoutMs;
  let failures = 0;
  for (;;) {
    const left = deadline - now();
    const wait = Math.max(1, Math.min(pollSeconds, Math.ceil(left / 1000)));
    const step = await poll(wait);
    if (step.kind === "done") return ok(step.value);
    if (step.kind === "fail") return err(step.error);
    if (step.kind === "waiting") {
      failures = 0;
      if (now() >= deadline) return ok(undefined);
      continue;
    }
    failures += 1;
    const seconds = Math.min(failures, 5);
    if (now() + seconds * 1000 > deadline) return err(step.error);
    onRetry(step.error, seconds);
    await sleep(seconds * 1000);
  }
}

/** 连不上后端、后端起不来和后端正忙都值得再试，别的失败照原样报出。 */
function retryable(error: ErrorBody): boolean {
  return error.code === "INTERNAL" || error.code === "BUSY";
}

// ── 在等的页和回复 ──

type Target = { readonly page: number; readonly seq: number; readonly round: string };

/**
 * 在等的页：要用户点的页，最近给出的那一页。只看的页不算在等，不等它的回复，见决定 204。
 * 没有时，最近一份回复还没被命令取走，或还有没处理的行，就取它的那一页：
 * 重复运行立即返回同一份回复。取走了、每一行也处理完了就不再返回它，免得当成新回复，看旧回复用 reply show。
 * 只有只看的页、也没有要处理的回复时，说明现在没有要用户点的页。
 */
async function targetPage(backend: Backend, pid: string): Promise<Result<Target, ErrorBody>> {
  const status = await backend.call((api) =>
    api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
  );
  if (!status.ok) return status;
  const waiting = [...status.value.data.waitingPages].sort((a, b) =>
    b.presentedAt.localeCompare(a.presentedAt),
  );
  const found = waiting.find((page) => page.purpose === pagePurpose.label("ask"));
  if (found !== undefined) return ok({ page: found.id, seq: found.seq, round: found.round });
  const viewing = waiting.at(0);
  if (viewing !== undefined) {
    const round = roundNameOfLabel(viewing.round);
    const issue = {
      message: renderCopy(errors.viewOnly.message, { round }),
      hint: renderCopy(errors.viewOnly.hint),
    };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  const latest = await backend.call((api) =>
    api.api.v1.projects[":pid"].submissions.latest.$get({ param: { pid } }),
  );
  if (!latest.ok) return latest;
  const last = latest.value.data;
  // 命令没取走过的回复照样返回：用户提交时后端当场处理完了每一行（取消队列事项、认可更改），
  // AI 也没看过它，不能说成「上一份回复也处理完了」。
  if (last !== null && (last.takenAt === null || pendingLines(last).length > 0)) {
    return ok({ page: last.page, seq: last.pageSeq, round: last.round });
  }
  const entry = last === null ? errors.noWaiting : errors.noWaitingHandled;
  const issue = { message: renderCopy(entry.message), hint: renderCopy(entry.hint) };
  return err(errorBody("NOT_FOUND", [issue]));
}

// ── 打印和写进项目缓存 ──

/** 一页的叫法：第 2 版的检查阶段的第 2 页，只写它在阶段里的第几页，不写全局的页面编号。 */
function pageOf(submission: Submission): string {
  return pageNameOfLabel(submission.round, submission.pageSeq);
}

/** 谁处理的：命令行交来的写「命令行」，工作台交来的写「工作台」，后端自己处理的照原样。 */
function actorText(by: string): string {
  if (by.startsWith("cli/")) return renderCopy(output.actorCli);
  if (by.startsWith("web/")) return renderCopy(output.actorWeb);
  return by;
}

function destinationText(line: Line): string | undefined {
  const handled = line.handled;
  if (handled === undefined) return undefined;
  const to = handled.destination;
  let text: string;
  switch (to.to) {
    case "主线":
      text = renderCopy(output.to.mainline, { revision: to.revision, part: to.part });
      break;
    case "决定":
      text = renderCopy(output.to.decision, { id: to.id });
      break;
    case "队列":
      text = renderCopy(output.to.queue, { id: to.id });
      break;
    case "当场做":
      text = renderCopy(output.to.doneHere, { evidence: to.evidence });
      break;
    case "不处理":
      text = renderCopy(output.to.noAction, { reason: to.reason });
      break;
  }
  return renderCopy(output.handled, { destination: text, by: actorText(handled.by) });
}

/**
 * 每张卡在文字里的叫法：「标题」。同一区块里有几张卡标题相同时，加上第几张。
 * 卡片的编号是后端按标题生成的，不写进文字，只在 --json 里。旧页面没有标题，没有叫法。
 */
export function cardLabels(lines: readonly Line[]): ReadonlyMap<string, string> {
  const titled = new Map<string, string[]>();
  for (const { section, card, cardTitle } of lines) {
    if (section === undefined || card === undefined || cardTitle === undefined) continue;
    const key = `${section}\0${cardTitle}`;
    const ids = titled.get(key) ?? [];
    if (!ids.includes(card)) titled.set(key, [...ids, card]);
  }
  const labels = new Map<string, string>();
  for (const { section, card, cardTitle } of lines) {
    if (section === undefined || card === undefined || cardTitle === undefined) continue;
    const ids = titled.get(`${section}\0${cardTitle}`) ?? [];
    const label =
      ids.length > 1
        ? renderCopy(output.cardNth, { title: cardTitle, n: ids.indexOf(card) + 1 })
        : renderCopy(output.card, { title: cardTitle });
    labels.set(`${section}\0${card}`, label);
  }
  return labels;
}

/** 一行写成几行文字：行号、来自哪里、种类和备注，每张图一行，有去处时写去处。 */
export function lineText(
  line: Line,
  imagePaths: ReadonlyMap<string, string>,
  labels: ReadonlyMap<string, string> = new Map(),
): string[] {
  const label =
    line.section === undefined || line.card === undefined
      ? undefined
      : labels.get(`${line.section}\0${line.card}`);
  const where =
    line.section === undefined
      ? ""
      : label === undefined
        ? renderCopy(output.section, { section: line.section })
        : renderCopy(output.where, { section: line.section, card: label });
  const extra = [
    line.option === undefined ? "" : renderCopy(output.option, { option: line.option }),
    line.queue === undefined ? "" : renderCopy(output.queue, { queue: line.queue }),
    line.note === undefined ? "" : renderCopy(output.note, { note: line.note }),
  ].join("");
  const handled = destinationText(line);
  return [
    renderCopy(output.row, { line: line.line, where, kind: line.kind, extra }),
    ...line.images.map((hash) => renderCopy(output.image, { path: imagePaths.get(hash) ?? hash })),
    ...(handled === undefined ? [] : [handled]),
  ];
}

/** 图的类型到扩展名。 */
const extensions: ReadonlyMap<string, string> = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

type Saved = {
  /** 图的哈希到下载以后的路径，路径相对项目根目录。 */
  readonly images: ReadonlyMap<string, string>;
  /** 写成的几行说明：副本在哪里、图下载到哪里。 */
  readonly lines: readonly string[];
  readonly warnings: readonly Issue[];
};

/**
 * 把回复写进项目缓存：图下载到这个阶段的 reply-img/，文字写成 reply.md，见「03 数据模型」第五节。
 * 图按「行号-第几张」命名，每次重新下载，不留上一次的。没有项目缓存时什么都不写。
 */
async function saveReply(
  backend: Backend,
  opened: OpenedProject,
  submission: Submission,
): Promise<Saved> {
  const root = opened.local?.root;
  if (root === undefined) {
    return { images: new Map(), lines: [renderCopy(output.noCache)], warnings: [] };
  }
  const roundDir = join(projectCacheDirName, "rounds", submission.round);
  const imageDir = join(roundDir, "reply-img");
  const images = new Map<string, string>();
  const warnings: Issue[] = [];
  const withImages = submission.lines.filter((line) => line.images.length > 0);
  await rm(join(root, imageDir), { recursive: true, force: true });
  if (withImages.length > 0) await mkdir(join(root, imageDir), { recursive: true });
  for (const line of withImages) {
    for (const [i, hash] of line.images.entries()) {
      if (images.has(hash)) continue;
      const got = await backend.raw(`/api/v1/blobs/${hash}`);
      const failed = (reason: string) =>
        warnings.push({
          message: renderCopy(errors.download.message, { hash: hash.slice(0, 8), reason }),
          hint: renderCopy(errors.download.hint),
        });
      if (!got.ok) {
        failed(got.error.message);
        continue;
      }
      if (got.value.status !== 200) {
        failed(String(got.value.status));
        continue;
      }
      const type = got.value.headers.get("Content-Type")?.split(";")[0] ?? "";
      const name = `${line.line}-${i + 1}${extensions.get(type) ?? ".bin"}`;
      const path = join(imageDir, name);
      await writeFile(join(root, path), Buffer.from(await got.value.arrayBuffer()));
      images.set(hash, path);
    }
  }
  const file = join(roundDir, "reply.md");
  const body = [
    renderCopy(output.shown, {
      id: submission.id,
      page: pageOf(submission),
      count: submission.lines.length,
      pending: pendingLines(submission).length,
    }),
    sourceLine(submission),
    "",
    ...submission.lines.flatMap((line) => lineText(line, images, cardLabels(submission.lines))),
    ...(submission.text === null
      ? []
      : ["", renderCopy(output.text), "", "```text", submission.text, "```"]),
  ];
  await mkdir(join(root, roundDir), { recursive: true });
  await writeFile(join(root, file), `${body.join("\n")}\n`);
  return {
    images,
    lines: [
      renderCopy(output.saved, { file }),
      ...(images.size === 0 ? [] : [renderCopy(output.images, { dir: `${imageDir}/` })]),
    ],
    warnings,
  };
}

function sourceLine(submission: Submission): string {
  return renderCopy(output.source, {
    source: submission.source,
    at: beijingTime(submission.submittedAt),
  });
}

/** 还没有去处的行号。 */
function pendingLines(submission: Submission): number[] {
  return submission.lines.filter((line) => line.handled === undefined).map((line) => line.line);
}

/** 还有行没处理：接着处理最前面的一行，多行可以写在文件里一起处理。去处和说明要 AI 定，命令里留着占位符。 */
function handleSteps(line: number): string[] {
  return [renderCopy(output.handleNext, { line }), renderCopy(output.handleFile)];
}

/**
 * 回复的行都处理完了，下一步照项目状态里的下一步：收尾，或者还有别的回复没处理时先看回复。
 * 还有没处理的行时，去处和说明要 AI 定，写不成一条能直接运行的命令，
 * 所以命令里留着占位符，见 handleSteps。
 */
async function nextOf(
  backend: Backend,
  opened: OpenedProject,
  submission: Submission,
): Promise<string[]> {
  const [first] = pendingLines(submission);
  if (first !== undefined) return handleSteps(first);
  return (await statusNext(backend, opened.projectId)) ?? [renderCopy(replyCopy.next.status)];
}

/** 还没处理的行里带图的行，处理带图的行要先读图。 */
function imageLines(submission: Submission): number[] {
  return submission.lines
    .filter((line) => line.handled === undefined && line.images.length > 0)
    .map((line) => line.line);
}

/** 处理回复的提醒：带图的行要先读图，接着处理最前面的一行，多行可以一起处理。都处理完了就没有。 */
function handleNotes(submission: Submission): string[] {
  const [first] = pendingLines(submission);
  if (first === undefined) return [];
  const withImages = imageLines(submission);
  return [
    ...(withImages.length === 0
      ? []
      : [renderCopy(output.readImages, { lines: withImages.join("、") })]),
  ];
}

/** 拿到一份回复以后的输出：第一行、来源、每一行、副本和图在哪里。 */
async function replyReport(
  kind: string,
  head: string,
  backend: Backend,
  opened: OpenedProject,
  submission: Submission,
): Promise<Report> {
  const saved = await saveReply(backend, opened, submission);
  return {
    kind,
    data: submission,
    lines: [
      head,
      sourceLine(submission),
      ...submission.lines.flatMap((line) =>
        lineText(line, saved.images, cardLabels(submission.lines)),
      ),
      ...saved.lines,
      ...handleNotes(submission),
    ],
    next: await nextOf(backend, opened, submission),
    warnings: saved.warnings,
  };
}

// ── reply wait ──

async function wait(
  ctx: CommandEnv,
  project: string | undefined,
  timeoutSeconds: number,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const target = await targetPage(backend, pid);
  if (!target.ok) return target;
  const { page, seq, round } = target.value;
  const id = String(page);
  const startedAt = Date.now();
  const result = await pollUntil<Submission>(
    async (seconds) => {
      const called = await backend.call(
        (api) =>
          api.api.v1.projects[":pid"].pages[":id"].submission.$get({
            param: { pid, id },
            query: { wait: String(seconds) },
          }),
        { timeoutMs: (seconds + 15) * 1000 },
      );
      if (!called.ok) {
        return retryable(called.error)
          ? { kind: "retry", error: called.error }
          : { kind: "fail", error: called.error };
      }
      const data = called.value.data;
      return data.status === replyWaitStatus.submitted
        ? { kind: "done", value: data.submission }
        : { kind: "waiting" };
    },
    {
      timeoutMs: timeoutSeconds === 0 ? undefined : timeoutSeconds * 1000,
      now: Date.now,
      sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      onRetry: (error, seconds) =>
        ctx.notice(renderCopy(output.retry, { message: error.message, seconds })),
    },
  );
  if (!result.ok) return result;
  const submission = result.value;
  if (submission === undefined) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    return ok({
      kind: "reply.waiting",
      data: { status: replyWaitStatus.waiting, page, seq, round },
      lines: [renderCopy(output.stillWaiting, { page: pageNameOfLabel(round, seq), seconds })],
      next: [renderCopy(replyCopy.next.again)],
      warnings: [],
      exit: exitCode.stillWaiting,
    });
  }
  const head = renderCopy(output.received, {
    page: pageOf(submission),
    count: submission.lines.length,
  });
  return ok(await replyReport("reply.received", head, backend, opened.value, submission));
}

// ── reply show ──

async function show(
  ctx: CommandEnv,
  project: string | undefined,
  submissionId: number | undefined,
): Promise<Outcome> {
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const found =
    submissionId === undefined
      ? await backend.call((api) =>
          api.api.v1.projects[":pid"].submissions.latest.$get({ param: { pid } }),
        )
      : await backend.call((api) =>
          api.api.v1.projects[":pid"].submissions[":sid"].$get({
            param: { pid, sid: String(submissionId) },
          }),
        );
  if (!found.ok) return found;
  const submission = found.value.data;
  if (submission === null) {
    const issue = {
      message: renderCopy(errors.noReply.message),
      hint: renderCopy(errors.noReply.hint),
    };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  const head = renderCopy(output.shown, {
    id: submission.id,
    page: pageOf(submission),
    count: submission.lines.length,
    pending: pendingLines(submission).length,
  });
  return ok(await replyReport("reply.shown", head, backend, opened.value, submission));
}

// ── reply handle ──

type HandleOptions = {
  readonly file?: string | undefined;
  readonly submission?: number | undefined;
  readonly readImages?: true | undefined;
  readonly decision?: string | undefined;
  readonly reason?: string | undefined;
  readonly case?: string | undefined;
  readonly stage?: string | undefined;
  readonly revision?: number | undefined;
};

function usage(
  entry: { readonly message: CopyEntry; readonly hint: CopyEntry },
  code: "BAD_REQUEST" | "NOT_FOUND" = "BAD_REQUEST",
): ErrorBody {
  return errorBody(code, [{ message: renderCopy(entry.message), hint: renderCopy(entry.hint) }]);
}

/** 逐行写的参数写成处理的输入里的一项，见 model 的 reply.ts。 */
function entryOf(
  line: number,
  to: DestinationLabel,
  detail: string | undefined,
  options: HandleOptions,
): Result<Record<string, unknown>, ErrorBody> {
  const read = options.readImages === true ? { imagesRead: true } : {};
  const key = destination.key(to);
  if (key === "decision") {
    return ok({
      line,
      to,
      decision: options.decision ?? detail,
      reason: options.reason,
      case: options.case,
      ...read,
    });
  }
  if (detail === undefined || detail.trim() === "" || key === undefined) {
    const hint = key === undefined ? "" : renderCopy(errors.detailHints[key]);
    return err(
      errorBody("BAD_REQUEST", [
        {
          message: renderCopy(errors.detailMissing.message, { destination: to }),
          hint: renderCopy(errors.detailMissing.hint, { hint }),
        },
      ]),
    );
  }
  switch (key) {
    case "mainline":
      return ok({
        line,
        to,
        part: detail,
        ...(options.revision === undefined ? {} : { revision: options.revision }),
        ...read,
      });
    case "queue":
      if (/^Q[1-9]\d*$/u.test(detail)) {
        const restage = options.stage === undefined ? {} : { stage: options.stage };
        return ok({ line, to, id: detail, ...restage, ...read });
      }
      return ok({
        line,
        to,
        item: { content: detail, stage: options.stage, proposer: "用户" },
        ...read,
      });
    case "doneHere":
      return ok({ line, to, evidence: detail, ...read });
    case "noAction":
      return ok({ line, to, reason: detail, ...read });
  }
}

/** --file 写的文件：相对当前目录找，找不到再相对项目缓存找。 */
async function readEntries(
  ctx: CommandEnv,
  opened: OpenedProject,
  file: string,
  readImages: boolean,
): Promise<Result<unknown[], ErrorBody>> {
  const candidates = [resolve(ctx.cwd, file)];
  const root = opened.local?.root;
  if (root !== undefined && !isAbsolute(file)) {
    candidates.push(join(root, projectCacheDirName, file));
  }
  let text: string | undefined;
  let reason = "";
  for (const path of candidates) {
    try {
      text = await readFile(path, "utf8");
      break;
    } catch (error) {
      reason ||= readFailure(error).reason;
    }
  }
  if (text === undefined) {
    const e = errors.fileUnreadable;
    return err(
      errorBody("NOT_FOUND", [
        { message: renderCopy(e.message, { file, reason }), hint: renderCopy(e.hint), where: file },
      ]),
    );
  }
  try {
    const parsed: unknown = JSON.parse(text);
    const entries = entriesOf(parsed, file);
    if (!entries.ok || !readImages) return entries;
    return ok(entries.value.map((entry) => ({ ...(entry as object), imagesRead: true })));
  } catch (error) {
    const e = errors.fileJson;
    const detail = error instanceof Error ? error.message : String(error);
    return err(
      errorBody("BAD_REQUEST", [
        {
          message: renderCopy(e.message, { file, reason: detail }),
          hint: renderCopy(e.hint),
          where: file,
        },
      ]),
    );
  }
}

async function handle(
  ctx: CommandEnv,
  project: string | undefined,
  args: {
    line?: number | undefined;
    to?: DestinationLabel | undefined;
    detail?: string | undefined;
  },
  options: HandleOptions,
): Promise<Outcome> {
  if (options.file !== undefined && args.line !== undefined) return err(usage(errors.handleBoth));
  if (options.file === undefined && (args.line === undefined || args.to === undefined)) {
    return err(usage(errors.handleArgs));
  }
  const opened = await openProject(ctx, project, { sync: true });
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const byArgs = options.file === undefined;
  let body: unknown[];
  if (byArgs) {
    const entry = entryOf(args.line as number, args.to as DestinationLabel, args.detail, options);
    if (!entry.ok) return entry;
    body = [entry.value];
  } else {
    const read = await readEntries(ctx, opened.value, options.file, options.readImages === true);
    if (!read.ok) return read;
    body = read.value;
  }
  const problem = checkEntries(body, byArgs);
  if (problem !== undefined) return err(problem);
  let sid = options.submission;
  if (sid === undefined) {
    const latest = await backend.call((api) =>
      api.api.v1.projects[":pid"].submissions.latest.$get({ param: { pid } }),
    );
    if (!latest.ok) return latest;
    if (latest.value.data === null) return err(usage(errors.noReply, "NOT_FOUND"));
    sid = latest.value.data.id;
  }
  const submission = String(sid);
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].submissions[":sid"].destinations.$post({
      param: { pid, sid: submission },
      // 文件里的内容由后端按处理回复的定义校验，报错写明哪一项不对。
      json: body as Parameters<Pid["submissions"][":sid"]["destinations"]["$post"]>[0]["json"],
    }),
  );
  if (!result.ok) return err(readableError(result.error, body, byArgs));
  const { data, next, warnings } = result.value;
  return ok({
    kind: "reply.handled",
    data,
    lines: handledLines(data),
    next: nextAfterHandle(data.remaining, next),
    warnings,
  });
}

/** 处理了几行以后：都处理完了用后端给的下一步；还有没处理的行，接着处理。 */
function nextAfterHandle(remaining: readonly number[], next: readonly string[]): string[] {
  const [first] = remaining;
  return first === undefined ? [...next] : handleSteps(first);
}

function handledLines(data: Handled): [string, ...string[]] {
  const lines = data.remaining.map((line) => renderCopy(output.lineRef, { line }));
  return [
    renderCopy(output.handledHead, {
      count: data.lines.length,
      submission: data.submission,
      round: roundNameOfLabel(data.round),
    }),
    ...data.lines.flatMap((line) => lineText(line, new Map(), cardLabels(data.lines))),
    ...data.decisions.map((d) =>
      renderCopy(output.decisionMade, { id: d.id, decision: d.decision }),
    ),
    ...data.queued.map((q) => renderCopy(output.queued, { id: q.id, content: q.content })),
    ...data.restored.map((q) => renderCopy(output.restored, { id: q.id, content: q.content })),
    ...data.restaged.map((q) =>
      renderCopy(output.restaged, { id: q.id, stage: q.stage, content: q.content }),
    ),
    ...(lines.length === 0
      ? [renderCopy(output.allHandled)]
      : [renderCopy(output.remaining, { lines: lines.join("、") })]),
  ];
}

// ── reply ingest ──

async function ingest(
  ctx: CommandEnv,
  project: string | undefined,
  file: string,
): Promise<Outcome> {
  let text: string;
  if (file === "-") {
    text = await readStdin();
  } else {
    try {
      text = await readFile(resolve(ctx.cwd, file), "utf8");
    } catch (error) {
      const e = errors.fileUnreadable;
      const { reason } = readFailure(error);
      return err(
        errorBody("NOT_FOUND", [
          {
            message: renderCopy(e.message, { file, reason }),
            hint: renderCopy(e.hint),
            where: file,
          },
        ]),
      );
    }
  }
  if (text.trim() === "") {
    const e = errors.empty;
    return err(
      errorBody("BAD_REQUEST", [
        { message: renderCopy(e.message, { file }), hint: renderCopy(e.hint), where: file },
      ]),
    );
  }
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  const target = await targetPage(backend, pid);
  if (!target.ok) return target;
  const id = String(target.value.page);
  const result = await backend.call((api) =>
    api.api.v1.projects[":pid"].pages[":id"].submission.text.$post({
      param: { pid, id },
      json: { text },
    }),
  );
  if (!result.ok) return result;
  const { submission } = result.value.data;
  const head = renderCopy(output.ingested, {
    page: pageOf(submission),
    count: submission.lines.length,
  });
  const report = await replyReport("reply.ingested", head, backend, opened.value, submission);
  return ok({ ...report, warnings: [...result.value.warnings, ...report.warnings] });
}

// ── 挂上命令 ──

function positiveInt(text: string, entry: typeof errors.lineInvalid): number {
  const value = Number(text);
  if (/^[1-9]\d*$/u.test(text) && Number.isSafeInteger(value)) return value;
  throw new InvalidArgumentError(renderCopy(entry.message, { text }));
}

function destinationArgument(text: string): DestinationLabel {
  const found = destination.labels.find((label) => label === text);
  if (found !== undefined) return found;
  throw new InvalidArgumentError(renderCopy(errors.destination.message, { text }));
}

function secondsArgument(text: string): number {
  const value = Number(text);
  if (/^\d+$/u.test(text) && Number.isSafeInteger(value)) return value;
  throw new InvalidArgumentError(renderCopy(errors.lineInvalid.message, { text }));
}

/** 挂上 ploop reply 和它的四个子命令。 */
export function replyCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = replyCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const group = program.command("reply").description(t(help.description));
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

  const waitCommand = group
    .command("wait")
    .description(t(help.wait.description))
    .option("--timeout <秒>", t(help.wait.timeout), secondsArgument, defaultTimeoutSeconds)
    .action(async (options, self) => {
      context.settle(await wait(context, globalProject(self), options.timeout));
    });
  withHelp(waitCommand, helpFor(help.wait));

  const showCommand = group
    .command("show")
    .description(t(help.show.description))
    .argument("[编号]", t(help.show.submission), (text) => positiveInt(text, errors.lineInvalid))
    .action(async (id, _options, self) => {
      context.settle(await show(context, globalProject(self), id));
    });
  withHelp(showCommand, helpFor(help.show));

  const handleCommand = group
    .command("handle")
    .description(t(help.handle.description))
    .argument("[行]", t(help.handle.line), (text) => positiveInt(text, errors.lineInvalid))
    .argument("[去处]", t(help.handle.destination), destinationArgument)
    .argument("[说明]", t(help.handle.detail))
    .option("--file <文件>", t(help.handle.file))
    .option("--submission <编号>", t(help.handle.submission), (text) =>
      positiveInt(text, errors.lineInvalid),
    )
    .option("--read-images", t(help.handle.readImages))
    .option("--decision <决定>", t(help.handle.decision))
    .option("--reason <原因>", t(help.handle.reason))
    .option("--case <案例>", t(help.handle.case))
    .option("--stage <阶段名>", t(help.handle.stage))
    .option("--revision <修订>", t(help.handle.revision), (text) =>
      positiveInt(text, errors.lineInvalid),
    )
    .action(async (line, to, detail, options, self) => {
      context.settle(await handle(context, globalProject(self), { line, to, detail }, options));
    });
  withHelp(handleCommand, helpFor(help.handle));

  const ingestCommand = group
    .command("ingest")
    .description(t(help.ingest.description))
    .argument("<文件>", t(help.ingest.file))
    .action(async (file, _options, self) => {
      context.settle(await ingest(context, globalProject(self), file));
    });
  withHelp(inGroup(ingestCommand, "transitional"), helpFor(help.ingest));
}
