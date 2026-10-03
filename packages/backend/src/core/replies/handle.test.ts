import { issuesOf, type ReplyHandleEntry } from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  decisions,
  events,
  queueItems,
  replyLines,
  submissions,
} from "../../store/schema/index.ts";
import { pushRevision } from "../mainline.ts";
import { fillPage } from "../pages/fill.ts";
import { presentPage } from "../pages/present.ts";
import {
  deps,
  failure,
  hash,
  landRound,
  pageData,
  presentInput,
  succeed,
} from "../pages/testing.ts";
import { addQueueItem, getQueueItem, transitionQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import type { TestCore } from "../testing.ts";
import { handleLine, handleLines } from "./handle.ts";
import { type SubmitInput, submitReply } from "./submit.ts";
import { cardIds, present, submitDeps } from "./testing.ts";

// 处理回复：五种去处各一成一败，捞回开始时取消的事，带图的行要确认读过图，
// 还有行没处理时给不出下一页、开不了下一轮，下一页填上一轮的回复去了哪里。
// 项目 app 开着第一轮落地，拿出了 Q1 到 Q3，给出的一页有一张疑问卡，见 testing.ts。

/** 回复这一页：疑问卡上写六行备注，第 1 行带一张图。返回回复的编号。 */
function reply(
  core: TestCore,
  pageId: number,
  extra: NonNullable<SubmitInput["lines"]> = [],
): number {
  const [card] = cardIds(core, pageId);
  const note = (text: string) => ({ section: "asks", card, kind: "noteOnly", note: text }) as const;
  const lines = [
    { ...note("先放第一屏"), images: [hash("c")] },
    note("场景清单要补一步"),
    note("看板默认按阶段分列"),
    note("首页再加一个入口"),
    note("这一版先放第一屏"),
    note("先不管深色模式"),
    ...extra,
  ];
  const submitted = submitReply(
    core.ctx,
    "app",
    pageId,
    { source: "workbench", lines },
    submitDeps,
  );
  return succeed(submitted).submission.id;
}

async function replied(): Promise<{ core: TestCore; pageId: number; sid: number }> {
  const core = await landRound();
  const pageId = present(core);
  return { core, pageId, sid: reply(core, pageId) };
}

const lineRow = (core: TestCore, sid: number, line: number) =>
  core.ctx.db
    .select()
    .from(replyLines)
    .where(and(eq(replyLines.submissionId, sid), eq(replyLines.line, line)))
    .get();

const handle = (core: TestCore, sid: number, entries: readonly ReplyHandleEntry[]) =>
  handleLines(core.ctx, "app", sid, entries);

/** 一小段主线。text 不同，交上去的就是新的一版。 */
const mainline = (text: string) => `# 主线\n\n## 一句话新闻稿\n\n${text}\n`;

function push(core: TestCore, text: string, baseRevision: number | null): number {
  const pushed = pushRevision(core.ctx, "app", {
    text: mainline(text),
    baseRevision,
    source: "cache",
  });
  return succeed(pushed).revision.revision;
}

/** 把假时钟往后拨一分钟，主线的新版本和给出页面的时间分得开。 */
function later(core: TestCore): void {
  core.setNow(new Date(core.ctx.now().getTime() + 60_000));
}

const lineEvents = (core: TestCore) =>
  core.ctx.db
    .select()
    .from(events)
    .where(eq(events.kind, "line.handled"))
    .all()
    .filter((event) => event.detail !== null && (event.detail as { by?: string }).by !== "后端");

describe("去处是主线", () => {
  it("给出页面以后交了新版本，这一行指向它和改的那一样", async () => {
    const core = await landRound();
    push(core, "第一版。", null);
    later(core);
    const pageId = present(core);
    const sid = reply(core, pageId);
    later(core);
    const revision = push(core, "第二版。", 1);
    const done = succeed(handleLine(core.ctx, "app", sid, 2, { to: "mainline", part: "场景清单" }));
    expect(done.lines).toMatchObject([
      { line: 2, handled: { destination: { to: "mainline", revision, part: "场景清单" } } },
    ]);
    expect(lineRow(core, sid, 2)).toMatchObject({ toRevision: 2, toPart: "场景清单" });
  });

  it("主线没有比给出页面时更新的修订，由 reply.mainline.newer 拦截", async () => {
    const core = await landRound();
    push(core, "第一版。", null);
    later(core);
    const pageId = present(core);
    const sid = reply(core, pageId);
    const error = failure(
      handleLine(core.ctx, "app", sid, 2, { to: "mainline", part: "场景清单" }),
    );
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "reply.mainline.newer",
      message: "主线还没有新的修订，第 2 行不能放进主线。",
      where: "[0].revision",
    });
    expect(lineRow(core, sid, 2)?.destination).toBeNull();
  });

  it("还没交过主线也由 reply.mainline.newer 拦截，写了不存在的版本是找不到", async () => {
    const { core, sid } = await replied();
    const none = failure(handleLine(core.ctx, "app", sid, 2, { to: "mainline", part: "交付线" }));
    expect(none).toMatchObject({ code: "RULE_BLOCKED", rule: "reply.mainline.newer" });
    push(core, "第一版。", null);
    const missing = { to: "mainline", part: "交付线", revision: 9 } as const;
    expect(failure(handleLine(core.ctx, "app", sid, 2, missing)).code).toBe("NOT_FOUND");
  });
});

