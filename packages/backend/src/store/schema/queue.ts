import { proposer, type QueueStatus, queueStatus, stage } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText, notKey } from "./enum.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

// 队列事项和队列变动，字段见「03 数据模型」第二节「队列和决定」。时间一律存成毫秒数。

/**
 * 检查约束里的列名，照 drizzle.config.ts 的蛇形写法手写，不带表名，道理见 enum.ts。
 * 写错了列名，迁移时 SQLite 就报错，测试随之失败。
 */
const column = (name: string) => sql.identifier(name);

/** 状态要求写上的列，和 model 的 queueItemSchema 相同：等待写依赖，已完成写证据，已取消写原因。 */
const requiredByStatus = [
  ["waiting", "depends_on"],
  ["done", "evidence"],
  ["dropped", "status_note"],
] as const satisfies readonly (readonly [QueueStatus, string])[];

/**
 * 队列事项：还没做的一件事。保留旧队列的十格，外加编号和修改计数。
 * 编号在项目内从 1 起连续编，写成 Q12。事项不删，取消也只是改状态，所以编号不会空出来。
 * 没有的格存成空，不存空字符串。
 */
export const queueItems = sqliteTable(
  "queue_items",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 项目内的编号，Q12 存成 12。 */
    number: integer().notNull(),
    content: text().notNull(),
    /** 要做它的阶段。 */
    stage: enumText(stage).notNull(),
    proposer: enumText(proposer).notNull(),
    /** 提出时的轮次。在两轮之间放进来的为空。 */
    proposedInRoundId: integer().references(() => rounds.id),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    status: enumText(queueStatus).notNull(),
    /** 状态说明：等待写依赖，已完成写证据，已取消写原因，退回和捞回写说明。 */
    statusNote: text(),
    dependsOn: text(),
    acceptance: text(),
    evidence: text(),
    /** 子项，存成文字的 JSON 数组。没有子项时是空数组。 */
    subItems: text({ mode: "json" }).$type<readonly string[]>().notNull(),
    /** 来源。重新要做一件已完成或已取消的事，在这里写明接的是哪一件。 */
    source: text(),
    /** 备注：内容放不下的细节，多行文字，不限长度。没有就为空。 */
    note: text(),
    /** 来自哪一行回复：回复的编号和行号，两列同时有或同时没有。不加外键，由处理回复的用例保证编号存在。 */
    fromSubmissionId: integer(),
    fromLine: integer(),
    /** 修改计数：内容、验收标准、子项、来源、备注每改一次加一，见「05 接口」第三节的 If-Match。 */
    editCount: integer().notNull(),
  },
  (t) => [
    uniqueIndex("queue_items_number").on(t.projectId, t.number),
    enumCheck(t.stage, stage),
    enumCheck(t.proposer, proposer),
    enumCheck(t.status, queueStatus),
    ...requiredByStatus.map(([status, name]) =>
      check(
        `queue_items_${status}_${name}`,
        sql`${notKey(t.status, status)} or ${column(name)} is not null`,
      ),
    ),
    check(
      "queue_items_from_line",
      sql`(${column("from_submission_id")} is null) = (${column("from_line")} is null)`,
    ),
  ],
);

/**
 * 队列变动：一件事的每次状态变化，只加不改。放进队列的那一次没有 from，状态是待办。
 * 「停了很多天的事」按每件事最近一次变动的时间算，见「06 工作台」第七节。
 */
export const queueEvents = sqliteTable(
  "queue_events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    itemId: integer()
      .notNull()
      .references(() => queueItems.id),
    at: integer({ mode: "timestamp_ms" }).notNull(),
    fromStatus: enumText(queueStatus),
    toStatus: enumText(queueStatus).notNull(),
    /** 这一次变化的说明，和事项上的状态说明相同。拿出来的那一次为空，轮次记在 roundId。 */
    note: text(),
    /** 在哪一轮。两轮之间的变化为空。 */
    roundId: integer().references(() => rounds.id),
    /** 执行者的客户端和版本，例如 cli/2.0.0。 */
    actor: text().notNull(),
    /** 执行者所在的 AI 会话。取不到时为空，见约定第 22 条。 */
    session: text(),
  },
  (t) => [
    // 按事项查它的历次变化。
    index("queue_events_item").on(t.itemId),
    enumCheck(t.fromStatus, queueStatus),
    enumCheck(t.toStatus, queueStatus),
  ],
);
