import type { RoundStatus } from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { productVersions, rounds } from "../store/schema/index.ts";
import { addProject, addRound, emptyCore, startAt, type TestCore } from "./testing.ts";
import { currentVersion, listVersions, nextVersion } from "./versions.ts";

const later = (ms: number) => new Date(startAt.getTime() + ms);

const versionRows = (core: TestCore) =>
  core.ctx.db
    .select({ version: productVersions.version, status: productVersions.status })
    .from(productVersions)
    .all();

/** 把一个项目的第 n 版直接改成已结束，像迁移完成时那样。 */
function endVersion(core: TestCore, projectId: string, version: number): void {
  core.ctx.db
    .update(productVersions)
    .set({ status: "closed", endedAt: core.ctx.now() })
    .where(and(eq(productVersions.projectId, projectId), eq(productVersions.version, version)))
    .run();
}

async function oneProject() {
  const core = await emptyCore();
  addProject(core, "/work/app");
  return core;
}

describe("看当前版本", () => {
  it("登记以后是第 1 版，进行中，还没有阶段", async () => {
    const core = await oneProject();
    expect(currentVersion(core.ctx.db, "app")).toEqual({
      ok: true,
      value: {
        version: 1,
        status: "open",
        startedAt: startAt.toISOString(),
        endedAt: null,
        summary: null,
        endReason: null,
        rounds: [],
      },
    });
  });

  it("阶段按开始的先后列出，写成 v1-构思-1 这样", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "think", seq: 1 });
    addRound(core, "app", { version: 1, stage: "land", seq: 1 });
    core.setNow(later(1000));
    addRound(core, "app", { version: 1, stage: "think", seq: 2, status: "waiting" });
    const result = currentVersion(core.ctx.db, "app");
    expect(result.ok && result.value.rounds).toEqual([
      expect.objectContaining({ label: "v1-构思-1", stage: "think", seq: 1, status: "closed" }),
      expect.objectContaining({ label: "v1-落地-1", stage: "land", seq: 1, status: "closed" }),
      {
        label: "v1-构思-2",
        version: 1,
        stage: "think",
        seq: 2,
        status: "waiting",
        startedAt: later(1000).toISOString(),
        closedAt: null,
        legacyId: null,
        summary: null,
      },
    ]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(currentVersion(core.ctx.db, "ghost")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });
});

describe("结束这一版，开始下一版", () => {
  it("结束当前版本，记下原因和时间，再开始下一版", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "think", seq: 1 });
    core.setNow(later(5000));
    const result = nextVersion(core.ctx, "app", "  跳过提升，先做下一版  ");
    const ended = {
      version: 1,
      status: "closed",
      startedAt: startAt.toISOString(),
      endedAt: later(5000).toISOString(),
      summary: null,
      endReason: "跳过提升，先做下一版",
    };
    const started = {
      version: 2,
      status: "open",
      startedAt: later(5000).toISOString(),
      endedAt: null,
      summary: null,
      endReason: null,
    };
    expect(result).toEqual({ ok: true, value: { ended, started } });
    expect(currentVersion(core.ctx.db, "app")).toEqual({
      ok: true,
      value: { ...started, rounds: [] },
    });
    expect(
      core.received.slice(-2).map((event) => [event.kind, event.objectId, event.detail]),
    ).toEqual([
      ["version.ended", "1", { reason: "跳过提升，先做下一版" }],
      ["version.started", "2", {}],
    ]);
  });

  it("原因写成空白时返回 BAD_REQUEST，版本不变", async () => {
    const core = await oneProject();
    expect(nextVersion(core.ctx, "app", " \n ")).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "提前结束一版要写一句原因。",
        hint: "写明为什么在这里结束，例如「跳过提升，先做下一版」。",
      },
    });
    expect(versionRows(core)).toEqual([{ version: 1, status: "open" }]);
  });

  it.each<RoundStatus>(["open", "waiting", "replied"])(
    "有一个阶段是 %s 时返回 CONFLICT，写明是哪个阶段",
    async (status) => {
      const core = await oneProject();
      addRound(core, "app", { version: 1, stage: "land", seq: 3, status });
      const before = core.received.length;
      expect(nextVersion(core.ctx, "app", "跳过提升")).toEqual({
        ok: false,
        error: {
          code: "CONFLICT",
          message: "第 1 版的落地阶段（第 3 次）还没收尾，第 1 版现在不能结束。",
          hint: "先运行 ploop status，把这个阶段做完并收尾，再结束这一版。",
          where: "第 1 版的落地阶段（第 3 次）",
        },
      });
      expect(versionRows(core)).toEqual([{ version: 1, status: "open" }]);
      expect(core.received).toHaveLength(before);
    },
  );

  it("那个阶段收尾以后可以结束", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "land", seq: 3, status: "open" });
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: startAt }).run();
    expect(nextVersion(core.ctx, "app", "跳过提升").ok).toBe(true);
    expect(versionRows(core)).toEqual([
      { version: 1, status: "closed" },
      { version: 2, status: "open" },
    ]);
  });

  it("当前的一版已经结束时返回 CONFLICT，写明下一次开始阶段时自动进入下一版", async () => {
    const core = await oneProject();
    endVersion(core, "app", 1);
    expect(nextVersion(core.ctx, "app", "跳过提升")).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "第 1 版已经结束，下一次开始阶段时自动进入第 2 版。",
        hint: "直接运行 ploop round start <阶段名>。",
      },
    });
    expect(versionRows(core)).toEqual([{ version: 1, status: "closed" }]);
  });

  it("迁移没完成的项目返回 NEEDS_DOCTOR，版本不变；看版本照常", async () => {
    const core = await emptyCore();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    expect(nextVersion(core.ctx, "abei", "跳过提升")).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR", message: "项目「abei」的迁移还没完成，要先做迁移检查。" },
    });
    expect(versionRows(core)).toEqual([{ version: 1, status: "open" }]);
    expect(currentVersion(core.ctx.db, "abei")).toMatchObject({ ok: true, value: { version: 1 } });
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(nextVersion(core.ctx, "ghost", "跳过提升")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("带着同一个请求编号重发时，返回第一次的结果，不会连开两版", async () => {
    const core = await oneProject();
    const ctx = {
      ...core.ctx,
      idempotency: { key: "k1", operation: "POST /projects/app/versions/next" },
    };
    const first = nextVersion(ctx, "app", "跳过提升");
    expect(first.ok).toBe(true);
    expect(nextVersion(ctx, "app", "跳过提升")).toEqual(first);
    expect(versionRows(core)).toEqual([
      { version: 1, status: "closed" },
      { version: 2, status: "open" },
    ]);
  });
});

describe("各版和每版下的阶段", () => {
  it("从第 1 版排起，每版带着自己的阶段", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "think", seq: 1 });
    nextVersion(core.ctx, "app", "跳过提升");
    addRound(core, "app", { version: 2, stage: "think", seq: 1 });
    addRound(core, "app", { version: 2, stage: "use", seq: 1, status: "open" });
    const result = listVersions(core.ctx.db, "app");
    expect(
      result.ok &&
        result.value.map((version) => [
          version.version,
          version.status,
          version.rounds.map((round) => round.label),
        ]),
    ).toEqual([
      [1, "closed", ["v1-构思-1"]],
      [2, "open", ["v2-构思-1", "v2-使用-1"]],
    ]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(listVersions(core.ctx.db, "ghost")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});
