import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  decisionAddSchema,
  decisionEditSchema,
  decisionListSchema,
  decisionQuerySchema,
} from "./decisions.ts";

// 决定接口的定义：缺项留给规矩 decision.fields 报，种类和状态在接口上写中文。

describe("新增一条的请求", () => {
  it("种类写中文，解码以后是英文键", () => {
    const body = {
      kind: "以后再说",
      decision: "先不做导出",
      reason: "没人要",
      case: "构思第 2 轮",
    };
    expect(decisionAddSchema.parse(body)).toEqual({ ...body, kind: "later" });
  });

  it("三项没写、写成 null 或空白都收下，由规矩 decision.fields 拦截", () => {
    for (const body of [{}, { decision: null, reason: "  " }, { case: "" }]) {
      expect(decisionAddSchema.safeParse(body).success).toBe(true);
    }
  });

  it("写的不是文字、种类写英文键、多出编号和日期，都拒绝", () => {
    const rejected = [{ reason: 3 }, { kind: "later" }, { id: 4 }, { date: "2026-09-28" }];
    for (const body of rejected) {
      expect(decisionAddSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("改一条的请求", () => {
  it("只写要改的项，没写的不带", () => {
    expect(decisionEditSchema.parse({ reason: "新的原因" })).toEqual({ reason: "新的原因" });
    expect(decisionEditSchema.parse({ decision: "a", reason: "b", case: "c" })).toEqual({
      decision: "a",
      reason: "b",
      case: "c",
    });
  });

  it("写成 null 或空白都收下，由规矩 decision.fields 拦截", () => {
    for (const body of [{ decision: null }, { reason: "  " }, { case: "" }]) {
      expect(decisionEditSchema.safeParse(body).success).toBe(true);
    }
  });

  it("一项都没写时拒绝，写明要改哪几项", () => {
    for (const body of [{}, { reason: undefined }]) {
      const result = decisionEditSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        "至少要改一项：决定、原因或案例。",
      ]);
    }
  });

  it("编号、日期、种类、状态不能改，写的不是文字也拒绝", () => {
    const rejected = [
      { reason: "b", id: 4 },
      { reason: "b", date: "2026-09-28" },
      { reason: "b", kind: "以后再说" },
      { reason: "b", status: "已作废" },
      { reason: 3 },
    ];
    for (const body of rejected) expect(decisionEditSchema.safeParse(body).success).toBe(false);
  });
});

describe("列出决定", () => {
  it("includeVoided 只收 true 和 false，不写就只列有效的", () => {
    expect(decisionQuerySchema.parse({})).toEqual({});
    expect(decisionQuerySchema.parse({ includeVoided: "true" })).toEqual({ includeVoided: true });
    expect(decisionQuerySchema.parse({ includeVoided: "false" })).toEqual({ includeVoided: false });
    expect(decisionQuerySchema.safeParse({ includeVoided: "1" }).success).toBe(false);
  });

  it("种类和状态编码成中文，接口上的写法再解析回来不变", () => {
    const list = [
      {
        id: 1,
        kind: "decision" as const,
        decision: "颜色表示分类",
        reason: "去掉颜色后整页只剩灰",
        case: "模板页第三行",
        date: "2026-09-28",
        status: "voided" as const,
        voidedBy: 2,
      },
    ];
    const wire = z.encode(decisionListSchema, list);
    expect(wire[0]).toMatchObject({ kind: "决定", status: "已作废", voidedBy: 2 });
    expect(decisionListSchema.parse(wire)).toEqual(list);
  });
});
