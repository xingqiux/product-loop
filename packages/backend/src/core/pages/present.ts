import {
  assignCardIds,
  type CardItem,
  type CopyEntry,
  cardSections,
  cardTitle,
  type ErrorBody,
  err,
  errorBody,
  formatRoundLabel,
  type Issue,
  ok,
  type PagePurpose,
  type PageSections,
  type PageStatus,
  type ParamArgs,
  pageFormatVersion,
  parseLineRange,
  parseQueueId,
  parseRoundLabel,
  parseSceneId,
  presentRuleInfo,
  type Result,
  type RoundStatus,
  type RuleIssue,
  renderCopy,
  type WithCardIds,
  whereText,
} from "@product-loop/model";
import { eq, max } from "drizzle-orm";
import { pagesCopy } from "../../copy/pages.ts";
import { parseBlobHash } from "../../store/blobs.ts";
import {
  type BlobHash,
  blobRefs,
  cards,
  excerpts,
  type PageImageRef,
  pages,
  rounds,
} from "../../store/schema/index.ts";
import { appendEvent } from "../events.ts";
import { mainlineStatus } from "../mainline.ts";
import { iso, requireWritable } from "../projects.ts";
import { presentedNext } from "../rounds/next.ts";
import { imageRefsOf } from "../rules/blobs.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { checkPage, type PageCheck, recordRuleHits } from "./check.ts";
import { fillParts } from "./fill.ts";
import { pageLookup } from "./lookup.ts";

// 给出信息：`ploop page present`，接口是 POST /projects/:pid/rounds/:rid/pages。
// 步骤见「05 接口」第十节，页面、卡片和原文摘录见「03 数据模型」第二节。
// 请求本身的问题先一次报齐，返回 BAD_REQUEST。其余的在一个 immediate 写事务里做，
// 前提都在事务里确认，所以检查和写入之间插不进别的写入，见约定 0002 第 3 条：
// 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
// 2. 校验管线：这一轮要开着，三层校验，后端的规则按事务里的页面表查，见 check.ts。
//    「一页在等」也在这里重新确认：别的会话刚给出了一页，这里就能查到。
// 3. 有拦截时什么都不存，返回全部拦截。命中照样记下，见 recordBlockedHits。
//    有一页在等时返回 CONFLICT，命令行以退出码 3 结束。报错先写在等的是哪一页，
//    再列出别的拦截，一次改完，见第一期计划第 42 步。其余的拦截返回 RULE_BLOCKED。
// 4. 核对原文摘录：页面数据里每条文字来源都要交来原文。
// 5. 存下这一页：页面数据填好卡片编号，连同后端填的部分一起存，之后不再改。
//    再写卡片索引、原文摘录、附件引用和这一次的警告。
// 6. 要用户点的页，这一轮改成等用户回复。只看的页不改轮次的状态。
//    使用阶段给出的页只给用户看，不等回复，写不写 --view 都一样，见决定 204。
// 7. 记一条 page.presented。事务提交以后发出。

/** 命令行交来的一张截图：页面数据里写的路径，和上传到附件库的哈希。 */
type ImageInput = { readonly path: string; readonly hash: string };

/** 命令行读出的一段原文，见「03 数据模型」第二节「附件和原文摘录」。 */
type ExcerptInput = {
  /** 文件路径，和来源里写的 file 相同。 */
  readonly file: string;
  /** 行号，和来源里写的 lines 相同，例如 12-20。 */
  readonly lines: string;
  /** 从起始行到结束行的原文，行与行之间用换行连接，末尾不带换行。 */
  readonly text: string;
  /** 摘录时文件的 SHA-256，写成六十四位小写十六进制。 */
  readonly fileHash: string;
};

/** 给出信息的请求，对应接口 POST /projects/:pid/rounds/:rid/pages 的请求体，枚举已换成英文键。 */
export type PresentInput = {
  /** 轮次的写法，例如 v2-检查-1。 */
  readonly round: string;
  /** 页面数据，AI 写的样子，还没有过数据定义。 */
  readonly data: unknown;
  /** 页面的用途。不写就是要用户点的。使用阶段的页一律只看，写什么都一样。 */
  readonly purpose?: PagePurpose | undefined;
  /** 页面数据引用的截图，已经上传到附件库。没有被引用的不存。 */
  readonly images?: readonly ImageInput[] | undefined;
  /** 来源里文字的原文。没有被引用的不存。 */
  readonly excerpts?: readonly ExcerptInput[] | undefined;
};

