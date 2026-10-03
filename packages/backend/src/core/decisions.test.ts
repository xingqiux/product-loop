import {
  beijingDay,
  type Decision,
  decisionSchema,
  err,
  errorBodySchema,
  type Result,
} from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decisions, projects } from "../store/schema/index.ts";
import {
  addDecision,
  createDecision,
  type DecisionInput,
  type DecisionPatch,
  editDecision,
  getDecision,
  type ImportedDecision,
  importDecisions,
  listDecisions,
  voidDecision,
} from "./decisions.ts";
import { appSkillVersion } from "./projects.ts";
import { addProject, emptyCore, startAt, type TestCore } from "./testing.ts";
import { writeTx } from "./tx.ts";

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

async function oneProject(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  return core;
}

/** 迁移没完成的项目，迁移时在它上面导入旧决定。 */
async function legacyProject(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
  return core;
}

/** 取出成功的结果。失败时抛出，测试随之失败。 */
function unwrap<T>(result: Result<T, { readonly message: string }>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 新增一条。失败时抛出，测试随之失败。 */
const add = (core: TestCore, input: DecisionInput = colors, project = "app"): Decision =>
  unwrap(addDecision(core.ctx, project, input));

const ids = (list: readonly Decision[]) => list.map((decision) => decision.id);

const allRows = (core: TestCore) => core.ctx.db.select().from(decisions).all();

/** 订阅者收到的决定的事件：种类、对象编号和改动内容。 */
const decisionEvents = (core: TestCore) =>
  core.received
    .filter((event) => event.objectType === "decision")
    .map((event) => [event.kind, event.objectId, event.detail]);

/** 决定三项缺了某一项时的拦截，和 model 的规矩 decision.fields 报的相同。 */
const missing = (field: "decision" | "reason" | "case") => {
  const name = { decision: "决定", reason: "原因", case: "案例" }[field];
  return {
    rule: "decision.fields",
    message: `决定、原因、案例三项都要写，这里缺了${name}。`,
    hint: `补上${name}再重跑，日期由命令填。`,
    where: field,
  };
};

describe("新增一条决定", () => {
  it("编号从 1 起，日期是当天，种类不写就是决定，状态是有效", async () => {
    const core = await oneProject();
    expect(addDecision(core.ctx, "app", colors)).toEqual({
      ok: true,
      value: { id: 1, kind: "decision", ...colors, date: today, status: "active" },
    });
  });

  it("编号接着项目里最大的编号往下编，各个项目分开编", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addProject(core, "/work/site");
    const added = [add(core), add(core), add(core, colors, "site"), add(core)];
    expect(ids(added)).toEqual([1, 2, 1, 3]);
  });

  it("写了种类以后再说，三项去掉首尾的空白", async () => {
    const core = await oneProject();
    const input = {
      kind: "later" as const,
      decision: "  每天自动用一遍，发现改坏了的地方 ",
      reason: "还没有发生过\n",
      case: "\t构思第 5 轮第 1 条",
    };
    expect(addDecision(core.ctx, "app", input)).toEqual({
      ok: true,
      value: {
        id: 1,
        kind: "later",
        decision: "每天自动用一遍，发现改坏了的地方",
        reason: "还没有发生过",
        case: "构思第 5 轮第 1 条",
        date: today,
        status: "active",
      },
    });
  });

  it("日期是写事务开始时北京时间的日期，和本机的时区无关", async () => {
    const core = await oneProject();
    core.setNow(new Date("2026-10-03T15:30:00Z"));
    expect(add(core).date).toBe("2026-10-03");
    core.setNow(new Date("2026-10-03T16:30:00Z"));
    expect(add(core).date).toBe("2026-10-04");
  });

  it("三项都没写时拦截，一次列出缺的三项，每条带规矩编号和改法", async () => {
    const core = await oneProject();
    const result = addDecision(core.ctx, "app", {});
    const issues = [missing("decision"), missing("reason"), missing("case")];
    expect(result).toEqual({
      ok: false,
      error: { code: "RULE_BLOCKED", ...issues[0], issues, total: 3 },
    });
    expect(!result.ok && errorBodySchema.safeParse(result.error).success).toBe(true);
    expect(allRows(core)).toEqual([]);
    expect(decisionEvents(core)).toEqual([]);
  });

  it("缺几项报几条：写成 null 和只写空白的都算缺", async () => {
    const core = await oneProject();
    const result = addDecision(core.ctx, "app", { ...colors, reason: " \n ", case: null });
    const issues = [missing("reason"), missing("case")];
    expect(result).toEqual({
      ok: false,
      error: { code: "RULE_BLOCKED", ...issues[0], issues, total: 2 },
    });
    expect(addDecision(core.ctx, "app", { ...colors, decision: "" })).toEqual({
      ok: false,
      error: { code: "RULE_BLOCKED", ...missing("decision") },
    });
    expect(allRows(core)).toEqual([]);
  });

  it("「决定」一项超过 40 个字时拦截：写明规矩、字数和怎么改，原因、案例不限长度", async () => {
    const core = await oneProject();
    const fit = "字".repeat(40);
    expect(addDecision(core.ctx, "app", { ...colors, decision: fit }).ok).toBe(true);
    // 原因和案例写得很长也放得进去，细节就写在这里。
    const details = "细节写在原因里，可以很长很长。".repeat(30);
    expect(addDecision(core.ctx, "app", { ...colors, reason: details, case: details }).ok).toBe(
      true,
    );
    const before = allRows(core).length;
    const long = "字".repeat(41);
    expect(addDecision(core.ctx, "app", { ...colors, decision: long })).toEqual({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: "decision.decision.tooLong",
        message: "「决定」一项有 41 个字，超过 40 个字。",
        hint: "缩短到 40 个字以内，细节写进原因。",
        where: "decision",
      },
    });
    expect(allRows(core)).toHaveLength(before);
  });

  it("过长和缺项一起报，缺项在前", async () => {
    const core = await oneProject();
    const result = addDecision(core.ctx, "app", { decision: "字".repeat(45), reason: "原因" });
    expect(
      result.ok ? [] : (result.error.issues ?? []).map((issue) => [issue.rule, issue.where]),
    ).toEqual([
      ["decision.fields", "case"],
      ["decision.decision.tooLong", "decision"],
    ]);
  });

  it("标点、空白和换行不算字，一串英文算一个字", async () => {
    const core = await oneProject();
    const decision = `${"字".repeat(38)}，。\n packages/web/src/features/queue/board.tsx`;
    expect(addDecision(core.ctx, "app", { ...colors, decision }).ok).toBe(true);
  });

  it("拦截以后编号不空出来，下一条仍从 1 起", async () => {
    const core = await oneProject();
    addDecision(core.ctx, "app", { ...colors, case: undefined });
    expect(add(core).id).toBe(1);
  });

  it("每新增一条记一条事件，写明内容", async () => {
    const core = await oneProject();
    add(core);
    add(core, { kind: "later", ...outline });
    expect(decisionEvents(core)).toEqual([
      ["decision.added", "1", { kind: "decision", ...colors, date: today, status: "active" }],
      ["decision.added", "2", { kind: "later", ...outline, date: today, status: "active" }],
    ]);
    const [event] = core.received.filter((e) => e.kind === "decision.added");
    expect(event).toMatchObject({ projectId: "app", client: "cli/2.0.0", session: "session-1" });
  });

  it("迁移没完成的项目返回 NEEDS_DOCTOR，不写入", async () => {
    const core = await legacyProject();
    expect(addDecision(core.ctx, "abei", colors)).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR", message: "项目「abei」的迁移还没完成，要先做迁移检查。" },
    });
    expect(allRows(core)).toEqual([]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(addDecision(core.ctx, "ghost", colors)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });

  it("带着同一个请求编号重发时，返回第一次的结果，不会建出两条", async () => {
    const core = await oneProject();
    const ctx = {
      ...core.ctx,
      idempotency: { key: "k1", operation: "POST /projects/app/decisions" },
    };
    const first = addDecision(ctx, "app", colors);
    expect(first.ok).toBe(true);
    expect(addDecision(ctx, "app", colors)).toEqual(first);
    expect(allRows(core)).toHaveLength(1);
  });

  it("处理回复时在调用者的写事务里新增，记下来自哪一行回复", async () => {
    const core = await oneProject();
    const fromLine = { submission: 4, line: 2 };
    const result = writeTx(core.ctx, (w) => createDecision(w, "app", { ...colors, fromLine }));
    expect(result).toMatchObject({ ok: true, value: { id: 1, fromLine } });
    expect(getDecision(core.ctx.db, "app", 1)).toMatchObject({ ok: true, value: { fromLine } });
    expect(decisionEvents(core)).toEqual([
      [
        "decision.added",
        "1",
        { kind: "decision", ...colors, date: today, status: "active", fromLine },
      ],
    ]);
  });

  it("调用者的写事务失败时，新增的决定和事件一起撤回", async () => {
    const core = await oneProject();
    const result = writeTx(core.ctx, (w) => {
      expect(createDecision(w, "app", colors).ok).toBe(true);
      return err("处理下一行时失败");
    });
    expect(result).toEqual({ ok: false, error: "处理下一行时失败" });
    expect(allRows(core)).toEqual([]);
    expect(decisionEvents(core)).toEqual([]);
  });
});

