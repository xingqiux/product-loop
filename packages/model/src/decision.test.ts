import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  checkDecisionFields,
  decisionCreateSchema,
  decisionFieldsRule,
  decisionRequiredFields,
  decisionSchema,
  decisionVoidSchema,
} from "./decision.ts";

/** 解析失败时的全部问题，每条是字段的路径和报错。通过时是空的。 */
function issuesOf(schema: z.ZodType, input: unknown): [string, string][] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const created = {
  decision: "颜色表示分类，选中另用描边",
  reason: "去掉颜色后整页只剩灰，未选的标签像禁用的",
  case: "模板页第三行标签四种淡色底",
};

const decision = {
  id: 11,
  kind: "决定",
  ...created,
  date: "2026-09-18",
  status: "有效",
};

const missingMessage = {
  decision: "决定、原因、案例三项都要写，这里缺了决定。",
  reason: "决定、原因、案例三项都要写，这里缺了原因。",
  case: "决定、原因、案例三项都要写，这里缺了案例。",
};

describe("新增一条决定", () => {
  it("写决定、原因、案例三项，种类可以不写", () => {
    expect(issuesOf(decisionCreateSchema, created)).toEqual([]);
    expect(issuesOf(decisionCreateSchema, { ...created, kind: "以后再说" })).toEqual([]);
  });

  it.each(decisionRequiredFields)("缺了 %s 时拦截，报错写明三项都要写", (field) => {
    const message = missingMessage[field];
    for (const value of [undefined, null, "", "  ", "\n"]) {
      expect(issuesOf(decisionCreateSchema, { ...created, [field]: value })).toEqual([
        [field, message],
      ]);
    }
  });

  it("三项都没写时，按决定表的列序各报一条", () => {
    expect(issuesOf(decisionCreateSchema, {})).toEqual([
      ["decision", missingMessage.decision],
      ["reason", missingMessage.reason],
      ["case", missingMessage.case],
    ]);
  });

  it("写的不是文字时，报错写明要写成文字", () => {
    expect(issuesOf(decisionCreateSchema, { ...created, reason: 3 })).toEqual([
      ["reason", "原因要写成文字。"],
    ]);
  });

  it("种类写中文标签，解析以后是英文键，写英文键不收", () => {
    expect(decisionCreateSchema.parse({ ...created, kind: "以后再说" }).kind).toBe("later");
    expect(decisionCreateSchema.safeParse({ ...created, kind: "later" }).success).toBe(false);
  });

  it("编号、日期、状态由后端填，写了就拦截", () => {
    for (const extra of [{ id: 3 }, { date: "2026-09-28" }, { status: "有效" }]) {
      expect(decisionCreateSchema.safeParse({ ...created, ...extra }).success).toBe(false);
    }
  });
});

describe("规矩 decision.fields", () => {
  it("三项都写了时没有拦截", () => {
    expect(checkDecisionFields(created)).toEqual([]);
  });

  it.each(decisionRequiredFields)("缺了 %s 时报一条拦截，带规矩编号和改法", (field) => {
    const hint = `补上${{ decision: "决定", reason: "原因", case: "案例" }[field]}再重跑，日期由命令填。`;
    const expected = [
      { rule: decisionFieldsRule, message: missingMessage[field], hint, where: field },
    ];
    for (const value of [undefined, null, "", " "]) {
      expect(checkDecisionFields({ ...created, [field]: value })).toEqual(expected);
    }
  });

  it("规矩编号是 decision.fields", () => {
    expect(decisionFieldsRule).toBe("decision.fields");
  });

  it("写的不是文字时不算缺项，留给数据定义按格式不对报", () => {
    expect(checkDecisionFields({ ...created, reason: 3 })).toEqual([]);
  });

  it("不是对象时三项都报", () => {
    for (const input of [undefined, null, "决定", 3]) {
      expect(checkDecisionFields(input).map((issue) => issue.where)).toEqual([
        "decision",
        "reason",
        "case",
      ]);
    }
  });

  it("拦截的说法和数据定义的报错相同", () => {
    const issues = checkDecisionFields({});
    const parsed = issuesOf(decisionCreateSchema, {});
    expect(issues.map((issue) => [issue.where, issue.message])).toEqual(parsed);
  });
});

