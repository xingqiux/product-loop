import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recordLandSteps, registerBlobs, succeed } from "../../core/pages/testing.ts";
import { withdrawPage } from "../../core/pages/withdraw.ts";
import { addQueueItem } from "../../core/queue.ts";
import { cardIds, present } from "../../core/replies/testing.ts";
import type { WaitClock } from "../../core/replies/wait.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import { cards, pages, rounds, submissions } from "../../store/schema/index.ts";
import type { AppDeps, ProcessGate } from "../deps.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 回复的接口，见「05 接口」第四节和第六节。每个接口至少一成一败。
// 长轮询的计时器用假的：不会自己到时，由测试调用 fire() 让它到时。

function fakeClock() {
  const timers = new Map<number, () => void>();
  let next = 1;
  const clock: WaitClock = {
    setTimeout(fire) {
      const id = next++;
      timers.set(id, fire);
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };
  const fire = () => {
    for (const [id, done] of [...timers]) {
      timers.delete(id);
      done();
    }
  };
  return { clock, fire, count: () => timers.size };
}

/** 旧模板复制出的回复，不带图。 */
const text = ["落地第 1 轮", "疑问 1（先放第一屏）", "想法：看板可以按阶段分列"].join("\n");

/** 开着第一轮落地，给出了一页。返回接口应用、页面编号和假计时器。 */
async function presented(overrides: Partial<AppDeps> = {}) {
  const timers = fakeClock();
  const t = await testApp({ waitClock: timers.clock, ...overrides });
  addProject(t.core, "/work/app");
  for (const content of ["看板放到首页的第一屏", "提交以后写明回复被取走了"]) {
    succeed(addQueueItem(t.core.ctx, "app", { content, stage: "land", proposer: "ai" }));
  }
  succeed(startRound(t.core.ctx, "app", { stage: "land" }));
  recordLandSteps(t.core);
  registerBlobs(t.core);
  return { t, pageId: present(t.core), timers };
}

const base = (pageId: number) => `/api/v1/projects/app/pages/${pageId}/submission`;

/** 让已经排队的任务先跑完，挂起的请求这时已经在等。 */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function postText(t: TestApp, pageId: number) {
  return t.request("POST", `${base(pageId)}/text`, { body: { text } });
}

describe("POST /projects/:pid/pages/:id/submission", () => {
  it("工作台交来各行，枚举写中文；同一页再交返回冲突", async () => {
    const { t, pageId } = await presented();
    const [card] = cardIds(t.core, pageId);
    const lines = [
      { section: "疑问", card, kind: "只写了备注", note: "先放第一屏" },
      { kind: "想法", note: "看板可以按阶段分列" },
    ];
    const res = await t.request("POST", base(pageId), { body: { lines } });
    expect(res.status).toBe(201);
    expect(dataOf(res)).toMatchObject({
      submission: { page: pageId, source: "工作台", text: null, lines: [{ line: 1 }, { line: 2 }] },
      roundStatus: "已回复",
    });
    const again = await t.request("POST", base(pageId), { body: { lines } });
    expect(errorOf(again).code).toBe("CONFLICT");
  });

  it("读出回复的每一行时带上卡片的标题；想法没有卡，也没有标题（N02）", async () => {
    const { t, pageId } = await presented();
    const [card] = cardIds(t.core, pageId);
    const lines = [
      { section: "疑问", card, kind: "只写了备注", note: "先放第一屏" },
      { kind: "想法", note: "看板可以按阶段分列" },
    ];
    await t.request("POST", base(pageId), { body: { lines } });
    const title = t.core.ctx.db
      .select()
      .from(cards)
      .where(eq(cards.cardId, card ?? ""))
      .get()?.title;
    expect(title).toBeTruthy();
    const latest = dataOf(await t.request("GET", "/api/v1/projects/app/submissions/latest")) as {
      lines: { line: number; card?: string; cardTitle?: string }[];
    };
    expect(latest.lines.map((line) => [line.line, line.card, line.cardTitle])).toEqual([
      [1, card, title],
      [2, undefined, undefined],
    ]);
  });

  it("所在的阶段已经收尾，返回 410 PAGE_GONE，写明是哪一页，什么都不存", async () => {
    const { t, pageId } = await presented();
    t.core.ctx.db.update(rounds).set({ status: "closed", closedAt: new Date() }).run();
    const lines = [{ kind: "想法", note: "看板可以按阶段分列" }];
    const res = await t.request("POST", base(pageId), { body: { lines } });
    expect(res.status).toBe(410);
    expect(errorOf(res)).toMatchObject({
      code: "PAGE_GONE",
      message: "第 1 版的落地阶段已经收尾了，它的第 1 页不能再回复。",
    });
    expect(t.core.ctx.db.select().from(submissions).all()).toEqual([]);
  });

  it("迁移来的历史页状态已回复、没有提交记录，返回 409 CONFLICT，什么都不存", async () => {
    const { t, pageId } = await presented();
    t.core.ctx.db.update(pages).set({ status: "replied" }).where(eq(pages.id, pageId)).run();
    const lines = [{ kind: "想法", note: "看板可以按阶段分列" }];
    const res = await t.request("POST", base(pageId), { body: { lines } });
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: "CONFLICT",
      message: "第 1 版的落地阶段的第 1 页已经回复过了，同一页只能提交一次。",
    });
    expect((await postText(t, pageId)).status).toBe(409);
    expect(t.core.ctx.db.select().from(submissions).all()).toEqual([]);
  });

  it("文字和各行都没写，返回 BAD_REQUEST", async () => {
    const { t, pageId } = await presented();
    const res = await t.request("POST", base(pageId), { body: {} });
    expect(errorOf(res).code).toBe("BAD_REQUEST");
  });
});

