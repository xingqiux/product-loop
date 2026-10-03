import { skillIssueStatus } from "@product-loop/model";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText } from "./enum.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

// skill 的问题，字段见「03 数据模型」第二节「skill 的问题和运行信号」。时间一律存成毫秒数。
// 各项目的会话用 ploop skill report 报上来，维护 skill 的会话用 ploop skill issues 查看和处理。

export const skillIssues = sqliteTable(
  "skill_issues",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 报告时开着的一轮，或这一版最近的一轮。项目还没有轮次时为空。 */
    roundId: integer().references(() => rounds.id),
    reportedAt: integer({ mode: "timestamp_ms" }).notNull(),
    /** 报告者：客户端和版本，例如 cli/2.0.0。 */
    reporter: text().notNull(),
    /** 报告的会话。命令行取不到就为空。 */
    session: text(),
    /** 方面，例如页面、命令、正文。 */
    aspect: text().notNull(),
    /** 问题的类。 */
    issueClass: text().notNull(),
    /** 原始情况，作为例子。 */
    example: text().notNull(),
    /** 报告时项目用的 skill 版本。 */
    skillVersion: text(),
    status: enumText(skillIssueStatus).notNull(),
    /** 处理说明：回的理解、不改的理由。 */
    note: text(),
    /** 在哪一版改的。 */
    fixedIn: text(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("skill_issues_status").on(t.status),
    index("skill_issues_project").on(t.projectId),
    enumCheck(t.status, skillIssueStatus),
  ],
);
