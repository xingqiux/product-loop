import { describe, expect, it } from "vitest";
import { z } from "zod";
import { versionChangeSchema, versionDetailSchema, versionNextSchema } from "./versions.ts";

// 版本接口的定义：版本和轮次的状态、阶段在接口上写中文，见「05 接口」第一节。

const version = {
  version: 1,
  status: "open" as const,
  startedAt: "2026-09-28T08:00:00.000Z",
  endedAt: null,
  summary: null,
  endReason: null,
};

describe("请求", () => {
  it("结束这一版要写原因，别的字段不收", () => {
    expect(versionNextSchema.parse({ reason: "跳过提升" })).toEqual({ reason: "跳过提升" });
    expect(versionNextSchema.safeParse({}).success).toBe(false);
    expect(versionNextSchema.safeParse({ reason: "跳过", version: 2 }).success).toBe(false);
  });
});

describe("响应", () => {
  it("结束一版：版本的状态写中文", () => {
    const wire = z.encode(versionChangeSchema, {
      ended: { ...version, status: "closed", endedAt: version.startedAt, endReason: "跳过" },
      started: { ...version, version: 2 },
    });
    expect([wire.ended.status, wire.started.status]).toEqual(["已结束", "进行中"]);
  });

  it("一版和它下面的阶段：阶段的种类和状态写中文，再解析回来不变", () => {
    const detail = {
      ...version,
      rounds: [
        {
          label: "v1-落地-3",
          version: 1,
          stage: "land" as const,
          seq: 3,
          status: "closed" as const,
          startedAt: version.startedAt,
          closedAt: version.startedAt,
          legacyId: "fix-13",
          summary: null,
        },
      ],
    };
    const wire = z.encode(versionDetailSchema, detail);
    expect(wire.rounds[0]).toMatchObject({ stage: "落地", status: "已收尾" });
    expect(versionDetailSchema.parse(wire)).toEqual(detail);
  });
});
