import { describe, expect, it } from "vitest";
import { submitReply } from "../replies/submit.ts";
import { presented, submitDeps } from "../replies/testing.ts";
import { waitForReply } from "../replies/wait.ts";
import { fillPage } from "./fill.ts";
import { succeed } from "./testing.ts";

// 填好的一页带着它的回复，工作台据此显示「等 AI 取走」和「AI 已收到」。

describe("一页的回复", () => {
  it("没提交时为空；提交以后有编号，取走以后有取走的时间", async () => {
    const { core, pageId } = await presented();
    expect(succeed(fillPage(core.ctx.db, pageId)).submission).toBeNull();
    const lines = [{ kind: "idea" as const, note: "看板可以按阶段分列" }];
    succeed(submitReply(core.ctx, "app", pageId, { source: "workbench", lines }, submitDeps));
    expect(succeed(fillPage(core.ctx.db, pageId)).submission).toMatchObject({ takenAt: null });
    succeed(await waitForReply(core.ctx, "app", pageId, { timeoutMs: 0 }));
    expect(succeed(fillPage(core.ctx.db, pageId)).submission?.takenAt).not.toBeNull();
  });
});
