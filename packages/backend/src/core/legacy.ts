import {
  assignCardIds,
  type CopyEntry,
  type DecisionKind,
  type DecisionStatus,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  formatQueueId,
  type Issue,
  type LegacyMigrationStatus,
  ok,
  type PageSections,
  type ParamArgs,
  type Proposer,
  parseQueueId,
  type QueueStatus,
  queueCopy,
  queueStatus,
  type Result,
  renderCopy,
  type Stage,
  type WithCardIds,
} from "@product-loop/model";
import { and, count, eq, isNotNull, max } from "drizzle-orm";
import { legacyCopy } from "../copy/legacy.ts";
import type { BlobHash } from "../store/blobs.ts";
import {
  type ArchiveEntry,
  blobRefs,
  decisions as decisionRows,
  type LegacyCounts,
  type LegacyFailure,
  legacyMigrations,
  pages,
  projects,
  queueEvents,
  queueItems,
  rounds,
} from "../store/schema/index.ts";
import { importDecisions } from "./decisions.ts";
import { appendEvent } from "./events.ts";
import { importMainlineRevision } from "./mainline.ts";
import { checkHistoryPage } from "./pages/check.ts";
import { insertPage } from "./pages/present.ts";
import { appSkillVersion, findProject, iso, type Reader } from "./projects.ts";
import { imageRefsOf } from "./rules/blobs.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";
import { currentVersionRow, endVersion, startNextVersion } from "./versions.ts";

// 迁移的后端：归档、导入、核对、完成，见「08 版本与迁移」第四节和第一期计划第 61 步。
// 这几步都在迁移完成以前做，所以不查 requireWritable。每个项目在迁移状态表里有一行。
// 1. 归档：命令行上传的包核对过清单和哈希，记下文件名和清单。已经完成的项目不能再归档。
// 2. 导入：在一个写事务里写主线、决定、队列、轮次和页面，最后按旧文件数出的数量核对。
//    任何一处不通过，整个事务撤回，另在一个事务里记下停在哪一步和原因。
//    旧页面按历史页面模式校验，仍被拦截的整批不导入。旧轮次都放进第 1 版，已收尾。
// 3. 完成：再数一遍，记下 skill 版本，结束第 1 版并开始第 2 版，返回要清理的旧文件。

type MigrationRow = typeof legacyMigrations.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

/** 迁移停在哪里。GET /projects/:pid/legacy 返回它。 */
export type LegacyState = {
  readonly project: string;
  readonly status: LegacyMigrationStatus | null;
  readonly archive: {
    readonly file: string;
    readonly sha256: string;
    readonly files: number;
    readonly bytes: number;
  } | null;
  readonly counts: LegacyCounts | null;
  readonly failure: { readonly step: string; readonly message: string; readonly at: string } | null;
  readonly updatedAt: string | null;
};

function findMigration(db: Reader, projectId: string): MigrationRow | undefined {
  return db.select().from(legacyMigrations).where(eq(legacyMigrations.projectId, projectId)).get();
}

function toState(projectId: string, row: MigrationRow | undefined): LegacyState {
  if (row === undefined) {
    return {
      project: projectId,
      status: null,
      archive: null,
      counts: null,
      failure: null,
      updatedAt: null,
    };
  }
  return {
    project: projectId,
    status: row.status,
    archive: {
      file: row.archiveFile,
      sha256: row.archiveSha256,
      files: row.manifest.length,
      bytes: row.archiveBytes,
    },
    counts: row.counts,
    failure:
      row.failure === null
        ? null
        : {
            step: row.failure.step,
            message: row.failure.message,
            at: iso(new Date(row.failure.at)),
          },
    updatedAt: iso(row.updatedAt),
  };
}

/** 迁移停在哪里。项目不存在时返回 NOT_FOUND。 */
export function legacyState(
  db: Reader,
  projectId: string,
): Result<LegacyState, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  return ok(toState(projectId, findMigration(db, projectId)));
}

