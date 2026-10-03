import {
  type DraftEntries,
  type DraftRevisionReason,
  draftRevisionRules,
  droppedMuch,
  type ErrorBody,
  ok,
  type Result,
  renderCopy,
  textLength,
} from "@product-loop/model";
import { and, desc, eq } from "drizzle-orm";
import { repliesCopy } from "../copy/replies.ts";
import { type DraftFieldMeta, draftRevisions, drafts } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { pageNameOf } from "./pages/lookup.ts";
import { fail, iso, type Reader, requireWritable } from "./projects.ts";
import { pageInProject } from "./replies/read.ts";
import { pageOpen } from "./replies/submit.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

// 草稿和草稿的旧版本，见「06 工作台」第四节。接口是 GET、PUT /pages/:id/draft 和旧版本的两个。
// 工作台每点一下交整份草稿。后端比较每个输入框的新旧文字，在两种时候存旧版本：
// - 删之前：每个输入框记着出现过的最长的一份。新的文字比它少了二十字以上，或者少了一半以上，
//   就把最长的一份存下，之后从新的文字重新记。最长的一份不到十个字时不存。
// - 定时：一个输入框在编辑时，每满两分钟存一份当时的文字，和这个输入框上一份相同就不存。
// 第三种是放回之前：用户把一份旧版本放回输入框时，先存下现在的文字，见 restoreDraftRevision。
// 只有在等用户回复的页能存草稿，已回复、已撤回、所在的轮次已收尾的，和提交一样拦下。

export type DraftView = {
  readonly page: number;
  readonly entries: DraftEntries;
  readonly updatedAt: string | null;
  /** 这一次保存存下「删之前」旧版本的输入框。 */
  readonly deleted: readonly string[];
};

export type DraftRevisionView = {
  readonly id: number;
  readonly field: string;
  readonly text: string;
  readonly reason: DraftRevisionReason;
  readonly savedAt: string;
};

type DraftRow = typeof drafts.$inferSelect;
type Failure = ErrorBody<"NOT_FOUND" | "CONFLICT" | "NEEDS_DOCTOR" | "PAGE_GONE">;

function draftRow(db: Reader, pageId: number): DraftRow | undefined {
  return db.select().from(drafts).where(eq(drafts.pageId, pageId)).get();
}

function viewOf(
  pageId: number,
  entries: DraftEntries,
  updatedAt: Date | null,
  deleted: readonly string[] = [],
): DraftView {
  return { page: pageId, entries, updatedAt: updatedAt === null ? null : iso(updatedAt), deleted };
}

/** 读一页的草稿。还没点过时是空的。 */
export function readDraft(
  db: Reader,
  projectId: string,
  pageId: number,
): Result<DraftView, ErrorBody<"NOT_FOUND">> {
  const page = pageInProject(db, projectId, pageId);
  if (!page.ok) return page;
  const row = draftRow(db, pageId);
  return ok(viewOf(pageId, row?.entries ?? {}, row?.updatedAt ?? null));
}

/** 这个输入框最近存下的一份旧版本的文字。 */
function lastRevisionText(w: WriteScope, pageId: number, field: string): string | undefined {
  return w.tx
    .select({ text: draftRevisions.text })
    .from(draftRevisions)
    .where(and(eq(draftRevisions.pageId, pageId), eq(draftRevisions.field, field)))
    .orderBy(desc(draftRevisions.id))
    .limit(1)
    .get()?.text;
}

function addRevision(
  w: WriteScope,
  pageId: number,
  field: string,
  text: string,
  reason: DraftRevisionReason,
): void {
  w.tx.insert(draftRevisions).values({ pageId, field, text, reason, savedAt: w.now }).run();
}

/** 草稿行要先有，旧版本才能挂在它上面。 */
function ensureRow(w: WriteScope, projectId: string, pageId: number, row: DraftRow | undefined) {
  if (row !== undefined) return;
  w.tx
    .insert(drafts)
    .values({ pageId, projectId, entries: {}, fieldMeta: {}, updatedAt: w.now })
    .run();
}

/**
 * 一个输入框的文字从 before 变成 after：按两条规则存旧版本，返回新的记录。
 * deleted 为 true 表示存了「删之前」的一份。
 */
function trackField(
  w: WriteScope,
  pageId: number,
  field: string,
  meta: DraftFieldMeta | undefined,
  after: string,
): { readonly meta: DraftFieldMeta; readonly deleted: boolean } {
  const now = w.now.getTime();
  if (meta === undefined) return { meta: { longest: after, timedAt: now }, deleted: false };
  let { longest, timedAt } = meta;
  let deleted = false;
  if (droppedMuch(longest, after)) {
    if (lastRevisionText(w, pageId, field) !== longest) {
      addRevision(w, pageId, field, longest, "beforeDelete");
    }
    deleted = true;
    longest = after;
  } else if (textLength(after) > textLength(longest)) {
    longest = after;
  }
  if (now - timedAt >= draftRevisionRules.timedMs) {
    if (after !== "" && lastRevisionText(w, pageId, field) !== after) {
      addRevision(w, pageId, field, after, "timer");
    }
    timedAt = now;
  }
  return { meta: { longest, timedAt }, deleted };
}

