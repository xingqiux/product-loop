import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issuesOf } from "@product-loop/model";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vitest";
import { openDatabase } from "../../store/db.ts";
import {
  type BlobHash,
  blobRefs,
  blobs,
  pages,
  productVersions,
  projects,
  queueEvents,
  queueItems,
  replyLines,
  rounds,
  submissions,
} from "../../store/schema/index.ts";
import { migrationsFolder } from "../../store/testing.ts";
import { failure, hash, landRound, succeed } from "../pages/testing.ts";
import { withdrawPage } from "../pages/withdraw.ts";
import { getQueueItem, transitionQueueItem } from "../queue.ts";
import type { TestCore } from "../testing.ts";
import { autoHandler } from "./auto.ts";
import { linesOfSubmission, submissionOfPage } from "./read.ts";
import { submitReply } from "./submit.ts";
import { cardIds, legacyText, present, presented, submitDeps } from "./testing.ts";

// 提交回复：同一页只能提交一次，旧格式的文字按存下的一页拆行，取消队列事项和认可更改当场处理，想法留给 AI。

const submitText = (core: TestCore, pageId: number, text: string, images?: string[]) =>
  submitReply(core.ctx, "app", pageId, { source: "legacyTemplate", text, images }, submitDeps);

const roundStatus = (core: TestCore) =>
  core.ctx.db.select({ status: rounds.status }).from(rounds).get()?.status;

const queueRow = (core: TestCore, number: number) =>
  core.ctx.db
    .select()
    .from(queueItems)
    .where(and(eq(queueItems.projectId, "app"), eq(queueItems.number, number)))
    .get();

describe("旧格式的回复文字", () => {
  it("按存下的一页拆行：卡片编号、队列编号、多行的想法，图补全成完整的哈希", async () => {
    const { core, pageId } = await presented();
    const [card] = cardIds(core, pageId);
    const submitted = succeed(submitText(core, pageId, legacyText));
    expect(submitted.roundStatus).toBe("replied");
    expect(submitted.warnings).toEqual([]);
    expect(submitted.next).toEqual(["ploop reply show"]);
    expect(submitted.submission).toMatchObject({
      project: "app",
      page: pageId,
      round: "v1-落地-1",
      source: "legacyTemplate",
      submittedAt: core.ctx.now().toISOString(),
      takenAt: null,
      text: legacyText,
    });
    const handled = { at: core.ctx.now().toISOString(), by: autoHandler };
    expect(submitted.submission.lines).toEqual([
      {
        submission: submitted.submission.id,
        line: 1,
        section: "asks",
        card,
        cardTitle: "看板放在哪里",
        kind: "noteOnly",
        note: "先放第一屏〔图 1〕",
        images: [hash("a")],
        imagesRead: false,
      },
      {
        submission: submitted.submission.id,
        line: 2,
        section: "queue",
        kind: "queueDrop",
        queue: "Q2",
        images: [],
        imagesRead: false,
        handled: { destination: { to: "queue", id: "Q2" }, ...handled },
      },
      {
        submission: submitted.submission.id,
        line: 3,
        kind: "idea",
        note: "看板可以按阶段分列\n每列按放进来的先后排",
        images: [],
        imagesRead: false,
      },
    ]);
    const stored = core.ctx.db.select().from(replyLines).orderBy(asc(replyLines.line)).all();
    expect(stored.map((row) => row.textLine)).toEqual([2, 3, 4]);
    expect(core.ctx.db.select().from(pages).get()?.status).toBe("replied");
    expect(roundStatus(core)).toBe("replied");
    const refs = core.ctx.db
      .select()
      .from(blobRefs)
      .where(eq(blobRefs.referrerKind, "replyLine"))
      .all();
    expect(refs).toEqual([
      {
        blobHash: hash("a"),
        referrerKind: "replyLine",
        referrerId: `${submitted.submission.id}:1`,
        purpose: "img",
      },
    ]);
  });

  it("这个阶段开始时取消的事排在疑问的第一张，回复里点名它的一行记在这一块", async () => {
    const core = await landRound();
    succeed(transitionQueueItem(core.ctx, "app", "Q3", { to: "dropped", reason: "先不做" }));
    const pageId = present(core);
    const [card] = cardIds(core, pageId);
    const text = "落地第 1 轮\n疑问 1（Q3 还要做）  2（先放第一屏）";
    const { lines } = succeed(submitText(core, pageId, text)).submission;
    expect(lines).toMatchObject([
      { line: 1, section: "droppedAtStart", kind: "noteOnly", note: "Q3 还要做" },
      { line: 2, section: "asks", card, kind: "noteOnly", note: "先放第一屏" },
    ]);
    expect(lines[0]).not.toHaveProperty("card");
    expect(lines[0]).not.toHaveProperty("handled");
  });

  it("拆不开时一次报齐每一处，返回 BAD_REQUEST，什么都不存", async () => {
    const { core, pageId } = await presented();
    const text = "检查第 2 轮\n疑问 3\n队列 不做了：「Q9 没有这件事」";
    const error = failure(submitText(core, pageId, text));
    expect(error.code).toBe("BAD_REQUEST");
    expect(issuesOf(error).map((issue) => issue.where)).toEqual([
      "回复文字第 1 行",
      "回复文字第 2 行",
      "回复文字第 3 行",
    ]);
    expect(error.total).toBe(3);
    expect(core.ctx.db.select().from(submissions).all()).toEqual([]);
    expect(core.ctx.db.select().from(pages).get()?.status).toBe("presented");
    expect(roundStatus(core)).toBe("waiting");
  });

  it("什么都没点时的占位文字拆出零行，空的回复不收，这一页还能再提交", async () => {
    const { core, pageId } = await presented();
    for (const text of ["还没有要复制的内容", "", "落地第 1 轮"]) {
      expect(failure(submitText(core, pageId, text))).toMatchObject({
        code: "BAD_REQUEST",
        message: "回复是空的，一行都没有。",
      });
    }
    succeed(submitText(core, pageId, legacyText));
  });
});