describe("一条决定", () => {
  it("有效的决定没有作废的信息", () => {
    expect(issuesOf(decisionSchema, decision)).toEqual([]);
    expect(issuesOf(decisionSchema, { ...decision, fromLine: { submission: 4, line: 2 } })).toEqual(
      [],
    );
  });

  it("已作废的原地留着，写明被哪一条推翻", () => {
    const voided = { ...decision, id: 3, status: "已作废", voidedBy: 11 };
    expect(issuesOf(decisionSchema, voided)).toEqual([]);
    expect(issuesOf(decisionSchema, { ...voided, voidReason: "用户要的是颜色有含义" })).toEqual([]);
    expect(issuesOf(decisionSchema, { ...voided, voidedBy: undefined })).toEqual([
      ["voidedBy", "作废的决定要写明被哪一条推翻。"],
    ]);
  });

  it("有效的决定写了作废的信息时拦截", () => {
    const message = "有效的决定不写被哪一条推翻，也不写作废原因。";
    expect(issuesOf(decisionSchema, { ...decision, voidedBy: 12 })).toEqual([
      ["voidedBy", message],
    ]);
    expect(issuesOf(decisionSchema, { ...decision, voidReason: "改主意了" })).toEqual([
      ["voidReason", message],
    ]);
  });

  it("不能被自己推翻", () => {
    const voided = { ...decision, status: "已作废", voidedBy: decision.id };
    expect(issuesOf(decisionSchema, voided)).toEqual([["voidedBy", "决定不能被自己推翻。"]]);
  });

  it("三项在存下的决定里同样必填", () => {
    expect(issuesOf(decisionSchema, { ...decision, case: undefined })).toEqual([
      ["case", missingMessage.case],
    ]);
  });

  it("存下的「以后再说」可以没有案例，别的种类不行", () => {
    expect(issuesOf(decisionSchema, { ...decision, kind: "以后再说", case: "" })).toEqual([]);
    expect(issuesOf(decisionSchema, { ...decision, case: " " })).toEqual([
      ["case", missingMessage.case],
    ]);
  });

  it("日期写成年月日，种类和状态写中文标签，解析以后是英文键，写英文键不收", () => {
    expect(decisionSchema.safeParse({ ...decision, date: "2026/09/18" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...decision, date: "9月18日" }).success).toBe(false);
    expect(decisionSchema.parse(decision)).toMatchObject({ kind: "decision", status: "active" });
    expect(decisionSchema.safeParse({ ...decision, kind: "decision" }).success).toBe(false);
    expect(decisionSchema.safeParse({ ...decision, status: "active" }).success).toBe(false);
  });
});

describe("作废一条决定", () => {
  it("写明被哪一条推翻，作废原因可以不写", () => {
    expect(issuesOf(decisionVoidSchema, { by: 80 })).toEqual([]);
    expect(issuesOf(decisionVoidSchema, { by: 80, reason: "按钮改叫用作起点" })).toEqual([]);
  });

  it("不写被哪一条推翻时拦截", () => {
    expect(issuesOf(decisionVoidSchema, {})).toEqual([["by", "作废的决定要写明被哪一条推翻。"]]);
    expect(decisionVoidSchema.safeParse({ by: 0 }).success).toBe(false);
    expect(decisionVoidSchema.safeParse({ by: "80" }).success).toBe(false);
    expect(decisionVoidSchema.safeParse({ by: 80, reason: " " }).success).toBe(false);
  });
});

describe("JSON Schema", () => {
  it.each([
    ["decision", decisionSchema],
    ["decisionCreate", decisionCreateSchema],
    ["decisionVoid", decisionVoidSchema],
  ] as const)("%s 能导出，结果和快照相同", (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: "input" })).toMatchSnapshot();
  });
});
