import type { ErrorBody, Result, Stage } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pages, rounds } from "../../store/schema/index.ts";
import { addQueueItem, transitionQueueItem } from "../queue.ts";
import { handleLine } from "../replies/handle.ts";
import { submitReply } from "../replies/submit.ts";
import { cardIds, presented, submitDeps } from "../replies/testing.ts";
import {
  addProject,
  addRound,
  emptyCore,
  mainlineText,
  pushMainline,
  startAt,
  type TestCore,
} from "../testing.ts";
import { recordUseRun } from "../use/testing.ts";
import { closeRound } from "./close.ts";
import { roundDetail } from "./show.ts";
import { startRound } from "./start.ts";

// 看一个阶段：阶段的写法和迁移前的文件名都能查到，文件名重名时列出对应的几个阶段，见「04 命令行」第二节。

async function oneProject(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  return core;
}

function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function failure<T>(result: Result<T, ErrorBody>): ErrorBody {
  if (result.ok) throw new Error("应当失败，却成功了");
  return result.error;
}

function add(core: TestCore, content: string, key: Stage): void {
  succeed(addQueueItem(core.ctx, "app", { content, stage: key, proposer: "ai" }));
}

const show = (core: TestCore, ref: string) => roundDetail(core.ctx.db, "app", ref);

/** 给一个阶段记上迁移前的文件名。迁移的用例在第 59 到 62 步。 */
function setLegacy(core: TestCore, seq: number, legacyId: string): void {
  core.ctx.db.update(rounds).set({ legacyId }).where(eq(rounds.seq, seq)).run();
}