function issue<S extends string>(
  entry: { readonly message: CopyEntry<S>; readonly hint: CopyEntry },
  ...params: ParamArgs<S>
): Issue {
  return { message: renderCopy(entry.message, ...params), hint: renderCopy(entry.hint) };
}

/** 迁移的状态不允许这一步：已经完成、已经导入、还没归档。 */
function stateConflict<S extends string>(
  entry: { readonly message: CopyEntry<S>; readonly hint: CopyEntry },
  ...params: ParamArgs<S>
): Result<never, ErrorBody<"CONFLICT">> {
  return err(errorBody("CONFLICT", [issue(entry, ...params)]));
}

// ── 归档 ──

export type ArchiveRecord = {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly manifest: readonly ArchiveEntry[];
};

/** 归档之前查一遍：项目要在，迁移还没完成。收包以前调用，免得白收一个包。 */
export function canArchive(
  db: Reader,
  projectId: string,
): Result<null, ErrorBody<"NOT_FOUND" | "CONFLICT">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = findMigration(db, projectId);
  if (row?.status === "completed")
    return stateConflict(legacyCopy.state.completed, { project: projectId });
  return ok(null);
}

/**
 * 记下核对过的归档包。重新归档时换成新的包，导入的状态从头来。
 * 返回被换下来的旧包的文件名，由接口层删掉。
 */
export function recordArchive(
  ctx: WriteContext,
  projectId: string,
  archive: ArchiveRecord,
): Result<
  { readonly state: LegacyState; readonly replaced: string | null },
  ErrorBody<"NOT_FOUND" | "CONFLICT">
> {
  return writeTx(ctx, (w) => {
    const allowed = canArchive(w.tx, projectId);
    if (!allowed.ok) return allowed;
    const previous = findMigration(w.tx, projectId);
    if (previous?.status === "imported")
      return stateConflict(legacyCopy.state.imported, { project: projectId });
    const values = {
      status: "archived" as const,
      archiveFile: archive.file,
      archiveSha256: archive.sha256,
      archiveBytes: archive.bytes,
      manifest: archive.manifest,
      counts: null,
      failure: null,
      updatedAt: w.now,
    };
    const row = w.tx
      .insert(legacyMigrations)
      .values({ projectId, ...values, startedAt: w.now })
      .onConflictDoUpdate({ target: legacyMigrations.projectId, set: values })
      .returning()
      .get();
    appendEvent(w, {
      projectId,
      kind: "legacy.archived",
      objectType: "project",
      objectId: projectId,
      detail: { file: archive.file, sha256: archive.sha256, files: archive.manifest.length },
    });
    const replaced =
      previous !== undefined && previous.archiveFile !== archive.file ? previous.archiveFile : null;
    return ok({ state: toState(projectId, row), replaced });
  });
}

// ── 导入 ──

type LegacyDecisionInput = {
  readonly id: number;
  readonly kind: DecisionKind;
  readonly decision: string;
  readonly reason: string;
  readonly case: string;
  readonly date: string;
  readonly status: DecisionStatus;
  readonly voidedBy?: number | undefined;
  readonly voidReason?: string | undefined;
};

type LegacyQueueInput = {
  readonly id: string;
  readonly content: string;
  readonly stage: Stage;
  readonly proposer: Proposer;
  readonly createdAt: string;
  readonly status: QueueStatus;
  readonly statusNote?: string | undefined;
  readonly dependsOn?: string | undefined;
  readonly acceptance?: string | undefined;
  readonly evidence?: string | undefined;
  readonly subItems: readonly string[];
  readonly source?: string | undefined;
};

type LegacyPageInput =
  | {
      readonly legacyId: string;
      readonly data: unknown;
      readonly images: readonly { readonly path: string; readonly hash: string }[];
    }
  | { readonly legacyId: string; readonly snapshot: string };

