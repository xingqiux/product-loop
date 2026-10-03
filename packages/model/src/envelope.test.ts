import { describe, expect, it } from "vitest";
import {
  apiEnvelopeSchema,
  cliEnvelopeSchema,
  errorBody,
  errorBodySchema,
  type Issue,
  issuesOf,
  toCliEnvelope,
} from "./envelope.ts";

// 「04 命令行」第五节的两段 JSON 样例，原样照抄。
const startedSample = `{"schemaVersion": 1, "kind": "round.started", "ok": true,
 "data": {"round": "v2-检查-1", "taken": ["Q12", "Q15"], "changedScreens": [{"scene": "S1", "steps": [2, 3]}]},
 "warnings": [], "next": ["ploop queue drop <编号> --reason <原因>", "ploop page present"]}`;

const errorSample = `{"schemaVersion": 1, "kind": "error", "ok": false,
 "error": {"code": "RULE_BLOCKED", "rule": "reply.line.handled", "message": "上一轮的回复还有两行没有处理：第 3 行、第 5 行。",
           "hint": "运行 ploop reply show 看这两行，再用 ploop reply handle 处理。", "where": "v1-构思-3"}}`;

const samples = [startedSample, errorSample].map((text) => JSON.parse(text));

/** 去掉命令行加的格式版本和种类，剩下的就是接口的响应。 */
function withoutHead(sample: Record<string, unknown>): Record<string, unknown> {
  const { schemaVersion: _version, kind: _kind, ...rest } = sample;
  return rest;
}

const sourceIssue: Issue = {
  rule: "card.source.visual",
  message: "疑问「主线里缺的十样规范」的来源「报告网页现在的样子」没有图。",
  hint: "界面的来源写 img（截图的路径）；文字的来源写 file 和 lines，原文由命令摘录。",
  where: "rounds/v2-构思-1/page.json → asks[0].sources[1]",
};
const replyIssue: Issue = {
  rule: "reply.line.handled",
  message: "上一轮的回复还有两行没有处理：第 3 行、第 5 行。",
  hint: "运行 ploop reply show 看这两行，再用 ploop reply handle 处理。",
  where: "v1-构思-3",
};

describe("命令行 --json 的外壳", () => {
  it.each(samples)("第五节的样例原样能解析：$kind", (sample) => {
    const result = cliEnvelopeSchema.safeParse(sample);
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toEqual(sample);
  });

  it.each(samples)("缺 schemaVersion 时拒绝：$kind", (sample) => {
    const { schemaVersion: _version, ...rest } = sample;
    expect(cliEnvelopeSchema.safeParse(rest).success).toBe(false);
    expect(cliEnvelopeSchema.safeParse({ ...sample, schemaVersion: 2 }).success).toBe(false);
  });

  it("ok 为 true 却带 error 时拒绝", () => {
    const [started, failed] = samples;
    expect(cliEnvelopeSchema.safeParse({ ...started, error: failed.error }).success).toBe(false);
  });

  it("ok 为 false 却带 data 时拒绝", () => {
    const [started, failed] = samples;
    expect(cliEnvelopeSchema.safeParse({ ...failed, data: started.data }).success).toBe(false);
  });

  it("失败时种类只能是 error", () => {
    const [, failed] = samples;
    expect(cliEnvelopeSchema.safeParse({ ...failed, kind: "round.started" }).success).toBe(false);
  });

  it("种类写成小驼峰的几段，用点连起来", () => {
    const [started] = samples;
    for (const kind of ["round.started", "status", "queue.itemAdded"]) {
      expect(cliEnvelopeSchema.safeParse({ ...started, kind }).success).toBe(true);
    }
    for (const kind of ["", "Round.started", "round started", "round.", "开始了"]) {
      expect(cliEnvelopeSchema.safeParse({ ...started, kind }).success).toBe(false);
    }
  });
});

describe("接口的响应外壳", () => {
  it.each(samples)("命令行的输出去掉格式版本和种类，就是接口的响应：$kind", (sample) => {
    const response = withoutHead(sample);
    expect(apiEnvelopeSchema.safeParse(response).success).toBe(true);
    const parsed = apiEnvelopeSchema.parse(response);
    expect(toCliEnvelope(sample.kind, parsed)).toEqual(sample);
    expect(JSON.stringify(toCliEnvelope(sample.kind, parsed))).toBe(JSON.stringify(sample));
  });

  it.each(samples)("接口的响应不带格式版本和种类：$kind", (sample) => {
    expect(apiEnvelopeSchema.safeParse(sample).success).toBe(false);
  });

  it("失败时命令行的种类一律写 error", () => {
    const response = { ok: false, error: errorBody("NOT_FOUND", [{ message: "找不到 Q12。" }]) };
    expect(toCliEnvelope("queue.shown", apiEnvelopeSchema.parse(response)).kind).toBe("error");
  });

  it("ok 为 true 却带 error 时拒绝", () => {
    const response = { ok: true, data: null, warnings: [], next: [] };
    expect(apiEnvelopeSchema.safeParse(response).success).toBe(true);
    const withError = { ...response, error: { code: "CONFLICT", message: "另一轮还开着。" } };
    expect(apiEnvelopeSchema.safeParse(withError).success).toBe(false);
  });

  it("成功时 data、warnings、next 都要写", () => {
    const response = { ok: true, data: { round: "v2-检查-1" }, warnings: [], next: [] };
    for (const field of ["data", "warnings", "next"]) {
      const { [field]: _dropped, ...rest } = response as Record<string, unknown>;
      expect(apiEnvelopeSchema.safeParse(rest).success).toBe(false);
    }
  });

  it("警告和拦截是同一种形状，多出不认识的字段就拒绝", () => {
    const warning = { rule: "mainline.ten", message: "主线缺三样：风险、待定、事前验尸。" };
    const response = { ok: true, data: {}, warnings: [warning], next: ["ploop page present"] };
    expect(apiEnvelopeSchema.safeParse(response).success).toBe(true);
    const odd = { ...response, warnings: [{ ...warning, level: "警告" }] };
    expect(apiEnvelopeSchema.safeParse(odd).success).toBe(false);
  });
});