describe("去处是决定", () => {
  it("当场建出一条决定，记下来自哪一行", async () => {
    const { core, sid } = await replied();
    const done = succeed(
      handleLine(core.ctx, "app", sid, 3, {
        to: "decision",
        decision: "看板默认按阶段分列",
        reason: "用户按阶段找事",
        case: "打开首页先看到检查那一列",
      }),
    );
    expect(done.decisions).toMatchObject([{ id: 1, fromLine: { submission: sid, line: 3 } }]);
    expect(lineRow(core, sid, 3)).toMatchObject({ destination: "decision", toDecision: 1 });
  });

  it("缺了案例由 decision.fields 拦截，什么都不写", async () => {
    const { core, sid } = await replied();
    const error = failure(
      handleLine(core.ctx, "app", sid, 3, {
        to: "decision",
        decision: "看板默认按阶段分列",
        reason: "用户按阶段找事",
        case: " ",
      }),
    );
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "decision.fields",
      where: "[0].case",
    });
    expect(core.ctx.db.select().from(decisions).all()).toEqual([]);
    expect(lineRow(core, sid, 3)?.destination).toBeNull();
  });
});

describe("去处是决定，「决定」一项超过 40 个字", () => {
  it("由 decision.decision.tooLong 拦截，写明怎么改，位置是这一行的 decision，什么都不写", async () => {
    const { core, sid } = await replied();
    const error = failure(
      handleLine(core.ctx, "app", sid, 3, {
        to: "decision",
        decision:
          "看板默认按阶段分列，因为用户按阶段找事，按状态分列时同一阶段的事散在几列里，要来回找，而且列头上的数量也对不上",
        reason: "用户按阶段找事",
        case: "打开首页先看到检查那一列",
      }),
    );
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "decision.decision.tooLong",
      hint: "缩短到 40 个字以内，细节写进原因。",
      where: "[0].decision",
    });
    expect(core.ctx.db.select().from(decisions).all()).toEqual([]);
    expect(lineRow(core, sid, 3)?.destination).toBeNull();
  });
});