type LegacyRoundInput = {
  readonly legacyId: string;
  readonly stage: Stage;
  readonly date: string;
  readonly pages: readonly LegacyPageInput[];
  readonly files: readonly { readonly path: string; readonly hash: string }[];
};

export type LegacyImportInput = {
  readonly mainline: { readonly original: string; readonly cleaned: string } | null;
  readonly decisions: readonly LegacyDecisionInput[];
  readonly queue: readonly LegacyQueueInput[];
  readonly rounds: readonly LegacyRoundInput[];
  readonly expected: LegacyCounts;
};

export type LegacyImportDeps = {
  /** 附件库里有没有这个哈希的完整一份。 */
  readonly hasBlob: (hash: BlobHash) => boolean;
};

type ImportFailure = ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "RULE_BLOCKED">;

/** 截图的扩展名。数截图时只数这几种。 */
const imagePattern = /\.(?:png|jpe?g|gif|webp|svg)$/iu;

/** 同一类的问题一次报齐。 */
function failAll<C extends ErrorCode>(code: C, issues: readonly Issue[]): ErrorBody<C> | undefined {
  const [first, ...rest] = issues;
  return first === undefined ? undefined : errorBody(code, [first, ...rest]);
}

/** 旧日期当作那一天北京时间的零点。 */
const dayStart = (date: string) => new Date(`${date}T00:00:00+08:00`);

/** 导入旧数据。步骤见文件开头。 */
export function importLegacy(
  ctx: WriteContext,
  projectId: string,
  input: LegacyImportInput,
  deps: LegacyImportDeps,
): Result<LegacyCounts, ImportFailure> {
  const result = writeTx<LegacyCounts, ImportFailure>(ctx, (w) => {
    const project = findProject(w.tx, projectId);
    if (!project.ok) return project;
    const row = findMigration(w.tx, projectId);
    if (row?.status === "completed")
      return stateConflict(legacyCopy.state.completed, { project: projectId });
    if (row?.status === "imported")
      return stateConflict(legacyCopy.state.imported, { project: projectId });
    if (row === undefined)
      return stateConflict(legacyCopy.state.notArchived, { project: projectId });
    const version = currentVersionRow(w.tx, projectId);
    if (version.version !== 1 || version.status !== "open") {
      return stateConflict(legacyCopy.state.versionMissing, { project: projectId });
    }

    if (input.mainline !== null) {
      importMainlineRevision(w, projectId, input.mainline.original);
      importMainlineRevision(w, projectId, input.mainline.cleaned);
    }
    const decisions = importDecisions(w, projectId, input.decisions);
    if (!decisions.ok) return decisions;
    const queue = importQueue(w, projectId, input.queue);
    if (queue !== undefined) return err(queue);
    const imported = importRounds(w, projectId, input.rounds, deps);
    if (!imported.ok) return imported;

    const counts: LegacyCounts = {
      rounds: input.rounds.length,
      pages: imported.value.pages,
      decisions: decisions.value.length,
      queue: input.queue.length,
      images: imported.value.images,
    };
    const mismatch = countIssues(input.expected, counts);
    if (mismatch !== undefined) return err(mismatch);
    w.tx
      .update(legacyMigrations)
      .set({ status: "imported", counts, failure: null, updatedAt: w.now })
      .where(eq(legacyMigrations.projectId, projectId))
      .run();
    appendEvent(w, {
      projectId,
      kind: "legacy.imported",
      objectType: "project",
      objectId: projectId,
      detail: { ...counts },
    });
    return ok(counts);
  });
  if (!result.ok) recordFailure(ctx, projectId, "import", result.error);
  return result;
}

/** 没做成的一步记进迁移状态表。导入的事务已经撤回，这里另开一个事务。 */
function recordFailure(ctx: WriteContext, projectId: string, step: string, error: ErrorBody): void {
  const failure: Omit<LegacyFailure, "at"> = { step, message: error.message };
  writeTx({ ...ctx, idempotency: undefined }, (w) => {
    w.tx
      .update(legacyMigrations)
      .set({ failure: { ...failure, at: w.now.getTime() }, updatedAt: w.now })
      .where(eq(legacyMigrations.projectId, projectId))
      .run();
    return ok(null);
  });
}

