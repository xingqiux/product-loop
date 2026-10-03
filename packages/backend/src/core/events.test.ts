import { err, ok } from "@product-loop/model";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { events } from "../store/schema/index.ts";
import { appendEvent, type EventInput, type StoredEvent } from "./events.ts";
import { projectId, startAt, tempCore } from "./testing.ts";
import { type WriteScope, writeTx } from "./tx.ts";

/** 一条事件的内容，种类和对象编号由测试指定。 */
const input = (kind: string, objectId = "1"): EventInput => ({
  projectId,
  kind,
  objectType: "round",
  objectId,
});

/** 写事务的回调：依次记下这几种事件。 */
const append =
  (...kinds: string[]) =>
  (w: WriteScope) => {
    for (const kind of kinds) appendEvent(w, input(kind));
    return ok(kinds.length);
  };

const kindsOf = (list: readonly StoredEvent[]) => list.map((event) => event.kind);

describe("事件", () => {
  it("写进事件表，时间和执行者由写事务填，没写改动内容时是空对象", async () => {
    const { ctx } = await tempCore();
    let returned: StoredEvent[] = [];
    writeTx(ctx, (w) => {
      returned = [
        appendEvent(w, input("round.started", "7")),
        appendEvent(w, {
          ...input("queue.changed", "Q12"),
          objectType: "queueItem",
          detail: { from: "todo", to: "doing" },
        }),
      ];
      return ok(null);
    });
    const rows = ctx.db.select().from(events).all();
    expect(rows).toEqual(returned);
    expect(rows).toEqual([
      {
        id: 1,
        createdAt: startAt,
        projectId,
        client: "cli/2.0.0",
        session: "session-1",
        kind: "round.started",
        objectType: "round",
        objectId: "7",
        detail: {},
      },
      {
        id: 2,
        createdAt: startAt,
        projectId,
        client: "cli/2.0.0",
        session: "session-1",
        kind: "queue.changed",
        objectType: "queueItem",
        objectId: "Q12",
        detail: { from: "todo", to: "doing" },
      },
    ]);
  });

  it("执行者没带会话的标识时，会话一列为空", async () => {
    const { ctx } = await tempCore();
    writeTx({ ...ctx, actor: { client: "web/2.0.0" } }, append("draft.saved"));
    const [row] = ctx.db.select().from(events).all();
    expect(row).toMatchObject({ client: "web/2.0.0", session: null });
  });

  it("事务提交以后才发出，订阅者收到时别的连接已经能读到", async () => {
    const { ctx, sqlite, received } = await tempCore();
    const other = new Database(sqlite.name, { readonly: true });
    const seen: unknown[] = [];
    ctx.notifier.subscribe((event) => {
      seen.push({
        inTransaction: sqlite.inTransaction,
        kind: other.prepare("select kind from events where id = ?").pluck().get(event.id),
      });
    });
    try {
      writeTx(ctx, (w) => {
        appendEvent(w, input("round.started"));
        // 还没提交，订阅者什么都没收到。
        expect(received).toEqual([]);
        return ok(null);
      });
    } finally {
      other.close();
    }
    expect(kindsOf(received)).toEqual(["round.started"]);
    expect(seen).toEqual([{ inTransaction: false, kind: "round.started" }]);
  });

  it("回滚的事务不发事件，之后提交的照常发出", async () => {
    const { ctx, received } = await tempCore();
    writeTx(ctx, (w) => {
      appendEvent(w, input("round.started"));
      return err("conflict");
    });
    expect(() =>
      writeTx(ctx, (w) => {
        appendEvent(w, input("round.started"));
        throw new Error("意外的错误");
      }),
    ).toThrow("意外的错误");
    expect(received).toEqual([]);
    writeTx(ctx, append("page.presented"));
    expect(kindsOf(received)).toEqual(["page.presented"]);
    expect(ctx.db.select().from(events).all()).toEqual(received);
  });

  it("按记下的顺序发出，编号递增", async () => {
    const { ctx, received } = await tempCore();
    writeTx(ctx, append("round.started", "page.presented"));
    writeTx(ctx, append("submission.created", "reply.received"));
    expect(kindsOf(received)).toEqual([
      "round.started",
      "page.presented",
      "submission.created",
      "reply.received",
    ]);
    expect(received.map((event) => event.id)).toEqual([1, 2, 3, 4]);
  });

  it("订阅者收到事件时又提交了写事务，新事件排在后面发", async () => {
    const { ctx, received } = await tempCore();
    ctx.notifier.subscribe((event) => {
      if (event.kind === "round.started") writeTx(ctx, append("queue.changed"));
    });
    const later: StoredEvent[] = [];
    ctx.notifier.subscribe((event) => later.push(event));
    writeTx(ctx, append("round.started", "page.presented"));
    // 排在它前面和后面的订阅者，都按编号从小到大收到。
    for (const got of [received, later]) {
      expect(kindsOf(got)).toEqual(["round.started", "page.presented", "queue.changed"]);
      expect(got.map((event) => event.id)).toEqual([1, 2, 3]);
    }
  });

  it("订阅者抛出错误时，别的订阅者照常收到，写入照常成功", async () => {
    const { ctx, received, subscriberErrors } = await tempCore();
    const boom = new Error("订阅者出错");
    ctx.notifier.subscribe(() => {
      throw boom;
    });
    const after: StoredEvent[] = [];
    ctx.notifier.subscribe((event) => after.push(event));
    const result = writeTx(ctx, append("round.started"));
    expect(result).toEqual({ ok: true, value: 1 });
    expect(kindsOf(received)).toEqual(["round.started"]);
    expect(after).toEqual(received);
    expect(subscriberErrors).toEqual([boom]);
  });

  it("取消订阅以后不再收到", async () => {
    const { ctx } = await tempCore();
    const got: StoredEvent[] = [];
    const unsubscribe = ctx.notifier.subscribe((event) => got.push(event));
    writeTx(ctx, append("round.started"));
    unsubscribe();
    writeTx(ctx, append("round.closed"));
    expect(kindsOf(got)).toEqual(["round.started"]);
  });

  it("事件挂的项目必须已经登记", async () => {
    const { ctx, received } = await tempCore();
    expect(() =>
      writeTx(ctx, (w) => {
        appendEvent(w, { ...input("round.started"), projectId: "ghost" });
        return ok(null);
      }),
    ).toThrow("FOREIGN KEY constraint failed");
    expect(received).toEqual([]);
  });
});