describe("图的哈希", () => {
  const extraBlob = (core: TestCore, value: string) =>
    core.ctx.db
      .insert(blobs)
      .values({
        hash: value as BlobHash,
        contentType: "image/png",
        size: 1,
        createdAt: core.ctx.now(),
        firstSource: "测试",
      })
      .run();

  it("随回复交来的完整哈希优先，不在页面上的图从附件库补全", async () => {
    const { core, pageId } = await presented();
    const text = "落地第 1 轮\n疑问 1（〔图 1〕和〔图 2〕）\n图：图 1=cccccc  图 2=aaaa";
    const { lines } = succeed(submitText(core, pageId, text, [hash("c")])).submission;
    expect(lines[0]?.images).toEqual([hash("c"), hash("a")]);
  });

  it("找不到的图和对得上几张的图，一次报齐", async () => {
    const { core, pageId } = await presented();
    const twin = `aaaaaa${"b".repeat(58)}`;
    extraBlob(core, twin);
    const text = "落地第 1 轮\n疑问 1（〔图 1〕和〔图 2〕）\n图：图 1=aaaaaa  图 2=123456";
    const error = failure(submitText(core, pageId, text, [twin]));
    expect(error.code).toBe("BAD_REQUEST");
    expect(issuesOf(error)).toEqual([
      {
        message: "第 2 行〔图 1〕写的 aaaaaa 对得上附件库里的几张图。",
        hint: "图写附件的完整哈希，或者随回复交上这张图的完整哈希。",
        where: "第 2 行〔图 1〕",
      },
      {
        message: "第 2 行〔图 2〕写的 123456 在附件库里找不到。",
        hint: "先上传这张图，再提交回复。",
        where: "第 2 行〔图 2〕",
      },
    ]);
  });

  it("交来的完整哈希写法不对，或者附件库里没有完整的一份，都不收", async () => {
    const { core, pageId } = await presented();
    expect(failure(submitText(core, pageId, legacyText, ["ABC"]))).toMatchObject({
      code: "BAD_REQUEST",
      where: "images[0]",
    });
    const missing = `aaaaaa${"d".repeat(58)}`;
    const text = "落地第 1 轮\n疑问 1（〔图 1〕）\n图：图 1=aaaaaad";
    const error = failure(submitText(core, pageId, text, [missing]));
    expect(error).toMatchObject({ code: "BAD_REQUEST", where: "第 2 行〔图 1〕" });
  });
});