/** 数量逐项核对，对不上的一次报齐。 */
function countIssues(
  expected: LegacyCounts,
  actual: LegacyCounts,
): ErrorBody<"CONFLICT"> | undefined {
  const keys = ["rounds", "pages", "decisions", "queue", "images"] as const;
  const issues = keys.flatMap((key) => {
    if (expected[key] === actual[key]) return [];
    const item = renderCopy(legacyCopy.counts.item[key]);
    const text = legacyCopy.counts.mismatch;
    return [
      {
        message: renderCopy(text.message, { item, expected: expected[key], actual: actual[key] }),
        hint: renderCopy(text.hint),
        where: key,
      },
    ];
  });
  return failAll("CONFLICT", issues);
}

/** 状态要求写上的一格，和队列表的检查约束相同。 */
const requiredField: ReadonlyMap<QueueStatus, "dependsOn" | "evidence" | "statusNote"> = new Map([
  ["waiting", "dependsOn"],
  ["done", "evidence"],
  ["dropped", "statusNote"],
]);

/** 旧队列逐件写进去，编号照对照表。每件记一条放进来的变动。 */
function importQueue(
  w: WriteScope,
  projectId: string,
  items: readonly LegacyQueueInput[],
): ErrorBody<"BAD_REQUEST"> | undefined {
  const issues: Issue[] = [];
  const seen = new Set<number>();
  const numbers = items.map((item) => {
    const parsed = parseQueueId(item.id);
    const number = parsed.ok ? parsed.value : 0;
    if (seen.has(number)) {
      issues.push({ ...issue(legacyCopy.import.queueDuplicate, { id: item.id }), where: item.id });
    }
    seen.add(number);
    if (item.status === "doing") {
      issues.push({ ...issue(legacyCopy.import.queueDoing, { id: item.id }), where: item.id });
    }
    const field = requiredField.get(item.status);
    if (field !== undefined && (item[field] ?? "").trim() === "") {
      const params = {
        id: item.id,
        status: queueStatus.label(item.status),
        field: renderCopy(queueCopy.field[field]),
      };
      issues.push({ ...issue(legacyCopy.import.queueField, params), where: `${item.id}.${field}` });
    }
    return number;
  });
  const failed = failAll("BAD_REQUEST", issues);
  if (failed !== undefined) return failed;
  const text = (value: string | undefined) => (value?.trim() ? value.trim() : null);
  items.forEach((item, i) => {
    const row = w.tx
      .insert(queueItems)
      .values({
        projectId,
        number: numbers[i] ?? 0,
        content: item.content.trim(),
        stage: item.stage,
        proposer: item.proposer,
        proposedInRoundId: null,
        createdAt: dayStart(item.createdAt),
        status: item.status,
        statusNote: text(item.statusNote),
        dependsOn: text(item.dependsOn),
        acceptance: text(item.acceptance),
        evidence: text(item.evidence),
        subItems: item.subItems,
        source: text(item.source),
        editCount: 0,
      })
      .returning()
      .get();
    // 先记一条「待办」：放进队列的那一次总是待办，状态变化从它起算。
    // 已经不是待办的，再记一条改成迁移时的状态。
    const move = {
      itemId: row.id,
      roundId: null,
      actor: w.actor.client,
      session: w.actor.session ?? null,
    };
    w.tx
      .insert(queueEvents)
      .values({
        ...move,
        at: item.status === "todo" ? w.now : row.createdAt,
        fromStatus: null,
        toStatus: "todo",
        note: item.status === "todo" ? row.statusNote : null,
      })
      .run();
    if (item.status !== "todo") {
      w.tx
        .insert(queueEvents)
        .values({
          ...move,
          at: w.now,
          fromStatus: "todo",
          toStatus: item.status,
          note: row.statusNote,
        })
        .run();
    }
    appendEvent(w, {
      projectId,
      kind: "queue.imported",
      objectType: "queueItem",
      objectId: formatQueueId(row.number),
      detail: { status: item.status },
    });
  });
  return undefined;
}

