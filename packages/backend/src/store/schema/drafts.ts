import { type DraftEntries, draftRevisionReason } from "@product-loop/model";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText } from "./enum.ts";
import { pages } from "./pages.ts";
import { projects } from "./projects.ts";

// 草稿和草稿的旧版本，字段见「03 数据模型」第二节「页面和回复」。时间一律存成毫秒数。
// 一页最多一份草稿，工作台每点一下整份替换。旧版本只增不改。

/** 一个输入框为存旧版本记着的两样，见 core/drafts.ts。 */
export type DraftFieldMeta = {
  /** 出现过的最长的一份文字。删之前存的就是它。 */
  readonly longest: string;
  /** 编辑期间上一次定时的时间，毫秒数。 */
  readonly timedAt: number;
};

export const drafts = sqliteTable(
  "drafts",
  {
    pageId: integer()
      .primaryKey()
      .references(() => pages.id),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    entries: text({ mode: "json" }).$type<DraftEntries>().notNull(),
    /** 每个输入框为存旧版本记着的内容，按输入框的名字。 */
    fieldMeta: text({ mode: "json" }).$type<Readonly<Record<string, DraftFieldMeta>>>().notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("drafts_project").on(t.projectId)],
);

export const draftRevisions = sqliteTable(
  "draft_revisions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    pageId: integer()
      .notNull()
      .references(() => drafts.pageId),
    /** 哪个输入框。 */
    field: text().notNull(),
    text: text().notNull(),
    reason: enumText(draftRevisionReason).notNull(),
    savedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("draft_revisions_field").on(t.pageId, t.field),
    enumCheck(t.reason, draftRevisionReason),
  ],
);