export type PresentDeps = {
  /** 附件库里有没有这个哈希的完整一份。接口层传 store/blobs.ts 的 hasBlob。 */
  readonly hasBlob: (hash: BlobHash) => boolean;
};

/** 接口和命令行看到的一页的概要。 */
export type PageSummary = {
  /** 页面的编号，后端生成的全局整数。 */
  readonly id: number;
  readonly project: string;
  /** 轮次的写法，例如 v2-检查-1。 */
  readonly round: string;
  /** 这一轮的第几页。 */
  readonly seq: number;
  readonly purpose: PagePurpose;
  readonly status: PageStatus;
  readonly presentedAt: string;
};

/** 给出信息的结果。接口层把 warnings 和 next 放进响应外壳，其余是 data。 */
export type PresentedPage = {
  readonly page: PageSummary;
  /** 给出以后这一轮的状态。 */
  readonly roundStatus: RoundStatus;
  /** 工作台里这一轮的地址，不带主机和端口。默认显示最新的一页，见约定 0001 第 20 条。 */
  readonly path: string;
  /** 建了索引的卡片有几张。 */
  readonly cards: number;
  /** 警告：三层校验的全部警告，按三层的顺序。 */
  readonly warnings: readonly RuleIssue[];
  /** 下一步：一条完整的命令。 */
  readonly next: readonly string[];
};

type Failure = ErrorBody<
  "BAD_REQUEST" | "NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "RULE_BLOCKED"
>;

type PageRow = typeof pages.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

/** 给出信息。步骤见文件开头。 */
export function presentPage(
  ctx: WriteContext,
  projectId: string,
  input: PresentInput,
  deps: PresentDeps,
): Result<PresentedPage, Failure> {
  const cleaned = cleanRequest(input);
  if (!cleaned.ok) return cleaned;
  const request = cleaned.value;
  // 被拦截的一次校验。事务回滚以后，另开一个事务记下它的命中。
  const blocked: { check?: PageCheck } = {};
  const result = writeTx<PresentedPage, Failure>(ctx, (w) => {
    blocked.check = undefined;
    const writable = requireWritable(w.tx, projectId);
    if (!writable.ok) return writable;
    const purpose = purposeOf(input);
    const checked = checkPage(
      w.tx,
      projectId,
      {
        data: input.data,
        command: "page present",
        purpose,
        images: input.images,
        run: { mode: "current", round: input.round },
      },
      { hasBlob: deps.hasBlob, pages: pageLookup },
    );
    if (!checked.ok) return checked;
    const check = checked.value;
    const [first, ...rest] = check.block;
    if (first !== undefined) {
      blocked.check = check;
      return blockedError([first, ...rest]);
    }
    // 三层都通过时，页面数据已经解析，平时的校验挂在一轮上。
    if (check.page === undefined || check.round === null) throw new Error("校验通过却没有页面");
    const sections = assignCardIds(check.page);
    const texts = excerptRows(sections, request.excerpts);
    if (!texts.ok) return texts;
    const source = { projectId, roundId: check.round.id, purpose, sections, request };
    return ok(store(w, check, { ...source, texts: texts.value }));
  });
  if (blocked.check !== undefined) recordBlockedHits(ctx, projectId, blocked.check);
  return result;
}

/** 这一页的用途：使用阶段给出的页只给用户看，不等回复（决定 204），别的阶段不写就是要用户点的。 */
function purposeOf(input: PresentInput): PagePurpose {
  const label = parseRoundLabel(input.round);
  return label.ok && label.value.stage === "use" ? "view" : (input.purpose ?? "ask");
}

