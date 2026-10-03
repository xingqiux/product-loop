import type { LandPlanSection, LandPlanTidy, ReviewLevel, VerdictRow } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { commandRuns } from "./command-runs.ts";
import { bareColumn } from "./enum.ts";
import { rounds } from "./rounds.ts";

// 落地记录和功能改动，字段见「03 数据模型」第二节「落地和命令运行」。时间一律存成毫秒数。
// 一个落地轮一份落地记录，交计划时建。重构、评审记在这一份上，每件功能改动另记一行。

/** 一条评审意见：指到文件和行，分阻塞和建议，阻塞的写处置。沿用旧的评审.json。 */
export type ReviewOpinion = {
  readonly file: string;
  /** 从 1 数的行号。 */
  readonly line: number;
  readonly level: ReviewLevel;
  readonly text: string;
  /** 处置：改了什么，或者为什么不改。阻塞的必写，建议的可以不写。 */
  readonly disposition?: string;
};

/**
 * 评审时这一批改动的规模，和当时的评审界线，见「04 命令行」第十一节（决定 173）。
 * 行数是增加和删除的行数之和，文件数是改到的文件的个数。
 */
export type ReviewDiffSize = {
  readonly lines: number;
  readonly files: number;
  /** 改到的依赖清单和锁文件。有这样的文件，就算加了依赖，见约定 0001 第 12 条。 */
  readonly dependencyFiles: readonly string[];
  /** 命中 config.json 里数据格式路径的文件。有这样的文件，就算改了数据格式。 */
  readonly dataFormatFiles: readonly string[];
  /** 当时的界线：行数和文件数。 */
  readonly maxLines: number;
  readonly maxFiles: number;
  /** 在界线以内，可以跳过评审。 */
  readonly within: boolean;
};

/**
 * 落地记录：一个落地轮的五步里记在一处的几样。一轮只有一份，交计划时建，再交计划时换成新的。
 * 重构：跳过时记计划里写的理由，做了时记检查命令的那次运行，运行记下的提交就是重构的提交。
 * 评审：记意见，或者跳过的理由。跳过时一定记下改动的规模。
 */
export const landRecords = sqliteTable(
  "land_records",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    roundId: integer()
      .notNull()
      .references(() => rounds.id),
    /** 计划全文，就是项目缓存里的计划.md。 */
    planText: text().notNull(),
    /** 计划七节各自的正文，键是七节的英文键。 */
    planSections: text({ mode: "json" })
      .$type<Readonly<Record<LandPlanSection, string>>>()
      .notNull(),
    /** 「要不要先重构」写的是要，还是不要加理由。 */
    planTidy: text({ mode: "json" }).$type<LandPlanTidy>().notNull(),
    /** 裁决表的每一行，不含表头。 */
    verdicts: text({ mode: "json" }).$type<readonly VerdictRow[]>().notNull(),
    /** 最近一次交计划的时间。 */
    plannedAt: integer({ mode: "timestamp_ms" }).notNull(),
    /** 跳过重构的理由，取自计划。做了重构时为空。 */
    tidySkipReason: text(),
    /** 重构以后检查命令的那次运行。跳过重构时为空。 */
    tidyRunId: integer().references(() => commandRuns.id),
    /** 记下重构的时间。还没记时为空。 */
    tidiedAt: integer({ mode: "timestamp_ms" }),
    /** 评审意见。跳过评审时为空，没有意见时是空数组。 */
    reviewOpinions: text({ mode: "json" }).$type<readonly ReviewOpinion[]>(),
    /** 跳过评审的理由。 */
    reviewSkipReason: text(),
    /** 评审时这一批改动的规模。跳过评审时必有，评审了的可以没有。 */
    reviewDiff: text({ mode: "json" }).$type<ReviewDiffSize>(),
    /** 记下评审的时间。还没记时为空。 */
    reviewedAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => {
    const tidySkip = bareColumn(t.tidySkipReason);
    const tidyRun = bareColumn(t.tidyRunId);
    const opinions = bareColumn(t.reviewOpinions);
    const reviewSkip = bareColumn(t.reviewSkipReason);
    return [
      // 一轮只有一份落地记录。
      uniqueIndex("land_records_round").on(t.roundId),
      // 重构要么跳过，要么有检查命令的运行，只记一样。记了才有时间。
      check("land_records_tidy", sql`${tidySkip} is null or ${tidyRun} is null`),
      check(
        "land_records_tidied_at",
        sql`(${bareColumn(t.tidiedAt)} is null) = (${tidySkip} is null and ${tidyRun} is null)`,
      ),
      // 评审要么有意见，要么跳过，只记一样。记了才有时间。跳过时要有改动的规模。
      check("land_records_review", sql`${opinions} is null or ${reviewSkip} is null`),
      check(
        "land_records_reviewed_at",
        sql`(${bareColumn(t.reviewedAt)} is null) = (${opinions} is null and ${reviewSkip} is null)`,
      ),
      check(
        "land_records_review_skip_diff",
        sql`${reviewSkip} is null or ${bareColumn(t.reviewDiff)} is not null`,
      ),
    ];
  },
);

/**
 * 功能改动：这一批里的一件改动，名字就是计划「功能改动」里这一件的名字。
 * 记改之前失败的时候建这一行，所以一定有失败的那次运行。只有通过、没有失败的记录进不来。
 * 通过时记下通过的那次运行和对应的提交，两样同有同无。重记失败时，通过的几样清空。
 */
export const landChanges = sqliteTable(
  "land_changes",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    landRecordId: integer()
      .notNull()
      .references(() => landRecords.id),
    name: text().notNull(),
    /**
     * 对应的队列事项，存队列编号的数字，按编号排，没有对应的是空数组。
     * 取自通过时那几个提交的说明末尾写的「队列: Q12」，见「10 工程规范与流程」第三节。
     */
    queueNumbers: text({ mode: "json" }).$type<readonly number[]>().notNull(),
    /** 改之前失败的那次运行。 */
    redRunId: integer()
      .notNull()
      .references(() => commandRuns.id),
    /** 改之后通过的那次运行。还没通过时为空。 */
    greenRunId: integer().references(() => commandRuns.id),
    /** 对应的提交，就是通过时的提交。 */
    commit: text(),
    /** 失败以后到通过为止的提交，由 git rev-list --ancestry-path 列出，通过时的提交在内。 */
    commitsAfterRed: text({ mode: "json" }).$type<readonly string[]>(),
  },
  (t) => {
    const green = bareColumn(t.greenRunId);
    return [
      uniqueIndex("land_changes_name").on(t.landRecordId, t.name),
      check("land_changes_commit", sql`(${green} is null) = (${bareColumn(t.commit)} is null)`),
      check(
        "land_changes_commits_after_red",
        sql`(${green} is null) = (${bareColumn(t.commitsAfterRed)} is null)`,
      ),
    ];
  },
);