describe("失败时的 error", () => {
  it("RULE_BLOCKED 能带多条 issues：顶层写第一条，另写全部和总条数", () => {
    const body = errorBody("RULE_BLOCKED", [sourceIssue, replyIssue]);
    expect(body).toEqual({
      code: "RULE_BLOCKED",
      ...sourceIssue,
      issues: [sourceIssue, replyIssue],
      total: 2,
    });
    expect(errorBodySchema.safeParse(body).success).toBe(true);
    const output = { schemaVersion: 1, kind: "error", ok: false, error: body };
    expect(cliEnvelopeSchema.safeParse(output).success).toBe(true);
    expect(issuesOf(body)).toEqual([sourceIssue, replyIssue]);
  });

  it("只有一条时不写 issues 和 total，读出来仍是一条", () => {
    const body = errorBody("NOT_FOUND", [{ message: "找不到 Q12。", hint: "检查编号。" }]);
    expect(body).toEqual({ code: "NOT_FOUND", message: "找不到 Q12。", hint: "检查编号。" });
    expect(errorBodySchema.safeParse(body).success).toBe(true);
    expect(issuesOf(body)).toEqual([{ message: "找不到 Q12。", hint: "检查编号。" }]);
  });

  it("第五节样例里的 error 只有一条，读出来就是顶层那一条", () => {
    const [, failed] = samples;
    expect(issuesOf(errorBodySchema.parse(failed.error))).toEqual([replyIssue]);
  });

  it("RULE_BLOCKED 缺规矩的编号时拒绝，issues 里的每一条也要写", () => {
    const { rule: _rule, ...noRule } = replyIssue;
    const top = errorBodySchema.safeParse({ code: "RULE_BLOCKED", ...noRule });
    expect(top.error?.issues.map((i) => [i.path, i.message])).toEqual([
      [["rule"], "错误码 RULE_BLOCKED 要写 rule。"],
    ]);
    const body = errorBody("RULE_BLOCKED", [sourceIssue, replyIssue]);
    const inner = errorBodySchema.safeParse({ ...body, issues: [sourceIssue, noRule] });
    expect(inner.error?.issues.map((i) => i.path)).toEqual([["issues", 1, "rule"]]);
  });

  it("INTERNAL 缺日志的位置时拒绝", () => {
    const body = { code: "INTERNAL", message: "后端内部出错。" };
    expect(errorBodySchema.safeParse(body).success).toBe(false);
    const withHint = { ...body, hint: "出错的详情写在日志里：~/.product-loop/logs/backend.log。" };
    expect(errorBodySchema.safeParse(withHint).success).toBe(true);
  });

  it("别的错误码不要求 rule 和 hint", () => {
    for (const code of ["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "BUSY", "PAGE_GONE"]) {
      expect(errorBodySchema.safeParse({ code, message: "出错了。" }).success).toBe(true);
    }
  });

  it("issues 和 total 要一起写，total 要等于条数", () => {
    const body = errorBody("RULE_BLOCKED", [sourceIssue, replyIssue]);
    const { total: _total, ...noTotal } = body;
    const { issues: _issues, ...noIssues } = body;
    expect(errorBodySchema.safeParse(noTotal).success).toBe(false);
    expect(errorBodySchema.safeParse(noIssues).success).toBe(false);
    const wrongTotal = errorBodySchema.safeParse({ ...body, total: 3 });
    expect(wrongTotal.error?.issues.map((i) => i.message)).toEqual([
      "total 写的是 3，issues 实际有 2 条。",
    ]);
  });

  it("顶层和 issues 的第一条不一样时拒绝", () => {
    const body = errorBody("RULE_BLOCKED", [sourceIssue, replyIssue]);
    const result = errorBodySchema.safeParse({ ...body, ...replyIssue });
    expect(result.error?.issues.map((i) => i.path)).toEqual([
      ["rule"],
      ["message"],
      ["hint"],
      ["where"],
    ]);
  });

  it("issues 不能是空的", () => {
    const body = { code: "RULE_BLOCKED", ...sourceIssue, issues: [], total: 0 };
    expect(errorBodySchema.safeParse(body).success).toBe(false);
  });

  it("不认识的错误码和多出的字段都拒绝", () => {
    expect(errorBodySchema.safeParse({ code: "OOPS", message: "出错了。" }).success).toBe(false);
    const extra = { code: "CONFLICT", message: "另一轮还开着。", session: "abc" };
    expect(errorBodySchema.safeParse(extra).success).toBe(false);
  });

  it("message 不能是空的", () => {
    expect(errorBodySchema.safeParse({ code: "CONFLICT", message: "" }).success).toBe(false);
  });
});