describe("自动处理", () => {
  it("想法框里的话不自动处理：没有去处，队列里也不多一件，留给 AI 用 reply handle 定去处", async () => {
    const { core, pageId } = await presented();
    const queued = core.ctx.db.select().from(queueItems).all().length;
    const { submission } = succeed(submitText(core, pageId, legacyText));
    expect(core.ctx.db.select().from(queueItems).all()).toHaveLength(queued);
    expect(failure(getQueueItem(core.ctx.db, "app", "Q4"))).toMatchObject({ code: "NOT_FOUND" });
    const idea = core.ctx.db
      .select()
      .from(replyLines)
      .where(and(eq(replyLines.submissionId, submission.id), eq(replyLines.line, 3)))
      .get();
    expect(idea).toMatchObject({
      kind: "idea",
      destination: null,
      handledAt: null,
      handledBy: null,
    });
  });

  it("取消队列事项：那件事改成已取消，原因写明是用户在回复里取消的，变动记在这个阶段上", async () => {
    const { core, pageId } = await presented();
    succeed(submitText(core, pageId, legacyText));
    expect(queueRow(core, 2)).toMatchObject({
      status: "dropped",
      statusNote: "用户在回复里取消了这件事。",
    });
    const last = core.ctx.db
      .select()
      .from(queueEvents)
      .where(eq(queueEvents.itemId, queueRow(core, 2)?.id ?? 0))
      .all()
      .at(-1);
    expect(last).toMatchObject({ fromStatus: "doing", toStatus: "dropped", roundId: 1 });
  });

  it("要取消的事已经完成了，这一行留给 AI，返回一条警告", async () => {
    const { core, pageId } = await presented();
    succeed(transitionQueueItem(core.ctx, "app", "Q2", { to: "done", evidence: "提交记录 abc" }));
    const submitted = succeed(submitText(core, pageId, legacyText));
    expect(queueRow(core, 2)?.status).toBe("done");
    expect(submitted.submission.lines[1]).not.toHaveProperty("handled");
    expect(submitted.warnings).toMatchObject([
      { where: "第 2 行", hint: "运行 ploop reply handle 处理这一行。" },
    ]);
    expect(submitted.warnings[0]?.message).toMatch(/^第 2 行要取消的 Q2 没能自动取消：/u);
  });

  it("认可一条更改：去处是不处理，原因写明是用户认可，执行者是后端，没有警告", async () => {
    const { core, pageId } = await presented();
    const [, change = ""] = cardIds(core, pageId);
    const lines = [{ section: "changes", card: change, kind: "changeApproved" }] as const;
    const submitted = succeed(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps),
    );
    expect(submitted.warnings).toEqual([]);
    expect(submitted.submission.lines).toMatchObject([
      {
        line: 1,
        section: "changes",
        card: change,
        kind: "changeApproved",
        handled: {
          destination: { to: "noAction", reason: "用户认可了这一条更改。" },
          by: autoHandler,
        },
      },
    ]);
  });

  it("其余的行不处理，留给第 44 步", async () => {
    const { core, pageId } = await presented();
    const { submission } = succeed(submitText(core, pageId, legacyText));
    const row = core.ctx.db
      .select()
      .from(replyLines)
      .where(and(eq(replyLines.submissionId, submission.id), eq(replyLines.line, 1)))
      .get();
    expect(row).toMatchObject({ destination: null, handledAt: null, handledBy: null });
  });
});