describe("去处是队列", () => {
  it("写 item 就当场放进一件新的，来源是这一行", async () => {
    const { core, sid } = await replied();
    const item = { content: "首页再加一个入口", stage: "improve", proposer: "user" } as const;
    const done = succeed(handleLine(core.ctx, "app", sid, 4, { to: "queue", item }));
    expect(done.queued).toMatchObject([{ id: "Q4", content: "首页再加一个入口" }]);
    expect(lineRow(core, sid, 4)).toMatchObject({ destination: "queue", toQueue: 4 });
    const row = core.ctx.db.select().from(queueItems).where(eq(queueItems.number, 4)).get();
    expect(row).toMatchObject({ fromSubmissionId: sid, fromLine: 4 });
  });

  it("内容超过 40 个字，由 queue.content.tooLong 拦截；细节写进 note 就放得进去", async () => {
    const { core, sid } = await replied();
    const content =
      "首页再加一个入口，放在左边列表的最下面，点开以后直接跳到队列看板的等待那一列上面，再高亮那一件";
    const error = failure(
      handleLine(core.ctx, "app", sid, 4, {
        to: "queue",
        item: { content, stage: "improve", proposer: "user" },
      }),
    );
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "queue.content.tooLong",
      hint: "缩短到 40 个字以内，细节写进备注。",
    });
    expect(error.where).toMatch(/^\[0\]\.item/u);
    expect(core.ctx.db.select().from(queueItems).all()).toHaveLength(3);
    const done = succeed(
      handleLine(core.ctx, "app", sid, 4, {
        to: "queue",
        item: { content: "首页再加一个入口", stage: "improve", proposer: "user", note: content },
      }),
    );
    expect(done.queued).toMatchObject([{ id: "Q4", note: content }]);
  });

  it("内容和还没做完的一件重复，由 queue.content.duplicate 拦截", async () => {
    const { core, sid } = await replied();
    const item = { content: "看板放到首页的第一屏", stage: "land", proposer: "user" } as const;
    const error = failure(handleLine(core.ctx, "app", sid, 4, { to: "queue", item }));
    expect(error).toMatchObject({ code: "RULE_BLOCKED", rule: "queue.content.duplicate" });
    expect(error.where).toMatch(/^\[0\]\.item/u);
    expect(core.ctx.db.select().from(queueItems).all()).toHaveLength(3);
  });

  it("写 id 指向还没做完的一件，不改它的状态", async () => {
    const { core, sid } = await replied();
    succeed(handleLine(core.ctx, "app", sid, 5, { to: "queue", id: "Q1" }));
    expect(lineRow(core, sid, 5)).toMatchObject({ destination: "queue", toQueue: 1 });
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q1")).item.status).toBe("doing");
  });

  it("写的编号不在队列里是找不到", async () => {
    const { core, sid } = await replied();
    const error = failure(handleLine(core.ctx, "app", sid, 5, { to: "queue", id: "Q9" }));
    expect(error).toMatchObject({ code: "NOT_FOUND", where: "[0].id" });
  });
});

describe("去处是当场做和不处理", () => {
  it("当场做记在这一页所在的阶段上，写完成证据", async () => {
    const { core, sid } = await replied();
    const entry = { to: "doneHere", evidence: "已经改成第一屏" } as const;
    const done = succeed(handleLine(core.ctx, "app", sid, 5, entry));
    expect(done.lines[0]?.handled?.destination).toEqual({
      to: "doneHere",
      round: "v1-落地-1",
      evidence: "已经改成第一屏",
    });
  });

  it("当场做没写完成证据是请求不对", async () => {
    const { core, sid } = await replied();
    const error = failure(handleLine(core.ctx, "app", sid, 5, { to: "doneHere", evidence: "  " }));
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: "第 5 行没有写完成证据。",
      where: "[0].evidence",
    });
  });

  it("不处理写原因", async () => {
    const { core, sid } = await replied();
    const entry = { to: "noAction", reason: "深色模式在第二期" } as const;
    succeed(handleLine(core.ctx, "app", sid, 6, entry));
    expect(lineRow(core, sid, 6)).toMatchObject({
      destination: "noAction",
      handledNote: "深色模式在第二期",
      handledBy: "cli/2.0.0",
    });
  });

  it("不处理没写原因是请求不对", async () => {
    const { core, sid } = await replied();
    const error = failure(handleLine(core.ctx, "app", sid, 6, { to: "noAction", reason: "" }));
    expect(error).toMatchObject({ code: "BAD_REQUEST", message: "第 6 行没有写不处理的原因。" });
  });
});

