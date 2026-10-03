import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { decisionCopy } from "./copy/records.ts";
import { rulesCopy } from "./copy/rules.ts";
import { decisionFieldsSamples } from "./decision.samples.ts";
import type { Issue } from "./envelope.ts";
import { decisionKind, decisionStatus } from "./names.ts";
import { nonBlankText, replyLineRefSchema, textOf } from "./queue.ts";
import { defineRule, sinceRelease } from "./rules/rule.ts";
import { runRules } from "./rules/run.ts";

// 决定：一条用户看得见的行为，见「03 数据模型」第二节「队列和决定」。
// 决定表统一成一种格式：编号、决定、原因、案例、日期，另加种类和状态。
// 决定、原因、案例三项必填，日期由命令填，见「04 命令行」第十节。
// 作废时写明被哪一条推翻，原地标已作废，不删。

/** 决定三项必填的规矩编号，见「07 校验」第四节。 */
export const decisionFieldsRule = "decision.fields";

/** 必填的三项，顺序是决定表的列序。 */
export const decisionRequiredFields = ["decision", "reason", "case"] as const;
export type DecisionRequiredField = (typeof decisionRequiredFields)[number];

/** 缺了某一项时的报错，写明三项都要写。 */
function fieldsMessage(field: DecisionRequiredField): string {
  return renderCopy(decisionCopy.fields.message, { field: renderCopy(decisionCopy.field[field]) });
}

const requiredShape = {
  decision: nonBlankText(decisionCopy.field.decision, fieldsMessage("decision")),
  reason: nonBlankText(decisionCopy.field.reason, fieldsMessage("reason")),
  case: nonBlankText(decisionCopy.field.case, fieldsMessage("case")),
};

/**
 * 新增一条决定：`ploop decision add`，以及处理回复时去处是决定的行。
 * 种类不写就是决定。编号、日期和状态由后端填。
 */
export const decisionCreateSchema = z.strictObject({
  kind: decisionKind.codec.optional(),
  ...requiredShape,
});
export type DecisionCreate = z.infer<typeof decisionCreateSchema>;

const voidReason = nonBlankText(decisionCopy.field.voidReason);

/** 一条决定。编号在项目内从 1 起连续编，接口上写数字。 */
export const decisionSchema = z
  .strictObject({
    id: z.int().min(1),
    kind: decisionKind.codec,
    ...requiredShape,
    /**
     * 案例。迁移进来的「以后再说」可以是空的：旧的三列表格本来没有这一列，
     * 导入时不补，见 superRefine。新增的决定仍由 decisionCreateSchema 要求三项都写。
     */
    case: textOf(decisionCopy.field.case, fieldsMessage("case")),
    /** 日期，写成 2026-09-28。 */
    date: z.iso.date(),
    status: decisionStatus.codec,
    /** 被哪一条推翻，写那一条的编号。只有已作废的有。 */
    voidedBy: z.int().min(1).optional(),
    voidReason: voidReason.optional(),
    /** 来自哪一行回复。 */
    fromLine: replyLineRefSchema.optional(),
  })
  .superRefine((decision, ctx) => {
    if (decision.kind !== "later" && decision.case.trim() === "") {
      ctx.addIssue({ code: "custom", path: ["case"], message: fieldsMessage("case") });
    }
    if (decision.status === "voided" && decision.voidedBy === undefined) {
      const message = renderCopy(decisionCopy.voidNeedsBy);
      ctx.addIssue({ code: "custom", path: ["voidedBy"], message });
    }
    if (decision.status === "active") {
      for (const field of ["voidedBy", "voidReason"] as const) {
        if (decision[field] !== undefined) {
          const message = renderCopy(decisionCopy.activeWithVoid);
          ctx.addIssue({ code: "custom", path: [field], message });
        }
      }
    }
    if (decision.voidedBy === decision.id) {
      const message = renderCopy(decisionCopy.voidedBySelf);
      ctx.addIssue({ code: "custom", path: ["voidedBy"], message });
    }
  });
export type Decision = z.infer<typeof decisionSchema>;

/** 作废一条：`ploop decision void <编号> --by <新编号>`。被哪一条推翻必须写，作废原因可以不写。 */
export const decisionVoidSchema = z.strictObject({
  by: z
    .int({
      error: (issue) =>
        issue.input === undefined ? renderCopy(decisionCopy.voidNeedsBy) : undefined,
    })
    .min(1),
  reason: voidReason.optional(),
});
export type DecisionVoid = z.infer<typeof decisionVoidSchema>;

/** 没写、写成 null 或只写了空白的必填项，按决定表的列序。写的不是文字的不算缺项。 */
function missingFields(input: unknown): DecisionRequiredField[] {
  const fields: Readonly<Record<string, unknown>> =
    typeof input === "object" && input !== null ? { ...input } : {};
  return decisionRequiredFields.filter((field) => {
    const value = fields[field];
    if (value === undefined || value === null) return true;
    return typeof value === "string" && !/\S/u.test(value);
  });
}

/**
 * 规矩 decision.fields：查决定、原因、案例三项，缺一项报一条拦截。
 * 新增决定和处理回复时先跑它，缺项按拦截报，不按请求的格式不对报。
 * 写的不是文字的，留给数据定义按格式不对报。where 写字段名，调用的地方可以在前面加上位置。
 */
export const decisionFields = defineRule({
  id: decisionFieldsRule,
  level: "block",
  scope: {
    subjects: ["decision"],
    commands: ["decision add", "decision edit", "reply handle"],
  },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.decision.fields,
  copy: decisionCopy.fields,
  check: (input: unknown) =>
    missingFields(input).map((field) => ({
      where: field,
      params: { field: renderCopy(decisionCopy.field[field]) },
    })),
  samples: decisionFieldsSamples,
});

/** 跑规矩 decision.fields，返回全部拦截。三项都写了时是空的。 */
export function checkDecisionFields(input: unknown): Issue[] {
  return [...runRules([decisionFields], input, {}).block];
}
