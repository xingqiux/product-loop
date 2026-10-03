import { type MainlineParse, mainlineSource } from "@product-loop/model";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { bareColumn, enumCheck, enumText } from "./enum.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

// 主线版本和场景，字段见「03 数据模型」第二节「主线和场景」。时间一律存成毫秒数。

/**
 * 主线版本：主线的一次修改，只加不改。版本号在项目内从 1 起连续编。
 * 全文是补好场景编号以后的，命令把它写回项目缓存的主线.md，见「03 数据模型」第五节。
 */
export const mainlineRevisions = sqliteTable(
  "mainline_revisions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 项目内的版本号，从 1 起。project.json 的 mainlineBase 记的就是它。 */
    revision: integer().notNull(),
    /** 全文，补好了场景编号。 */
    text: text().notNull(),
    /** 全文按 UTF-8 编码的 SHA-256，写成六十四位小写十六进制。命令拿它和主线.md 比较。 */
    hash: text().notNull(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    source: enumText(mainlineSource).notNull(),
    /** 在哪一轮改的。两轮之间交上来的为空。 */
    roundId: integer().references(() => rounds.id),
    /** 解析结果：十样各在不在、场景、设计规范的十二样、写作规范一节，以及查出的问题。 */
    parsed: text({ mode: "json" }).$type<MainlineParse>().notNull(),
    /**
     * 到这一版为止用过的最大的场景编号，包括已经删掉的场景，没有场景时是 0。
     * 下一版补编号时从它往后数，所以删掉的编号不会再用。
     */
    maxSceneId: integer().notNull(),
  },
  (t) => [
    // 场景表按版本号指到这一版，所以版本号要能当外键的目标。
    uniqueIndex("mainline_revisions_revision").on(t.projectId, t.revision),
    enumCheck(t.source, mainlineSource),
  ],
);

/** 场景的一步：步号、做什么、该看到什么。行号随主线的版本变，不存。 */
export type SceneStep = {
  readonly step: number;
  readonly do: string;
  readonly expect: string;
};

/**
 * 场景：主线场景清单里的一个场景，按场景编号记。
 * 编号由后端在场景第一次出现时补上，此后不变。名字、谁在什么时候用和步骤，取最近一次出现时的。
 * 场景从主线里删掉时，这一行留着，记下从哪一版起不在，编号也不再给别的场景用。
 */
export const scenes = sqliteTable(
  "scenes",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 场景编号，S14 存成 14。 */
    number: integer().notNull(),
    /** 名字，不含后面括号里的说明。 */
    name: text().notNull(),
    /** 谁在什么时候用。旧写法的场景没写时为空。 */
    who: text(),
    steps: text({ mode: "json" }).$type<readonly SceneStep[]>().notNull(),
    /** 首次出现的主线版本号。 */
    firstRevision: integer().notNull(),
    /** 最近一次出现的主线版本号。 */
    latestRevision: integer().notNull(),
    /** 从哪一版起不在主线里。还在的为空，删掉以后又写回来的也清空。 */
    removedInRevision: integer(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.number] }),
    foreignKey({
      columns: [t.projectId, t.firstRevision],
      foreignColumns: [mainlineRevisions.projectId, mainlineRevisions.revision],
    }),
    foreignKey({
      columns: [t.projectId, t.latestRevision],
      foreignColumns: [mainlineRevisions.projectId, mainlineRevisions.revision],
    }),
    foreignKey({
      columns: [t.projectId, t.removedInRevision],
      foreignColumns: [mainlineRevisions.projectId, mainlineRevisions.revision],
    }),
    check(
      "scenes_first_latest",
      sql`${bareColumn(t.firstRevision)} <= ${bareColumn(t.latestRevision)}`,
    ),
    // 不见的那一版在最近一次出现以后。还在的场景为空，比较的结果是空，检查照常通过。
    check(
      "scenes_removed_after_latest",
      sql`${bareColumn(t.removedInRevision)} > ${bareColumn(t.latestRevision)}`,
    ),
  ],
);
