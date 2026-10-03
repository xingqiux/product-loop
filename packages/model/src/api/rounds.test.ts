import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  closedRoundSchema,
  roundCloseSchema,
  roundDetailSchema,
  roundStartSchema,
  startedRoundSchema,
} from "./rounds.ts";

// 轮次接口的定义：阶段、结果、页面的用途和状态在接口上写中文，见「05 接口」第一节。

const at = "2026-09-28T08:00:00.000Z";

const round = {
  label: "v1-落地-1",
  version: 1,
  stage: "land" as const,
  seq: 1,
  status: "open" as const,
  startedAt: at,
  closedAt: null,
  legacyId: null,
  summary: null,
};

const item = {
  id: "Q12",
  content: "设置页的保存按钮在窄屏被挡住",
  stage: "land" as const,
  proposer: "ai" as const,
  createdAt: at,
  status: "doing" as const,
  subItems: [],
  editCount: 0,
};

describe("开始阶段的请求", () => {
  it("阶段写中文，解码以后是英文键；编号、依赖、提交照原样收下", () => {
    const body = {
      stage: "落地",
      take: ["Q12", "Q15"],
      defer: [{ id: "Q9", dependsOn: "等构思定下场景 S4" }],
      baseCommits: [{ root: "/work/app", commit: "a".repeat(40) }],
    };
    expect(roundStartSchema.parse(body)).toEqual({ ...body, stage: "land" });
  });

  it("阶段写英文键、写了不认识的字段，都拒绝", () => {
    expect(roundStartSchema.safeParse({ stage: "land" }).success).toBe(false);
    expect(roundStartSchema.safeParse({ stage: "检查", all: true }).success).toBe(false);
  });
});

describe("收尾的请求", () => {
  it("结果写做完或退回，退回可以写阶段，解码以后是英文键", () => {
    const body = {
      results: [
        { id: "Q12", result: "做完", note: "提交 3f2a9c1" },
        { id: "Q15", result: "退回", note: "定义不对", stage: "构思" },
      ],
      summary: "修好了设置页",
    };
    expect(roundCloseSchema.parse(body)).toEqual({
      results: [
        { id: "Q12", result: "done", note: "提交 3f2a9c1" },
        { id: "Q15", result: "returned", note: "定义不对", stage: "think" },
      ],
      summary: "修好了设置页",
    });
    expect(roundCloseSchema.parse({})).toEqual({});
  });

  it("结果写开始时取消或英文键，拒绝", () => {
    for (const result of ["开始时取消", "done"]) {
      expect(roundCloseSchema.safeParse({ results: [{ id: "Q1", result }] }).success).toBe(false);
    }
  });
});

describe("响应", () => {
  it("开始了的一个阶段：阶段、状态、主线缺的几个部分写中文，再解析回来不变", () => {
    const started = {
      round,
      versionChange: null,
      autoClosed: {
        ...round,
        label: "v1-检查-1",
        stage: "check" as const,
        status: "closed" as const,
      },
      taken: [item],
      deferred: [],
      waiting: [],
      baseCommits: [{ root: "/work/app", commit: "a".repeat(40) }],
      mainline: { revision: null, missingParts: ["audience" as const], missingDesignSpec: [] },
      screens: null,
    };
    const wire = z.encode(startedRoundSchema, started);
    expect(wire.round).toMatchObject({ stage: "落地", status: "进行中" });
    expect(wire.autoClosed).toMatchObject({ stage: "检查", status: "已收尾" });
    expect(wire.taken[0]).toMatchObject({ status: "进行中", proposer: "AI" });
    expect(wire.mainline.missingParts).toEqual(["给谁用"]);
    expect(startedRoundSchema.parse(wire)).toEqual(started);
  });

  it("收尾的结果：每件事都有结果，写中文", () => {
    const closed = {
      round: { ...round, status: "closed" as const, closedAt: at },
      summary: null,
      items: [
        {
          item: { ...item, status: "todo" as const, statusNote: "定义不对" },
          result: "returned" as const,
          returnedTo: "think" as const,
          note: "定义不对",
        },
      ],
    };
    const wire = z.encode(closedRoundSchema, closed);
    expect(wire.items[0]).toMatchObject({ result: "退回", returnedTo: "构思" });
    expect(closedRoundSchema.parse(wire)).toEqual(closed);
    const noResult = { ...wire, items: [{ ...wire.items[0], result: null }] };
    expect(closedRoundSchema.safeParse(noResult).success).toBe(false);
  });

  it("一个阶段的详情：还没收尾的事结果为空，页面的用途和状态写中文", () => {
    const detail = {
      round,
      openedBySession: "7f3a9c2e",
      openedByClient: "cli/2.0.0",
      baseCommits: null,
      summary: null,
      items: [{ item, result: null, returnedTo: null, note: null }],
      pages: [
        {
          id: 12,
          seq: 1,
          purpose: "ask" as const,
          status: "presented" as const,
          presentedAt: at,
          withdrawnAt: null,
        },
      ],
      replies: [
        {
          id: 3,
          project: "app",
          page: 12,
          pageSeq: 1,
          round: "v1-落地-1",
          source: "workbench" as const,
          submittedAt: at,
          takenAt: null,
          text: null,
          lines: [
            {
              submission: 3,
              line: 1,
              kind: "noteOnly" as const,
              note: "先放第一屏",
              images: [],
              imagesRead: false,
            },
          ],
        },
      ],
    };
    const wire = z.encode(roundDetailSchema, detail);
    expect(wire.pages[0]).toMatchObject({ purpose: "要用户点", status: "已给出" });
    expect(wire.replies[0]?.lines[0]).toMatchObject({ kind: "只写了备注" });
    expect(roundDetailSchema.parse(wire)).toEqual(detail);
  });
});
