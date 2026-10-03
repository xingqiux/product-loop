import { assignCardIds, pageFormatVersion } from "@product-loop/model";
import Database from "better-sqlite3";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  blobRefs,
  cards,
  events,
  excerpts,
  pages,
  projects,
  rounds,
  ruleHits,
} from "../../store/schema/index.ts";
import { sqliteError } from "../../store/testing.ts";
import { closeRound } from "../rounds/close.ts";
import { checkPageAndRecord } from "./check.ts";
import { type PresentDeps, presentPage } from "./present.ts";
import { deps, failure, hash, landRound, pageData, presentInput, succeed } from "./testing.ts";
import { withdrawPage } from "./withdraw.ts";

// 给出信息：存页、卡片索引、原文摘录、附件引用、轮次的状态、事件和命中的记录，
// 以及「一页在等」和写事务里重新确认的前提。填的部分见 fill.test.ts。

/** 一句四十多字的话，写作校验警告。 */
const longish =
  "看板现在放在首页的最下面，用户每次打开首页都要先翻过两屏的项目列表，才能看到自己关心的那几件事。";

const roundStatus = (core: Awaited<ReturnType<typeof landRound>>) =>
  core.ctx.db.select({ status: rounds.status }).from(rounds).get()?.status;

describe("存下一页", () => {
  it("合格的一页存成已给出，这个阶段改成等用户回复，返回编号、地址和下一步", async () => {
    const core = await landRound();
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(presented).toMatchObject({
      page: { project: "app", round: "v1-落地-1", seq: 1, purpose: "ask", status: "presented" },
      roundStatus: "waiting",
      path: "/p/app/r/v1-落地-1",
      cards: 2,
      warnings: [],
      next: ["ploop reply wait"],
    });
    expect(roundStatus(core)).toBe("waiting");
    const row = core.ctx.db.select().from(pages).get();
    expect(row).toMatchObject({
      id: presented.page.id,
      formatVersion: pageFormatVersion,
      status: "presented",
      withdrawnAt: null,
    });
    expect(row?.sections).toEqual(assignCardIds(pageData()));
    expect(row?.images).toEqual([
      { path: "img/home.png", hash: hash("a") },
      { path: "img/after.png", hash: hash("c") },
    ]);
  });

  it("每张有编号的卡记一行索引，写区块、顺序、标题、引用的事项和场景", async () => {
    const core = await landRound();
    const data = pageData();
    const ask = { ...data.asks[0], id: "ask-board", where: { scene: "S2", step: 1 } };
    succeed(presentPage(core.ctx, "app", presentInput({ ...data, asks: [ask] }), deps));
    const rows = core.ctx.db.select().from(cards).orderBy(asc(cards.position)).all();
    const [, change] = rows;
    expect(rows.map(({ pageId: _, ...rest }) => rest)).toEqual([
      {
        section: "asks",
        cardId: "ask-board",
        position: 0,
        title: "看板放在哪里",
        queue: [1],
        scenes: [2],
      },
      {
        section: "changes",
        cardId: change?.cardId,
        position: 1,
        title: "提交以后写明回复被取走",
        queue: [2, 3],
        scenes: [],
      },
    ]);
    expect(change?.cardId).toMatch(/^change-[0-9a-z]{7}$/u);
  });

  it("卡片编号按标题算，同一份数据撤回以后再给出，编号不变", async () => {
    const core = await landRound();
    const first = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    succeed(withdrawPage(core.ctx, "app", first.page.id));
    const second = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(second.page.seq).toBe(2);
    const idsOf = (pageId: number) =>
      core.ctx.db
        .select({ id: cards.cardId })
        .from(cards)
        .where(eq(cards.pageId, pageId))
        .orderBy(asc(cards.position))
        .all()
        .map((row) => row.id);
    expect(idsOf(second.page.id)).toEqual(idsOf(first.page.id));
  });

  it("截图记下附件引用，同一张图只记一次", async () => {
    const core = await landRound();
    const data = pageData();
    const change = { ...data.changes[0], before: { img: "img/home.png" } };
    const presented = succeed(
      presentPage(core.ctx, "app", presentInput({ ...data, changes: [change] }), deps),
    );
    const refs = core.ctx.db.select().from(blobRefs).all();
    expect(refs).toEqual([
      {
        blobHash: hash("a"),
        referrerKind: "page",
        referrerId: String(presented.page.id),
        purpose: "img",
      },
      {
        blobHash: hash("c"),
        referrerKind: "page",
        referrerId: String(presented.page.id),
        purpose: "img",
      },
    ]);
  });

  it("警告随结果返回，每条命中记一行，写明存成的页面", async () => {
    const core = await landRound();
    const data = pageData();
    const ask = { ...data.asks[0], why: longish };
    const presented = succeed(
      presentPage(core.ctx, "app", presentInput({ ...data, asks: [ask] }), deps),
    );
    expect(presented.warnings.map((issue) => issue.rule)).toEqual(["writing.sentence.long"]);
    const hits = core.ctx.db.select().from(ruleHits).all();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      command: "page present",
      pageId: presented.page.id,
      level: "warn",
      rule: "writing.sentence.long",
    });
  });

  it("记一条 page.presented，事务提交以后发出", async () => {
    const core = await landRound();
    const before = core.received.length;
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const sent = core.received.slice(before);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      projectId: "app",
      kind: "page.presented",
      objectType: "page",
      objectId: String(presented.page.id),
      client: "cli/2.0.0",
      session: "session-1",
      detail: { round: "v1-落地-1", page: presented.page.id, seq: 1, purpose: "ask" },
    });
  });

  it("给出以后不再改：撤回只改状态和撤回的两列，页面数据和填的部分不变", async () => {
    const core = await landRound();
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const stored = core.ctx.db.select().from(pages).get();
    succeed(withdrawPage(core.ctx, "app", presented.page.id, "标题写错了"));
    const after = core.ctx.db.select().from(pages).get();
    expect(after).toMatchObject({ status: "withdrawn", withdrawReason: "标题写错了" });
    expect({ ...after, status: stored?.status, withdrawnAt: null, withdrawReason: null }).toEqual(
      stored,
    );
  });
});

