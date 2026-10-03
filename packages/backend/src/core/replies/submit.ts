import {
  type CopyEntry,
  describeLegacyReplyProblem,
  type ErrorBody,
  err,
  errorBody,
  formatPageName,
  formatRoundLabel,
  formatRoundName,
  type Issue,
  type LegacyReplyLine,
  type LegacyReplyProblem,
  ok,
  type ParamArgs,
  parseLegacyReply,
  parseQueueId,
  type ReplyLineKind,
  type ReplySection,
  type Result,
  type RoundStatus,
  renderCopy,
  replyLineKind,
  type SubmissionSource,
} from "@product-loop/model";
import { and, eq, like } from "drizzle-orm";
import { projectsCopy } from "../../copy/projects.ts";
import { repliesCopy } from "../../copy/replies.ts";
import { parseBlobHash } from "../../store/blobs.ts";
import {
  type BlobHash,
  blobRefs,
  blobs,
  cards,
  pages,
  queueItems,
  replyLines,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import type { Json } from "../../store/schema/json.ts";
import { appendEvent } from "../events.ts";
import { waitingPageIn } from "../pages/lookup.ts";
import { fail, type Reader, requireWritable } from "../projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { autoHandle } from "./auto.ts";
import { legacyPageOf } from "./legacy-page.ts";
import { pageInProject, type SubmissionView, toSubmissionView } from "./read.ts";

// 提交回复：工作台的提交按钮和 `ploop reply ingest`。后者也收旧模板「复制回复」复制出的文字。
// 接口是 POST /pages/:id/submission 和 POST /pages/:id/submission/text，见「05 接口」第四节。
// 请求本身的问题先一次报齐，返回 BAD_REQUEST。其余的在一个 immediate 写事务里做。
// 前提都在事务里确认，见约定 0002 第 3 条。两个请求同时提交同一页，后到的一个会看到已回复。
// 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
// 2. 页面要在这个项目里。同一页只能提交一次，已回复的返回 CONFLICT。
//    已撤回的页，和所在的轮次已经收尾的页，返回 PAGE_GONE。
// 3. 拆成一行一件事。旧格式的文字按存下的这一页在旧模板上的样子拆，见 legacy-page.ts。
//    拆不开的地方一次报齐，返回 BAD_REQUEST，什么都不存。一行都没有的回复也不收。
// 4. 图的哈希：旧模板只写前几位，按随回复交来的哈希、这一页的截图、附件库的顺序补全。
//    找不到或对得上几张的，返回 BAD_REQUEST。
// 5. 存下回复和每一行，记下图的引用。页面改成已回复。
//    这一轮不再有要用户点的页在等时，改成已回复，见「03 数据模型」第二节。
// 6. 记一条 submission.created。事务提交以后发出，在等的命令随之醒来，见 wait.ts。
// 7. 取消队列事项和认可更改由后端当场处理，见 auto.ts。想法框里的话和别的行一样，留给 AI 定去处。

/** 工作台交来的一行。行号按交来的顺序从 1 编。 */
type ReplyLineInput = {
  readonly section?: ReplySection | undefined;
  readonly card?: string | undefined;
  readonly kind: ReplyLineKind;
  readonly option?: string | undefined;
  readonly note?: string | undefined;
  /** 取消的是哪一件队列事项，写成 Q12。 */
  readonly queue?: string | undefined;
  /** 这一行带的图，写附件的完整哈希，图要先上传。 */
  readonly images?: readonly string[] | undefined;
};

/** 提交回复的请求，枚举已换成英文键。文字和各行只交一样。 */
export type SubmitInput = {
  readonly source: SubmissionSource;
  /** 旧格式的回复文字，旧模板复制出的样子。 */
  readonly text?: string | undefined;
  /** 工作台拆好的各行。 */
  readonly lines?: readonly ReplyLineInput[] | undefined;
  /** 回复里的图的完整哈希。旧模板的回复文字只写前几位，按它补全，见第一期计划第 48 步。 */
  readonly images?: readonly string[] | undefined;
};

export type SubmitDeps = {
  /** 附件库里有没有这个哈希的完整一份。接口层传 store/blobs.ts 的 hasBlob。 */
  readonly hasBlob: (hash: BlobHash) => boolean;
};

/** 提交的结果。接口层把 warnings 和 next 放进响应外壳，其余是 data。 */
export type SubmittedReply = {
  readonly submission: SubmissionView;
  /** 提交以后这一轮的状态。 */
  readonly roundStatus: RoundStatus;
  /** 自动处理没能做完的行，留给 AI 处理。 */
  readonly warnings: readonly Issue[];
  readonly next: readonly string[];
};

type Failure = ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "PAGE_GONE">;

type PageRow = typeof pages.$inferSelect;

/** 拆好的一行，还没有补全图的哈希。 */
type Draft = {
  /** 在回复文字里从第几行开始。交来的是各行时为空。 */
  readonly textLine: number | null;
  readonly section: ReplySection | null;
  readonly card: string | null;
  readonly kind: ReplyLineKind;
  readonly option: string | null;
  readonly note: string | null;
  readonly queue: number | null;
  /** 图：报错时的位置，和哈希。旧格式只写前几位，各行写完整的哈希。 */
  readonly images: readonly { readonly where: string; readonly id: string }[];
};

/** 提交回复。步骤见文件开头。 */
export function submitReply(
  ctx: WriteContext,
  projectId: string,
  pageId: number,
  input: SubmitInput,
  deps: SubmitDeps,
): Result<SubmittedReply, Failure> {
  const cleaned = cleanRequest(input);
  if (!cleaned.ok) return cleaned;
  const given = cleaned.value;
  return writeTx<SubmittedReply, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const found = pageInProject(w.tx, projectId, pageId);
    if (!found.ok) return found;
    const page = found.value;
    const open = pageOpen(w.tx, page);
    if (!open.ok) return open;
    const drafts =
      input.text === undefined
        ? linesFromInput(w.tx, page, input.lines ?? [])
        : linesFromText(w.tx, page, input.text);
    if (!drafts.ok) return drafts;
    const images = resolveImages(
      w.tx,
      drafts.value,
      [...given, ...page.images.map((i) => i.hash)],
      deps,
    );
    if (!images.ok) return images;
    return ok(store(w, page, input, drafts.value, images.value));
  });
}

