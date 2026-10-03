import { roundItemResult, stage } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bareColumn, enumCheck, enumText, isKey } from "./enum.ts";
import { queueItems } from "./queue.ts";
import { rounds } from "./rounds.ts";

/**
 * 拿出的事：开始一轮时从队列拿进这一轮的事，落地轮叫「这一批」，字段见「03 数据模型」第二节。
 * 一件事在一轮里只拿一次。退回以后可以再拿进以后的轮次，每一轮各记一行。
 * 结果在收尾时写，收尾以前为空。开始时改成等待的事不拿进这一轮，不记在这里。
 */
export const roundItems = sqliteTable(
  "round_items",
  {
    roundId: integer()
      .notNull()
      .references(() => rounds.id),
    queueItemId: integer()
      .notNull()
      .references(() => queueItems.id),
    /** 结果：做完、退回、开始时取消。收尾以前为空。 */
    result: enumText(roundItemResult),
    /** 退回到哪个阶段。只有退回的事有。 */
    returnedTo: enumText(stage),
    /** 说明，例如退回的原因。 */
    note: text(),
    /** 拿进这一轮的时间，就是开始这一轮的时间。 */
    takenAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.roundId, t.queueItemId] }),
    enumCheck(t.result, roundItemResult),
    enumCheck(t.returnedTo, stage),
    check(
      "round_items_returned_to",
      sql`${bareColumn(t.returnedTo)} is null or ${isKey(t.result, "returned")}`,
    ),
  ],
);
