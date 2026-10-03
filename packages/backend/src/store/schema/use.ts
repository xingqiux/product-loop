import { useStepResult } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { type BlobHash, blobs } from "./blobs.ts";
import { bareColumn, enumCheck, enumText } from "./enum.ts";
import type { JsonObject } from "./json.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

// 使用记录和屏，字段见「03 数据模型」第二节「使用记录和屏」。时间一律存成毫秒数。
// 截图都在附件库里，这里记附件的哈希，并在附件引用表里记一条，见「03 数据模型」第六节。

/**
 * 使用代码的一次运行，收进来以后不改。挂在收进来时开着的那一轮上。
 * ploop use ingest 收下现成的输出时，命令行不知道命令、退出码和提交，这几列为空。
 */
export const useRuns = sqliteTable(
  "use_runs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    roundId: integer()
      .notNull()
      .references(() => rounds.id),
    /** 运行的程序和参数，原样记下，不经过 shell。 */
    command: text({ mode: "json" }).$type<readonly string[]>(),
    startedAt: integer({ mode: "timestamp_ms" }),
    finishedAt: integer({ mode: "timestamp_ms" }),
    exitCode: integer(),
    /** 运行时的 HEAD，完整的提交号。 */
    commit: text(),
    /** 覆盖表的快照：命令行读到的覆盖表全文。怎么查缺口由第 54 步定。 */
    coverage: text(),
    /** 环境说明，取自 use-run.json 的 environment。 */
    environment: text(),
    /** 收进来的时间。 */
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("use_runs_round").on(t.roundId), index("use_runs_project").on(t.projectId)],
);

/**
 * 使用步骤：一个场景的一步在一个宽度下的结果，按 use-run.json 里的先后编号。
 * 场景编号 S14 存成 14，和场景表相同。场景不在主线里的照样记下，收进来时另给警告。
 */
export const useSteps = sqliteTable(
  "use_steps",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    runId: integer()
      .notNull()
      .references(() => useRuns.id),
    scene: integer().notNull(),
    step: integer().notNull(),
    /** 截图时窗口的宽度。命令行的场景没有。 */
    width: integer(),
    do: text().notNull(),
    expect: text().notNull(),
    result: enumText(useStepResult).notNull(),
    shot: text()
      .$type<BlobHash>()
      .references(() => blobs.hash),
    facts: text({ mode: "json" }).$type<JsonObject>(),
    error: text(),
  },
  (t) => [
    index("use_steps_run").on(t.runId),
    enumCheck(t.result, useStepResult),
    check(
      "use_steps_shot_width",
      sql`${bareColumn(t.shot)} is null or ${bareColumn(t.width)} is not null`,
    ),
  ],
);

/**
 * 屏：产品里的一屏，以场景、步号和宽度确定。只由结果是通过的步骤的截图更新。
 * 「上一版的截图」是这一版以前最后一次截到的，这一版的截图都和它比，见 core/use/ingest.ts。
 */
export const screens = sqliteTable(
  "screens",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    scene: integer().notNull(),
    step: integer().notNull(),
    width: integer().notNull(),
    /** 首次出现的版本。 */
    firstVersion: integer().notNull(),
    /** 最近一次的截图。 */
    shot: text()
      .$type<BlobHash>()
      .notNull()
      .references(() => blobs.hash),
    /** 最近一次截图的感知哈希，见 store/screen-hash.ts。 */
    phash: text().notNull(),
    /** 最近一次截图是哪一版截的。 */
    shotVersion: integer().notNull(),
    /** 上一版的截图和它的感知哈希。这一屏在 shotVersion 这一版才出现时为空。 */
    baseShot: text()
      .$type<BlobHash>()
      .references(() => blobs.hash),
    basePhash: text(),
    /** 最近一次变化的版本。没变过的为空。 */
    changedVersion: integer(),
  },
  (t) => [
    uniqueIndex("screens_key").on(t.projectId, t.scene, t.step, t.width),
    check(
      "screens_base",
      sql`(${bareColumn(t.baseShot)} is null) = (${bareColumn(t.basePhash)} is null)`,
    ),
  ],
);
