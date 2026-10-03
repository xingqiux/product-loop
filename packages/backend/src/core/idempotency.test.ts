import { err, ok } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { events, idempotencyKeys } from "../store/schema/index.ts";
import type { Json } from "../store/schema/json.ts";
import { appendEvent } from "./events.ts";
import { type IdempotencyKey, idempotencyTtlMs } from "./idempotency.ts";
import { projectId, startAt, type TestCore, tempCore } from "./testing.ts";
import { type WriteScope, writeTx } from "./tx.ts";

const request: IdempotencyKey = { key: "7f3a9c2e", operation: "POST /projects/demo/queue" };

/** 记一条事件，当作这次请求要写的数据。 */
const logQueue = (w: WriteScope) =>
  appendEvent(w, { projectId, kind: "queue.changed", objectType: "queueItem", objectId: "Q1" });

/** 带着请求编号发请求：记一条事件，结果是事件的编号。ran 是回调真正执行的次数。 */
function sender(core: TestCore, idempotency?: IdempotencyKey) {
  let ran = 0;
  const ctx = { ...core.ctx, idempotency };
  const send = () =>
    writeTx(ctx, (w) => {
      ran += 1;
      return ok({ eventId: logQueue(w).id });
    });
  return { send, ran: () => ran };
}

const keyRows = (core: TestCore) => core.ctx.db.select().from(idempotencyKeys).all();

const later = (ms: number) => new Date(startAt.getTime() + ms);

describe("请求编号", () => {
  it("同一个编号第二次返回第一次的结果，回调不再执行", async () => {
    const core = await tempCore();
    const { send, ran } = sender(core, request);
    const first = send();
    expect(first).toEqual({ ok: true, value: { eventId: 1 } });
    expect(send()).toEqual(first);
    expect(ran()).toBe(1);
    expect(core.ctx.db.select().from(events).all()).toHaveLength(1);
    expect(core.received).toHaveLength(1);
    expect(keyRows(core)).toEqual([{ ...request, result: { eventId: 1 }, createdAt: startAt }]);
  });

  it("编号相同、操作不同时，各自执行", async () => {
    const core = await tempCore();
    const push = sender(core, { ...request, operation: "POST /projects/demo/mainline/revisions" });
    const add = sender(core, request);
    expect(push.send()).toEqual({ ok: true, value: { eventId: 1 } });
    expect(add.send()).toEqual({ ok: true, value: { eventId: 2 } });
    expect(push.send()).toEqual({ ok: true, value: { eventId: 1 } });
    expect(add.send()).toEqual({ ok: true, value: { eventId: 2 } });
    expect([push.ran(), add.ran()]).toEqual([1, 1]);
  });

  it("不带编号时每次都执行，也不记编号", async () => {
    const core = await tempCore();
    const { send, ran } = sender(core);
    expect(send()).toEqual({ ok: true, value: { eventId: 1 } });
    expect(send()).toEqual({ ok: true, value: { eventId: 2 } });
    expect(ran()).toBe(2);
    expect(keyRows(core)).toEqual([]);
  });

  it("二十四小时内重发返回第一次的结果，满二十四小时后重新执行", async () => {
    const core = await tempCore();
    const { send, ran } = sender(core, request);
    expect(send()).toEqual({ ok: true, value: { eventId: 1 } });
    core.setNow(later(idempotencyTtlMs - 1));
    expect(send()).toEqual({ ok: true, value: { eventId: 1 } });
    expect(ran()).toBe(1);
    core.setNow(later(idempotencyTtlMs));
    expect(send()).toEqual({ ok: true, value: { eventId: 2 } });
    expect(ran()).toBe(2);
    // 重新执行的结果从这时起再保留二十四小时。
    core.setNow(later(idempotencyTtlMs + 1));
    expect(send()).toEqual({ ok: true, value: { eventId: 2 } });
    expect(ran()).toBe(2);
    expect(keyRows(core)).toEqual([
      { ...request, result: { eventId: 2 }, createdAt: later(idempotencyTtlMs) },
    ]);
  });

  it("过期的编号在下一次带编号的写入时删掉", async () => {
    const core = await tempCore();
    sender(core, request).send();
    core.setNow(later(idempotencyTtlMs));
    const next = { ...request, key: "0b8d4e61" };
    sender(core, next).send();
    expect(keyRows(core).map((row) => row.key)).toEqual([next.key]);
  });

  it("回调返回失败或抛出错误时回滚，不留编号，重发时照常执行", async () => {
    const core = await tempCore();
    const ctx = { ...core.ctx, idempotency: request };
    const conflict = writeTx(ctx, (w) => {
      logQueue(w);
      return err("conflict");
    });
    expect(conflict).toEqual({ ok: false, error: "conflict" });
    // 上一次要是留下了编号，这一次会直接返回，不会抛出。
    expect(() =>
      writeTx(ctx, (w) => {
        logQueue(w);
        throw new Error("意外的错误");
      }),
    ).toThrow("意外的错误");
    expect(keyRows(core)).toEqual([]);
    expect(core.ctx.db.select().from(events).all()).toEqual([]);
    expect(core.received).toEqual([]);
    const { send, ran } = sender(core, request);
    expect(send()).toEqual({ ok: true, value: { eventId: 1 } });
    expect(ran()).toBe(1);
  });

  it.each<[string, Json]>([
    ["null", null],
    ["数字", 0],
    ["文字", "Q12"],
    ["数组", [1, "二", true, null]],
    ["嵌套的对象", { round: { label: "v2-检查-1", taken: ["Q1", "Q2"] }, warnings: [] }],
  ])("结果是%s时，重发拿到的和第一次相同", async (_, value) => {
    const core = await tempCore();
    const ctx = { ...core.ctx, idempotency: request };
    let ran = 0;
    const send = () =>
      writeTx(ctx, () => {
        ran += 1;
        return ok(value);
      });
    expect(send()).toEqual({ ok: true, value });
    expect(send()).toEqual({ ok: true, value });
    expect(ran).toBe(1);
  });

  it("结果里值为 undefined 的属性，重发时不在", async () => {
    const core = await tempCore();
    const ctx = { ...core.ctx, idempotency: request };
    const send = () => writeTx(ctx, () => ok({ label: "v2-检查-1", note: undefined }));
    expect(send()).toEqual({ ok: true, value: { label: "v2-检查-1", note: undefined } });
    const replayed = send();
    expect(replayed).toStrictEqual({ ok: true, value: { label: "v2-检查-1" } });
  });
});