describe("看一个阶段", () => {
  it("开着的阶段：拿出的事没有结果，写明开它的会话和客户端", async () => {
    const core = await oneProject();
    add(core, "设置页的保存按钮在窄屏被挡住", "use");
    succeed(startRound(core.ctx, "app", { stage: "use" }));
    const detail = succeed(show(core, "v1-使用-1"));
    expect(detail).toMatchObject({
      round: { label: "v1-使用-1", status: "open" },
      openedBySession: "session-1",
      openedByClient: "cli/2.0.0",
      baseCommits: null,
      summary: null,
      pages: [],
    });
    expect(detail.items).toEqual([
      {
        item: expect.objectContaining({ id: "Q1", status: "doing" }),
        result: null,
        returnedTo: null,
        note: null,
      },
    ]);
  });

  it("收尾以后：每件事写结果和说明，另有收尾说明", async () => {
    const core = await oneProject();
    add(core, "设置页的保存按钮在窄屏被挡住", "use");
    add(core, "队列看板的卡重复", "use");
    succeed(startRound(core.ctx, "app", { stage: "use" }));
    succeed(transitionQueueItem(core.ctx, "app", "Q2", { to: "dropped", reason: "已经修掉" }));
    recordUseRun(core);
    const results = [{ id: "Q1", result: "returned", note: "定义不对", stage: "think" }] as const;
    succeed(closeRound(core.ctx, "app", "v1-使用-1", { results, summary: "查完了设置页" }));
    const detail = succeed(show(core, "v1-使用-1"));
    expect(detail.summary).toBe("查完了设置页");
    expect(detail.items.map(({ item, ...rest }) => [item.id, rest])).toEqual([
      ["Q1", { result: "returned", returnedTo: "think", note: "定义不对" }],
      ["Q2", { result: "droppedAtStart", returnedTo: null, note: "已经修掉" }],
    ]);
  });

  it("给出过的页按页序号列出，撤回的也列", async () => {
    const core = await oneProject();
    succeed(startRound(core.ctx, "app", { stage: "use" }));
    const roundId = core.ctx.db.select().from(rounds).get()?.id ?? 0;
    const page = {
      projectId: "app",
      roundId,
      purpose: "ask",
      formatVersion: 1,
      sections: {},
      images: [],
      fill: {},
      presentedAt: startAt,
    } as const;
    core.ctx.db
      .insert(pages)
      .values([
        { ...page, seq: 2, status: "presented" },
        { ...page, seq: 1, status: "withdrawn", withdrawnAt: startAt },
      ])
      .run();
    const at = startAt.toISOString();
    expect(succeed(show(core, "v1-使用-1")).pages.map(({ id: _id, ...rest }) => rest)).toEqual([
      { seq: 1, purpose: "ask", status: "withdrawn", presentedAt: at, withdrawnAt: at },
      { seq: 2, purpose: "ask", status: "presented", presentedAt: at, withdrawnAt: null },
    ]);
  });

  it("收到的回复连同每一行的去处一起列出，没处理的行没有去处；没有回复时为空", async () => {
    const { core, pageId } = await presented();
    expect(succeed(show(core, "v1-落地-1")).replies).toEqual([]);
    const [card] = cardIds(core, pageId);
    const note = (text: string) =>
      ({ section: "asks", card, kind: "noteOnly", note: text }) as const;
    const submitted = submitReply(
      core.ctx,
      "app",
      pageId,
      { source: "workbench", lines: [note("先放第一屏"), note("首页再加一个入口")] },
      submitDeps,
    );
    const id = succeed(submitted).submission.id;
    succeed(handleLine(core.ctx, "app", id, 1, { to: "noAction", reason: "已经在第一屏" }));
    const { replies } = succeed(show(core, "v1-落地-1"));
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id, pageSeq: 1, round: "v1-落地-1" });
    expect(
      replies[0]?.lines.map((line) => [line.line, line.note, line.handled?.destination]),
    ).toEqual([
      [1, "先放第一屏", { to: "noAction", reason: "已经在第一屏" }],
      [2, "首页再加一个入口", undefined],
    ]);
  });

  it("迁移前的文件名查到迁移进来的阶段，带日期文件夹的文件名也能查", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "land", seq: 13 });
    addRound(core, "app", { version: 1, stage: "think", seq: 29 });
    setLegacy(core, 13, "fix-13");
    setLegacy(core, 29, "2026-09-20/think-29");
    expect(succeed(show(core, "fix-13")).round).toMatchObject({
      label: "v1-落地-13",
      legacyId: "fix-13",
    });
    expect(succeed(show(core, "2026-09-20/think-29")).round.label).toBe("v1-构思-29");
  });

  it("按阶段的叫法查：写全的、省了空格和「的」的、带次数的，都找到同一个阶段", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "land", seq: 1 });
    addRound(core, "app", { version: 1, stage: "land", seq: 2 });
    addRound(core, "app", { version: 1, stage: "think", seq: 1 });
    const first = ["第 1 版的落地阶段", "第1版落地阶段", "第 1 版的落地阶段（第 1 次）"];
    for (const ref of first) {
      expect(succeed(show(core, ref)).round.label, ref).toBe("v1-落地-1");
    }
    const second = [
      "第 1 版的落地阶段（第 2 次）",
      "第1版落地阶段第2次",
      "第 1 版的落地阶段(第 2 次)",
    ];
    for (const ref of second) {
      expect(succeed(show(core, ref)).round.label, ref).toBe("v1-落地-2");
    }
    expect(succeed(show(core, "第 1 版的构思阶段")).round.label).toBe("v1-构思-1");
  });

  it("按叫法查不到时，报的也是叫法；阶段名不对时按叫法的写法报", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "land", seq: 1 });
    expect(failure(show(core, "第 1 版的使用阶段"))).toMatchObject({
      code: "NOT_FOUND",
      message: "项目「app」没有第 1 版的使用阶段。",
    });
    expect(failure(show(core, "第 1 版的修复阶段")).code).toBe("BAD_REQUEST");
  });

  it("迁移前的文件名对上两个阶段：BAD_REQUEST，列出对应的几个阶段", async () => {
    const core = await oneProject();
    addRound(core, "app", { version: 1, stage: "land", seq: 13 });
    addRound(core, "app", { version: 1, stage: "land", seq: 14 });
    core.ctx.db.update(rounds).set({ legacyId: "fix-13" }).run();
    expect(failure(show(core, "fix-13"))).toMatchObject({
      code: "BAD_REQUEST",
      message:
        "迁移前的文件名「fix-13」对上了 2 个阶段：第 1 版的落地阶段（第 13 次）、第 1 版的落地阶段（第 14 次）。",
      where: "fix-13",
    });
  });

  it("没有这个阶段、没有这个项目：NOT_FOUND", async () => {
    const core = await oneProject();
    expect(failure(show(core, "v1-使用-1"))).toMatchObject({
      code: "NOT_FOUND",
      message: "项目「app」没有第 1 版的使用阶段。",
    });
    expect(failure(show(core, "fix-13")).code).toBe("NOT_FOUND");
    expect(failure(roundDetail(core.ctx.db, "other", "v1-使用-1")).code).toBe("NOT_FOUND");
  });

  it("N13 只写阶段名：指这一版里最近一次的那个阶段；这一版还没有就 NOT_FOUND", async () => {
    const core = await oneProject();
    expect(failure(show(core, "落地"))).toMatchObject({
      code: "NOT_FOUND",
      message: "项目「app」这一版还没有落地阶段。",
    });
    // 构思收尾要主线写好一半以上。
    pushMainline(core, mainlineText());
    add(core, "先做一件", "think");
    succeed(startRound(core.ctx, "app", { stage: "think" }));
    succeed(
      closeRound(core.ctx, "app", "v1-构思-1", {
        results: [{ id: "Q1", result: "done", note: "好了" }],
      }),
    );
    add(core, "再做一件", "think");
    succeed(startRound(core.ctx, "app", { stage: "think" }));
    expect(succeed(show(core, "构思")).round.label).toBe("v1-构思-2");
    expect(succeed(show(core, "构思阶段")).round.label).toBe("v1-构思-2");
    expect(failure(show(core, "落地")).code).toBe("NOT_FOUND");
  });

  it("写法不对：BAD_REQUEST，按新写法或两种都不是分别报", async () => {
    const core = await oneProject();
    expect(failure(show(core, "v1-修复-3"))).toMatchObject({
      code: "BAD_REQUEST",
      message: "阶段「v1-修复-3」用了改过名的阶段名「修复」。",
    });
    expect(failure(show(core, "落地第三轮"))).toMatchObject({
      code: "BAD_REQUEST",
      message: "「落地第三轮」既不是阶段的写法，也不是迁移前的文件名。",
    });
  });
});
