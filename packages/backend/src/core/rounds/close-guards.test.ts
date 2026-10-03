import { issuesOf } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, queueItems, roundItems, rounds } from "../../store/schema/index.ts";
import { landRound, succeed } from "../pages/testing.ts";
import { addQueueItem, getQueueItem } from "../queue.ts";
import { handleLine } from "../replies/handle.ts";
import { submitReply } from "../replies/submit.ts";
import { cardIds, present, submitDeps } from "../replies/testing.ts";
import type { TestCore } from "../testing.ts";
import { closeRound, type RoundCloseInput } from "./close.ts";

// 收尾的几道关：回复没处理完不能收尾，用户不认可的更改不能记成做完，
// 放弃一个阶段的规矩，还有拿出来的事没有结果时，第一条拦截就写出能运行的命令。
// 项目 app 开着第一轮落地，拿出了 Q1 到 Q3，给出的一页有一张疑问卡（Q1）和一张更改卡（Q2、Q3）。

const round = "v1-落地-1";
const close = (core: TestCore, input: RoundCloseInput) =>
  closeRound(core.ctx, "app", round, { worktree: [], ...input });
const rules = (result: ReturnType<typeof close>) =>
  result.ok ? [] : issuesOf(result.error).map((issue) => issue.rule);
const status = (core: TestCore, id: string) =>
  succeed(getQueueItem(core.ctx.db, "app", id)).item.status;

/** 对更改卡点认可或不认可，对疑问卡写一句备注，提交这一页的回复。返回回复的编号。 */
function reply(core: TestCore, pageId: number, verdict: "changeRejected" | "changeApproved") {
  const [ask, change] = cardIds(core, pageId);
  const lines = [
    { section: "asks", card: ask, kind: "noteOnly", note: "先放第一屏" },
    {
      section: "changes",
      card: change,
      kind: verdict,
      ...(verdict === "changeRejected" ? { note: "第一屏还是被挡住" } : {}),
    },
  ] as const;
  const submitted = submitReply(
    core.ctx,
    "app",
    pageId,
    { source: "workbench", lines },
    submitDeps,
  );
  return succeed(submitted).submission;
}

const doneAll = [
  { id: "Q1", result: "done" as const, note: "提交 3f2a9c1" },
  { id: "Q2", result: "done" as const, note: "提交 3f2a9c1" },
  { id: "Q3", result: "done" as const, note: "提交 3f2a9c1" },
];

describe("回复还有行没处理：收尾时就拦，和开始阶段同一条规矩", () => {
  it("还有行没处理时拦截，写明第几行；处理完就能收尾", async () => {
    const core = await landRound();
    const pageId = present(core);
    const submission = reply(core, pageId, "changeApproved");
    // 认可的行后端自动处理，疑问卡上的备注留给 AI。
    expect(submission.lines.filter((line) => line.handled === undefined)).toHaveLength(1);
    const blocked = close(core, { results: doneAll });
    expect(blocked.ok ? [] : issuesOf(blocked.error)).toMatchObject([
      {
        rule: "reply.line.handled",
        message: "第 1 版的落地阶段的回复还有几行没有处理：第 1 行。",
        hint: "运行 ploop reply show 看这几行，再用 ploop reply handle 给每一行定去处。",
      },
    ]);
    expect(status(core, "Q1")).toBe("doing");
    succeed(
      handleLine(core.ctx, "app", submission.id, 1, { to: "noAction", reason: "已经在第一屏" }),
    );
    const closed = close(core, { results: doneAll });
    expect(closed.ok).toBe(true);
  });
});

describe("land.change.rejected：用户不认可的更改不能记成做完", () => {
  it("不认可的更改对应的事写了 --done 就拦截，写明改成 --return；退回就能收尾", async () => {
    const core = await landRound();
    const pageId = present(core);
    const submission = reply(core, pageId, "changeRejected");
    succeed(handleLine(core.ctx, "app", submission.id, 1, { to: "noAction", reason: "备注" }));
    succeed(handleLine(core.ctx, "app", submission.id, 2, { to: "queue", id: "Q2" }));
    const blocked = close(core, { results: doneAll });
    expect(rules(blocked)).toEqual(["land.change.rejected", "land.change.rejected"]);
    expect(blocked.ok ? [] : issuesOf(blocked.error)[0]).toEqual({
      rule: "land.change.rejected",
      message: "用户对「提交以后写明回复被取走」点了不认可，Q2 不能记成做完。",
      hint: "运行 ploop round close --return Q2:落地=<原因>，退回队列，改好以后再给用户看。",
      where: "Q2",
    });
    expect(status(core, "Q2")).toBe("doing");
    const back = [
      doneAll[0] as (typeof doneAll)[number],
      { id: "Q2", result: "returned" as const, stage: "land" as const, note: "第一屏被挡住" },
      { id: "Q3", result: "returned" as const, stage: "land" as const, note: "第一屏被挡住" },
    ];
    const closed = close(core, { results: back });
    expect(closed.ok).toBe(true);
    expect(status(core, "Q2")).toBe("todo");
  });

  it("以最后一次的认可或不认可为准：不认可以后改好、用户又认可了，就能做完", async () => {
    const core = await landRound();
    const first = reply(core, present(core), "changeRejected");
    succeed(handleLine(core.ctx, "app", first.id, 1, { to: "noAction", reason: "备注" }));
    succeed(handleLine(core.ctx, "app", first.id, 2, { to: "queue", id: "Q2" }));
    core.setNow(new Date(core.ctx.now().getTime() + 60_000));
    const second = reply(core, present(core), "changeApproved");
    succeed(handleLine(core.ctx, "app", second.id, 1, { to: "noAction", reason: "备注" }));
    expect(close(core, { results: doneAll }).ok).toBe(true);
  });
});