describe("捞回开始时取消的事", () => {
  /** 开始以后取消 Q3，给出一页，回复里在「这一轮开始时取消的事」点名它。 */
  async function droppedAndNamed() {
    const core = await landRound();
    succeed(transitionQueueItem(core.ctx, "app", "Q3", { to: "dropped", reason: "先不做" }));
    const pageId = present(core);
    const named = { section: "droppedAtStart", kind: "noteOnly", note: "Q3 还要做" } as const;
    return { core, sid: reply(core, pageId, [named]) };
  }

  it("来自这一块的行把它捞回待办，编号不变", async () => {
    const { core, sid } = await droppedAndNamed();
    const done = succeed(handleLine(core.ctx, "app", sid, 7, { to: "queue", id: "Q3" }));
    expect(done.restored).toMatchObject([{ id: "Q3", status: "todo" }]);
    expect(done.restored[0]?.statusNote).toBe("用户在回复里点名捞回这件事。");
    expect(lineRow(core, sid, 7)).toMatchObject({ destination: "queue", toQueue: 3 });
  });

  it("不是来自这一块、也没点名它的行，由状态图拦截", async () => {
    const { core, sid } = await droppedAndNamed();
    const error = failure(handleLine(core.ctx, "app", sid, 2, { to: "queue", id: "Q3" }));
    expect(error).toMatchObject({ code: "RULE_BLOCKED", rule: "queue.status.graph" });
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q3")).item.status).toBe("dropped");
  });

  it("不是这个阶段开始时取消的事，捞不回", async () => {
    const { core, sid } = await droppedAndNamed();
    succeed(addQueueItem(core.ctx, "app", { content: "改配色", stage: "check", proposer: "ai" }));
    succeed(transitionQueueItem(core.ctx, "app", "Q4", { to: "dropped", reason: "不要了" }));
    const error = failure(handleLine(core.ctx, "app", sid, 7, { to: "queue", id: "Q4" }));
    expect(error).toMatchObject({ code: "RULE_BLOCKED", rule: "queue.status.graph" });
  });
});

describe("选中已有的一件，改标要做它的阶段", () => {
  it("这一轮拿出的事写了阶段：编号不变，回到待办，改标成新阶段，不放进新的一件", async () => {
    const { core, sid } = await replied();
    const done = succeed(
      handleLine(core.ctx, "app", sid, 2, { to: "queue", id: "Q1", stage: "think" }),
    );
    expect(done.restaged).toMatchObject([{ id: "Q1", stage: "think", status: "todo" }]);
    expect(done.queued).toEqual([]);
    expect(lineRow(core, sid, 2)).toMatchObject({ destination: "queue", toQueue: 1 });
    const { item } = succeed(getQueueItem(core.ctx.db, "app", "Q1"));
    expect(item).toMatchObject({ stage: "think", status: "todo", statusNote: "选中，改标构思" });
    expect(
      core.ctx.db
        .select({ n: queueItems.number })
        .from(queueItems)
        .all()
        .map((row) => row.n),
    ).toEqual([1, 2, 3]);
  });

  it("阶段没变时只指过去，不记改标", async () => {
    const { core, sid } = await replied();
    const done = succeed(
      handleLine(core.ctx, "app", sid, 2, { to: "queue", id: "Q1", stage: "land" }),
    );
    expect(done.restaged).toEqual([]);
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q1")).item.status).toBe("doing");
  });

  it("待办的事只改阶段，例如用户写在想法框里、还没被这一轮拿出的事", async () => {
    const { core, sid } = await replied();
    succeed(
      addQueueItem(core.ctx, "app", { content: "改配色", stage: "improve", proposer: "user" }),
    );
    const done = succeed(
      handleLine(core.ctx, "app", sid, 2, { to: "queue", id: "Q4", stage: "land" }),
    );
    expect(done.restaged).toMatchObject([{ id: "Q4", stage: "land", status: "todo" }]);
  });

  it("捞回已取消的事时可以同时改标阶段", async () => {
    const core = await landRound();
    succeed(transitionQueueItem(core.ctx, "app", "Q3", { to: "dropped", reason: "先不做" }));
    const pageId = present(core);
    const named = { section: "droppedAtStart", kind: "noteOnly", note: "Q3 改到检查再做" } as const;
    const sid = reply(core, pageId, [named]);
    const done = succeed(
      handleLine(core.ctx, "app", sid, 7, { to: "queue", id: "Q3", stage: "check" }),
    );
    expect(done.restored).toMatchObject([{ id: "Q3", status: "todo", stage: "check" }]);
  });

  it("卡上已列着还没做完的事，却又放进了新的一件：警告，写明怎么改标", async () => {
    const { core, sid } = await replied();
    const done = succeed(
      handleLine(core.ctx, "app", sid, 2, {
        to: "queue",
        item: { content: "看板放到首页", stage: "land", proposer: "user" },
      }),
    );
    expect(done.queued).toMatchObject([{ id: "Q4" }]);
    expect(done.warnings).toEqual([
      {
        message: "第 2 行所在的卡上已有 Q1，这次又放进了新的 Q4。",
        hint: "要改 Q1 的阶段，运行 ploop reply handle 2 队列 Q1 --stage <阶段名>。",
        where: "[0].item",
      },
    ]);
  });

  it("已完成的事改标不了，由状态图拦截", async () => {
    const { core, sid } = await replied();
    succeed(transitionQueueItem(core.ctx, "app", "Q1", { to: "done", evidence: "提交 3f2a9c1" }));
    const error = failure(
      handleLine(core.ctx, "app", sid, 2, { to: "queue", id: "Q1", stage: "think" }),
    );
    expect(error).toMatchObject({ code: "RULE_BLOCKED", rule: "queue.status.graph" });
  });
});