/** 有拦截时的报错：有一页在等时是冲突，在等的页写在最前面。 */
function blockedError(block: readonly [RuleIssue, ...RuleIssue[]]): Result<never, Failure> {
  const isWaiting = (issue: RuleIssue) => issue.rule === presentRuleInfo.oneWaiting.id;
  const [waiting, ...more] = block.filter(isWaiting);
  if (waiting === undefined) return err(errorBody("RULE_BLOCKED", block));
  return err(errorBody("CONFLICT", [waiting, ...more, ...block.filter((i) => !isWaiting(i))]));
}

/**
 * 被拦截的一次给出信息，另开一个写事务记下每条命中，见「07 校验」第三节。
 * 给出信息的事务要回滚，不能靠它记。请求编号只记成功的结果，所以这个事务不带请求编号。
 */
function recordBlockedHits(ctx: WriteContext, projectId: string, check: PageCheck): void {
  writeTx({ ...ctx, idempotency: undefined }, (w) => {
    recordRuleHits(w, check, { projectId, command: "page present" });
    return ok(null);
  });
}

// ── 请求本身的问题 ──

/** 一段原文的位置：文件和起止行。同一段原文按它认。 */
type TextKey = { readonly file: string; readonly start: number; readonly end: number };

type CleanExcerpt = TextKey & { readonly text: string; readonly fileHash: string };

type CleanRequest = {
  readonly excerpts: readonly CleanExcerpt[];
  readonly images: ReadonlyMap<string, BlobHash>;
};

const fileHashPattern = /^[0-9a-f]{64}$/u;

const sameText = (a: TextKey, b: TextKey) =>
  a.file === b.file && a.start === b.start && a.end === b.end;

