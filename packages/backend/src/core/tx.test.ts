import { err, ok } from "@product-loop/model";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { events, projectRoots } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { projectId, startAt, tempCore } from "./testing.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

/** 给测试项目登记一个根目录，当作要写的业务数据。 */
function addRoot(w: WriteScope, path: string) {
  return w.tx.insert(projectRoots).values({ projectId, path, addedAt: w.now }).returning().get();
}

/** 记一条事件。 */
function logRoot(w: WriteScope, path: string) {
  return appendEvent(w, {
    projectId,
    kind: "root.added",
    objectType: "projectRoot",
    objectId: path,
  });
}

const roots = (ctx: WriteContext) =>
  ctx.db
    .select({ path: projectRoots.path })
    .from(projectRoots)
    .all()
    .map((row) => row.path);

const eventRows = (ctx: WriteContext) => ctx.db.select().from(events).all();

/** 等到计时器的下一轮，让 await 之后的代码先跑完。 */
const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("写事务", () => {
  it("成功时提交并返回回调的结果，写入的时间是事务开始的时间", async () => {
    const { ctx } = await tempCore();
    const result = writeTx(ctx, (w) => {
      const row = addRoot(w, "/work/app");
      return ok({ rootId: row.id, addedAt: row.addedAt.getTime() });
    });
    expect(result).toEqual({ ok: true, value: { rootId: 1, addedAt: startAt.getTime() } });
    expect(roots(ctx)).toEqual(["/work/app"]);
  });

  it("回调是异步函数时报错，一行都不执行，也不写入", async () => {
    const { ctx, received } = await tempCore();
    let ran = false;
    expect(() =>
      // @ts-expect-error 回调返回 Promise，类型检查就不让过。
      writeTx(ctx, async (w) => {
        ran = true;
        addRoot(w, "/work/before");
        await nextTick();
        addRoot(w, "/work/after");
        return ok(null);
      }),
    ).toThrow("写事务的回调不能是异步函数");
    await nextTick();
    expect(ran).toBe(false);
    expect(roots(ctx)).toEqual([]);
    expect(received).toEqual([]);
  });

  it("回调返回 Promise 时报错，await 前后的写入都不留下", async () => {
    const { ctx, received } = await tempCore();
    const later = async (w: WriteScope) => {
      await nextTick();
      addRoot(w, "/work/after");
      logRoot(w, "/work/after");
    };
    let pending: Promise<void> | undefined;
    expect(() =>
      // @ts-expect-error 回调返回 Promise，类型检查就不让过。
      writeTx(ctx, (w) => {
        addRoot(w, "/work/before");
        logRoot(w, "/work/before");
        pending = later(w);
        return pending;
      }),
    ).toThrow("写事务的回调返回了 Promise");
    // await 之后的写入被拦下，没有写进事务外面。
    await expect(pending).rejects.toThrow("写事务已经结束");
    expect(roots(ctx)).toEqual([]);
    expect(eventRows(ctx)).toEqual([]);
    expect(received).toEqual([]);
  });

  it("回调返回失败时回滚，原样返回这个失败", async () => {
    const { ctx, received } = await tempCore();
    const result = writeTx(ctx, (w) => {
      addRoot(w, "/work/app");
      logRoot(w, "/work/app");
      return err({ kind: "conflict" as const });
    });
    expect(result).toEqual({ ok: false, error: { kind: "conflict" } });
    expect(roots(ctx)).toEqual([]);
    expect(eventRows(ctx)).toEqual([]);
    expect(received).toEqual([]);
  });

  it("回调抛出错误时回滚，错误原样抛出", async () => {
    const { ctx, received } = await tempCore();
    const boom = new Error("意外的错误");
    expect(() =>
      writeTx(ctx, (w) => {
        addRoot(w, "/work/app");
        logRoot(w, "/work/app");
        throw boom;
      }),
    ).toThrow(boom);
    expect(roots(ctx)).toEqual([]);
    expect(eventRows(ctx)).toEqual([]);
    expect(received).toEqual([]);
  });

  it("写入违反约束时回滚，前面的写入也撤销", async () => {
    const { ctx } = await tempCore();
    expect(() =>
      writeTx(ctx, (w) => {
        addRoot(w, "/work/app");
        addRoot(w, "/work/app");
        return ok(null);
      }),
    ).toThrow("UNIQUE constraint failed: project_roots.path");
    expect(roots(ctx)).toEqual([]);
  });

  it("用 immediate 方式开始：还没写入时就占着写锁，提交以后放开", async () => {
    const { ctx, sqlite } = await tempCore();
    // 另开一个连接，不等锁，拿不到就立刻报错。
    const other = new Database(sqlite.name, { timeout: 0 });
    try {
      writeTx(ctx, () => {
        expect(() => other.exec("BEGIN IMMEDIATE")).toThrow("database is locked");
        return ok(null);
      });
      other.exec("BEGIN IMMEDIATE");
      other.exec("ROLLBACK");
    } finally {
      other.close();
    }
  });

  it("写事务不能嵌套，外层的写入随之撤销", async () => {
    const { ctx } = await tempCore();
    expect(() =>
      writeTx(ctx, (w) => {
        addRoot(w, "/work/app");
        return writeTx(ctx, () => ok(null));
      }),
    ).toThrow("写事务不能嵌套");
    expect(roots(ctx)).toEqual([]);
  });

  it("事务结束以后，留下的 w 不能再用", async () => {
    const { ctx } = await tempCore();
    let kept: WriteScope | undefined;
    writeTx(ctx, (w) => {
      kept = w;
      return ok(null);
    });
    const w = kept as WriteScope;
    expect(() => addRoot(w, "/work/app")).toThrow("写事务已经结束");
    expect(() => logRoot(w, "/work/app")).toThrow("写事务已经结束");
    expect(roots(ctx)).toEqual([]);
  });

  it("结果要能存成 JSON，带 Date 时类型检查不让过", async () => {
    const { ctx } = await tempCore();
    // @ts-expect-error Date 存成 JSON 再读回来是字符串，所以不收。
    const result = writeTx(ctx, () => ok({ at: startAt }));
    expect(result.ok).toBe(true);
  });
});
