import { decisionKind, decisionStatus } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, foreignKey, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bareColumn, enumCheck, enumText, isKey } from "./enum.ts";
import { projects } from "./projects.ts";

/**
 * 决定：一条用户看得见的行为决定，字段见「03 数据模型」第二节「队列和决定」。
 * 编号在项目内唯一。新增时取这个项目最大的编号加一，迁移时保留旧表的编号。
 * 作废的不删，状态改成已作废，并写明被同一项目的哪一条推翻。
 */
export const decisions = sqliteTable(
  "decisions",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 编号，接口上写数字，和 model 的 decisionSchema 的 id 相同。 */
    id: integer().notNull(),
    kind: enumText(decisionKind).notNull(),
    decision: text().notNull(),
    reason: text().notNull(),
    case: text().notNull(),
    /** 日期，写成 2026-09-28。新增时由后端按北京时间的日期填，迁移时取旧表的日期。 */
    date: text().notNull(),
    status: enumText(decisionStatus).notNull(),
    /** 被哪一条推翻：同一项目里那一条的编号。只有已作废的有。 */
    voidedBy: integer(),
    /** 作废原因，可以不写。只有已作废的有。 */
    voidReason: text(),
    /**
     * 来自哪一行回复：回复的编号和行号，两列同时有或同时没有。
     * 只存编号，不加外键。加外键要重建这张表，由处理回复的用例保证编号存在。
     */
    fromSubmission: integer(),
    fromLine: integer(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    // 推翻它的那一条必须在同一个项目里，并且已经存在。
    foreignKey({ columns: [t.projectId, t.voidedBy], foreignColumns: [t.projectId, t.id] }),
    enumCheck(t.kind, decisionKind),
    enumCheck(t.status, decisionStatus),
    // 已作废的写明被哪一条推翻，有效的不写。作废原因只有已作废的有。
    check(
      "decisions_voided_by",
      sql`(${isKey(t.status, "voided")}) = (${bareColumn(t.voidedBy)} is not null)`,
    ),
    check(
      "decisions_void_reason",
      sql`${bareColumn(t.voidReason)} is null or ${isKey(t.status, "voided")}`,
    ),
    // 决定不能被自己推翻。没写推翻它的那一条时，比较的结果是空，检查照常通过。
    check("decisions_not_self", sql`${bareColumn(t.voidedBy)} <> ${bareColumn(t.id)}`),
    check(
      "decisions_from_line",
      sql`(${bareColumn(t.fromSubmission)} is null) = (${bareColumn(t.fromLine)} is null)`,
    ),
    check(
      "decisions_date",
      sql`${bareColumn(t.date)} glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`,
    ),
  ],
);