describe("同一页只能提交一次", () => {
  it("第二次提交返回冲突，第一份回复不变", async () => {
    const { core, pageId } = await presented();
    const first = succeed(submitText(core, pageId, legacyText)).submission;
    expect(failure(submitText(core, pageId, "落地第 1 轮\n疑问 1（改主意了）"))).toMatchObject({
      code: "CONFLICT",
      message: "第 1 版的落地阶段的第 1 页已经回复过了，同一页只能提交一次。",
      hint: "运行 ploop reply show 查看这份回复。",
    });
    expect(succeed(submissionOfPage(core.ctx.db, "app", pageId))?.lines).toEqual(first.lines);
  });

  it("带着同一个请求编号重发，拿到第一次的结果，不算第二次提交", async () => {
    const { core, pageId } = await presented();
    const idempotency = { key: "k-1", operation: `POST /pages/${pageId}/submission/text` };
    const ctx = { ...core.ctx, idempotency };
    const input = { source: "legacyTemplate", text: legacyText } as const;
    const first = succeed(submitReply(ctx, "app", pageId, input, submitDeps));
    const again = succeed(submitReply(ctx, "app", pageId, input, submitDeps));
    expect(again).toEqual(first);
    expect(core.ctx.db.select().from(submissions).all()).toHaveLength(1);
  });

  it("另一个连接先提交了，这里在事务里看到已回复，返回冲突", async () => {
    const { core, pageId } = await presented();
    const other = await openDatabase({
      file: core.sqlite.name,
      migrationsFolder,
      backupsDir: mkdtempSync(join(tmpdir(), "ploop-backups-")),
    });
    if (!other.ok) throw new Error(other.error.kind);
    onTestFinished(() => {
      other.value.sqlite.close();
    });
    const otherCtx = { ...core.ctx, db: other.value.db };
    succeed(submitReply(otherCtx, "app", pageId, { source: "chat", text: legacyText }, submitDeps));
    expect(failure(submitText(core, pageId, legacyText)).code).toBe("CONFLICT");
    expect(core.ctx.db.select().from(submissions).all()).toHaveLength(1);
  });
});

describe("页面和项目的前提", () => {
  it("撤回的页返回 PAGE_GONE", async () => {
    const { core, pageId } = await presented();
    succeed(withdrawPage(core.ctx, "app", pageId));
    expect(failure(submitText(core, pageId, legacyText))).toMatchObject({
      code: "PAGE_GONE",
      message: "第 1 版的落地阶段的第 1 页已经撤回了。",
    });
  });

  it("所在的阶段已经收尾的页返回 PAGE_GONE", async () => {
    const core = await landRound();
    const pageId = present(core, "view");
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: core.ctx.now() }).run();
    expect(failure(submitText(core, pageId, legacyText))).toMatchObject({
      code: "PAGE_GONE",
      message: "第 1 版的落地阶段已经收尾了，它的第 1 页不能再回复。",
    });
  });

  it("要用户点的页，所在的阶段已经收尾，也返回 PAGE_GONE，什么都不存", async () => {
    const { core, pageId } = await presented();
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: core.ctx.now() }).run();
    const lines = [{ kind: "idea", note: "看板可以按阶段分列" }] as const;
    const error = failure(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps),
    );
    expect(error).toMatchObject({
      code: "PAGE_GONE",
      message: "第 1 版的落地阶段已经收尾了，它的第 1 页不能再回复。",
    });
    expect(core.ctx.db.select().from(submissions).all()).toEqual([]);
    expect(core.ctx.db.select().from(pages).get()?.status).toBe("presented");
    expect(getQueueItem(core.ctx.db, "app", "Q4").ok).toBe(false);
  });

  it("迁移进来的历史页，状态是已回复却没有提交记录，返回冲突，什么都不存", async () => {
    const { core, pageId } = await presented();
    core.ctx.db.update(pages).set({ status: "replied" }).run();
    expect(core.ctx.db.select().from(submissions).all()).toEqual([]);
    const lines = [{ kind: "idea", note: "看板可以按阶段分列" }] as const;
    const error = failure(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps),
    );
    expect(error).toMatchObject({
      code: "CONFLICT",
      message: "第 1 版的落地阶段的第 1 页已经回复过了，同一页只能提交一次。",
    });
    expect(failure(submitText(core, pageId, legacyText)).code).toBe("CONFLICT");
    expect(core.ctx.db.select().from(submissions).all()).toEqual([]);
  });

  it("页面不在这个项目里返回 NOT_FOUND", async () => {
    const { core, pageId } = await presented();
    expect(failure(submitText(core, pageId + 1, legacyText)).code).toBe("NOT_FOUND");
    const other = submitReply(
      core.ctx,
      "other",
      pageId,
      { source: "chat", text: legacyText },
      submitDeps,
    );
    expect(failure(other).code).toBe("NOT_FOUND");
  });

  it("项目要先做迁移检查时返回 NEEDS_DOCTOR，什么都不存", async () => {
    const { core, pageId } = await presented();
    core.ctx.db.update(projects).set({ skillVersion: null }).where(eq(projects.id, "app")).run();
    expect(failure(submitText(core, pageId, legacyText)).code).toBe("NEEDS_DOCTOR");
    expect(core.ctx.db.select().from(submissions).all()).toEqual([]);
  });

  it("回复只看的页时，这个阶段还有要用户点的页在等，仍是等用户回复", async () => {
    const core = await landRound();
    const viewed = present(core, "view");
    present(core);
    expect(succeed(submitText(core, viewed, legacyText)).roundStatus).toBe("waiting");
    expect(roundStatus(core)).toBe("waiting");
  });
});

