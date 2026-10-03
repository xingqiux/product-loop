import { legacyMigrationStatus } from "@product-loop/model";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText } from "./enum.ts";
import { projects } from "./projects.ts";

// 迁移状态：一个旧项目迁移走到了哪一步，见「08 版本与迁移」第四节和第一期计划第 61 步。
// 每个项目一行。归档以后写这一行，导入和完成时改它。没做成的一步和原因也记在这里，
// ploop doctor 据此写明上一次停在哪里。时间一律存成毫秒数。

/** 归档包里的一个文件：相对旧文件位置的路径、字节数和 SHA-256。 */
export type ArchiveEntry = {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
};

/** 旧文件里数出的数量，导入以后逐项核对。 */
export type LegacyCounts = {
  readonly rounds: number;
  readonly pages: number;
  readonly decisions: number;
  readonly queue: number;
  readonly images: number;
};

/** 没做成的一步。 */
export type LegacyFailure = {
  readonly step: string;
  readonly message: string;
  /** 毫秒数。 */
  readonly at: number;
};

export const legacyMigrations = sqliteTable(
  "legacy_migrations",
  {
    projectId: text()
      .primaryKey()
      .references(() => projects.id),
    status: enumText(legacyMigrationStatus).notNull(),
    /** 归档包在 archives/ 下的文件名。 */
    archiveFile: text().notNull(),
    archiveSha256: text().notNull(),
    archiveBytes: integer().notNull(),
    /** 归档包的文件清单，后端核对过每个文件的哈希。 */
    manifest: text({ mode: "json" }).$type<readonly ArchiveEntry[]>().notNull(),
    /** 导入以后写进去的数量。还没导入时为空。 */
    counts: text({ mode: "json" }).$type<LegacyCounts>(),
    failure: text({ mode: "json" }).$type<LegacyFailure>(),
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    updatedAt: integer({ mode: "timestamp_ms" }).notNull(),
    completedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [enumCheck(t.status, legacyMigrationStatus)],
);
