import { beijingDay } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { startAt } from "../../core/testing.ts";
import { decisions } from "../../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 决定的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 业务规则的细节在内核的测试里，这里只看请求和响应：中文进出、状态码、缺项时的规矩编号。

const today = beijingDay(startAt);

/** 三项都写了的一条。 */
const colors = {
  decision: "颜色表示分类，选中另用描边",
  reason: "去掉颜色后整页只剩灰，未选的标签像禁用的",
  case: "模板页第三行标签四种淡色底",
};

const outline = {
  decision: "选中改用描边，颜色只表示状态",
  reason: "用户说颜色太多，分不清哪个是选中",
  case: "构思第 3 轮第 2 条",
};

/** 登记项目 app，新增给定的几条决定，返回测试的应用。 */
async function withDecisions(...inputs: object[]): Promise<TestApp> {
  const t = await testApp();
  await t.request("POST", "/api/v1/projects", { body: { root: "/work/app", repoKind: "自己的" } });
  for (const body of inputs) {
    const res = await t.request("POST", "/api/v1/projects/app/decisions", { body });
    dataOf(res);
  }
  return t;
}

/** 作废一条。 */
function voidOne(t: TestApp, id: number | string, body: unknown) {
  return t.request("POST", `/api/v1/projects/app/decisions/${id}/void`, { body });
}

describe("POST /projects/:pid/decisions", () => {
  it("新增一条：编号从 1 起，日期由后端填，种类和状态写中文", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", { body: colors });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      data: { id: 1, kind: "决定", ...colors, date: today, status: "有效" },
      warnings: [],
      next: [],
    });
  });

  it("种类写以后再说，存成英文键", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { kind: "以后再说", ...outline },
    });
    expect(dataOf(res)).toMatchObject({ kind: "以后再说" });
    expect(t.core.ctx.db.select().from(decisions).get()?.kind).toBe("later");
  });

  it("缺了原因和案例，返回 RULE_BLOCKED，带规矩编号，一次报齐，什么都不写", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { decision: colors.decision, reason: "  ", case: null },
    });
    expect(res.status).toBe(422);
    const error = errorOf(res);
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "decision.fields",
      message: "决定、原因、案例三项都要写，这里缺了原因。",
      where: "reason",
      total: 2,
    });
    expect(error.issues?.map((issue) => [issue.rule, issue.where])).toEqual([
      ["decision.fields", "reason"],
      ["decision.fields", "case"],
    ]);
    expect(t.core.ctx.db.select().from(decisions).all()).toEqual([]);
  });

  it("「决定」一项超过 40 个字，返回 RULE_BLOCKED，写明怎么改；原因写长了不拦", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { ...colors, decision: "字".repeat(41) },
    });
    expect(res.status).toBe(422);
    expect(errorOf(res)).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "decision.decision.tooLong",
      message: "「决定」一项有 41 个字，超过 40 个字。",
      hint: "缩短到 40 个字以内，细节写进原因。",
      where: "decision",
    });
    expect(t.core.ctx.db.select().from(decisions).all()).toEqual([]);
    const ok = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { ...colors, reason: "细节".repeat(200) },
    });
    expect(ok.status).toBe(201);
  });

  it("写的不是文字，返回 BAD_REQUEST", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { ...colors, case: 3 },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({ message: "case 要写成文字。", where: "case" });
  });

  it("种类写英文键，返回 BAD_REQUEST", async () => {
    const t = await withDecisions();
    const res = await t.request("POST", "/api/v1/projects/app/decisions", {
      body: { kind: "later", ...outline },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("kind");
  });
});

describe("GET /projects/:pid/decisions", () => {
  it("默认只列有效的；includeVoided=true 时连已作废的一起列", async () => {
    const t = await withDecisions(colors, outline);
    await voidOne(t, 1, { by: 2 });
    const active = await t.request("GET", "/api/v1/projects/app/decisions");
    expect(active.status).toBe(200);
    expect((dataOf(active) as { id: number }[]).map((d) => d.id)).toEqual([2]);
    const all = await t.request("GET", "/api/v1/projects/app/decisions?includeVoided=true");
    const rows = dataOf(all) as { id: number; status: string }[];
    expect(rows.map((d) => [d.id, d.status])).toEqual([
      [1, "已作废"],
      [2, "有效"],
    ]);
  });

  it("includeVoided 只收 true 和 false，写错返回 BAD_REQUEST", async () => {
    const t = await withDecisions(colors);
    const res = await t.request("GET", "/api/v1/projects/app/decisions?includeVoided=1");
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      message: "includeVoided 写的是「1」，可以写的有：true、false。",
      where: "includeVoided",
    });
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/decisions");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/decisions/:id", () => {
  it("已作废的也取得到，写明被哪一条推翻", async () => {
    const t = await withDecisions(colors, outline);
    await voidOne(t, 1, { by: 2, reason: "用户改了主意" });
    const res = await t.request("GET", "/api/v1/projects/app/decisions/1");
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({
      id: 1,
      kind: "决定",
      ...colors,
      date: today,
      status: "已作废",
      voidedBy: 2,
      voidReason: "用户改了主意",
    });
  });

  it("编号不是从 1 起的整数，返回 BAD_REQUEST，写明怎么查编号", async () => {
    const t = await withDecisions(colors);
    const res = await t.request("GET", "/api/v1/projects/app/decisions/01");
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "决定的编号要写从 1 起的整数，这里是「01」。",
      hint: "运行 ploop decision list，查看这个项目的决定和编号。",
      where: "01",
    });
  });

  it("没有这一条，返回 NOT_FOUND", async () => {
    const t = await withDecisions(colors);
    const res = await t.request("GET", "/api/v1/projects/app/decisions/7");
    expect(res.status).toBe(404);
    expect(errorOf(res).message).toBe("项目「app」没有编号是 7 的决定。");
  });
});

