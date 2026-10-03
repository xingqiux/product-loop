import { ok, type Result } from "@product-loop/model";
import { and, eq, lte } from "drizzle-orm";
import { idempotencyKeys } from "../store/schema/index.ts";
import type { Json } from "../store/schema/json.ts";
import type { Tx } from "./tx.ts";

// 请求编号：命令行重发同一个请求时，后端返回第一次的结果，不重复执行。
// 见「01 架构」第七节和「05 接口」第三节。编号保留二十四小时。
// 查编号、执行、记下结果都在同一个写事务里，所以同一个编号不会执行两次。
// 事务回滚时不留编号，重发时照常执行。

/** 编号保留多久，毫秒。 */
export const idempotencyTtlMs = 24 * 60 * 60 * 1000;

/** 写请求带的请求编号，接口层从 Idempotency-Key 请求头取。 */
export type IdempotencyKey = {
  /** 请求头的原值。客户端每发一个写请求生成一个，只在重发这个请求时沿用（约定 0002 第 2 条）。 */
  readonly key: string;
  /**
   * 请求做的是哪个操作。接口层写方法和路由，例如 POST /api/v1/projects/:pid。
   * 编号和操作一起确定一个请求，编号万一重复，不同的操作也不会串。
   */
  readonly operation: string;
};

/**
 * 在写事务里执行一次带编号的请求。先删掉过期的编号，再查这个编号。
 * 查到就返回第一次的结果，不执行 run。查不到就执行，成功时记下结果。
 * 失败的结果不记，写事务随后回滚，重发时照常执行。
 */
export function runOnce<T extends Json, E>(
  tx: Tx,
  request: IdempotencyKey,
  now: Date,
  run: () => Result<T, E>,
): Result<T, E> {
  const expired = new Date(now.getTime() - idempotencyTtlMs);
  tx.delete(idempotencyKeys).where(lte(idempotencyKeys.createdAt, expired)).run();
  const stored = tx
    .select({ result: idempotencyKeys.result })
    .from(idempotencyKeys)
    .where(
      and(eq(idempotencyKeys.key, request.key), eq(idempotencyKeys.operation, request.operation)),
    )
    .get();
  // 同一个编号和操作，第一次的结果就是这个类型。
  if (stored !== undefined) return ok(stored.result as T);
  const result = run();
  if (result.ok) {
    const { key, operation } = request;
    tx.insert(idempotencyKeys)
      .values({ key, operation, result: result.value, createdAt: now })
      .run();
  }
  return result;
}
