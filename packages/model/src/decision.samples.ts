import type { RuleContextOf, RuleSamples } from "./rules/rule.ts";

// 规矩 decision.fields 的样本，见「07 校验」第六节：一份合格的决定，加几份各缺一处的。

const created = {
  decision: "颜色表示分类，选中另用描边",
  reason: "去掉颜色后整页只剩灰，未选的标签像禁用的",
  case: "模板页第三行标签四种淡色底",
};

export const decisionFieldsSamples: RuleSamples<unknown, RuleContextOf<never>> = {
  base: { subject: created, context: {} },
  hits: [
    {
      why: "没写案例",
      subject: { decision: created.decision, reason: created.reason },
      expect: [{ where: "case", params: { field: "案例" } }],
    },
    {
      why: "原因只写了空白",
      subject: { ...created, reason: " \n" },
      expect: [{ where: "reason", params: { field: "原因" } }],
    },
    {
      why: "决定写成 null",
      subject: { ...created, decision: null },
      expect: [{ where: "decision", params: { field: "决定" } }],
    },
    {
      why: "三项都没写，按决定表的列序各报一条",
      subject: {},
      expect: [
        { where: "decision", params: { field: "决定" } },
        { where: "reason", params: { field: "原因" } },
        { where: "case", params: { field: "案例" } },
      ],
    },
  ],
};