/** 存整份草稿。步骤见文件开头。 */
export function saveDraft(
  ctx: WriteContext,
  projectId: string,
  pageId: number,
  entries: DraftEntries,
): Result<DraftView, Failure> {
  return writeTx<DraftView, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const page = pageInProject(w.tx, projectId, pageId);
    if (!page.ok) return page;
    const open = pageOpen(w.tx, page.value);
    if (!open.ok) return open;
    const row = draftRow(w.tx, pageId);
    ensureRow(w, projectId, pageId, row);
    const meta: Record<string, DraftFieldMeta> = { ...(row?.fieldMeta ?? {}) };
    const deleted: string[] = [];
    for (const [field, entry] of Object.entries(entries)) {
      const after = entry.note ?? "";
      const before = row?.entries[field]?.note ?? "";
      if (after === before && meta[field] !== undefined) continue;
      const tracked = trackField(w, pageId, field, meta[field], after);
      meta[field] = tracked.meta;
      if (tracked.deleted) deleted.push(field);
    }
    // 整个删掉的输入框，按清空处理
    for (const field of Object.keys(row?.entries ?? {})) {
      if (Object.hasOwn(entries, field)) continue;
      const tracked = trackField(w, pageId, field, meta[field], "");
      meta[field] = tracked.meta;
      if (tracked.deleted) deleted.push(field);
    }
    w.tx
      .update(drafts)
      .set({ entries, fieldMeta: meta, updatedAt: w.now })
      .where(eq(drafts.pageId, pageId))
      .run();
    appendEvent(w, {
      projectId,
      kind: "draft.saved",
      objectType: "draft",
      objectId: String(pageId),
    });
    return ok(viewOf(pageId, entries, w.now, deleted));
  });
}

/** 列出一页草稿的旧版本，新的在前。写了输入框的只列这一个。 */
export function listDraftRevisions(
  db: Reader,
  projectId: string,
  pageId: number,
  field?: string,
): Result<DraftRevisionView[], ErrorBody<"NOT_FOUND">> {
  const page = pageInProject(db, projectId, pageId);
  if (!page.ok) return page;
  const where =
    field === undefined
      ? eq(draftRevisions.pageId, pageId)
      : and(eq(draftRevisions.pageId, pageId), eq(draftRevisions.field, field));
  const rows = db.select().from(draftRevisions).where(where).orderBy(desc(draftRevisions.id)).all();
  return ok(
    rows.map((r) => ({
      id: r.id,
      field: r.field,
      text: r.text,
      reason: r.reason,
      savedAt: iso(r.savedAt),
    })),
  );
}

/**
 * 把一份旧版本放回它的输入框。放回之前先存下现在的文字，所以放回以后还能改回来。
 * 放回的文字成为这个输入框新的起点。
 */
export function restoreDraftRevision(
  ctx: WriteContext,
  projectId: string,
  pageId: number,
  revisionId: number,
): Result<DraftView, Failure> {
  return writeTx<DraftView, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const page = pageInProject(w.tx, projectId, pageId);
    if (!page.ok) return page;
    const open = pageOpen(w.tx, page.value);
    if (!open.ok) return open;
    const revision = w.tx
      .select()
      .from(draftRevisions)
      .where(and(eq(draftRevisions.id, revisionId), eq(draftRevisions.pageId, pageId)))
      .get();
    const row = draftRow(w.tx, pageId);
    if (revision === undefined || row === undefined) {
      const text = repliesCopy.draft.revisionUnknown;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { page: pageNameOf(w.tx, page.value), rev: revisionId }),
        hint: renderCopy(text.hint),
        where: String(revisionId),
      });
    }
    const { field } = revision;
    const current = row.entries[field]?.note ?? "";
    if (current !== "" && current !== revision.text) {
      addRevision(w, pageId, field, current, "beforeRestore");
    }
    const entries: DraftEntries = {
      ...row.entries,
      [field]: { ...row.entries[field], note: revision.text },
    };
    const fieldMeta = {
      ...row.fieldMeta,
      [field]: { longest: revision.text, timedAt: w.now.getTime() },
    };
    w.tx
      .update(drafts)
      .set({ entries, fieldMeta, updatedAt: w.now })
      .where(eq(drafts.pageId, pageId))
      .run();
    appendEvent(w, {
      projectId,
      kind: "draft.saved",
      objectType: "draft",
      objectId: String(pageId),
    });
    return ok(viewOf(pageId, entries, w.now));
  });
}