/** 旧轮次逐轮写进第 1 版，每个阶段接着已有的轮号编，状态是已收尾。 */
function importRounds(
  w: WriteScope,
  projectId: string,
  input: readonly LegacyRoundInput[],
  deps: LegacyImportDeps,
): Result<{ readonly pages: number; readonly images: number }, ImportFailure> {
  const blocked: Issue[] = [];
  const unlisted: Issue[] = [];
  const missing = new Set<string>();
  const checked = input.map((round) =>
    round.pages.map((page) => {
      if ("snapshot" in page) {
        if (!deps.hasBlob(page.snapshot as BlobHash)) missing.add(page.snapshot);
        return { page, sections: undefined };
      }
      for (const image of page.images) {
        if (!deps.hasBlob(image.hash as BlobHash)) missing.add(image.hash);
      }
      const check = checkHistoryPage(page.data, round.stage, round.date);
      const listed = new Set(page.images.map((image) => image.path));
      for (const ref of check.page === undefined ? [] : imageRefsOf(check.page)) {
        if (listed.has(ref.path)) continue;
        listed.add(ref.path);
        const params = { page: page.legacyId, path: ref.path };
        unlisted.push({ ...issue(legacyCopy.import.imageUnlisted, params), where: page.legacyId });
      }
      for (const hit of check.block) {
        const where = renderCopy(legacyCopy.import.pageWhere, {
          page: page.legacyId,
          where: hit.where ?? "",
        });
        blocked.push({ ...hit, where });
      }
      return { page, sections: check.page };
    }),
  );
  for (const round of input) {
    for (const file of round.files)
      if (!deps.hasBlob(file.hash as BlobHash)) missing.add(file.hash);
  }
  const blobIssues = [...missing].map((hash) => ({
    ...issue(legacyCopy.import.blobMissing, { hash: hash.slice(0, 8) }),
    where: hash,
  }));
  const failure =
    failAll("BAD_REQUEST", [...blobIssues, ...unlisted]) ?? failAll("RULE_BLOCKED", blocked);
  if (failure !== undefined) return err(failure);

  const seqs = new Map<Stage, number>();
  let ordinal =
    w.tx
      .select({ last: max(rounds.ordinal) })
      .from(rounds)
      .where(eq(rounds.projectId, projectId))
      .get()?.last ?? 0;
  let pageCount = 0;
  const images = new Set<string>();
  input.forEach((round, r) => {
    const last =
      seqs.get(round.stage) ??
      w.tx
        .select({ last: max(rounds.seq) })
        .from(rounds)
        .where(
          and(
            eq(rounds.projectId, projectId),
            eq(rounds.version, 1),
            eq(rounds.stage, round.stage),
          ),
        )
        .get()?.last ??
      0;
    seqs.set(round.stage, last + 1);
    ordinal += 1;
    const at = dayStart(round.date);
    const row: RoundRow = w.tx
      .insert(rounds)
      .values({
        projectId,
        version: 1,
        stage: round.stage,
        seq: last + 1,
        ordinal,
        status: "closed",
        startedAt: at,
        closedAt: at,
        legacyId: round.legacyId,
      })
      .returning()
      .get();
    for (const { page, sections } of checked[r] ?? []) {
      const snapshot = "snapshot" in page ? (page.snapshot as BlobHash) : undefined;
      const stored: WithCardIds<PageSections> =
        sections === undefined ? {} : assignCardIds(sections);
      const given = "snapshot" in page ? [] : page.images;
      insertPage(w, {
        projectId,
        round: row,
        roundStatus: "closed",
        purpose: snapshot === undefined ? "ask" : "view",
        status: "replied",
        sections: stored,
        images: new Map(given.map((image) => [image.path, image.hash as BlobHash])),
        presentedAt: at,
        legacySnapshot: snapshot,
      });
      pageCount += 1;
    }
    const refs = [...new Set(round.files.map((file) => file.hash))].map((hash) => ({
      blobHash: hash as BlobHash,
      referrerKind: "round" as const,
      referrerId: String(row.id),
      purpose: "legacy",
    }));
    if (refs.length > 0) w.tx.insert(blobRefs).values(refs).run();
    for (const file of round.files) if (imagePattern.test(file.path)) images.add(file.path);
  });
  return ok({ pages: pageCount, images: images.size });
}