describe("报错里页面的叫法", () => {
  // 页只有一种叫法：第几版的哪个阶段的第几页，全局的页面编号不出现在报错里，见审查报告 P07。
  // 把一页挪到第 2 版的检查阶段，序号写成 2，让版、阶段和页序号都和编号对不上。
  function moveToSecondCheckPage(core: TestCore, pageId: number): void {
    const { db } = core.ctx;
    const now = core.ctx.now();
    db.update(productVersions)
      .set({ status: "closed", endedAt: now })
      .where(eq(productVersions.version, 1))
      .run();
    db.insert(productVersions)
      .values({ projectId: "app", version: 2, status: "open", startedAt: now })
      .run();
    db.update(rounds).set({ version: 2, stage: "check" }).run();
    db.update(pages).set({ seq: 2 }).where(eq(pages.id, pageId)).run();
  }

  it("撤回的页：写第 2 版的检查阶段的第 2 页，不写页面编号", async () => {
    const { core, pageId } = await presented();
    succeed(withdrawPage(core.ctx, "app", pageId));
    moveToSecondCheckPage(core, pageId);
    expect(failure(submitText(core, pageId, legacyText))).toMatchObject({
      code: "PAGE_GONE",
      message: "第 2 版的检查阶段的第 2 页已经撤回了。",
    });
  });

  it("已经回复过的页：写第 2 版的检查阶段的第 2 页，不写页面编号", async () => {
    const { core, pageId } = await presented();
    succeed(submitText(core, pageId, legacyText));
    moveToSecondCheckPage(core, pageId);
    expect(failure(submitText(core, pageId, legacyText))).toMatchObject({
      code: "CONFLICT",
      message: "第 2 版的检查阶段的第 2 页已经回复过了，同一页只能提交一次。",
    });
  });

  it("所在的阶段已经收尾：写第 2 版的检查阶段，再写是它的第 2 页", async () => {
    const { core, pageId } = await presented();
    moveToSecondCheckPage(core, pageId);
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: core.ctx.now() }).run();
    expect(failure(submitText(core, pageId, legacyText))).toMatchObject({
      code: "PAGE_GONE",
      message: "第 2 版的检查阶段已经收尾了，它的第 2 页不能再回复。",
    });
  });
});

