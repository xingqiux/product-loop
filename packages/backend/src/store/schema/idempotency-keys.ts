import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { Json } from "./json.ts";

/**
 * 请求编号：会改数据的请求带的随机编号。
 * 请求头是 Idempotency-Key，见「05 接口」第三节和约定第 21 条。
 * 记下第一次的结果，二十四小时内重发时原样返回，不再执行。
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    key: text().notNull(),
    /**
     * 请求做的是哪个操作，接口层写方法和路径。
     * 一次命令调用只生成一个编号，其中的几个写请求靠它分开。
     */
    operation: text().notNull(),
    /** 第一次的结果。结果是 null 时这一列为空。 */
    result: text({ mode: "json" }).$type<Json>(),
    createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.operation] }),
    // 删过期的编号时按时间找。
    index("idempotency_keys_created_at").on(t.createdAt),
  ],
);