describe("reply.images.read", () => {
  it("处理带图的行没写已读，拦截", async () => {
    const { core, sid } = await replied();
    const error = failure(handleLine(core.ctx, "app", sid, 1, { to: "noAction", reason: "重复" }));
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "reply.images.read",
      message: "第 1 行带了 1 张图，还没有确认读过。",
      where: "[0].imagesRead",
    });
  });

  it("写了已读就能处理，这一行记下已读", async () => {
    const { core, sid } = await replied();
    const entry = { to: "noAction", reason: "重复", imagesRead: true } as const;
    succeed(handleLine(core.ctx, "app", sid, 1, entry));
    expect(lineRow(core, sid, 1)).toMatchObject({ destination: "noAction", imagesRead: true });
  });
});

describe("一次处理多行", () => {
  it("全部通过时一起写下，每一行记一条 line.handled，列出还没处理的行", async () => {
    const { core, sid } = await replied();
    const done = succeed(
      handle(core, sid, [
        { line: 5, to: "doneHere", evidence: "已经改好" },
        { line: 6, to: "noAction", reason: "第二期再做" },
      ]),
    );
    expect(done.lines.map((line) => line.line)).toEqual([5, 6]);
    expect(done.remaining).toEqual([1, 2, 3, 4]);
    expect(done.next).toEqual(["ploop reply show"]);
    expect(lineEvents(core).map((event) => event.objectId)).toEqual([`${sid}:5`, `${sid}:6`]);
    expect(lineEvents(core)[1]?.detail).toMatchObject({ to: "noAction", note: "第二期再做" });
  });

  it("有一行不通过就整批撤回，同一类问题一次报齐", async () => {
    const { core, sid } = await replied();
    const error = failure(
      handle(core, sid, [
        { line: 5, to: "doneHere", evidence: "已经改好" },
        { line: 1, to: "noAction", reason: "重复" },
        { line: 3, to: "decision", decision: "按阶段分列", reason: "好找", case: "" },
      ]),
    );
    expect(error.code).toBe("RULE_BLOCKED");
    expect(issuesOf(error).map((issue) => issue.rule)).toEqual([
      "reply.images.read",
      "decision.fields",
    ]);
    expect(lineRow(core, sid, 5)?.destination).toBeNull();
    expect(lineEvents(core)).toEqual([]);
  });

  it("行号不在回复里是找不到，已经处理过是冲突，同一行写两次是请求不对", async () => {
    const { core, sid } = await replied();
    const missing = failure(handle(core, sid, [{ line: 99, to: "noAction", reason: "无" }]));
    expect(missing).toMatchObject({ code: "NOT_FOUND", message: "这份回复没有第 99 行。" });
    succeed(handle(core, sid, [{ line: 6, to: "noAction", reason: "第二期" }]));
    const again = failure(handle(core, sid, [{ line: 6, to: "noAction", reason: "第二期" }]));
    expect(again).toMatchObject({
      code: "CONFLICT",
      message: "第 6 行已经处理过了，去处是不处理。",
    });
    const twice = failure(
      handle(core, sid, [
        { line: 5, to: "noAction", reason: "一" },
        { line: 5, to: "noAction", reason: "二" },
      ]),
    );
    expect(twice).toMatchObject({ code: "BAD_REQUEST", where: "[1].line" });
  });

  it("回复不在这个项目里是找不到", async () => {
    const { core, sid } = await replied();
    const error = failure(
      handleLines(core.ctx, "app", sid + 1, [{ line: 1, to: "noAction", reason: "无" }]),
    );
    expect(error.code).toBe("NOT_FOUND");
    expect(core.ctx.db.select().from(submissions).all()).toHaveLength(1);
  });
});

