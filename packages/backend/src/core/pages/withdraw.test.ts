import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pages, projects, rounds } from "../../store/schema/index.ts";
import { closeRound } from "../rounds/close.ts";
import { projectStatus } from "../status.ts";
import { addProject, type TestCore } from "../testing.ts";
import { presentPage } from "./present.ts";
import { deps, failure, landRound, pageData, presentInput, succeed } from "./testing.ts";
import { withdrawPage } from "./withdraw.ts";

// 撤回一页：页面改成已撤回，这一轮不再等用户，记一条 page.withdrawn。
// 另有两处用到「在等的页」：有一页在等时不能收尾，状态列出在等的页。

const roundStatus = (core: TestCore) =>
  core.ctx.db.select({ status: rounds.status }).from(rounds).get()?.status;

const ask = (core: TestCore) =>
  succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps)).page.id;
const view = (core: TestCore) =>
  succeed(presentPage(core.ctx, "app", presentInput(pageData(), { purpose: "view" }), deps)).page
    .id;

describe("撤回", () => {
  it("撤回在等的一页：改成已撤回，这个阶段回到进行中，名额空出来", async () => {
    const core = await landRound();
    const pageId = ask(core);
    const before = core.received.length;
    const withdrawn = succeed(withdrawPage(core.ctx, "app", pageId, "  标题写错了 "));
    expect(withdrawn).toMatchObject({
      page: { id: pageId, status: "withdrawn", round: "v1-落地-1" },
      roundStatus: "open",
      // 用户在对话里回答了，按回答处理再收尾；页不对，重新给出。
      next: ["ploop round close", "ploop page present"],
    });
    expect(roundStatus(core)).toBe("open");
    const row = core.ctx.db.select().from(pages).where(eq(pages.id, pageId)).get();
    expect(row).toMatchObject({ withdrawReason: "标题写错了", withdrawnAt: core.ctx.now() });
    expect(core.received.slice(before)).toMatchObject([
      {
        kind: "page.withdrawn",
        objectType: "page",
        objectId: String(pageId),
        detail: { round: "v1-落地-1", page: pageId, reason: "标题写错了", roundStatus: "open" },
      },
    ]);
    expect(ask(core)).toBeGreaterThan(pageId);
  });

  it("用户回复过这个阶段别的页时，撤回以后这个阶段回到已回复", async () => {
    const core = await landRound();
    const first = ask(core);
    // 回复在第 43 步做，这里直接写成已回复。
    core.ctx.db.update(pages).set({ status: "replied" }).where(eq(pages.id, first)).run();
    core.ctx.db.update(rounds).set({ status: "replied" }).run();
    const second = ask(core);
    expect(roundStatus(core)).toBe("waiting");
    expect(succeed(withdrawPage(core.ctx, "app", second)).roundStatus).toBe("replied");
    expect(roundStatus(core)).toBe("replied");
  });

  it("撤回只看的页不改这个阶段的状态，原因可以不写", async () => {
    const core = await landRound();
    const viewed = view(core);
    ask(core);
    const withdrawn = succeed(withdrawPage(core.ctx, "app", viewed));
    expect(withdrawn.roundStatus).toBe("waiting");
    expect(core.ctx.db.select().from(pages).where(eq(pages.id, viewed)).get()).toMatchObject({
      status: "withdrawn",
      withdrawReason: null,
    });
  });

  it("已撤回、已回复的页不能撤回，返回冲突", async () => {
    const core = await landRound();
    const first = ask(core);
    succeed(withdrawPage(core.ctx, "app", first));
    expect(failure(withdrawPage(core.ctx, "app", first))).toMatchObject({
      code: "CONFLICT",
      message: "第 1 版的落地阶段的第 1 页已经撤回了。",
    });
    const second = ask(core);
    core.ctx.db.update(pages).set({ status: "replied" }).where(eq(pages.id, second)).run();
    expect(failure(withdrawPage(core.ctx, "app", second))).toMatchObject({
      code: "CONFLICT",
      message: "用户已经回复了第 1 版的落地阶段的第 2 页，不能再撤回。",
    });
  });

  it("没有这一页、页面在别的项目里，返回 NOT_FOUND，原因只写了空白返回 BAD_REQUEST", async () => {
    const core = await landRound();
    const pageId = ask(core);
    addProject(core, "/work/other");
    expect(failure(withdrawPage(core.ctx, "app", 99)).code).toBe("NOT_FOUND");
    expect(failure(withdrawPage(core.ctx, "other", pageId))).toMatchObject({
      code: "NOT_FOUND",
      message: `项目「other」里没有编号为 ${pageId} 的页面。`,
    });
    expect(failure(withdrawPage(core.ctx, "app", pageId, "  "))).toMatchObject({
      code: "BAD_REQUEST",
      where: "reason",
    });
    expect(roundStatus(core)).toBe("waiting");
  });

  it("要先做迁移检查的项目不能撤回", async () => {
    const core = await landRound();
    const pageId = ask(core);
    core.ctx.db.update(projects).set({ skillVersion: null }).run();
    expect(failure(withdrawPage(core.ctx, "app", pageId)).code).toBe("NEEDS_DOCTOR");
  });
});

describe("在等的页", () => {
  const results = {
    results: ["Q1", "Q2", "Q3"].map((id) => ({ id, result: "done" as const, note: "已经做完" })),
    worktree: [],
  };

  it("有一页在等用户点时不能收尾，写明是哪一页；撤回以后能收尾", async () => {
    const core = await landRound();
    const pageId = ask(core);
    const error = failure(closeRound(core.ctx, "app", "v1-落地-1", results));
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "第 1 版的落地阶段的第 1 页还在等用户点，现在不能收尾。",
      where: "第 1 版的落地阶段",
    });
    succeed(withdrawPage(core.ctx, "app", pageId));
    // 撤回的页不算给用户看过，落地轮收尾以前还要有一页。
    expect(failure(closeRound(core.ctx, "app", "v1-落地-1", results)).rule).toBe("land.page.shown");
    view(core);
    expect(succeed(closeRound(core.ctx, "app", "v1-落地-1", results)).round.status).toBe("closed");
  });

  it("只看的页不挡收尾", async () => {
    const core = await landRound();
    view(core);
    expect(succeed(closeRound(core.ctx, "app", "v1-落地-1", results)).round.status).toBe("closed");
  });

  it("状态列出在等用户的页，要用户点的在前，只看的也列出", async () => {
    const core = await landRound();
    const viewed = view(core);
    const asked = ask(core);
    const status = succeed(projectStatus(core.ctx.db, "app", { now: core.ctx.now() }));
    expect(status.waitingPages).toEqual([
      {
        id: asked,
        seq: 2,
        round: "v1-落地-1",
        purpose: "ask",
        presentedAt: core.ctx.now().toISOString(),
      },
      {
        id: viewed,
        seq: 1,
        round: "v1-落地-1",
        purpose: "view",
        presentedAt: core.ctx.now().toISOString(),
      },
    ]);
  });
});