describe("原文摘录", () => {
  /** 一张卡带两条文字来源，引用同一个文件的不同几行。 */
  function withText() {
    const data = pageData();
    const ask = {
      ...data.asks[0],
      sources: [
        ...(data.asks[0]?.sources ?? []),
        { name: "规矩的说明", file: "skill/SKILL.md", lines: "3-4", mark: [4] },
        { name: "规矩的开头", file: "skill/SKILL.md", lines: "3" },
      ],
    };
    return { ...data, asks: [ask] };
  }
  const text = (lines: string, body: string) => ({
    file: "skill/SKILL.md",
    lines,
    text: body,
    fileHash: hash("f"),
  });

  it("每条文字来源存一行原文，写明位置、起止行和要标出的行", async () => {
    const core = await landRound();
    const input = presentInput(withText(), {
      excerpts: [text("3-4", "第三行\n第四行"), text("3", "第三行"), text("9", "没有用到")],
    });
    const presented = succeed(presentPage(core.ctx, "app", input, deps));
    const rows = core.ctx.db.select().from(excerpts).orderBy(asc(excerpts.id)).all();
    expect(rows.map(({ id: _, createdAt: __, ...rest }) => rest)).toEqual([
      {
        pageId: presented.page.id,
        where: "asks[0].sources[1]",
        file: "skill/SKILL.md",
        startLine: 3,
        endLine: 4,
        mark: [4],
        text: "第三行\n第四行",
        fileHash: hash("f"),
      },
      {
        pageId: presented.page.id,
        where: "asks[0].sources[2]",
        file: "skill/SKILL.md",
        startLine: 3,
        endLine: 3,
        mark: null,
        text: "第三行",
        fileHash: hash("f"),
      },
    ]);
  });

  it("缺了原文时一次报齐，什么都不存", async () => {
    const core = await landRound();
    const error = failure(presentPage(core.ctx, "app", presentInput(withText()), deps));
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.issues?.map((issue) => issue.where)).toEqual([
      "asks[0].sources[1]",
      "asks[0].sources[2]",
    ]);
    expect(core.ctx.db.select().from(pages).all()).toEqual([]);
    expect(roundStatus(core)).toBe("open");
  });

  it("原文的行数、行号、哈希不对，同一段交了两份不同的，都在事务以前报齐", async () => {
    const core = await landRound();
    const input = presentInput(withText(), {
      excerpts: [
        text("3-4", "只有一行"),
        text("4-3", "倒过来的行号"),
        { ...text("3", "第三行"), fileHash: "f" },
        text("3", "另一份第三行"),
      ],
      images: [
        { path: "img/home.png", hash: hash("a") },
        { path: "img/home.png", hash: hash("c") },
      ],
    });
    const error = failure(presentPage(core.ctx, "app", input, deps));
    expect(error.code).toBe("BAD_REQUEST");
    expect(error.issues?.map((issue) => issue.message)).toEqual([
      "原文 skill/SKILL.md 第 3-4 行应有 2 行，交来的有 1 行。",
      "原文 skill/SKILL.md 的行号 4-3 写法不对。",
      "原文 skill/SKILL.md 的哈希不是六十四位小写十六进制。",
      "原文 skill/SKILL.md 第 3 行交了两份不同的内容。",
      "截图 img/home.png 交了两个不同的哈希。",
    ]);
    expect(core.ctx.db.select().from(ruleHits).all()).toEqual([]);
  });
});