// ── 请求本身的问题 ──

/** 文字和各行只交一样，交来的完整哈希写法要对。返回交来的哈希。 */
function cleanRequest(input: SubmitInput): Result<BlobHash[], ErrorBody<"BAD_REQUEST">> {
  const text = repliesCopy.request;
  if (input.text !== undefined && input.lines !== undefined) {
    return fail("BAD_REQUEST", issue(text.bodyBoth, "lines"));
  }
  if (input.text === undefined && input.lines === undefined) {
    return fail("BAD_REQUEST", issue(text.bodyMissing, "text"));
  }
  const hashes: BlobHash[] = [];
  const issues: Issue[] = [];
  for (const [i, value] of (input.images ?? []).entries()) {
    const parsed = parseBlobHash(value);
    if (parsed.ok) hashes.push(parsed.value);
    else issues.push(issue(text.imageHash, `images[${i}]`, { hash: value }));
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok(hashes);
}

/** 一条报错：文案里填上参数，写明位置。 */
function issue<S extends string>(
  entry: { readonly message: CopyEntry<S>; readonly hint: CopyEntry },
  where: string,
  ...params: ParamArgs<S>
): Issue {
  return { message: renderCopy(entry.message, ...params), hint: renderCopy(entry.hint), where };
}

// ── 这一页还能不能回复 ──

/** 已给出的页才能回复。已回复是冲突，已撤回和所在的轮次已经收尾是页面没了。 */
export function pageOpen(
  db: Reader,
  page: PageRow,
): Result<null, ErrorBody<"CONFLICT" | "PAGE_GONE">> {
  const text = repliesCopy.page;
  const round = roundOf(db, page);
  const name = formatPageName(round, page.seq);
  if (page.status === "replied") {
    return fail("CONFLICT", issue(text.replied, name, { page: name }));
  }
  if (page.status === "withdrawn") {
    return fail("PAGE_GONE", issue(text.withdrawn, name, { page: name }));
  }
  if (round.status === "closed") {
    const params = { round: formatRoundName(round), seq: page.seq };
    return fail("PAGE_GONE", issue(text.closed, name, params));
  }
  return ok(null);
}

function roundOf(db: Reader, page: PageRow) {
  const round = db.select().from(rounds).where(eq(rounds.id, page.roundId)).get();
  // 页面挂在存在的轮次上，由外键保证。
  if (round === undefined) throw new Error(`阶段 ${page.roundId} 不存在，数据不一致。`);
  return round;
}

// ── 拆成一行一件事 ──

/** 旧格式的文字按旧模板上的样子拆。拆不开的地方一次报齐，一行都没有的不收。 */
function linesFromText(
  db: Reader,
  page: PageRow,
  text: string,
): Result<Draft[], ErrorBody<"BAD_REQUEST">> {
  const parsed = parseLegacyReply(text, legacyPageOf(db, page));
  if (!parsed.ok) {
    const [first, ...rest] = parsed.error;
    const describe = (problem: LegacyReplyProblem) => describeLegacyReplyProblem(problem);
    return err(errorBody("BAD_REQUEST", [describe(first), ...rest.map(describe)]));
  }
  if (parsed.value.length === 0) return emptyReply();
  return ok(parsed.value.map(draftOfLegacy));
}

function draftOfLegacy(line: LegacyReplyLine): Draft {
  let queue: number | null = null;
  if (line.queue !== undefined) {
    const number = parseQueueId(line.queue);
    // 看板上的编号由后端写，一定写得对。
    if (!number.ok) throw new Error(`看板上的编号写错了：${line.queue}`);
    queue = number.value;
  }
  return {
    textLine: line.textLine,
    section: line.section ?? null,
    card: line.card ?? null,
    kind: line.kind,
    option: line.option ?? null,
    note: line.note ?? null,
    queue,
    images: line.images.map((image) => ({
      where: `${renderCopy(repliesCopy.where, { line: line.textLine })}〔图 ${image.n}〕`,
      id: image.id,
    })),
  };
}

function emptyReply(): Result<never, ErrorBody<"BAD_REQUEST">> {
  return fail("BAD_REQUEST", issue(repliesCopy.request.empty, "text"));
}

/** 要写备注的几种行，和 model 的 replyLineSchema 相同。 */
const kindsNeedingNote: readonly ReplyLineKind[] = ["noteOnly", "idea"];

/**
 * 工作台交来的各行。卡片要在这一页上，选了选项的写选项，想法和只写了备注的写备注。
 * 取消队列事项的行写是哪一件，那一件要在这个项目的队列里。问题一次报齐。
 * 选项的 key 是否在卡上，等工作台的提交做出来时再查。
 */
function linesFromInput(
  db: Reader,
  page: PageRow,
  lines: readonly ReplyLineInput[],
): Result<Draft[], ErrorBody<"BAD_REQUEST">> {
  if (lines.length === 0) return emptyReply();
  const text = repliesCopy.line;
  const issues: Issue[] = [];
  const drafts = lines.map((input, i): Draft => {
    const line = i + 1;
    const where = `lines[${i}]`;
    const card = blankToNull(input.card);
    const option = blankToNull(input.option);
    const note = blankToNull(input.note);
    if (card !== null) {
      const indexed = db
        .select({ section: cards.section })
        .from(cards)
        .where(and(eq(cards.pageId, page.id), eq(cards.cardId, card)))
        .get();
      if (indexed === undefined) issues.push(issue(text.cardUnknown, where, { line, card }));
      else if (input.section !== undefined && input.section !== indexed.section) {
        const params = { line, card, actual: indexed.section, section: input.section };
        issues.push(issue(text.sectionMismatch, where, params));
      }
    }
    if (input.kind === "option" && option === null) {
      issues.push(issue(text.optionMissing, where, { line }));
    }
    if (kindsNeedingNote.includes(input.kind) && note === null) {
      const kind = replyLineKind.label(input.kind);
      issues.push(issue(text.noteMissing, where, { line, kind }));
    }
    const queue = queueOf(db, page.projectId, input, line, where, issues);
    return {
      textLine: null,
      section: input.section ?? null,
      card,
      kind: input.kind,
      option,
      note,
      queue,
      images: (input.images ?? []).map((id, j) => ({
        where: renderCopy(repliesCopy.lineImage, { line, n: j + 1 }),
        id,
      })),
    };
  });
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok(drafts);
}

/** 一行点名的队列事项。取消队列事项的行必须写，写了的要在这个项目的队列里。 */
function queueOf(
  db: Reader,
  projectId: string,
  input: ReplyLineInput,
  line: number,
  where: string,
  issues: Issue[],
): number | null {
  const text = repliesCopy.line;
  const written = blankToNull(input.queue);
  if (written === null) {
    if (input.kind === "queueDrop") issues.push(issue(text.queueMissing, where, { line }));
    return null;
  }
  const number = parseQueueId(written);
  const exists =
    number.ok &&
    db
      .select({ id: queueItems.id })
      .from(queueItems)
      .where(and(eq(queueItems.projectId, projectId), eq(queueItems.number, number.value)))
      .get() !== undefined;
  if (!number.ok || !exists) {
    issues.push(issue(text.queueUnknown, where, { line, queue: written }));
    return null;
  }
  return number.value;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

// ── 图的哈希 ──

/** 哈希的前几位：十六进制小写。旧模板写六位。 */
const hashPrefixPattern = /^[0-9a-f]{1,64}$/u;

/**
 * 补全每一行的图。先在随回复交来的哈希和这一页的截图里找，找不到再查附件库。
 * 只对得上一张时用它，并且附件库里要有完整的一份。问题一次报齐，按行排。
 */
function resolveImages(
  db: Reader,
  drafts: readonly Draft[],
  known: readonly BlobHash[],
  deps: SubmitDeps,
): Result<BlobHash[][], ErrorBody<"BAD_REQUEST">> {
  const candidates = [...new Set(known)];
  const issues: Issue[] = [];
  const resolved = drafts.map((draft) =>
    draft.images.flatMap(({ where, id }) => {
      const found = lookupHash(db, id, candidates);
      if (found === "ambiguous") {
        issues.push(issue(repliesCopy.image.ambiguous, where, { where, id }));
        return [];
      }
      if (found === undefined || !deps.hasBlob(found)) {
        issues.push(issue(repliesCopy.image.missing, where, { where, id }));
        return [];
      }
      return [found];
    }),
  );
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok(resolved.map((hashes) => [...new Set(hashes)]));
}

/** 按前几位找哈希：先在已知的几张里找，没有再查附件库。对得上几张时返回 ambiguous。 */
function lookupHash(
  db: Reader,
  id: string,
  candidates: readonly BlobHash[],
): BlobHash | "ambiguous" | undefined {
  if (!hashPrefixPattern.test(id)) return undefined;
  const known = candidates.filter((hash) => hash.startsWith(id));
  if (known.length > 1) return "ambiguous";
  if (known[0] !== undefined) return known[0];
  // 前缀只含十六进制字符，没有 like 的通配符。
  const stored = db
    .select({ hash: blobs.hash })
    .from(blobs)
    .where(like(blobs.hash, `${id}%`))
    .limit(2)
    .all();
  if (stored.length > 1) return "ambiguous";
  return stored[0]?.hash;
}

// ── 存下回复 ──

/** 存下回复、每一行和图的引用，改页面和轮次的状态，自动处理，记下事件。前提都已确认。 */
function store(
  w: WriteScope,
  page: PageRow,
  input: SubmitInput,
  drafts: readonly Draft[],
  images: readonly (readonly BlobHash[])[],
): SubmittedReply {
  const { projectId } = page;
  const row = w.tx
    .insert(submissions)
    .values({
      projectId,
      pageId: page.id,
      source: input.source,
      submittedAt: w.now,
      text: input.text ?? null,
      content: input.lines === undefined ? null : (input.lines as unknown as Json),
      takenAt: null,
    })
    .returning()
    .get();
  const lines = drafts.map((draft, i) => ({
    submissionId: row.id,
    line: i + 1,
    projectId,
    textLine: draft.textLine,
    section: draft.section,
    card: draft.card,
    kind: draft.kind,
    option: draft.option,
    note: draft.note,
    queue: draft.queue,
    images: [...(images[i] ?? [])],
    imagesRead: false,
  }));
  w.tx.insert(replyLines).values(lines).run();
  const refs = lines.flatMap((line) =>
    line.images.map((blobHash) => ({
      blobHash,
      referrerKind: "replyLine" as const,
      referrerId: `${row.id}:${line.line}`,
      purpose: "img",
    })),
  );
  if (refs.length > 0) w.tx.insert(blobRefs).values(refs).run();

  w.tx.update(pages).set({ status: "replied" }).where(eq(pages.id, page.id)).run();
  const round = roundOf(w.tx, page);
  // 这一轮还有要用户点的页在等，就还是等用户回复，例如用户回复的是只看的页。
  const roundStatus: RoundStatus =
    waitingPageIn(w.tx, round.id) === undefined ? "replied" : "waiting";
  if (roundStatus !== round.status) {
    w.tx.update(rounds).set({ status: roundStatus }).where(eq(rounds.id, round.id)).run();
  }
  const label = formatRoundLabel(round);
  appendEvent(w, {
    projectId,
    kind: "submission.created",
    objectType: "submission",
    objectId: String(row.id),
    detail: {
      round: label,
      page: page.id,
      submission: row.id,
      source: input.source,
      lines: lines.length,
      roundStatus,
    },
  });
  const warnings = autoHandle(w, projectId, row.id, lines);
  return {
    submission: toSubmissionView(w.tx, row),
    roundStatus,
    warnings,
    next: [renderCopy(projectsCopy.next.replyShow)],
  };
}