/** 处理完这份回复里还没处理的行：第 1 行带图，写已读。 */
function handleAll(core: TestCore, sid: number) {
  return succeed(
    handle(core, sid, [
      { line: 1, to: "doneHere", evidence: "已经放到第一屏", imagesRead: true },
      { line: 2, to: "noAction", reason: "场景在构思里补" },
      { line: 3, to: "noAction", reason: "已经是这样" },
      { line: 4, to: "queue", item: { content: "首页加入口", stage: "improve", proposer: "user" } },
      { line: 5, to: "queue", id: "Q1" },
      { line: 6, to: "noAction", reason: "第二期再做" },
    ]),
  );
}

describe("reply.line.handled", () => {
  it("还有行没处理时，给不出下一页，写明是哪几行", async () => {
    const { core, sid } = await replied();
    succeed(handle(core, sid, [{ line: 6, to: "noAction", reason: "第二期" }]));
    const error = failure(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "reply.line.handled",
      message:
        "第 1 版的落地阶段的回复还有几行没有处理：第 1 行、第 2 行、第 3 行、第 4 行、第 5 行。",
      where: "第 1 版的落地阶段",
    });
  });

  it("还有行没处理时，开不了下一个阶段", async () => {
    const { core, sid } = await replied();
    const blocked = failure(startRound(core.ctx, "app", { stage: "improve" }));
    expect(blocked).toMatchObject({ code: "RULE_BLOCKED", rule: "reply.line.handled" });
    handleAll(core, sid);
    // 处理完以后不再拦截。落地轮不自动收尾，所以接着报的是还开着的一轮。
    expect(failure(startRound(core.ctx, "app", { stage: "improve" })).code).toBe("CONFLICT");
  });

  it("处理完以后给得出下一页，页面填上上一个阶段的回复去了哪里", async () => {
    const { core, sid } = await replied();
    const done = handleAll(core, sid);
    expect(done.remaining).toEqual([]);
    // 回复都处理完了：下一步是收尾，不是再给一页；还要给下一页时 AI 自己写好页面再运行 page present。
    // 这一轮拿出的三件事还在进行中，收尾会拦下并写明每件事怎么记结果，下一步只写命令本身。
    expect(done.next).toEqual(["ploop round close"]);
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    const { fill } = succeed(fillPage(core.ctx.db, presented.page.id));
    expect(fill.previousReplies).toMatchObject({ submission: sid, round: "v1-落地-1" });
    expect(fill.previousReplies?.lines.map((line) => line.handled?.destination)).toEqual([
      { to: "doneHere", round: "v1-落地-1", evidence: "已经放到第一屏" },
      { to: "noAction", reason: "场景在构思里补" },
      { to: "noAction", reason: "已经是这样" },
      { to: "queue", id: "Q4" },
      { to: "queue", id: "Q1" },
      { to: "noAction", reason: "第二期再做" },
    ]);
  });
});