/** 整理请求里的原文和截图，问题一次报齐。这些不看库里的数据，所以在写事务外面查。 */
function cleanRequest(input: PresentInput): Result<CleanRequest, ErrorBody<"BAD_REQUEST">> {
  const issues: Issue[] = [];
  const text = pagesCopy.present;
  const excerpts: CleanExcerpt[] = [];
  for (const entry of input.excerpts ?? []) {
    const { file, lines } = entry;
    const range = parseLineRange(lines);
    if (!range.ok) {
      issues.push(issue(text.excerptLines, file, { file, lines }));
      continue;
    }
    if (!fileHashPattern.test(entry.fileHash)) issues.push(issue(text.excerptHash, file, { file }));
    const expected = range.value.end - range.value.start + 1;
    const actual = entry.text.split("\n").length;
    if (actual !== expected) {
      issues.push(issue(text.excerptCount, file, { file, lines, expected, actual }));
    }
    const clean = { file, ...range.value, text: entry.text, fileHash: entry.fileHash };
    const earlier = excerpts.find((e) => sameText(e, clean));
    if (earlier === undefined) excerpts.push(clean);
    else if (earlier.text !== clean.text || earlier.fileHash !== clean.fileHash) {
      issues.push(issue(text.excerptTwice, file, { file, lines }));
    }
  }
  const images = new Map<string, BlobHash>();
  const reported = new Set<string>();
  for (const { path, hash } of input.images ?? []) {
    const parsed = parseBlobHash(hash);
    // 哈希写错的截图当作没有上传，由规则 blob.present 拦截。
    if (!parsed.ok) continue;
    const earlier = images.get(path);
    if (earlier === undefined) images.set(path, parsed.value);
    else if (earlier !== parsed.value && !reported.has(path)) {
      reported.add(path);
      issues.push(issue(text.imageTwice, path, { path }));
    }
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok({ excerpts, images });
}

/** 一条请求的问题：文案里填上参数，写明位置。 */
function issue<S extends string>(
  entry: { readonly message: CopyEntry<S>; readonly hint: CopyEntry },
  where: string,
  ...params: ParamArgs<S>
): Issue {
  return { message: renderCopy(entry.message, ...params), hint: renderCopy(entry.hint), where };
}

// ── 原文摘录 ──

type ExcerptRow = Omit<typeof excerpts.$inferInsert, "pageId" | "createdAt">;

/** 卡片的区块：来源只写在这三种卡上。 */
const sourceSections = ["asks", "findings", "improvements"] as const;

/**
 * 页面数据里每条文字来源一行原文摘录，原文从请求里按文件和起止行取。
 * 缺了的一次报齐，返回 BAD_REQUEST：原文由命令行读出，缺了是命令行的问题。
 */
function excerptRows(
  sections: WithCardIds<PageSections>,
  given: readonly CleanExcerpt[],
): Result<ExcerptRow[], ErrorBody<"BAD_REQUEST">> {
  const rows: ExcerptRow[] = [];
  const issues: Issue[] = [];
  for (const section of sourceSections) {
    for (const [i, card] of (sections[section] ?? []).entries()) {
      for (const [j, source] of card.sources.entries()) {
        if (source.file === undefined || source.lines === undefined) continue;
        const range = parseLineRange(source.lines);
        // 通过了数据定义，行号的写法一定对。
        if (!range.ok) throw new Error(`行号的写法不对：${source.lines}`);
        const key = { file: source.file, ...range.value };
        const found = given.find((entry) => sameText(entry, key));
        const where = whereText([section, i, "sources", j]);
        if (found === undefined) {
          const params = { name: source.name, file: source.file, lines: source.lines };
          issues.push(issue(pagesCopy.present.excerptMissing, where, params));
          continue;
        }
        rows.push({
          where,
          file: found.file,
          startLine: found.start,
          endLine: found.end,
          mark: source.mark ?? null,
          text: found.text,
          fileHash: found.fileHash,
        });
      }
    }
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("BAD_REQUEST", [first, ...rest]));
  return ok(rows);
}

// ── 存下这一页 ──

type StoreSource = {
  readonly projectId: string;
  readonly roundId: number;
  readonly purpose: PagePurpose;
  readonly sections: WithCardIds<PageSections>;
  readonly texts: readonly ExcerptRow[];
  readonly request: CleanRequest;
};

/** 存下这一页和它的索引，改这一轮的状态，记下警告和事件。前提都已确认。 */
function store(w: WriteScope, check: PageCheck, source: StoreSource): PresentedPage {
  const { projectId, purpose, sections } = source;
  const round = w.tx.select().from(rounds).where(eq(rounds.id, source.roundId)).get();
  // 校验管线刚在这个事务里找到这一轮。
  if (round === undefined) throw new Error(`阶段 ${source.roundId} 不存在。`);
  const roundStatus: RoundStatus = purpose === "ask" ? "waiting" : round.status;
  const row = insertPage(w, {
    projectId,
    round,
    roundStatus,
    purpose,
    status: "presented",
    sections,
    images: source.request.images,
    presentedAt: w.now,
  });
  if (source.texts.length > 0) {
    const rows = source.texts.map((text) => ({ ...text, pageId: row.id, createdAt: w.now }));
    w.tx.insert(excerpts).values(rows).run();
  }
  recordRuleHits(w, check, { projectId, command: "page present", pageId: row.id });
  if (roundStatus !== round.status) {
    w.tx.update(rounds).set({ status: roundStatus }).where(eq(rounds.id, round.id)).run();
  }

  const page = toPageSummary(row, formatRoundLabel(round));
  appendEvent(w, {
    projectId,
    kind: "page.presented",
    objectType: "page",
    objectId: String(row.id),
    detail: { round: page.round, page: row.id, seq: row.seq, purpose, roundStatus },
  });
  return {
    page,
    roundStatus,
    path: `/p/${projectId}/r/${page.round}`,
    cards: cardRows(row.id, sections).length,
    warnings: check.warn,
    next: presentedNext(w.tx, round, purpose, mainlineStatus(w.tx, projectId)),
  };
}

/** 存一页要的东西。给出信息和迁移导入都用 insertPage。 */
export type PageInsert = {
  readonly projectId: string;
  readonly round: RoundRow;
  /** 算后端填的部分时这一轮的状态。 */
  readonly roundStatus: RoundStatus;
  readonly purpose: PagePurpose;
  readonly status: PageStatus;
  readonly sections: WithCardIds<PageSections>;
  /** 截图的路径到哈希。页面数据引用的每一张都要有。 */
  readonly images: ReadonlyMap<string, BlobHash>;
  readonly presentedAt: Date;
  /** 迁移进来的只有网页的一页：网页在附件库里的哈希。 */
  readonly legacySnapshot?: BlobHash | undefined;
};

/** 在调用者的写事务里存下一页，写卡片索引和附件的引用。前提由调用的一方查过。 */
export function insertPage(w: WriteScope, input: PageInsert): PageRow {
  const { round, sections } = input;
  const lastSeq = w.tx
    .select({ last: max(pages.seq) })
    .from(pages)
    .where(eq(pages.roundId, round.id))
    .get()?.last;
  const images = pageImages(sections, input.images);
  const row = w.tx
    .insert(pages)
    .values({
      projectId: input.projectId,
      roundId: round.id,
      seq: (lastSeq ?? 0) + 1,
      purpose: input.purpose,
      formatVersion: pageFormatVersion,
      sections,
      images,
      fill: fillParts(w.tx, { round, roundStatus: input.roundStatus, sections, now: w.now }),
      status: input.status,
      presentedAt: input.presentedAt,
      legacySnapshot: input.legacySnapshot ?? null,
    })
    .returning()
    .get();
  const indexed = cardRows(row.id, sections);
  if (indexed.length > 0) w.tx.insert(cards).values(indexed).run();
  const refs = [...new Set(images.map((image) => image.hash))].map((blobHash) => ({
    blobHash,
    referrerKind: "page" as const,
    referrerId: String(row.id),
    purpose: "img",
  }));
  if (input.legacySnapshot !== undefined) {
    refs.push({
      blobHash: input.legacySnapshot,
      referrerKind: "page",
      referrerId: String(row.id),
      purpose: "snapshot",
    });
  }
  if (refs.length > 0) w.tx.insert(blobRefs).values(refs).run();
  return row;
}

/** 一页的概要。撤回也用它。 */
export function toPageSummary(row: PageRow, round: string): PageSummary {
  return {
    id: row.id,
    project: row.projectId,
    round,
    seq: row.seq,
    purpose: row.purpose,
    status: row.status,
    presentedAt: iso(row.presentedAt),
  };
}

/** 页面数据引用的截图，按路径第一次出现的先后。规则 blob.present 已经确认每一张都上传了。 */
function pageImages(
  sections: WithCardIds<PageSections>,
  given: ReadonlyMap<string, BlobHash>,
): PageImageRef[] {
  const images: PageImageRef[] = [];
  for (const { path } of imageRefsOf(sections)) {
    const hash = given.get(path);
    if (hash === undefined) throw new Error(`截图 ${path} 没有哈希，blob.present 应当已经拦截。`);
    if (!images.some((image) => image.path === path)) images.push({ path, hash });
  }
  return images;
}

/** 卡片索引：有卡片编号的每一项一行，按页面上的顺序，见 model 的 cardSections。 */
function cardRows(pageId: number, sections: WithCardIds<PageSections>) {
  const items: { section: keyof typeof cardSections; item: CardItem & { id: string } }[] = [];
  for (const section of Object.keys(cardSections) as (keyof typeof cardSections)[]) {
    for (const item of sections[section] ?? []) items.push({ section, item });
  }
  return items.map(({ section, item }, position) => ({
    pageId,
    section,
    cardId: item.id,
    position,
    title: cardTitle(item),
    queue: numbers(item.queue ?? [], parseQueueId),
    scenes: numbers(scenesOf(item), parseSceneId),
  }));
}

/** 一项引用的场景：场景清单写的编号，和卡片位置里的场景。 */
function scenesOf(item: CardItem): string[] {
  const scenes: string[] = [];
  if ("scene" in item && item.scene !== undefined) scenes.push(item.scene);
  if ("where" in item && item.where !== undefined) scenes.push(item.where.scene);
  return scenes;
}

/** 编号换成数字，去掉重复。编号都通过了数据定义，一定写得对。 */
function numbers(
  ids: readonly string[],
  parse: (text: string) => Result<number, unknown>,
): number[] {
  const parsed = ids.map((id) => {
    const n = parse(id);
    if (!n.ok) throw new Error(`编号写错了：${id}`);
    return n.value;
  });
  return [...new Set(parsed)];
}
