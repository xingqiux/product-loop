import { describe, expect, it } from "vitest";
import { legacyMigrations, pages, queueEvents, queueItems, rounds } from "../store/schema/index.ts";
import {
  completeLegacy,
  importLegacy,
  type LegacyImportInput,
  legacyState,
  recordArchive,
} from "./legacy.ts";
import { failure, hash, pageData, registerBlobs, succeed } from "./pages/testing.ts";
import { requireWritable } from "./projects.ts";
import { addProject, emptyCore, type TestCore } from "./testing.ts";
import { currentVersionRow } from "./versions.ts";

// 迁移的后端：归档、导入、核对、完成，见第一期计划第 61 步。
// 附件库里登记了两张图，哈希由 a 和 c 重复而成，见 pages/testing.ts。

const stored = new Set([hash("a"), hash("c")]);
const deps = { hasBlob: (value: string) => stored.has(value) };

const manifest = [
  { path: "主线.md", size: 10, sha256: hash("1") },
  { path: "决定.md", size: 10, sha256: hash("2") },
  { path: "walk/2026-09-20/fix-2.json", size: 10, sha256: hash("3") },
];

/** 登记了旧项目 app，归档过。 */
async function archived(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app", { legacySource: "docs" });
  registerBlobs(core);
  succeed(
    recordArchive(core.ctx, "app", {
      file: "app-1.tar.gz",
      sha256: hash("f"),
      bytes: 99,
      manifest,
    }),
  );
  return core;
}

const images = [
  { path: "img/home.png", hash: hash("a") },
  { path: "img/after.png", hash: hash("c") },
];

/** 一份合格的旧数据：主线两版、两条决定、两件队列事项、两轮，一轮里一页数据一页快照。 */
function input(more: Partial<LegacyImportInput> = {}): LegacyImportInput {
  return {
    mainline: { original: "# 主线\n\nhttps://claude.ai/x\n", cleaned: "# 主线\n" },
    decisions: [
      {
        id: 1,
        kind: "decision",
        decision: "看板放首页",
        reason: "每次都要看",
        case: "打开就看到",
        date: "2026-09-18",
        status: "voided",
        voidedBy: 2,
        voidReason: "改了主意",
      },
      {
        id: 2,
        kind: "later",
        decision: "看板按阶段分列",
        reason: "先看用法",
        case: "",
        date: "2026-09-19",
        status: "active",
      },
    ],
    queue: [
      {
        id: "Q1",
        content: "看板放到首页",
        stage: "land",
        proposer: "user",
        createdAt: "2026-09-18",
        status: "done",
        evidence: "提交 3f2a9c1",
        subItems: [],
      },
      {
        id: "Q2",
        content: "提交以后写明回复被取走",
        stage: "land",
        proposer: "ai",
        createdAt: "2026-09-19",
        status: "todo",
        subItems: ["按钮下面写一句"],
      },
    ],
    rounds: [
      {
        legacyId: "fix-2",
        stage: "land",
        date: "2026-09-20",
        pages: [{ legacyId: "fix-2", data: pageData(), images }],
        files: [
          { path: "2026-09-20/img/home.png", hash: hash("a") },
          { path: "2026-09-20/img/after.png", hash: hash("c") },
        ],
      },
      {
        legacyId: "report-1",
        stage: "think",
        date: "2026-09-18",
        pages: [{ legacyId: "report-1", snapshot: hash("a") }],
        files: [],
      },
    ],
    expected: { rounds: 2, pages: 2, decisions: 2, queue: 2, images: 2 },
    ...more,
  };
}

describe("归档", () => {
  it("记下包和清单；再归档换成新的包，返回换下来的旧包", async () => {
    const core = await archived();
    const state = succeed(legacyState(core.ctx.db, "app"));
    expect(state).toMatchObject({
      status: "archived",
      archive: { file: "app-1.tar.gz", files: 3, bytes: 99 },
      counts: null,
    });
    const again = succeed(
      recordArchive(core.ctx, "app", {
        file: "app-2.tar.gz",
        sha256: hash("e"),
        bytes: 1,
        manifest,
      }),
    );
    expect(again.replaced).toBe("app-1.tar.gz");
  });
});