describe("改一条决定的文字", () => {
  const edit = (core: TestCore, id: number, patch: DecisionPatch, project = "app") =>
    editDecision(core.ctx, project, id, patch);

  /** 被拦下时什么都不写：决定、事件都和拦下以前一样。 */
  function expectRejected(core: TestCore, run: () => Result<Decision, unknown>) {
    const rows = allRows(core);
    const events = decisionEvents(core);
    const result = run();
    expect(result.ok).toBe(false);
    expect(allRows(core)).toEqual(rows);
    expect(decisionEvents(core)).toEqual(events);
    return result.ok ? undefined : result.error;
  }

  it("只改写了的项，编号、日期、种类和状态不变，别的项照旧", async () => {
    const core = await oneProject();
    add(core);
    core.setNow(new Date(startAt.getTime() + 3 * 24 * 60 * 60 * 1000));
    const result = edit(core, 1, { reason: "  去掉颜色后整页只剩灰  " });
    expect(result).toEqual({
      ok: true,
      value: {
        id: 1,
        kind: "decision",
        ...colors,
        reason: "去掉颜色后整页只剩灰",
        date: today,
        status: "active",
      },
    });
    expect(getDecision(core.ctx.db, "app", 1)).toEqual(result);
    const both = unwrap(edit(core, 1, { decision: "颜色表示分类", case: "模板页第三行" }));
    expect(both).toMatchObject({
      decision: "颜色表示分类",
      reason: "去掉颜色后整页只剩灰",
      case: "模板页第三行",
      date: today,
    });
  });

  it("已作废的也能改，作废的信息不动", async () => {
    const core = await oneProject();
    add(core);
    add(core, outline);
    unwrap(voidDecision(core.ctx, "app", 1, { by: 2, reason: "颜色只表示状态" }));
    const edited = unwrap(edit(core, 1, { decision: "颜色表示分类" }));
    expect(edited).toEqual({
      id: 1,
      kind: "decision",
      ...colors,
      decision: "颜色表示分类",
      date: today,
      status: "voided",
      voidedBy: 2,
      voidReason: "颜色只表示状态",
    });
  });

  it("记一条 decision.edited 事件，写明改了哪几项、新的文字和原来的文字", async () => {
    const core = await oneProject();
    add(core);
    unwrap(edit(core, 1, { decision: "颜色表示分类", reason: colors.reason, case: "新的案例" }));
    // 原因写的和原来一样，不算改。
    expect(decisionEvents(core).at(-1)).toEqual([
      "decision.edited",
      "1",
      {
        decision: "颜色表示分类",
        case: "新的案例",
        previous: { decision: colors.decision, case: colors.case },
      },
    ]);
    const [event] = core.received.filter((e) => e.kind === "decision.edited");
    expect(event).toMatchObject({ projectId: "app", client: "cli/2.0.0", session: "session-1" });
  });

  it("和原来一样时原样返回，不写，也不记事件", async () => {
    const core = await oneProject();
    const first = add(core);
    const events = core.received.length;
    expect(edit(core, 1, { decision: ` ${colors.decision} `, case: colors.case })).toEqual({
      ok: true,
      value: first,
    });
    expect(core.received).toHaveLength(events);
  });

  it("写成 null 或只写空白的项拦截，位置是字段名，没写的项不查", async () => {
    const core = await oneProject();
    add(core);
    const error = expectRejected(core, () => edit(core, 1, { reason: " \n ", case: null }));
    expect(error).toMatchObject({
      code: "RULE_BLOCKED",
      rule: "decision.fields",
      where: "reason",
      total: 2,
    });
    const issues = (error as { issues: { rule: string; where: string }[] }).issues;
    expect(issues.map((issue) => [issue.rule, issue.where])).toEqual([
      ["decision.fields", "reason"],
      ["decision.fields", "case"],
    ]);
  });

  it("「决定」一项超过 40 个字拦截，怎么改是把细节写进原因；原因和案例不限长度", async () => {
    const core = await oneProject();
    add(core);
    const error = expectRejected(core, () => edit(core, 1, { decision: "字".repeat(41) }));
    expect(error).toEqual({
      code: "RULE_BLOCKED",
      rule: "decision.decision.tooLong",
      message: "「决定」一项有 41 个字，超过 40 个字。",
      hint: "缩短到 40 个字以内，细节写进原因。",
      where: "decision",
    });
    const long = "细节写在原因里，可以很长很长。".repeat(30);
    expect(edit(core, 1, { decision: "字".repeat(40), reason: long, case: long })).toMatchObject({
      ok: true,
    });
  });

  it("过长和空白一起报，改内容的项和没改的项分开看", async () => {
    const core = await oneProject();
    add(core);
    const error = expectRejected(core, () =>
      edit(core, 1, { decision: "字".repeat(45), reason: "" }),
    );
    const issues = (error as { issues: { rule: string; where: string }[] }).issues;
    expect(issues.map((issue) => [issue.rule, issue.where])).toEqual([
      ["decision.fields", "reason"],
      ["decision.decision.tooLong", "decision"],
    ]);
  });

  it("已有的超过 40 个字的决定：只改原因和案例不查字数，改「决定」才查", async () => {
    const core = await legacyProject();
    const long: ImportedDecision = {
      id: 9,
      kind: "decision",
      decision: "字".repeat(80),
      reason: "旧表里写得很长",
      case: "旧表的案例",
      date: "2026-09-19",
      status: "active",
    };
    unwrap(writeTx(core.ctx, (w) => importDecisions(w, "abei", [long])));
    core.ctx.db
      .update(projects)
      .set({ skillVersion: appSkillVersion })
      .where(eq(projects.id, "abei"))
      .run();
    const noted = unwrap(edit(core, 9, { reason: "细节写进原因" }, "abei"));
    expect(noted).toMatchObject({ decision: "字".repeat(80), reason: "细节写进原因" });
    expect(edit(core, 9, { decision: "字".repeat(41) }, "abei")).toMatchObject({
      ok: false,
      error: { rule: "decision.decision.tooLong" },
    });
    expect(edit(core, 9, { decision: "缩短后的决定" }, "abei")).toMatchObject({ ok: true });
  });

  it("迁移来的「以后再说」没有案例，改别的项不被案例拦下", async () => {
    const core = await legacyProject();
    const later: ImportedDecision = {
      id: 3,
      kind: "later",
      decision: "每天自动用一遍",
      reason: "还没有发生过",
      case: "",
      date: "2026-09-20",
      status: "active",
    };
    unwrap(writeTx(core.ctx, (w) => importDecisions(w, "abei", [later])));
    core.ctx.db
      .update(projects)
      .set({ skillVersion: appSkillVersion })
      .where(eq(projects.id, "abei"))
      .run();
    expect(edit(core, 3, { reason: "先不做" }, "abei")).toMatchObject({
      ok: true,
      value: { reason: "先不做", case: "" },
    });
  });

  it("一项都没写返回 BAD_REQUEST，写明要改哪几项", async () => {
    const core = await oneProject();
    add(core);
    expect(edit(core, 1, {})).toEqual({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "至少要改一项：决定、原因或案例。",
        hint: "写上要改的项和新的文字，再重跑。",
      },
    });
  });

  it("编号不存在返回 NOT_FOUND；迁移没完成的项目返回 NEEDS_DOCTOR；项目不存在返回 NOT_FOUND", async () => {
    const core = await oneProject();
    expect(edit(core, 7, { reason: "改一下" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "项目「app」没有编号是 7 的决定。" },
    });
    const legacy = await legacyProject();
    expect(edit(legacy, 1, { reason: "改一下" }, "abei")).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
    expect(edit(core, 1, { reason: "改一下" }, "nope")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("带着同一个请求编号重发时，返回第一次的结果，不再记事件", async () => {
    const core = await oneProject();
    add(core);
    const ctx = {
      ...core.ctx,
      idempotency: { key: "k9", operation: "PATCH /projects/app/decisions/1" },
    };
    const first = editDecision(ctx, "app", 1, { reason: "新的原因" });
    const events = core.received.length;
    expect(editDecision(ctx, "app", 1, { reason: "新的原因" })).toEqual(first);
    expect(core.received).toHaveLength(events);
  });
});

describe("作废一条决定", () => {
  it("原地留着，状态改成已作废，写明被哪一条推翻和作废原因", async () => {
    const core = await oneProject();
    add(core);
    add(core, outline);
    const result = voidDecision(core.ctx, "app", 1, { by: 2, reason: "  颜色只表示状态  " });
    const voided = {
      id: 1,
      kind: "decision",
      ...colors,
      date: today,
      status: "voided",
      voidedBy: 2,
      voidReason: "颜色只表示状态",
    };
    expect(result).toEqual({ ok: true, value: voided });
    expect(getDecision(core.ctx.db, "app", 1)).toEqual({ ok: true, value: voided });
    expect(allRows(core)).toHaveLength(2);
    expect(decisionEvents(core).at(-1)).toEqual([
      "decision.voided",
      "1",
      { by: 2, reason: "颜色只表示状态" },
    ]);
  });

  it("作废原因可以不写，只写了空白的按没写算", async () => {
    const core = await oneProject();
    add(core);
    add(core);
    add(core);
    expect(unwrap(voidDecision(core.ctx, "app", 1, { by: 3 }))).not.toHaveProperty("voidReason");
    expect(unwrap(voidDecision(core.ctx, "app", 2, { by: 3, reason: " " }))).toEqual({
      id: 2,
      kind: "decision",
      ...colors,
      date: today,
      status: "voided",
      voidedBy: 3,
    });
    expect(decisionEvents(core).slice(-2)).toEqual([
      ["decision.voided", "1", { by: 3 }],
      ["decision.voided", "2", { by: 3 }],
    ]);
  });

  /** 作废失败时，决定一条都没改，也没有新的事件。 */
  function expectRejected(
    core: TestCore,
    run: () => Result<Decision, unknown>,
    error: Record<string, unknown>,
  ) {
    const rows = allRows(core);
    const before = decisionEvents(core);
    expect(run()).toEqual({ ok: false, error });
    expect(allRows(core)).toEqual(rows);
    expect(decisionEvents(core)).toEqual(before);
  }

  it("被自己推翻时返回 BAD_REQUEST，位置是 by", async () => {
    const core = await oneProject();
    add(core);
    expectRejected(core, () => voidDecision(core.ctx, "app", 1, { by: 1 }), {
      code: "BAD_REQUEST",
      message: "决定不能被自己推翻。",
      hint: "--by 写推翻它的那一条新决定的编号。",
      where: "by",
    });
  });

  it("要作废的那一条不存在时返回 NOT_FOUND", async () => {
    const core = await oneProject();
    add(core);
    expectRejected(core, () => voidDecision(core.ctx, "app", 7, { by: 1 }), {
      code: "NOT_FOUND",
      message: "项目「app」没有编号是 7 的决定。",
      hint: "运行 ploop decision list，查看这个项目有效的决定和编号。",
    });
  });

  it("推翻它的那一条不存在时返回 NOT_FOUND，位置是 by", async () => {
    const core = await oneProject();
    add(core);
    expectRejected(core, () => voidDecision(core.ctx, "app", 1, { by: 25 }), {
      code: "NOT_FOUND",
      message: "推翻它的决定不存在：项目「app」没有编号是 25 的决定。",
      hint: "先用 ploop decision add 新增推翻它的那一条，再用新的编号作废。",
      where: "by",
    });
  });

  it("推翻它的那一条在别的项目里，也算不存在", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addProject(core, "/work/site");
    add(core);
    add(core, colors, "site");
    add(core, outline, "site");
    const result = voidDecision(core.ctx, "app", 1, { by: 2 });
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND", where: "by" } });
  });

  it("已经作废的不能再作废，返回 CONFLICT，写明被哪一条推翻", async () => {
    const core = await oneProject();
    add(core);
    add(core);
    add(core);
    unwrap(voidDecision(core.ctx, "app", 1, { by: 2 }));
    expectRejected(core, () => voidDecision(core.ctx, "app", 1, { by: 3 }), {
      code: "CONFLICT",
      message: "编号是 1 的决定已经作废，被第 2 条推翻。",
      hint: "不用再作废。要推翻的是第 2 条时，作废那一条。",
    });
  });

  it("N15 已经被同一条推翻的再作废一次，不算错：原样返回，不再记事件", async () => {
    const core = await oneProject();
    add(core);
    add(core);
    const first = unwrap(voidDecision(core.ctx, "app", 1, { by: 2, reason: "改了" }));
    const events = core.received.length;
    const again = unwrap(voidDecision(core.ctx, "app", 1, { by: 2 }));
    expect(again).toEqual(first);
    expect(core.received).toHaveLength(events);
  });

  it("推翻它的那一条已经作废时返回 CONFLICT，位置是 by", async () => {
    const core = await oneProject();
    add(core);
    add(core);
    add(core);
    unwrap(voidDecision(core.ctx, "app", 2, { by: 3 }));
    expectRejected(core, () => voidDecision(core.ctx, "app", 1, { by: 2 }), {
      code: "CONFLICT",
      message: "编号是 2 的决定已经作废，不能用它推翻别的决定。",
      hint: "--by 写一条有效的决定。运行 ploop decision list，查看有效的决定。",
      where: "by",
    });
  });

  it("迁移没完成的项目返回 NEEDS_DOCTOR", async () => {
    const core = await legacyProject();
    expect(voidDecision(core.ctx, "abei", 1, { by: 2 })).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
  });
});

describe("列出决定", () => {
  it("默认只列有效的，按编号排；写了 includeVoided 时连已作废的一起列", async () => {
    const core = await oneProject();
    add(core);
    add(core, { kind: "later", ...outline });
    add(core, outline);
    unwrap(voidDecision(core.ctx, "app", 1, { by: 3 }));
    expect(ids(unwrap(listDecisions(core.ctx.db, "app")))).toEqual([2, 3]);
    const all = unwrap(listDecisions(core.ctx.db, "app", { includeVoided: true }));
    expect(all.map((decision) => [decision.id, decision.kind, decision.status])).toEqual([
      [1, "decision", "voided"],
      [2, "later", "active"],
      [3, "decision", "active"],
    ]);
  });

  it("只列这个项目的", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addProject(core, "/work/site");
    add(core);
    add(core, outline, "site");
    expect(unwrap(listDecisions(core.ctx.db, "site"))).toEqual([
      { id: 1, kind: "decision", ...outline, date: today, status: "active" },
    ]);
  });

  it("没有决定时是空的；迁移没完成的项目也能列", async () => {
    const core = await legacyProject();
    expect(listDecisions(core.ctx.db, "abei")).toEqual({ ok: true, value: [] });
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(listDecisions(core.ctx.db, "ghost")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("取一条决定", () => {
  it("已作废的也取得到", async () => {
    const core = await oneProject();
    add(core);
    add(core);
    unwrap(voidDecision(core.ctx, "app", 1, { by: 2 }));
    expect(getDecision(core.ctx.db, "app", 1)).toMatchObject({
      ok: true,
      value: { id: 1, status: "voided", voidedBy: 2 },
    });
  });

  it("编号不存在时返回 NOT_FOUND，写明项目和编号", async () => {
    const core = await oneProject();
    expect(getDecision(core.ctx.db, "app", 3)).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」没有编号是 3 的决定。",
        hint: "运行 ploop decision list，查看这个项目有效的决定和编号。",
      },
    });
    expect(getDecision(core.ctx.db, "ghost", 1)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });

  it("取出的决定能按 model 的定义编码成接口上的样子", async () => {
    const core = await oneProject();
    const fromLine = { submission: 4, line: 2 };
    add(core, { kind: "later", ...colors });
    unwrap(writeTx(core.ctx, (w) => createDecision(w, "app", { ...outline, fromLine })));
    unwrap(voidDecision(core.ctx, "app", 1, { by: 2, reason: "颜色只表示状态" }));
    const all = unwrap(listDecisions(core.ctx.db, "app", { includeVoided: true }));
    expect(all.map((decision) => z.encode(decisionSchema, decision))).toEqual([
      {
        id: 1,
        kind: "以后再说",
        ...colors,
        date: today,
        status: "已作废",
        voidedBy: 2,
        voidReason: "颜色只表示状态",
      },
      { id: 2, kind: "决定", ...outline, date: today, status: "有效", fromLine },
    ]);
  });
});

describe("迁移时导入旧决定", () => {
  /** 旧表里的三条：第 17 条被排在后面的第 25 条推翻，第 3 条是以后再说。 */
  const voided: ImportedDecision = {
    id: 17,
    kind: "decision",
    decision: "「看到」左边只留一句",
    reason: "用户在 5b 上加的",
    case: "构思第 2 轮 5b",
    date: "2026-09-19",
    status: "voided",
    voidedBy: 25,
  };
  const active: ImportedDecision = {
    id: 25,
    kind: "decision",
    decision: "卡片右边只放可视化的东西",
    reason: "右边看渲染和效果就行",
    case: "修复第 2 轮的感受 1 到 4",
    date: "2026-09-19",
    status: "active",
  };
  const later: ImportedDecision = {
    id: 3,
    kind: "later",
    decision: "每天自动用一遍，发现改坏了的地方",
    reason: "还没有发生过",
    case: "构思第 5 轮第 1 条",
    date: "2026-09-20",
    status: "active",
  };
  const legacy = [voided, active, later];

  const importIn = (core: TestCore, rows: readonly ImportedDecision[], project = "abei") =>
    writeTx(core.ctx, (w) => importDecisions(w, project, rows));

  /** 导入的问题都写同一句改法。 */
  const hint = "按报错改好旧决定表里的这一条，再运行 ploop doctor --fix。";

  it("编号、日期、种类和状态照旧表，推翻它的那一条可以排在后面", async () => {
    const core = await legacyProject();
    const imported = unwrap(importIn(core, legacy));
    expect(imported).toEqual([later, voided, active]);
    expect(unwrap(listDecisions(core.ctx.db, "abei", { includeVoided: true }))).toEqual(imported);
    expect(ids(unwrap(listDecisions(core.ctx.db, "abei")))).toEqual([3, 25]);
  });

  it("每导入一条记一条事件，按编号排，写明内容", async () => {
    const core = await legacyProject();
    unwrap(importIn(core, legacy));
    const detail = ({ id: _id, ...rest }: ImportedDecision) => rest;
    expect(decisionEvents(core)).toEqual([
      ["decision.imported", "3", detail(later)],
      ["decision.imported", "17", detail(voided)],
      ["decision.imported", "25", detail(active)],
    ]);
  });

  it("旧表里超过 40 个字的「决定」照收，导入和读出都不校验字数", async () => {
    const core = await legacyProject();
    const long: ImportedDecision = { ...active, id: 30, decision: "字".repeat(80) };
    expect(unwrap(importIn(core, [long]))).toEqual([long]);
    expect(unwrap(listDecisions(core.ctx.db, "abei"))).toEqual([long]);
    expect(unwrap(getDecision(core.ctx.db, "abei", 30)).decision).toHaveLength(80);
  });

  it("迁移完成以后新增，编号接着导入的最大编号往下编", async () => {
    const core = await legacyProject();
    unwrap(importIn(core, legacy));
    core.ctx.db
      .update(projects)
      .set({ skillVersion: appSkillVersion })
      .where(eq(projects.id, "abei"))
      .run();
    expect(add(core, colors, "abei").id).toBe(26);
  });

  it("推翻它的那一条可以是项目里已有的", async () => {
    const core = await legacyProject();
    unwrap(importIn(core, [active]));
    expect(importIn(core, [voided])).toMatchObject({
      ok: true,
      value: [{ id: 17, status: "voided", voidedBy: 25 }],
    });
  });

  it("决定三项缺的一次报全，位置写成编号.字段名，什么都不写入", async () => {
    const core = await legacyProject();
    const rows = [{ ...voided, reason: " " }, { ...active, case: "" }, later];
    const issues = [
      { ...missing("reason"), hint, where: "17.reason" },
      { ...missing("case"), hint, where: `${active.id}.case` },
    ];
    expect(importIn(core, rows)).toEqual({
      ok: false,
      error: { code: "RULE_BLOCKED", ...issues[0], issues, total: 2 },
    });
    expect(allRows(core)).toEqual([]);
    expect(decisionEvents(core)).toEqual([]);
  });

  it("「以后再说」的旧行没有案例也照收", async () => {
    const core = await legacyProject();
    expect(importIn(core, [{ ...later, case: "" }]).ok).toBe(true);
  });

  it("写法不对的返回 BAD_REQUEST：编号、日期、作废的信息、被自己推翻", async () => {
    const core = await legacyProject();
    const rows: ImportedDecision[] = [
      { ...active, id: 0 },
      { ...active, id: 5, date: "9月18日" },
      { ...active, id: 6, date: "2026-02-30" },
      { ...voided, id: 7, voidedBy: undefined },
      { ...active, id: 8, voidedBy: 5 },
      { ...active, id: 9, voidReason: "改主意了" },
      { ...voided, id: 10, voidedBy: 10 },
    ];
    const result = importIn(core, rows);
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST", total: 7, hint } });
    const issues = result.ok ? [] : (result.error.issues ?? []);
    expect(issues.map((issue) => [issue.where, issue.message])).toEqual([
      ["0.id", "编号要写从 1 起的整数，这里是 0。"],
      ["5.date", "日期「9月18日」不是年月日的写法，要写成 2026-09-28 这样。"],
      ["6.date", "日期「2026-02-30」不是年月日的写法，要写成 2026-09-28 这样。"],
      ["7.voidedBy", "作废的决定要写明被哪一条推翻。"],
      ["8.voidedBy", "有效的决定不写被哪一条推翻，也不写作废原因。"],
      ["9.voidReason", "有效的决定不写被哪一条推翻，也不写作废原因。"],
      ["10.voidedBy", "决定不能被自己推翻。"],
    ]);
    expect(allRows(core)).toEqual([]);
  });

  it("编号在这一批里重复，或和项目里已有的重复，返回 CONFLICT", async () => {
    const core = await legacyProject();
    expect(importIn(core, [active, { ...later, id: 25 }])).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "编号 25 用了不止一次，同一个项目里的编号不能重复。",
        hint,
        where: "25.id",
      },
    });
    unwrap(importIn(core, [later]));
    expect(importIn(core, [active, later])).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", where: "3.id" },
    });
    expect(ids(unwrap(listDecisions(core.ctx.db, "abei")))).toEqual([3]);
  });

  it("推翻它的那一条不存在时返回 NOT_FOUND", async () => {
    const core = await legacyProject();
    expect(importIn(core, [{ ...voided, voidedBy: 99 }])).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "推翻它的决定不存在：项目「abei」没有编号是 99 的决定。",
        hint,
        where: "17.voidedBy",
      },
    });
  });

  it("调用者的写事务失败时整批撤回，也不发事件", async () => {
    const core = await legacyProject();
    const result = writeTx(core.ctx, (w) => {
      expect(importDecisions(w, "abei", legacy).ok).toBe(true);
      return err("核对数量对不上");
    });
    expect(result).toEqual({ ok: false, error: "核对数量对不上" });
    expect(allRows(core)).toEqual([]);
    expect(decisionEvents(core)).toEqual([]);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(importIn(core, legacy, "ghost")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有叫「ghost」的项目。" },
    });
  });
});