describe("放弃一个阶段：round close --abort", () => {
  it("拿出的事都退回待办，原因写进收尾说明，不查代码提交，不要求给页", async () => {
    const core = await landRound();
    const result = closeRound(core.ctx, "app", round, { abort: "  计划要改  " });
    const closed = succeed(result);
    expect(closed.summary).toBe("放弃：计划要改");
    // 放弃的阶段没有做完：下一步只写再开一次，不往下走。
    expect(closed.next).toEqual(["ploop round start 落地"]);
    expect(closed.items.map((entry) => [entry.item.id, entry.item.status, entry.result])).toEqual([
      ["Q1", "todo", "returned"],
      ["Q2", "todo", "returned"],
      ["Q3", "todo", "returned"],
    ]);
    expect(closed.items[0]?.note).toBe("放弃：计划要改");
    expect(core.ctx.db.select().from(rounds).get()).toMatchObject({
      status: "closed",
      closeNote: "放弃：计划要改",
    });
    expect(core.ctx.db.select().from(roundItems).all()).toHaveLength(3);
    const closedEvent = core.ctx.db.select().from(events).where(eq(events.kind, "round.closed"));
    expect(closedEvent.get()?.detail).toMatchObject({
      returned: ["Q1", "Q2", "Q3"],
      aborted: true,
    });
    // 退回的事下一次还在这个阶段的队列里。
    expect(
      core.ctx.db
        .select()
        .from(queueItems)
        .all()
        .map((row) => row.stage),
    ).toEqual(["land", "land", "land"]);
  });

  it("已经给用户看过更改的页，就不能放弃，写明怎么收尾", async () => {
    const core = await landRound();
    const submission = reply(core, present(core), "changeApproved");
    succeed(handleLine(core.ctx, "app", submission.id, 1, { to: "noAction", reason: "备注" }));
    const blocked = closeRound(core.ctx, "app", round, { abort: "不想做了" });
    expect(blocked).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        message: "第 1 版的落地阶段已经给用户看过更改，不能放弃。",
        hint: "用 ploop round close 收尾：做完的写 --done，不做的写 --return <编号>:落地=<原因>。",
      },
    });
    expect(status(core, "Q2")).toBe("doing");
  });

  it("原因不能是空白，也不和 --done、--return、--summary 一起写", async () => {
    const core = await landRound();
    expect(closeRound(core.ctx, "app", round, { abort: " " })).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "放弃这个阶段要写原因。", where: "abort" },
    });
    const both = closeRound(core.ctx, "app", round, { abort: "计划要改", summary: "改了三处" });
    expect(both).toMatchObject({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "放弃不和逐件写结果、收尾说明一起写。",
        hint: "放弃时拿出的事都退回待办。去掉 --done、--return 和 --summary 再重跑。",
      },
    });
    expect(status(core, "Q1")).toBe("doing");
  });

  it("还有一页在等用户点，或回复还有行没处理时，放弃也要先处理", async () => {
    const core = await landRound();
    const pageId = present(core);
    expect(closeRound(core.ctx, "app", round, { abort: "计划要改" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    reply(core, pageId, "changeApproved");
    const blocked = closeRound(core.ctx, "app", round, { abort: "计划要改" });
    expect(blocked.ok ? "" : blocked.error.code).toBe("RULE_BLOCKED");
  });
});

describe("拿出的事没有结果：第一条拦截就写能运行的命令", () => {
  it("落地阶段退回要写退回哪个阶段，第一次就写对", async () => {
    const core = await landRound();
    const submission = reply(core, present(core), "changeApproved");
    succeed(handleLine(core.ctx, "app", submission.id, 1, { to: "noAction", reason: "备注" }));
    const blocked = close(core, {});
    const issue = blocked.ok ? undefined : issuesOf(blocked.error)[0];
    expect(issue).toMatchObject({ rule: "round.close.result", where: "Q1" });
    expect(issue?.hint).toContain("--return Q1:落地=<原因>");
  });

  it("提升阶段的事，写明选中的改标阶段、不改的取消", async () => {
    const core = await landRound();
    succeed(closeRound(core.ctx, "app", round, { abort: "先放一放" }));
    succeed(
      addQueueItem(core.ctx, "app", { content: "改配色", stage: "improve", proposer: "user" }),
    );
    const { startRound } = await import("./start.ts");
    succeed(startRound(core.ctx, "app", { stage: "improve" }));
    const blocked = closeRound(core.ctx, "app", "v1-提升-1", {});
    expect(blocked.ok ? [] : issuesOf(blocked.error)[0]?.hint).toBe(
      "选中的事运行 ploop reply handle <行> 队列 Q4 --stage <阶段名>，改标阶段。不改的运行 ploop queue drop Q4 --reason <原因>。",
    );
  });
});
