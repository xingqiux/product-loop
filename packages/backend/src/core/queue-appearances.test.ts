import { describe, expect, it } from "vitest";
import { succeed } from "./pages/testing.ts";
import { getQueueItem } from "./queue.ts";
import { cardIds, presented } from "./replies/testing.ts";

// 一件事出现在哪几轮的哪几张卡上，队列看板的展示卡片用。

describe("队列事项出现在哪些卡上", () => {
  it("按页面和卡片的先后列出引用了它的卡", async () => {
    const { core, pageId } = await presented();
    const [first, second] = cardIds(core, pageId);
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q1")).appearances).toMatchObject([
      { round: "v1-落地-1", page: pageId, card: first },
    ]);
    expect(succeed(getQueueItem(core.ctx.db, "app", "Q3")).appearances).toMatchObject([
      { page: pageId, card: second },
    ]);
  });
});
