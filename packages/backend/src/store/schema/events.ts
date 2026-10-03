import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "./json.ts";
import { projects } from "./projects.ts";

/**
 * 事件：每一次改动记一条，字段见「03 数据模型」第二节。只加不改。
 * 编号递增，事件流里的每条事件都带着它，见「05 接口」第五节。
 */
export const events = sqliteTable(
  "events",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 执行者的客户端和版本，例如 cli/2.0.0。取自 X-Ploop-Client 请求头。 */
    client: text().notNull(),
    /** 执行者所在的 AI 会话，取自 X-Ploop-Session 请求头。取不到时为空，见约定 0001 第 22 条。 */
    session: text(),
    /**
     * 种类，写成「对象.动作」，例如 round.started、queue.moved。
     * 事件流按前缀归到「05 接口」第五节的事件，见约定 0002 第 9 条。
     */
    kind: text().notNull(),
    /** 改的是哪一类对象，用术语对照表里的英文名，例如 round、queueItem。 */
    objectType: text().notNull(),
    /** 对象的编号。各类对象的编号写法不同，一律存成文字。 */
    objectId: text().notNull(),
    /** 改动内容。没有要记的就是空对象。 */
    detail: text({ mode: "json" }).$type<JsonObject>().notNull(),
  },
  (t) => [
    // 按项目看改动的记录。
    index("events_project").on(t.projectId),
    // 按对象查它的历次改动，例如一条决定的变化、一轮是哪个会话开的。
    index("events_object").on(t.objectType, t.objectId),
  ],
);