describe("拦截", () => {
  it("有拦截时什么都不存，返回全部拦截，命中照样记下", async () => {
    const core = await landRound();
    const data = pageData();
    Reflect.deleteProperty(data.changes[0] ?? {}, "queue");
    const input = presentInput(data, {
      images: [{ path: "img/home.png", hash: hash("a") }],
    });
    const before = core.received.length;
    const error = failure(presentPage(core.ctx, "app", input, deps));
    expect(error.code).toBe("RULE_BLOCKED");
    expect(error.issues?.map((issue) => `${issue.rule} ${issue.where}`)).toEqual([
      "round.batch.covered Q2",
      "round.batch.covered Q3",
      "blob.present changes[0].after.img",
    ]);
    expect(core.ctx.db.select().from(pages).all()).toEqual([]);
    expect(roundStatus(core)).toBe("open");
    expect(core.received.slice(before)).toEqual([]);
    const hits = core.ctx.db.select().from(ruleHits).all();
    expect(hits.map((hit) => [hit.rule, hit.command, hit.pageId])).toEqual([
      ["round.batch.covered", "page present", null],
      ["round.batch.covered", "page present", null],
      ["blob.present", "page present", null],
    ]);
  });

  it("请求编号只记成功的结果：被拦截的请求改好以后用同一个编号重发，照常执行", async () => {
    const core = await landRound();
    const ctx = { ...core.ctx, idempotency: { key: "k1", operation: "POST /pages" } };
    const blocked = presentInput(pageData(), { images: [] });
    expect(failure(presentPage(ctx, "app", blocked, deps)).code).toBe("RULE_BLOCKED");
    const first = succeed(presentPage(ctx, "app", presentInput(pageData()), deps));
    const again = succeed(presentPage(ctx, "app", presentInput(pageData()), deps));
    expect(again).toEqual(first);
    expect(core.ctx.db.select().from(pages).all()).toHaveLength(1);
  });

  it("要先做迁移检查的项目不能给出信息", async () => {
    const core = await landRound();
    core.ctx.db.update(projects).set({ skillVersion: null }).run();
    const error = failure(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(error.code).toBe("NEEDS_DOCTOR");
    expect(core.ctx.db.select().from(ruleHits).all()).toEqual([]);
  });
});

describe("一页在等", () => {
  it("已有一页在等时返回冲突，先写在等的是哪一页，再列出别的拦截", async () => {
    const core = await landRound();
    succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const error = failure(
      presentPage(core.ctx, "app", presentInput(pageData(), { images: [] }), deps),
    );
    expect(error.code).toBe("CONFLICT");
    expect(error.message).toBe("第 1 版的落地阶段的第 1 页还在等用户点，同一时间只能有一页在等。");
    expect(error.issues?.map((issue) => issue.rule)).toEqual([
      "page.oneWaiting",
      "blob.present",
      "blob.present",
    ]);
    expect(core.ctx.db.select().from(pages).all()).toHaveLength(1);
    const hits = core.ctx.db.select({ rule: ruleHits.rule }).from(ruleHits).all();
    // 命中按校验的顺序记。
    expect(hits.map((hit) => hit.rule)).toEqual([
      "blob.present",
      "blob.present",
      "page.oneWaiting",
    ]);
  });

  it("只看的页不占名额，也不改这个阶段的状态", async () => {
    const core = await landRound();
    const view = presentInput(pageData(), { purpose: "view" });
    const viewed = succeed(presentPage(core.ctx, "app", view, deps));
    expect(viewed).toMatchObject({ page: { purpose: "view", seq: 1 }, roundStatus: "open" });
    expect(roundStatus(core)).toBe("open");

    const asked = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(asked).toMatchObject({ page: { seq: 2 }, roundStatus: "waiting" });
    const again = succeed(presentPage(core.ctx, "app", view, deps));
    expect(again).toMatchObject({ page: { seq: 3 }, roundStatus: "waiting" });
    expect(failure(presentPage(core.ctx, "app", presentInput(pageData()), deps)).code).toBe(
      "CONFLICT",
    );
  });

  it("唯一索引兜底：一个项目同时只有一页要用户点的页在等", async () => {
    const core = await landRound();
    const first = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const row = core.ctx.db.select().from(pages).where(eq(pages.id, first.page.id)).get();
    if (row === undefined) throw new Error("没有存下页面");
    const { id: _, ...copy } = row;
    expect(
      sqliteError(() =>
        core.ctx.db
          .insert(pages)
          .values({ ...copy, seq: 2 })
          .run(),
      ),
    ).toBe("UNIQUE constraint failed: pages.project_id");
    core.ctx.db
      .insert(pages)
      .values({ ...copy, seq: 2, purpose: "view" })
      .run();
  });
});

describe("写事务里重新确认前提", () => {
  it("校验通过以后别的会话给出了一页，这时再给出就返回冲突", async () => {
    const core = await landRound();
    const check = { ...presentInput(pageData()), command: "page check" as const };
    const checked = succeed(
      checkPageAndRecord(
        core.ctx,
        "app",
        { ...check, run: { mode: "current", round: "v1-落地-1" } },
        deps,
      ),
    );
    expect(checked.block).toEqual([]);

    const other = { ...core.ctx, actor: { client: "cli/2.0.0", session: "session-2" } };
    succeed(presentPage(other, "app", presentInput(pageData()), deps));
    const error = failure(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(error).toMatchObject({ code: "CONFLICT", rule: "page.oneWaiting" });
    expect(error.message).toContain("第 1 版的落地阶段的第 1 页");
  });

  it("校验通过以后这个阶段收尾了，这时再给出就返回冲突，什么都不存", async () => {
    const core = await landRound();
    // 落地轮收尾以前要给用户看过一页，先给出一页只看的。
    succeed(presentPage(core.ctx, "app", presentInput(pageData(), { purpose: "view" }), deps));
    const done = (id: string) => ({ id, result: "done" as const, note: "已经做完" });
    succeed(
      closeRound(core.ctx, "app", "v1-落地-1", {
        results: [done("Q1"), done("Q2"), done("Q3")],
        worktree: [],
      }),
    );
    const error = failure(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(error).toMatchObject({ code: "CONFLICT", where: "第 1 版的落地阶段" });
    expect(core.ctx.db.select().from(pages).all()).toHaveLength(1);
    expect(
      core.ctx.db.select().from(events).where(eq(events.kind, "page.presented")).all(),
    ).toHaveLength(1);
  });

  it("校验和写入在同一个写事务里，别的连接在这中间写不进来", async () => {
    const core = await landRound();
    // 另一个连接，不等锁：拿不到写锁就立即报错。
    const other = new Database(core.sqlite.name, { timeout: 0 });
    onTestFinished(() => {
      other.close();
    });
    const attempts: string[] = [];
    const racing: PresentDeps = {
      hasBlob: (value) => {
        // 校验查截图时，事务已经开始。另一个连接这时想写，被挡在外面。
        try {
          other.exec("begin immediate");
          other.exec("rollback");
          attempts.push("写进来了");
        } catch (error) {
          attempts.push(error instanceof Error ? error.message : String(error));
        }
        return deps.hasBlob(value);
      },
    };
    succeed(presentPage(core.ctx, "app", presentInput(pageData()), racing));
    expect(attempts).toEqual(["database is locked", "database is locked"]);
    other.exec("begin immediate");
    other.exec("rollback");
  });
});