// ── 完成 ──

export type LegacyCompleted = {
  readonly counts: LegacyCounts;
  readonly skillVersion: string;
  readonly ended: number;
  readonly started: number;
  /** 归档包的文件清单：要清理的旧文件，路径相对旧文件的位置。哪些留下由命令行定。 */
  readonly cleanup: readonly string[];
};

/** 完成迁移。步骤见文件开头。 */
export function completeLegacy(
  ctx: WriteContext,
  projectId: string,
): Result<LegacyCompleted, ErrorBody<"NOT_FOUND" | "CONFLICT">> {
  const result = writeTx<LegacyCompleted, ErrorBody<"NOT_FOUND" | "CONFLICT">>(ctx, (w) => {
    const project = findProject(w.tx, projectId);
    if (!project.ok) return project;
    const row = findMigration(w.tx, projectId);
    if (row?.status === "completed")
      return stateConflict(legacyCopy.state.completed, { project: projectId });
    if (row?.status !== "imported" || row.counts === null) {
      return stateConflict(legacyCopy.state.notImported, { project: projectId });
    }
    const recounted = { ...row.counts, ...storedCounts(w.tx, projectId) };
    const mismatch = countIssues(row.counts, recounted);
    if (mismatch !== undefined) return err(mismatch);
    const current = currentVersionRow(w.tx, projectId);
    const ended = endVersion(w, current, renderCopy(legacyCopy.complete.reason));
    const started = startNextVersion(w, ended);
    w.tx
      .update(projects)
      .set({ skillVersion: appSkillVersion })
      .where(eq(projects.id, projectId))
      .run();
    w.tx
      .update(legacyMigrations)
      .set({ status: "completed", failure: null, updatedAt: w.now, completedAt: w.now })
      .where(eq(legacyMigrations.projectId, projectId))
      .run();
    appendEvent(w, {
      projectId,
      kind: "legacy.completed",
      objectType: "project",
      objectId: projectId,
      detail: { skillVersion: appSkillVersion, ended: ended.version, started: started.version },
    });
    return ok({
      counts: row.counts,
      skillVersion: appSkillVersion,
      ended: ended.version,
      started: started.version,
      cleanup: row.manifest.map((entry) => entry.path),
    });
  });
  if (!result.ok) recordFailure(ctx, projectId, "complete", result.error);
  return result;
}

/** 库里迁进来的轮次、页面、决定和队列事项的数量。截图按导入时数的。 */
function storedCounts(db: Reader, projectId: string): Omit<LegacyCounts, "images"> {
  const legacyRounds = and(eq(rounds.projectId, projectId), isNotNull(rounds.legacyId));
  const number = (query: { get(): { n: number } | undefined }) => query.get()?.n ?? 0;
  return {
    rounds: number(db.select({ n: count() }).from(rounds).where(legacyRounds)),
    pages: number(
      db
        .select({ n: count() })
        .from(pages)
        .innerJoin(rounds, eq(rounds.id, pages.roundId))
        .where(legacyRounds),
    ),
    decisions: number(
      db.select({ n: count() }).from(decisionRows).where(eq(decisionRows.projectId, projectId)),
    ),
    queue: number(
      db.select({ n: count() }).from(queueItems).where(eq(queueItems.projectId, projectId)),
    ),
  };
}