describe("导入", () => {
  it("在一个事务里写进全部旧数据，旧轮次放进第 1 版，每个阶段从 1 编号", async () => {
    const core = await archived();
    const counts = succeed(importLegacy(core.ctx, "app", input(), deps));
    expect(counts).toEqual({ rounds: 2, pages: 2, decisions: 2, queue: 2, images: 2 });
    const rows = core.ctx.db.select().from(rounds).all();
    expect(rows.map((row) => [row.legacyId, row.stage, row.seq, row.status])).toEqual([
      ["fix-2", "land", 1, "closed"],
      ["report-1", "think", 1, "closed"],
    ]);
    const stored = core.ctx.db.select().from(pages).all();
    expect(stored.map((page) => [page.status, page.purpose, page.legacySnapshot])).toEqual([
      ["replied", "ask", null],
      ["replied", "view", hash("a")],
    ]);
    const items = core.ctx.db.select().from(queueItems).all();
    expect(items.map((item) => [item.number, item.status, item.evidence])).toEqual([
      [1, "done", "提交 3f2a9c1"],
      [2, "todo", null],
    ]);
    expect(succeed(legacyState(core.ctx.db, "app")).status).toBe("imported");
  });

  it("迁移的事项都先记一条待办，已经不是待办的再记一条改成现在的状态", async () => {
    const core = await archived();
    succeed(importLegacy(core.ctx, "app", input(), deps));
    const numbers = new Map(
      core.ctx.db
        .select()
        .from(queueItems)
        .all()
        .map((item) => [item.id, item.number]),
    );
    const moves = core.ctx.db
      .select()
      .from(queueEvents)
      .all()
      .map((event) => [numbers.get(event.itemId), event.fromStatus, event.toStatus]);
    expect(moves).toEqual([
      [1, null, "todo"],
      [1, "todo", "done"],
      [2, null, "todo"],
    ]);
  });

  it("数量对不上时整批撤回，记下停在导入这一步", async () => {
    const core = await archived();
    const expected = { rounds: 2, pages: 3, decisions: 2, queue: 2, images: 5 };
    const error = failure(importLegacy(core.ctx, "app", input({ expected }), deps));
    expect(error.code).toBe("CONFLICT");
    expect(error.issues?.map((issue) => issue.message) ?? [error.message]).toEqual([
      "页面的数量对不上：旧文件里有 3，导入了 2。",
      "截图的数量对不上：旧文件里有 5，导入了 2。",
    ]);
    expect(core.ctx.db.select().from(rounds).all()).toEqual([]);
    expect(core.ctx.db.select().from(queueItems).all()).toEqual([]);
    const state = succeed(legacyState(core.ctx.db, "app"));
    expect(state.status).toBe("archived");
    expect(state.failure).toMatchObject({ step: "import", message: error.message });
  });

  it("旧页面按历史页面模式仍被拦截的，写明是哪一页的哪一处", async () => {
    const core = await archived();
    const data = { ...pageData(), stats: [] };
    const round = { ...input().rounds[0], pages: [{ legacyId: "fix-2", data, images }] };
    const bad = input({ rounds: [round as LegacyImportInput["rounds"][number]] });
    const error = failure(importLegacy(core.ctx, "app", bad, deps));
    expect(error).toMatchObject({ code: "RULE_BLOCKED", where: "fix-2 → stats" });
  });

  it("截图没上传、队列事项缺证据，都报出来", async () => {
    const core = await archived();
    const round = { ...input().rounds[0], files: [{ path: "2026-09-20/x.png", hash: hash("b") }] };
    const missing = failure(
      importLegacy(
        core.ctx,
        "app",
        input({ rounds: [round as LegacyImportInput["rounds"][number]] }),
        deps,
      ),
    );
    expect(missing).toMatchObject({ code: "BAD_REQUEST", where: hash("b") });
    const queue = input().queue.map((item) => ({ ...item, evidence: undefined }));
    const noEvidence = failure(importLegacy(core.ctx, "app", input({ queue }), deps));
    expect(noEvidence).toMatchObject({
      code: "BAD_REQUEST",
      message: "Q1 是已完成，要写完成证据。",
      where: "Q1.evidence",
    });
  });

  it("还没归档不能导入，已经导入的不能再导入", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app", { legacySource: "docs" });
    expect(failure(importLegacy(core.ctx, "app", input(), deps)).message).toBe(
      "项目「app」还没有归档，不能导入。",
    );
    const done = await archived();
    succeed(importLegacy(done.ctx, "app", input(), deps));
    expect(failure(importLegacy(done.ctx, "app", input(), deps)).message).toBe(
      "项目「app」已经导入过旧数据了。",
    );
  });
});

describe("完成", () => {
  it("记下 skill 版本，结束第 1 版、开始第 2 版，返回清单；之后项目能改数据", async () => {
    const core = await archived();
    expect(requireWritable(core.ctx.db, "app").ok).toBe(false);
    succeed(importLegacy(core.ctx, "app", input(), deps));
    const completed = succeed(completeLegacy(core.ctx, "app"));
    expect(completed).toMatchObject({
      skillVersion: "0.0.1",
      ended: 1,
      started: 2,
      cleanup: manifest.map((entry) => entry.path),
    });
    expect(currentVersionRow(core.ctx.db, "app")).toMatchObject({ version: 2, status: "open" });
    expect(requireWritable(core.ctx.db, "app").ok).toBe(true);
    const row = core.ctx.db.select().from(legacyMigrations).get();
    expect(row?.status).toBe("completed");
    expect(failure(completeLegacy(core.ctx, "app")).message).toBe("项目「app」已经迁移完成了。");
  });

  it("还没导入时不能完成", async () => {
    const core = await archived();
    expect(failure(completeLegacy(core.ctx, "app")).message).toBe(
      "项目「app」还没有导入旧数据，不能完成迁移。",
    );
  });
});
