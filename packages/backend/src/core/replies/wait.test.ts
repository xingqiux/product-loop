import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, rounds, submissions } from "../../store/schema/index.ts";
import { failure, landRound, succeed } from "../pages/testing.ts";
import { withdrawPage } from "../pages/withdraw.ts";
import type { TestCore } from "../testing.ts";
import { submitReply } from "./submit.ts";
import { legacyText, present, presented, submitDeps } from "./testing.ts";
import { type WaitClock, waitForReply } from "./wait.ts";

// 等回复的原语：提交时立即醒来，到时返回等待中，撤回时返回 PAGE_GONE。计时器用假的。

/** 假的计时器：不会自己到时，由测试调用 fire() 让它到时。 */
function fakeClock() {
  const timers = new Map<number, { fire: () => void; ms: number }>();
  let next = 1;
  const clock: WaitClock = {
    setTimeout(fire, ms) {
      const id = next++;
      timers.set(id, { fire, ms });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  const fire = () => {
    for (const [id, timer] of [...timers]) {
      timers.delete(id);
      timer.fire();
    }
  };
  return { clock, fire, pending: () => [...timers.values()].map((timer) => timer.ms) };
}

const submit = (core: TestCore, pageId: number) =>
  succeed(
    submitReply(
      core.ctx,
      "app",
      pageId,
      { source: "legacyTemplate", text: legacyText },
      submitDeps,
    ),
  );

/** 让已经排队的微任务先跑完。 */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("等回复", () => {
  it("已经有回复时立即返回，记下已取走并发出 reply.received，再等一次不再发", async () => {
    const { core, pageId } = await presented();
    const { submission } = submit(core, pageId);
    const before = core.received.length;
    const { clock, pending } = fakeClock();
    const first = succeed(
      await waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock }),
    );
    expect(pending()).toEqual([]);
    expect(first).toMatchObject({
      status: "submitted",
      submission: { id: submission.id, takenAt: core.ctx.now().toISOString() },
    });
    if (first.status !== "submitted") throw new Error("应当有回复");
    expect(first.submission.lines).toEqual(submission.lines);
    expect(core.received.slice(before)).toMatchObject([
      {
        kind: "reply.received",
        objectType: "submission",
        objectId: String(submission.id),
        detail: { page: pageId, submission: submission.id },
      },
    ]);
    const again = succeed(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 }));
    expect(again).toEqual(first);
    expect(core.received.length).toBe(before + 1);
  });

  it("还没有回复时挂起，提交以后立即醒来，返回回复和它的行", async () => {
    const { core, pageId } = await presented();
    const { clock, pending } = fakeClock();
    let settled = false;
    const waiting = waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock }).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await settle();
    expect(settled).toBe(false);
    expect(pending()).toEqual([50_000]);
    // 等的时候不占着事务，提交照常写得进去。
    const { submission } = submit(core, pageId);
    const result = succeed(await waiting);
    expect(result).toMatchObject({ status: "submitted", submission: { id: submission.id } });
    expect(pending()).toEqual([]);
    const row = core.ctx.db.select().from(submissions).get();
    expect(row?.takenAt).toEqual(core.ctx.now());
  });

  it("到时还没有回复，返回等待中", async () => {
    const { core, pageId } = await presented();
    const { clock, fire } = fakeClock();
    const waiting = waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock });
    await settle();
    fire();
    expect(succeed(await waiting)).toEqual({ status: "waiting" });
  });

  it("不等时只看一眼：还没有回复就返回等待中", async () => {
    const { core, pageId } = await presented();
    expect(succeed(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 }))).toEqual({
      status: "waiting",
    });
  });

  it("等的时候页面被撤回，返回 PAGE_GONE", async () => {
    const { core, pageId } = await presented();
    const { clock } = fakeClock();
    const waiting = waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock });
    await settle();
    succeed(withdrawPage(core.ctx, "app", pageId));
    expect(failure(await waiting)).toMatchObject({
      code: "PAGE_GONE",
      message: "第 1 版的落地阶段的第 1 页已经撤回了。",
    });
    expect(failure(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 })).code).toBe(
      "PAGE_GONE",
    );
  });

  it("所在的阶段已经收尾，返回 PAGE_GONE", async () => {
    const core = await landRound();
    const pageId = present(core, "view");
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: core.ctx.now() }).run();
    expect(failure(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 })).code).toBe(
      "PAGE_GONE",
    );
  });

  it("中止时返回等待中，计时器随之取消，例如后端正在关闭", async () => {
    const { core, pageId } = await presented();
    const { clock, pending } = fakeClock();
    const controller = new AbortController();
    const signal = controller.signal;
    const waiting = waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock, signal });
    await settle();
    controller.abort();
    expect(succeed(await waiting)).toEqual({ status: "waiting" });
    expect(pending()).toEqual([]);
    const aborted = await waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, signal });
    expect(succeed(aborted)).toEqual({ status: "waiting" });
  });

  it("别的项目的事件不叫醒这里", async () => {
    const { core, pageId } = await presented();
    const { clock, fire } = fakeClock();
    let settled = false;
    const waiting = waitForReply(core.ctx, "app", pageId, { timeoutMs: 50_000, clock }).then(
      (result) => {
        settled = true;
        return result;
      },
    );
    await settle();
    core.ctx.notifier.publish([
      {
        id: 999,
        createdAt: core.ctx.now(),
        projectId: "other",
        client: "web/2.0.0",
        session: null,
        kind: "submission.created",
        objectType: "submission",
        objectId: "1",
        detail: {},
      },
    ]);
    await settle();
    expect(settled).toBe(false);
    fire();
    expect(succeed(await waiting)).toEqual({ status: "waiting" });
  });

  it("页面不在这个项目里返回 NOT_FOUND", async () => {
    const { core, pageId } = await presented();
    expect(failure(await waitForReply(core.ctx, "other", pageId, { timeoutMs: 0 })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("项目要先做迁移检查时照常取回复", async () => {
    const { core, pageId } = await presented();
    submit(core, pageId);
    core.ctx.db.update(projects).set({ skillVersion: null }).where(eq(projects.id, "app")).run();
    const result = succeed(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 }));
    expect(result.status).toBe("submitted");
  });
});