describe("工作台交来的各行", () => {
  it("存下结构化内容，不存文字，想法留着没有去处", async () => {
    const { core, pageId } = await presented();
    const [card] = cardIds(core, pageId);
    const lines = [
      { section: "asks", card, kind: "noteOnly", note: " 先放第一屏 ", images: [hash("c")] },
      { kind: "idea", note: "看板可以按阶段分列" },
    ] as const;
    const submitted = succeed(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps),
    );
    expect(submitted.submission.text).toBeNull();
    expect(submitted.submission.lines).toMatchObject([
      { line: 1, section: "asks", card, kind: "noteOnly", note: "先放第一屏", images: [hash("c")] },
      { line: 2, kind: "idea", note: "看板可以按阶段分列" },
    ]);
    expect(submitted.submission.lines[1]).not.toHaveProperty("handled");
    const row = core.ctx.db.select().from(submissions).get();
    expect(row?.content).toEqual(lines);
    expect(
      core.ctx.db
        .select()
        .from(replyLines)
        .all()
        .map((line) => line.textLine),
    ).toEqual([null, null]);
  });

  it("对不上这一页的地方一次报齐", async () => {
    const { core, pageId } = await presented();
    const [card = ""] = cardIds(core, pageId);
    const lines = [
      { card: "no-such-card", kind: "agree" },
      { section: "findings", card, kind: "option" },
      { kind: "idea", note: "  " },
      { kind: "queueDrop" },
      { kind: "queueDrop", queue: "Q9" },
      { kind: "agree", card, images: [hash("9")] },
    ] as const;
    const error = failure(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps),
    );
    expect(error.code).toBe("BAD_REQUEST");
    expect(issuesOf(error).map((issue) => issue.message)).toEqual([
      "第 1 行的卡片 no-such-card 不在这一页上。",
      `第 2 行的卡片 ${card} 在 asks 区块，行里写的是 findings。`,
      "第 2 行选了选项，没有写选的是哪一个。",
      "第 3 行是想法，没有写备注。",
      "第 4 行要取消队列事项，没有写是哪一件。",
      "第 5 行写的 Q9 不在这个项目的队列里。",
    ]);
    const images = failure(
      submitReply(core.ctx, "app", pageId, { source: "workbench", lines: [lines[5]] }, submitDeps),
    );
    expect(images).toMatchObject({ code: "BAD_REQUEST", where: "第 1 行的第 1 张图" });
  });

  it("文字和各行只交一样，一行都没有的不收", async () => {
    const { core, pageId } = await presented();
    const submit = (input: Parameters<typeof submitReply>[3]) =>
      failure(submitReply(core.ctx, "app", pageId, input, submitDeps));
    expect(submit({ source: "workbench" }).message).toBe("回复里没有文字，也没有各行。");
    expect(submit({ source: "workbench", text: legacyText, lines: [] }).message).toBe(
      "回复里同时写了文字和各行。",
    );
    expect(submit({ source: "workbench", lines: [] }).message).toBe("回复是空的，一行都没有。");
  });
});

describe("事件", () => {
  it("先记 submission.created，再记自动处理的队列变化和 line.handled，提交以后按顺序发出，想法不记", async () => {
    const { core, pageId } = await presented();
    const before = core.received.length;
    const { submission } = succeed(submitText(core, pageId, legacyText));
    const sid = submission.id;
    expect(core.received.slice(before).map((event) => [event.kind, event.objectId])).toEqual([
      ["submission.created", String(sid)],
      ["queue.moved", "Q2"],
      ["line.handled", `${sid}:2`],
    ]);
    expect(core.received[before]).toMatchObject({
      projectId: "app",
      objectType: "submission",
      detail: {
        round: "v1-落地-1",
        page: pageId,
        submission: sid,
        source: "legacyTemplate",
        lines: 3,
        roundStatus: "replied",
      },
    });
    expect(core.received.at(-1)).toMatchObject({
      objectType: "replyLine",
      detail: { submission: sid, line: 2, to: "queue", queue: "Q2", by: autoHandler },
    });
  });

  it("失败的提交不发事件", async () => {
    const { core, pageId } = await presented();
    succeed(withdrawPage(core.ctx, "app", pageId));
    const before = core.received.length;
    failure(submitText(core, pageId, legacyText));
    expect(core.received.length).toBe(before);
  });
});

describe("读回复", () => {
  it("还没回复时是空的，回复以后按行号列出每一行", async () => {
    const { core, pageId } = await presented();
    expect(succeed(submissionOfPage(core.ctx.db, "app", pageId))).toBeNull();
    const { submission } = succeed(submitText(core, pageId, legacyText));
    const lines = succeed(linesOfSubmission(core.ctx.db, "app", submission.id));
    expect(lines.map((line) => line.line)).toEqual([1, 2, 3]);
    expect(failure(linesOfSubmission(core.ctx.db, "other", submission.id))).toMatchObject({
      code: "NOT_FOUND",
      message: `项目「other」没有编号为 ${submission.id} 的回复。`,
    });
  });
});
