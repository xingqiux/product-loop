import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  filledPageSchema,
  pageCheckRequestSchema,
  pagePresentRequestSchema,
  pageWithdrawRequestSchema,
  presentedPageSchema,
} from "./pages.ts";

// 页面接口的定义：请求里的用途解码成英文键，响应里的英文键编码回中文。

const at = "2026-09-28T08:00:00.000Z";
const image = { path: "img/home.png", hash: "a".repeat(64) };
const excerpt = { file: "src/a.ts", lines: "3-4", text: "甲\n乙", fileHash: "e".repeat(64) };

describe("校验和给出信息的请求", () => {
  it("用途写中文，解码成英文键。页面数据原样留给内核校验", () => {
    const data = { asks: "随便写的" };
    expect(
      pagePresentRequestSchema.parse({
        round: "v1-落地-1",
        data,
        purpose: "只看",
        images: [image],
        excerpts: [excerpt],
      }),
    ).toEqual({ round: "v1-落地-1", data, purpose: "view", images: [image], excerpts: [excerpt] });
    expect(pageCheckRequestSchema.parse({ round: "v1-落地-1", data })).toEqual({
      round: "v1-落地-1",
      data,
    });
  });

  it("用途写英文键、截图少了哈希、只校验时带原文，都拒绝", () => {
    const base = { round: "v1-落地-1", data: {} };
    expect(pagePresentRequestSchema.safeParse({ ...base, purpose: "view" }).success).toBe(false);
    expect(
      pagePresentRequestSchema.safeParse({ ...base, images: [{ path: "a.png" }] }).success,
    ).toBe(false);
    expect(pageCheckRequestSchema.safeParse({ ...base, excerpts: [excerpt] }).success).toBe(false);
  });

  it("撤回的原因可以不写，写了要是文字", () => {
    expect(pageWithdrawRequestSchema.parse({})).toEqual({});
    expect(pageWithdrawRequestSchema.safeParse({ reason: 1 }).success).toBe(false);
  });
});

const summary = {
  id: 7,
  project: "app",
  round: "v1-落地-1",
  seq: 1,
  purpose: "ask" as const,
  status: "presented" as const,
  presentedAt: at,
};

describe("给出信息的结果", () => {
  it("用途、状态和这个阶段的状态编码成中文", () => {
    const presented = {
      page: summary,
      roundStatus: "waiting" as const,
      path: "/p/app/r/x",
      cards: 2,
    };
    const wire = z.encode(presentedPageSchema, presented);
    expect(wire).toMatchObject({
      page: { purpose: "要用户点", status: "已给出" },
      roundStatus: "等用户回复",
    });
    expect(presentedPageSchema.parse(wire)).toEqual(presented);
  });
});

describe("填好的一页", () => {
  const item = {
    id: "Q1",
    content: "看板放到首页的第一屏",
    stage: "land" as const,
    proposer: "ai" as const,
    createdAt: at,
    status: "doing" as const,
    subItems: [],
    editCount: 0,
    stale: false,
  };
  const page = {
    ...summary,
    stage: "land" as const,
    status: "withdrawn" as const,
    formatVersion: 2,
    withdrawal: { at, reason: "卡片写错了", replacedBy: 8 },
    submission: null,
    snapshot: null,
    sections: {
      asks: [
        {
          id: "ask-board",
          queue: ["Q1"],
          title: "看板放在哪里",
          why: "要翻两屏。",
          sources: [{ name: "工作台首页", saw: "看板在最下面。", img: "img/home.png" }],
        },
      ],
    },
    images: [image],
    excerpts: [{ where: "asks[0].sources[0]", ...excerpt, start: 3, end: 4, mark: [4] }],
    fill: {
      header: {
        system: "app",
        round: "v1-落地-1",
        legacyId: null,
        stage: "land" as const,
        date: "2026-09-28",
      },
      strip: {
        stages: [
          {
            stage: "land" as const,
            rounds: [{ label: "v1-落地-1", status: "open" as const }],
            queue: 1,
          },
        ],
      },
      queue: {
        waiting: [],
        columns: [{ stage: "land" as const, items: [item] }],
        doneThisRound: [{ id: "Q2", content: "写明回复被取走", evidence: null }],
      },
      where: {
        scenes: [{ id: "S1", name: "看队列", steps: 2 }],
        places: [{ scene: "S1", step: 1, name: "看队列", do: "点队列", expect: null }],
      },
      droppedAtStart: [{ id: "Q3", content: "步骤写成动宾短语", reason: "重复" }],
      textDiffs: [
        {
          card: "change-a",
          rows: [
            {
              k: "mix" as const,
              parts: [
                ["del", "旧"],
                ["ins", "新"],
              ] as const,
            },
            { k: "gap" as const, parts: [] },
          ],
        },
      ],
      previousReplies: null,
      use: null,
      landEvidence: null,
    },
  };

  it("枚举编码成中文，逐行对比的记号不换，接口上的写法再解析回来不变", () => {
    const wire = z.encode(filledPageSchema, page);
    expect(wire).toMatchObject({ stage: "落地", purpose: "要用户点", status: "已撤回" });
    expect(wire.fill.header.stage).toBe("落地");
    expect(wire.fill.strip.stages[0]?.rounds[0]?.status).toBe("进行中");
    expect(wire.fill.queue.columns[0]?.items[0]).toMatchObject({
      stage: "落地",
      proposer: "AI",
      status: "进行中",
      stale: false,
    });
    expect(wire.fill.textDiffs[0]?.rows[0]?.k).toBe("mix");
    expect(filledPageSchema.parse(wire)).toEqual(page);
  });

  it("上一个阶段的回复：区块、种类和去处编码成中文", () => {
    const line = {
      submission: 4,
      line: 1,
      section: "asks" as const,
      card: "c1a2b3",
      kind: "option" as const,
      option: "a",
      images: [],
      imagesRead: false,
      handled: {
        destination: { to: "decision" as const, id: 12 },
        at: "2026-09-28T08:00:00.000Z",
        by: "cli/2.0.0",
      },
    };
    const previousReplies = {
      submission: 4,
      page: 6,
      round: "v1-落地-1",
      submittedAt: "2026-09-28T08:00:00.000Z",
      lines: [line],
    };
    const withReplies = { ...page, fill: { ...page.fill, previousReplies } };
    const wire = z.encode(filledPageSchema, withReplies);
    expect(wire.fill.previousReplies?.lines[0]).toMatchObject({
      section: "疑问",
      kind: "选了选项",
      handled: { destination: { to: "决定", id: 12 } },
    });
    expect(filledPageSchema.parse(wire)).toEqual(withReplies);
  });

  it("填的部分多出字段，编码时拒绝", () => {
    const extra = { ...page, fill: { ...page.fill, board: [] } };
    expect(() => z.encode(filledPageSchema, extra as typeof page)).toThrow();
  });
});
