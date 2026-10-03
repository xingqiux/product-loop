import { repoKind, versionStatus } from "@product-loop/model";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText, notKey } from "./enum.ts";

// 项目和产品版本，字段见「03 数据模型」第二节。时间一律存成毫秒数。

/** 项目。编号是根目录名转成的 ASCII 短名，重名时加数字，见第一期计划第三节。 */
export const projects = sqliteTable(
  "projects",
  {
    id: text().primaryKey(),
    /** 页头上的系统名。 */
    name: text().notNull(),
    repoKind: enumText(repoKind).notNull(),
    /** 忽略规则写在哪个文件：自己的仓库写 .gitignore，共用的写 .git/info/exclude。 */
    ignoreFile: text(),
    /** 停在哪一版 skill，例如 0.0.1。迁移完成以前为空。 */
    skillVersion: text(),
    /** 迁移前的旧数据在哪里，例如 docs/ 或 --from 指的文件夹。新建的项目为空。 */
    legacySource: text(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    archivedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [enumCheck(t.repoKind, repoKind)],
);

/**
 * 项目根目录。一个项目可以有多个，对应 git 的多个工作目录，见约定第 21 条。
 * 同一个目录只能属于一个项目，命令行按目录找项目时只认这里登记过的。
 */
export const projectRoots = sqliteTable("project_roots", {
  id: integer().primaryKey({ autoIncrement: true }),
  projectId: text()
    .notNull()
    .references(() => projects.id),
  path: text().notNull().unique(),
  addedAt: integer({ mode: "timestamp_ms" }).notNull(),
});

/** 产品版本：一次完整的循环。版本号在项目内从 1 开始，同一个项目最多一版没结束。 */
export const productVersions = sqliteTable(
  "product_versions",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id),
    version: integer().notNull(),
    status: enumText(versionStatus).notNull(),
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    endedAt: integer({ mode: "timestamp_ms" }),
    /** 一句话小结。 */
    summary: text(),
    /**
     * 结束这一版的原因，见「08 版本与迁移」第二节。ploop version next 写 AI 给的原因。
     * 提升轮收尾以后，开始一轮时自动换版，写明是哪一轮提升收尾。
     * 小结写这一版做了什么，原因写为什么在这里结束，所以分两列。
     */
    endReason: text(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.version] }),
    uniqueIndex("product_versions_one_open").on(t.projectId).where(notKey(t.status, "closed")),
    enumCheck(t.status, versionStatus),
  ],
);