describe("POST /projects/:pid/pages/:id/submission/text", () => {
  it("按旧格式拆成一行一行，来源写对话", async () => {
    const { t, pageId } = await presented();
    const res = await postText(t, pageId);
    expect(res.status).toBe(201);
    expect(dataOf(res)).toMatchObject({ submission: { source: "对话", text } });
  });

  it("页面编号写得不对，返回 BAD_REQUEST", async () => {
    const { t } = await presented();
    const res = await t.request("POST", "/api/v1/projects/app/pages/abc/submission/text", {
      body: { text },
    });
    expect(errorOf(res)).toMatchObject({ code: "BAD_REQUEST", where: "abc" });
  });
});

describe("GET /projects/:pid/pages/:id/submission?wait=", () => {
  it("挂起时提交，立即返回回复和它的行，计时器已清掉", async () => {
    const { t, pageId, timers } = await presented();
    const waiting = t.request("GET", `${base(pageId)}?wait=50`);
    await settle();
    expect(timers.count()).toBe(1);
    expect((await postText(t, pageId)).status).toBe(201);
    const res = await waiting;
    expect(res.status).toBe(200);
    const data = dataOf(res) as {
      status: string;
      submission: { lines: unknown[]; takenAt: string };
    };
    expect(data.status).toBe("已提交");
    expect(data.submission.lines).toHaveLength(2);
    expect(data.submission.takenAt).not.toBeNull();
    expect(timers.count()).toBe(0);
  });

  it("到时还没有回复，返回等待中；不写 wait 时只看一眼", async () => {
    const { t, pageId, timers } = await presented();
    const waiting = t.request("GET", `${base(pageId)}?wait=50`);
    await settle();
    timers.fire();
    expect(dataOf(await waiting)).toEqual({ status: "等待中" });
    expect(dataOf(await t.request("GET", base(pageId)))).toEqual({ status: "等待中" });
  });

  it("后端开始退出时返回等待中", async () => {
    let stop = () => {};
    const gate: ProcessGate = {
      busy: () => undefined,
      stopping: () => false,
      onStopping: (listener) => {
        stop = listener;
        return () => {};
      },
      during: (_work, task) => task(),
    };
    const { t, pageId } = await presented({ process: gate });
    const waiting = t.request("GET", `${base(pageId)}?wait=50`);
    await settle();
    stop();
    expect(dataOf(await waiting)).toEqual({ status: "等待中" });
  });

  it("页面撤回，挂起的请求返回 410 PAGE_GONE", async () => {
    const { t, pageId } = await presented();
    const waiting = t.request("GET", `${base(pageId)}?wait=50`);
    await settle();
    succeed(withdrawPage(t.core.ctx, "app", pageId, "用户在对话里答了"));
    const res = await waiting;
    expect(res.status).toBe(410);
    expect(errorOf(res).code).toBe("PAGE_GONE");
  });

  it("wait 超过五十秒，返回 BAD_REQUEST", async () => {
    const { t, pageId } = await presented();
    expect(errorOf(await t.request("GET", `${base(pageId)}?wait=51`)).code).toBe("BAD_REQUEST");
  });
});

describe("回复的各行和去处", () => {
  it("最近一份回复、按编号取、每一行；处理一行以后写明还没处理的行", async () => {
    const { t, pageId } = await presented();
    expect(dataOf(await t.request("GET", "/api/v1/projects/app/submissions/latest"))).toBeNull();
    await postText(t, pageId);
    const latest = dataOf(await t.request("GET", "/api/v1/projects/app/submissions/latest")) as {
      id: number;
    };
    const one = dataOf(await t.request("GET", `/api/v1/projects/app/submissions/${latest.id}`));
    expect(one).toEqual(latest);
    const lines = dataOf(
      await t.request("GET", `/api/v1/projects/app/submissions/${latest.id}/lines`),
    ) as { line: number; kind: string; handled?: unknown }[];
    expect(lines.map((line) => [line.line, line.kind, line.handled !== undefined])).toEqual([
      [1, "只写了备注", false],
      [2, "想法", false],
    ]);
    const res = await t.request(
      "POST",
      `/api/v1/projects/app/submissions/${latest.id}/destinations`,
      { body: [{ line: 1, to: "不处理", reason: "已经在第一屏" }] },
    );
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      lines: [{ line: 1, handled: { destination: { to: "不处理", reason: "已经在第一屏" } } }],
      remaining: [2],
    });
  });

  it("回复的编号写得不对返回 BAD_REQUEST，别的项目的回复返回 NOT_FOUND", async () => {
    const { t, pageId } = await presented();
    await postText(t, pageId);
    const bad = await t.request("GET", "/api/v1/projects/app/submissions/abc/lines");
    expect(errorOf(bad).code).toBe("BAD_REQUEST");
    const missing = await t.request("POST", "/api/v1/projects/app/submissions/99/destinations", {
      body: [{ line: 1, to: "不处理", reason: "没有" }],
    });
    expect(errorOf(missing).code).toBe("NOT_FOUND");
  });
});
