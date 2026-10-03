import type { Err, Result } from "@product-loop/model";
import type Database from "better-sqlite3";
import type { Db } from "../store/db.ts";
import type { Json } from "../store/schema/json.ts";
import type { Actor, Notifier, StoredEvent } from "./events.ts";
import { type IdempotencyKey, runOnce } from "./idempotency.ts";

// 写事务，见「01 架构」第七节和「10 工程规范与流程」第二节。
// better-sqlite3 的调用都是同步的。写事务从开始到提交不让出执行权，不会交错。
// 写事务用 immediate 方式开始，一开始就拿到写锁。
// 回调里不能 await。better-sqlite3 只撤销第一个 await 之前的写入。
// 之后的写入不在事务里，会直接写进数据库。所以异步的回调一行都不执行。
// 事务结束以后，再用 w.tx 也会报错。

/** Drizzle 在事务回调里给的数据库对象。 */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 内核的依赖。后端启动时建一份，测试里换成临时数据库和假时钟。 */
type Core = {
  readonly db: Db;
  /** 写事务提交以后，把事件发给订阅者。 */
  readonly notifier: Notifier;
  readonly now: () => Date;
};

/**
 * 一次写请求的上下文：内核的依赖，加上执行者和请求编号。
 * 接口层按请求头为每个请求建一份，见「05 接口」第三节。
 */
export type WriteContext = Core & {
  readonly actor: Actor;
  /** 带了请求编号，就记下第一次的结果，重发时原样返回，见 idempotency.ts。 */
  readonly idempotency?: IdempotencyKey | undefined;
};

/** 写事务的回调拿到的东西。 */
export type WriteScope = {
  /**
   * 这个事务里的数据库。事务结束以后再用会报错。
   * 要回滚时返回失败的结果，不调用 tx.rollback()。
   */
  readonly tx: Tx;
  /** 事务开始的时间。这个事务里写的时间都用它。 */
  readonly now: Date;
  readonly actor: Actor;
  /** 提交以后要发出的事件，由 appendEvent 加入。 */
  readonly pendingEvents: StoredEvent[];
};

/**
 * 在一个 immediate 写事务里执行 fn。fn 必须是同步函数，返回成功或失败的结果。
 * - 成功：提交，再把记下的事件按顺序发给订阅者。
 * - 失败：回滚，返回这个失败的结果，不发事件。
 * - 抛出错误：回滚，原样抛出，不发事件。
 * 带了请求编号时，编号记过就返回第一次的结果，不执行 fn。
 * 所以前提的检查也写在 fn 里。写在外面的检查先于查编号执行，重发时可能被它拦下。
 * 这样检查和写入之间也不会插进别的写入。
 * 结果要能存成 JSON，因为带了请求编号时要记下它。
 */
export function writeTx<T extends Json, E = never>(
  ctx: WriteContext,
  fn: (w: WriteScope) => Result<T, E>,
): Result<T, E> {
  if (fn instanceof AsyncFunction) {
    throw new TypeError("写事务的回调不能是异步函数，事务里不能 await。");
  }
  if (connection(ctx.db).inTransaction) {
    throw new Error("写事务不能嵌套。要在一个事务里做几件事，把 w 传给它们。");
  }
  const now = ctx.now();
  const pendingEvents: StoredEvent[] = [];
  let open = true;
  let committed: Result<T, E>;
  try {
    committed = ctx.db.transaction(
      (tx) => {
        const w: WriteScope = {
          tx: whileOpen(tx, () => open),
          now,
          actor: ctx.actor,
          pendingEvents,
        };
        const run = () => notPromise(fn(w));
        const { idempotency } = ctx;
        const result = idempotency === undefined ? run() : runOnce(tx, idempotency, now, run);
        if (!result.ok) throw new Rollback(result);
        return result;
      },
      { behavior: "immediate" },
    );
  } catch (error) {
    // 只有这个事务的 fn 返回的失败会包成 Rollback 抛到这里。
    if (error instanceof Rollback) return error.result as Err<E>;
    throw error;
  } finally {
    open = false;
  }
  ctx.notifier.publish(pendingEvents);
  return committed;
}

/** 回调返回失败时抛出它，让事务回滚。事务外面再换回失败的结果。 */
class Rollback {
  readonly result: Err<unknown>;
  constructor(result: Err<unknown>) {
    this.result = result;
  }
}

/** 异步函数的构造函数。用它认出 async 写的回调。 */
const AsyncFunction = (async () => {}).constructor;

/** 回调返回了 Promise 时，它的同步部分已经执行。这里抛出错误，让事务回滚。 */
function notPromise<R>(result: R): R {
  const value: unknown = result;
  const thenable =
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function";
  if (thenable) {
    // 它 await 之后再用 w.tx 会报错。这里接住，不让它成为没有处理的拒绝。
    Promise.resolve(value).catch(() => {});
    throw new TypeError("写事务的回调返回了 Promise，事务里不能 await。");
  }
  return result;
}

/** 事务结束以后，再取 tx 的任何属性都报错，防止写入发生在事务外面。 */
function whileOpen<T extends object>(target: T, isOpen: () => boolean): T {
  return new Proxy(target, {
    get(object, key, receiver) {
      if (!isOpen()) throw new Error("写事务已经结束，不能再用它读写。");
      return Reflect.get(object, key, receiver);
    },
  });
}

/** drizzle() 返回的对象带着 better-sqlite3 的连接。Db 的类型里没有写出来。 */
function connection(db: Db): Database.Database {
  return (db as Db & { readonly $client: Database.Database }).$client;
}
