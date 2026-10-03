import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queueDetailSchema, queueQuerySchema, queueTransitionSchema } from "./queue.ts";

// 队列接口的定义：查询参数和改状态的请求里的中文解码成英文键，响应里的英文键编码回中文。

describe("列出队列的查询参数", () => {
  it("写一次是一个取值，写几次是几个取值，都解码成英文键的数组", () => {
    expect(queueQuerySchema.parse({ stage: "落地" })).toEqual({ stage: ["land"] });
    expect(queueQuerySchema.parse({ status: ["待办", "等待"] })).toEqual({
      status: ["todo", "waiting"],
    });
    expect(queueQuerySchema.parse({})).toEqual({});
  });

  it("英文键、改过名的阶段和不认识的参数都拒绝", () => {
    for (const query of [{ stage: "land" }, { stage: ["落地", "修复"] }, { kind: "想法" }]) {
      expect(queueQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("改状态的请求", () => {
  it("四种状态各带自己的字段，状态写中文，解码以后是英文键", () => {
    expect(queueTransitionSchema.parse({ to: "等待", dependsOn: "等构思定下场景 S4" })).toEqual({
      to: "waiting",
      dependsOn: "等构思定下场景 S4",
    });
    expect(queueTransitionSchema.parse({ to: "已完成", evidence: "改后截图" })).toEqual({
      to: "done",
      evidence: "改后截图",
    });
    expect(queueTransitionSchema.parse({ to: "已取消", reason: "重复" })).toEqual({
      to: "dropped",
      reason: "重复",
    });
    expect(queueTransitionSchema.parse({ to: "待办" })).toEqual({ to: "todo" });
  });

  it("进行中、英文键、别的状态的字段、捞回要看的两件事，都拒绝", () => {
    const rejected = [
      { to: "进行中" },
      { to: "dropped", reason: "重复" },
      { to: "已取消" },
      { to: "已完成", evidence: "改后截图", reason: "重复" },
      { to: "待办", droppedAtRoundStart: true, namedInReply: true },
    ];
    for (const body of rejected) {
      expect(queueTransitionSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("一件事和它的状态变化", () => {
  it("枚举编码成中文，接口上的写法再解析回来不变", () => {
    const detail = {
      item: {
        id: "Q3",
        content: "队列看板",
        stage: "improve" as const,
        proposer: "user" as const,
        proposedIn: "v2-检查-1",
        createdAt: "2026-09-28T08:00:00.000Z",
        status: "waiting" as const,
        statusNote: "等构思定下场景 S4",
        dependsOn: "等构思定下场景 S4",
        subItems: [],
        editCount: 2,
      },
      events: [
        {
          item: "Q3",
          at: "2026-09-28T08:00:00.000Z",
          to: "todo" as const,
          actor: "cli/2.0.0",
        },
        {
          item: "Q3",
          at: "2026-09-28T09:00:00.000Z",
          from: "todo" as const,
          to: "waiting" as const,
          note: "等构思定下场景 S4",
          round: "v2-检查-1",
          actor: "web/2.0.0",
        },
      ],
      appearances: [{ round: "v2-检查-1", page: 4, card: "ask-board", title: "看板放在哪里" }],
    };
    const wire = z.encode(queueDetailSchema, detail);
    expect(wire.item).toMatchObject({ stage: "提升", proposer: "用户", status: "等待" });
    expect(wire.events.map((event) => [event.from, event.to])).toEqual([
      [undefined, "待办"],
      ["待办", "等待"],
    ]);
    expect(queueDetailSchema.parse(wire)).toEqual(detail);
  });
});
