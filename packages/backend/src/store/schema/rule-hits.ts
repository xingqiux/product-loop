import { defineEnum, type KeyOf, ruleLevel } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bareColumn, enumCheck, enumText, isKey } from "./enum.ts";
import { pages } from "./pages.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

/** 命中来自三层校验的哪一层，见「07 校验」第一节。 */
export const ruleHitLayer = defineEnum({
  definition: "数据定义",
  rule: "校验规则",
  writing: "写作校验",
});
export type RuleHitLayer = KeyOf<typeof ruleHitLayer>;

/** 校验的方式：平时，或者迁移旧页面时的历史页面模式，见「07 校验」第七节。 */
export const ruleRunMode = defineEnum({ current: "平时", history: "历史页面" });
export type RuleRunMode = KeyOf<typeof ruleRunMode>;

/**
 * 拦截和警告的记录：每次命中记一行，字段见「03 数据模型」第二节。只加不改。
 * 「skill 的问题」页按规矩的编号数命中，列出反复被拦截的规矩，见「07 校验」第三节和第八节。
 */
export const ruleHits = sqliteTable(
  "rule_hits",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 校验的是哪一轮的页面。历史页面模式没有轮次，为空。 */
    roundId: integer().references(() => rounds.id),
    /** 给出信息存成的页面。只校验、没有存成页面时为空，给出信息被拦截时也为空。 */
    pageId: integer().references(() => pages.id),
    /** 是哪条命令触发的，写 ploop 后面的部分，例如 page present。 */
    command: text().notNull(),
    mode: enumText(ruleRunMode).notNull(),
    /** 历史页面模式写页面的日期，平时为空。 */
    pageDate: text(),
    layer: enumText(ruleHitLayer).notNull(),
    /** 规矩的编号。数据定义那一层写定义里那一项的编号，例如 page.field.unknown。 */
    rule: text().notNull(),
    level: enumText(ruleLevel).notNull(),
    /** 在哪里：字段的路径，或者写好的位置。 */
    where: text(),
    /** 报错的原文：什么不对，和怎么改。 */
    message: text().notNull(),
    hint: text(),
  },
  (t) => [
    // 按项目看记录，按规矩数命中。
    index("rule_hits_project").on(t.projectId),
    index("rule_hits_rule").on(t.rule),
    enumCheck(t.mode, ruleRunMode),
    enumCheck(t.layer, ruleHitLayer),
    enumCheck(t.level, ruleLevel),
    check(
      "rule_hits_page_date",
      sql`(${isKey(t.mode, "history")}) = (${bareColumn(t.pageDate)} is not null)`,
    ),
  ],
);