/** 改一条的文字。 */
function editOne(t: TestApp, id: number | string, body: unknown) {
  return t.request("PATCH", `/api/v1/projects/app/decisions/${id}`, { body });
}

describe("PATCH /projects/:pid/decisions/:id", () => {
  it("只改写了的项，编号、日期、种类和状态不变，写中文", async () => {
    const t = await withDecisions(colors);
    const res = await editOne(t, 1, { reason: "去掉颜色后整页只剩灰" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: {
        id: 1,
        kind: "决定",
        ...colors,
        reason: "去掉颜色后整页只剩灰",
        date: today,
        status: "有效",
      },
      warnings: [],
      next: [],
    });
    const rows = t.core.ctx.db.select().from(decisions).all();
    expect(rows.map((row) => [row.id, row.reason, row.date])).toEqual([
      [1, "去掉颜色后整页只剩灰", today],
    ]);
  });

  it("已作废的也能改，作废的信息不动", async () => {
    const t = await withDecisions(colors, outline);
    await voidOne(t, 1, { by: 2, reason: "颜色只表示状态" });
    const res = await editOne(t, 1, { case: "新的案例" });
    expect(dataOf(res)).toEqual({
      id: 1,
      kind: "决定",
      ...colors,
      case: "新的案例",
      date: today,
      status: "已作废",
      voidedBy: 2,
      voidReason: "颜色只表示状态",
    });
  });

  it("一项都没写，返回 BAD_REQUEST，写明要改哪几项", async () => {
    const t = await withDecisions(colors);
    const res = await editOne(t, 1, {});
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("至少要改一项：决定、原因或案例。");
  });

  it("不认识的字段，返回 BAD_REQUEST：编号、日期、种类和状态不能改", async () => {
    const t = await withDecisions(colors);
    for (const extra of [
      { date: "2026-01-01" },
      { id: 9 },
      { kind: "以后再说" },
      { status: "已作废" },
    ]) {
      const res = await editOne(t, 1, { reason: "新的原因", ...extra });
      expect(res.status).toBe(400);
    }
    expect(t.core.ctx.db.select().from(decisions).get()?.reason).toBe(colors.reason);
  });

  it("写成空白，返回 RULE_BLOCKED 和规矩编号；「决定」超过 40 个字，写明怎么改", async () => {
    const t = await withDecisions(colors);
    const blank = await editOne(t, 1, { reason: "  " });
    expect(blank.status).toBe(422);
    expect(errorOf(blank)).toMatchObject({ rule: "decision.fields", where: "reason" });
    const long = await editOne(t, 1, { decision: "字".repeat(41) });
    expect(long.status).toBe(422);
    expect(errorOf(long)).toMatchObject({
      rule: "decision.decision.tooLong",
      hint: "缩短到 40 个字以内，细节写进原因。",
      where: "decision",
    });
    expect(t.core.ctx.db.select().from(decisions).get()).toMatchObject({
      decision: colors.decision,
      reason: colors.reason,
    });
  });

  it("编号写错，返回 BAD_REQUEST；没有这一条，返回 NOT_FOUND", async () => {
    const t = await withDecisions(colors);
    const bad = await editOne(t, "x1", { reason: "新的原因" });
    expect(bad.status).toBe(400);
    expect(errorOf(bad).where).toBe("x1");
    const missing = await editOne(t, 9, { reason: "新的原因" });
    expect(missing.status).toBe(404);
    expect(errorOf(missing).code).toBe("NOT_FOUND");
  });
});

describe("POST /projects/:pid/decisions/:id/void", () => {
  it("作废一条，写明被哪一条推翻。这一条留着，状态写中文", async () => {
    const t = await withDecisions(colors, outline);
    const res = await voidOne(t, 1, { by: 2 });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({
      id: 1,
      kind: "决定",
      ...colors,
      date: today,
      status: "已作废",
      voidedBy: 2,
    });
    const rows = t.core.ctx.db.select().from(decisions).all();
    expect(rows.map((row) => [row.id, row.status, row.voidedBy])).toEqual([
      [1, "voided", 2],
      [2, "active", null],
    ]);
  });

  it("没写被哪一条推翻，返回 BAD_REQUEST", async () => {
    const t = await withDecisions(colors, outline);
    const res = await voidOne(t, 1, {});
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      message: "作废的决定要写明被哪一条推翻。",
      where: "by",
    });
  });

  it("已经作废的再作废，返回 CONFLICT", async () => {
    const t = await withDecisions(colors, outline, outline);
    await voidOne(t, 1, { by: 2 });
    const res = await voidOne(t, 1, { by: 3 });
    expect(res.status).toBe(409);
    expect(errorOf(res).message).toBe("编号是 1 的决定已经作废，被第 2 条推翻。");
  });

  it("推翻它的那一条不存在，返回 NOT_FOUND", async () => {
    const t = await withDecisions(colors);
    const res = await voidOne(t, 1, { by: 9 });
    expect(res.status).toBe(404);
    expect(errorOf(res).where).toBe("by");
  });

  it("路径里的编号写错，返回 BAD_REQUEST", async () => {
    const t = await withDecisions(colors, outline);
    const res = await voidOne(t, "第一条", { by: 2 });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("决定的编号要写从 1 起的整数，这里是「第一条」。");
  });
});
