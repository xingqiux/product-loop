import {
  type Destination,
  destination,
  replyLineKind,
  replySection,
  submissionSource,
} from "@product-loop/model";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  foreignKey,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { BlobHash } from "./blobs.ts";
import { decisions } from "./decisions.ts";
import { bareColumn, enumCheck, enumText, notKey } from "./enum.ts";
import { mainlineRevisions } from "./mainline.ts";
import { pages } from "./pages.ts";
import { projects } from "./projects.ts";
import { queueItems } from "./queue.ts";
import { rounds } from "./rounds.ts";

// 回复和回复的一行，字段见「03 数据模型」第二节「页面和回复」。时间一律存成毫秒数。
// 一页只有一份回复，由 submissions_page 保证。提交的用例在写事务里先查，这个索引兜底。
// 去处的几列在第 44 步处理回复时写。这一步只有取消队列事项和认可更改由后端自动处理。

/**
 * 条件「去处是某一种」。去处为空时结果是假，不是空，所以检查约束能拿它和别的条件比较。
 */
const goesTo = (column: AnySQLiteColumn, key: Destination) =>
  sql`(${bareColumn(column)} is ${sql.raw(`'${key}'`)})`;

/**
 * 回复：用户对一页的一次提交。编号是后端生成的全局整数（约定 0001 第 4 条）。
 * 旧格式的回复文字存原文。工作台交来的结构化内容存成 JSON，以后由它生成旧格式的文字。
 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    /** 项目。和页面的项目相同，另存一列方便按项目查。 */
    projectId: text()
      .notNull()
      .references(() => projects.id),
    pageId: integer()
      .notNull()
      .references(() => pages.id),
    source: enumText(submissionSource).notNull(),
    submittedAt: integer({ mode: "timestamp_ms" }).notNull(),
    /** 旧格式的回复文字。交来的是文字时存原文，交来的是各行时为空。 */
    text: text(),
    /** 工作台交来的结构化内容。交来的是文字时为空。 */
    content: text({ mode: "json" }),
    /** 在等的命令第一次取走回复的时间，见「05 接口」第六节。还没取走的为空。 */
    takenAt: integer({ mode: "timestamp_ms" }),
  },
  (t) => [
    uniqueIndex("submissions_page").on(t.pageId),
    enumCheck(t.source, submissionSource),
    check(
      "submissions_body",
      sql`(${bareColumn(t.text)} is null) <> (${bareColumn(t.content)} is null)`,
    ),
  ],
);

/**
 * 回复的一行：一行一件事。行号在一份回复里从 1 数。
 * 队列事项、决定、主线版本都按项目内的编号引用，所以这里另存项目，外键带上它。
 * 去处写了，处理的时间和执行者也要写。每种去处要求它指向的几列，见下面的检查约束。
 */
export const replyLines = sqliteTable(
  "reply_lines",
  {
    submissionId: integer()
      .notNull()
      .references(() => submissions.id),
    line: integer().notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 这一行在回复文字里从第几行开始。交来的是各行时为空。 */
    textLine: integer(),
    /** 来自哪个区块。想法没有。 */
    section: enumText(replySection),
    /** 卡片编号。想法、取消队列事项、这一轮开始时取消的事没有。 */
    card: text(),
    kind: enumText(replyLineKind).notNull(),
    /** 选的选项的 key。种类是选了选项时必填。 */
    option: text(),
    /** 备注、修改时写的怎么改，或者想法的全文。 */
    note: text(),
    /** 这一行点名的队列事项，Q12 存成 12。种类是取消队列事项时必填。 */
    queue: integer(),
    /** 这一行带的图，写附件的哈希，按在备注里第一次出现的先后。 */
    images: text({ mode: "json" }).$type<readonly BlobHash[]>().notNull(),
    /** 处理这一行之前，AI 已经读过它带的图。 */
    imagesRead: integer({ mode: "boolean" }).notNull(),
    /** 去处。还没处理的为空。 */
    destination: enumText(destination),
    /** 去处是队列：队列事项的编号。 */
    toQueue: integer(),
    /** 去处是决定：决定的编号。 */
    toDecision: integer(),
    /** 去处是主线：改后的主线版本号，和改的是哪一样。 */
    toRevision: integer(),
    toPart: text(),
    /** 去处是当场做：在哪一轮做的。 */
    toRoundId: integer().references(() => rounds.id),
    /** 说明：当场做写完成证据，不处理写原因。 */
    handledNote: text(),
    handledAt: integer({ mode: "timestamp_ms" }),
    /** 执行者，例如 cli/2.0.0。后端自动处理的行写后端。 */
    handledBy: text(),
  },
  (t) => [
    primaryKey({ columns: [t.submissionId, t.line] }),
    foreignKey({
      columns: [t.projectId, t.queue],
      foreignColumns: [queueItems.projectId, queueItems.number],
    }),
    foreignKey({
      columns: [t.projectId, t.toQueue],
      foreignColumns: [queueItems.projectId, queueItems.number],
    }),
    foreignKey({
      columns: [t.projectId, t.toDecision],
      foreignColumns: [decisions.projectId, decisions.id],
    }),
    foreignKey({
      columns: [t.projectId, t.toRevision],
      foreignColumns: [mainlineRevisions.projectId, mainlineRevisions.revision],
    }),
    enumCheck(t.section, replySection),
    enumCheck(t.kind, replyLineKind),
    enumCheck(t.destination, destination),
    check("reply_lines_line", sql`${bareColumn(t.line)} >= 1`),
    // 和 model 的 replyLineSchema 相同：选了选项写选项，想法和只写了备注的写备注。
    check(
      "reply_lines_option",
      sql`${notKey(t.kind, "option")} or ${bareColumn(t.option)} is not null`,
    ),
    check(
      "reply_lines_note",
      sql`${bareColumn(t.kind)} not in ('noteOnly', 'idea') or ${bareColumn(t.note)} is not null`,
    ),
    check(
      "reply_lines_queue",
      sql`${notKey(t.kind, "queueDrop")} or ${bareColumn(t.queue)} is not null`,
    ),
    // 去处、处理的时间和执行者同时有或同时没有。
    check(
      "reply_lines_handled",
      sql`(${bareColumn(t.destination)} is null) = (${bareColumn(t.handledAt)} is null) and (${bareColumn(t.destination)} is null) = (${bareColumn(t.handledBy)} is null)`,
    ),
    // 每种去处写它指向的东西，别的去处不写这几列。
    check(
      "reply_lines_to_queue",
      sql`${goesTo(t.destination, "queue")} = (${bareColumn(t.toQueue)} is not null)`,
    ),
    check(
      "reply_lines_to_decision",
      sql`${goesTo(t.destination, "decision")} = (${bareColumn(t.toDecision)} is not null)`,
    ),
    check(
      "reply_lines_to_mainline",
      sql`${goesTo(t.destination, "mainline")} = (${bareColumn(t.toRevision)} is not null) and (${bareColumn(t.toRevision)} is null) = (${bareColumn(t.toPart)} is null)`,
    ),
    check(
      "reply_lines_to_round",
      sql`${goesTo(t.destination, "doneHere")} = (${bareColumn(t.toRoundId)} is not null)`,
    ),
    check(
      "reply_lines_handled_note",
      sql`(${goesTo(t.destination, "doneHere")} or ${goesTo(t.destination, "noAction")}) = (${bareColumn(t.handledNote)} is not null)`,
    ),
  ],
);
