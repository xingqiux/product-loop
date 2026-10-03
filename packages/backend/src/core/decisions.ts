import {
  beijingDay,
  checkDecisionFields,
  checkDecisionLength,
  type Decision,
  type DecisionKind,
  type DecisionVoid,
  decisionCopy,
  decisionRequiredFields,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  type Issue,
  ok,
  type ReplyLineRef,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { decisionsCopy } from "../copy/decisions.ts";
import { decisions } from "../store/schema/index.ts";
import type { JsonObject } from "../store/schema/json.ts";
import { appendEvent } from "./events.ts";
import { fail, findProject, type Reader, requireWritable } from "./projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

// 决定的用例：新增、修改、作废、列出、取一条，以及迁移时导入旧决定。字段见「03 数据模型」第二节。
// 新增时先跑规矩 decision.fields，缺几项就报几条拦截，见「07 校验」第四节。
// 「决定」一项超过 40 个字也拦下，细节写进原因，规矩是 decision.decision.tooLong，和缺项一起报。
// 改文字时只改决定、原因、案例，编号和日期不变，已作废的也能改；写了的项照新增的规矩查。
// 作废时写明被哪一条推翻，这一条原地留着，不删，见「04 命令行」第十节。
// 列出时默认只列有效的，见「05 接口」第四节。每次改动记一条事件，决定的历次变化由此能查到。

type DecisionRow = typeof decisions.$inferSelect;

/** 事件里的对象种类，用术语对照表里的英文名。 */
const objectType = "decision";

/** 接口和命令行看到的一条决定，形状和 model 的 decisionSchema 解析以后的相同。 */
function toDecision(row: DecisionRow): Decision {
  const { fromSubmission, fromLine } = row;
  return {
    id: row.id,
    kind: row.kind,
    decision: row.decision,
    reason: row.reason,
    case: row.case,
    date: row.date,
    status: row.status,
    ...(row.voidedBy === null ? {} : { voidedBy: row.voidedBy }),
    ...(row.voidReason === null ? {} : { voidReason: row.voidReason }),
    ...(fromSubmission === null || fromLine === null
      ? {}
      : { fromLine: { submission: fromSubmission, line: fromLine } }),
  };
}

/** 事件里记的改动内容：编号以外的各个字段。编号记在事件的对象编号里。 */
function detailOf(decision: Decision): JsonObject {
  const { id: _id, ...detail } = decision;
  return detail;
}

/** 由一到多条问题拼出失败的结果。没有问题时返回 undefined。 */
function failWith<C extends ErrorCode>(
  code: C,
  issues: readonly Issue[],
): ErrorBody<C> | undefined {
  const [first, ...rest] = issues;
  return first === undefined ? undefined : errorBody(code, [first, ...rest]);
}

/** 按编号找一条，已作废的也找得到。 */
function findDecisionRow(
  tx: Reader,
  projectId: string,
  id: number,
): Result<DecisionRow, ErrorBody<"NOT_FOUND">> {
  const row = tx
    .select()
    .from(decisions)
    .where(and(eq(decisions.projectId, projectId), eq(decisions.id, id)))
    .get();
  if (row !== undefined) return ok(row);
  const text = decisionsCopy.notFound;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { project: projectId, id }),
    hint: renderCopy(text.hint),
  });
}

// ── 查看 ──

export type ListDecisionsOptions = {
  /** 连已作废的一起列。重写决定.md、导出和工作台切换成全部时用。 */
  readonly includeVoided?: boolean | undefined;
};

/** 一个项目的决定，按编号从小到大排。默认只列有效的，接口 GET /projects/:pid/decisions 用。 */
export function listDecisions(
  db: Reader,
  projectId: string,
  options: ListDecisionsOptions = {},
): Result<Decision[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const ofProject = eq(decisions.projectId, projectId);
  const where =
    options.includeVoided === true ? ofProject : and(ofProject, eq(decisions.status, "active"));
  const rows = db.select().from(decisions).where(where).orderBy(asc(decisions.id)).all();
  return ok(rows.map(toDecision));
}

/** 按编号取一条，已作废的也取得到。 */
export function getDecision(
  db: Reader,
  projectId: string,
  id: number,
): Result<Decision, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = findDecisionRow(db, projectId, id);
  return row.ok ? ok(toDecision(row.value)) : row;
}

// ── 新增 ──

/** 新增一条决定要写的内容。三项可以缺，缺了由规矩 decision.fields 拦截。 */
export type DecisionInput = {
  /** 不写就是决定。 */
  readonly kind?: DecisionKind | undefined;
  readonly decision?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly case?: string | null | undefined;
  /** 来自哪一行回复。处理回复时，去处是决定的那一行才有。 */
  readonly fromLine?: ReplyLineRef | undefined;
};

/** 这个项目下一条决定的编号：已有的最大编号加一，迁移进来的编号也算在内。 */
function nextId(tx: Reader, projectId: string): number {
  const row = tx
    .select({ last: max(decisions.id) })
    .from(decisions)
    .where(eq(decisions.projectId, projectId))
    .get();
  return (row?.last ?? 0) + 1;
}

/** 三项在 decision.fields 查过以后一定有字，这里只去掉首尾的空白。 */
const text = (value: string | null | undefined): string => (value ?? "").trim();

/**
 * 在调用者的写事务里新增一条决定。编号和日期由后端填，日期是事务开始时北京时间的日期。
 * ploop decision add 经 addDecision 调用它。处理回复时（第 44 步），
 * 建出决定和给那一行定去处在同一个事务里，也调用它。项目能不能写，由调用者先查。
 */
export function createDecision(
  w: WriteScope,
  projectId: string,
  input: DecisionInput,
): Result<Decision, ErrorBody<"RULE_BLOCKED">> {
  const blocked = failWith("RULE_BLOCKED", [
    ...checkDecisionFields(input),
    ...checkDecisionLength(text(input.decision)),
  ]);
  if (blocked !== undefined) return err(blocked);
  const row = w.tx
    .insert(decisions)
    .values({
      projectId,
      id: nextId(w.tx, projectId),
      kind: input.kind ?? "decision",
      decision: text(input.decision),
      reason: text(input.reason),
      case: text(input.case),
      date: beijingDay(w.now),
      status: "active",
      fromSubmission: input.fromLine?.submission ?? null,
      fromLine: input.fromLine?.line ?? null,
      createdAt: w.now,
    })
    .returning()
    .get();
  const decision = toDecision(row);
  appendEvent(w, {
    projectId,
    kind: "decision.added",
    objectType,
    objectId: String(decision.id),
    detail: detailOf(decision),
  });
  return ok(decision);
}

/** ploop decision add：项目要能写，再新增一条，接口 POST /projects/:pid/decisions 用。 */
export function addDecision(
  ctx: WriteContext,
  projectId: string,
  input: DecisionInput,
): Result<Decision, ErrorBody<"RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  type Failure = ErrorBody<"RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<Decision, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    return createDecision(w, projectId, input);
  });
}

// ── 修改 ──

/** 改一条决定要写的文字：写了的项才改，null 和空白由规矩 decision.fields 拦截。 */
export type DecisionPatch = {
  readonly decision?: string | null | undefined;
  readonly reason?: string | null | undefined;
  readonly case?: string | null | undefined;
};

/**
 * ploop decision edit <编号>：只改决定、原因、案例的文字，编号、日期、种类和状态不变，
 * 已作废的也能改。写了的项先查有没有字，「决定」一项再查字数，问题一次报齐，什么都不写。
 * 文字去掉首尾的空白，和原来一样的项不算改；一项都没改就什么都不写，也不记事件。
 * 确有改动时记一条 decision.edited 事件，写明改了哪几项的新文字和原来的文字。
 */
export function editDecision(
  ctx: WriteContext,
  projectId: string,
  id: number,
  patch: DecisionPatch,
): Result<Decision, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  type Failure = ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<Decision, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const provided = decisionRequiredFields.filter((field) => patch[field] !== undefined);
    if (provided.length === 0) {
      return fail("BAD_REQUEST", {
        message: renderCopy(decisionCopy.edit.empty),
        hint: renderCopy(decisionsCopy.edit.emptyHint),
      });
    }
    const target = findDecisionRow(w.tx, projectId, id);
    if (!target.ok) return target;
    const row = target.value;
    // 没写的项照原样带着，只看写了的项有没有字：迁移来的「以后再说」可以没有案例。
    const merged = {
      decision: row.decision,
      reason: row.reason,
      case: row.case,
      ...Object.fromEntries(provided.map((field) => [field, patch[field]])),
    };
    const blocked = failWith("RULE_BLOCKED", [
      ...checkDecisionFields(merged).filter((issue) =>
        provided.some((field) => field === issue.where),
      ),
      ...(provided.includes("decision") ? checkDecisionLength(text(patch.decision)) : []),
    ]);
    if (blocked !== undefined) return err(blocked);

    const changes: Partial<Record<(typeof provided)[number], string>> = {};
    const previous: Partial<Record<(typeof provided)[number], string>> = {};
    for (const field of provided) {
      const next = text(patch[field]);
      if (next === row[field]) continue;
      changes[field] = next;
      previous[field] = row[field];
    }
    if (Object.keys(changes).length === 0) return ok(toDecision(row));
    const updated = w.tx
      .update(decisions)
      .set(changes)
      .where(and(eq(decisions.projectId, projectId), eq(decisions.id, id)))
      .returning()
      .get();
    appendEvent(w, {
      projectId,
      kind: "decision.edited",
      objectType,
      objectId: String(id),
      detail: { ...changes, previous },
    });
    return ok(toDecision(updated));
  });
}

// ── 作废 ──

/**
 * ploop decision void <编号> --by <新编号>：作废一条，写明被哪一条推翻。
 * 这一条原地留着，状态改成已作废。推翻它的那一条要在同一个项目里，有效，并且不是它自己。
 * 作废原因可以不写，只写了空白的按没写算。
 */
export function voidDecision(
  ctx: WriteContext,
  projectId: string,
  id: number,
  input: DecisionVoid,
): Result<Decision, ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  type Failure = ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<Decision, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const { by } = input;
    if (by === id) {
      return fail("BAD_REQUEST", {
        message: renderCopy(decisionCopy.voidedBySelf),
        hint: renderCopy(decisionsCopy.void.self.hint),
        where: "by",
      });
    }
    const target = findDecisionRow(w.tx, projectId, id);
    if (!target.ok) return target;
    // 已作废的一定写着被哪一条推翻，有效的一定没写，由表的检查约束保证。
    const { voidedBy } = target.value;
    // 重复运行同一条命令不算错：已经被同一条推翻的，什么都不写，照原样返回。
    if (voidedBy === by) return ok(toDecision(target.value));
    if (voidedBy !== null) {
      const text = decisionsCopy.void.alreadyVoided;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { id, by: voidedBy }),
        hint: renderCopy(text.hint, { by: voidedBy }),
      });
    }
    const replacing = findDecisionRow(w.tx, projectId, by);
    if (!replacing.ok) {
      const text = decisionsCopy.void.byNotFound;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, by }),
        hint: renderCopy(text.hint),
        where: "by",
      });
    }
    if (replacing.value.status === "voided") {
      const text = decisionsCopy.void.byVoided;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { by }),
        hint: renderCopy(text.hint),
        where: "by",
      });
    }
    const reason = input.reason?.trim() || null;
    const row = w.tx
      .update(decisions)
      .set({ status: "voided", voidedBy: by, voidReason: reason })
      .where(and(eq(decisions.projectId, projectId), eq(decisions.id, id)))
      .returning()
      .get();
    appendEvent(w, {
      projectId,
      kind: "decision.voided",
      objectType,
      objectId: String(id),
      detail: { by, ...(reason === null ? {} : { reason }) },
    });
    return ok(toDecision(row));
  });
}

// ── 迁移时导入 ──

/** 迁移时导入的一条旧决定。编号照旧表保留，可以是已作废的，见「08 版本与迁移」第五节。 */
export type ImportedDecision = Omit<Decision, "fromLine">;

const dateSchema = z.iso.date();

/** 导入的一条问题：位置写成「编号.字段名」，改法都是改好旧表再重跑。 */
function importIssue(id: number, field: string, message: string, rule?: string): Issue {
  const hint = renderCopy(decisionsCopy.import.hint);
  return { ...(rule === undefined ? {} : { rule }), message, hint, where: `${id}.${field}` };
}

/** 一条旧决定自己的写法：编号、日期，以及状态和作废的信息对不对得上。 */
function shapeIssues(row: ImportedDecision): Issue[] {
  const { id, date, status, voidedBy } = row;
  const issues: Issue[] = [];
  if (!Number.isSafeInteger(id) || id < 1) {
    issues.push(importIssue(id, "id", renderCopy(decisionsCopy.import.id, { id })));
  }
  if (!dateSchema.safeParse(date).success) {
    issues.push(importIssue(id, "date", renderCopy(decisionsCopy.import.date, { date })));
  }
  if (status === "voided" && voidedBy === undefined) {
    issues.push(importIssue(id, "voidedBy", renderCopy(decisionCopy.voidNeedsBy)));
  }
  if (status === "active") {
    const message = renderCopy(decisionCopy.activeWithVoid);
    if (voidedBy !== undefined) issues.push(importIssue(id, "voidedBy", message));
    if (row.voidReason?.trim()) issues.push(importIssue(id, "voidReason", message));
  }
  if (voidedBy === id) {
    issues.push(importIssue(id, "voidedBy", renderCopy(decisionCopy.voidedBySelf)));
  }
  return issues;
}

type ImportFailure = ErrorBody<"RULE_BLOCKED" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND">;

/**
 * 导入前把问题一次查全，只报第一类有问题的。
 * 顺序是：决定三项缺的、写法不对的、编号重复的、推翻它的那一条不存在的。
 */
function importFailure(
  projectId: string,
  rows: readonly ImportedDecision[],
  existing: ReadonlySet<number>,
): ImportFailure | undefined {
  // 旧表里「以后再说」的行没有案例这一列，不要求案例。
  const missing = rows.flatMap((row) =>
    checkDecisionFields(row)
      .filter((issue) => !(row.kind === "later" && issue.where === "case"))
      .map((issue) => importIssue(row.id, issue.where ?? "", issue.message, issue.rule)),
  );
  const shape = rows.flatMap(shapeIssues);
  const seen = new Set(existing);
  const duplicates = rows.flatMap((row) => {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      return [];
    }
    const message = renderCopy(decisionsCopy.import.duplicate, { id: row.id });
    return [importIssue(row.id, "id", message)];
  });
  const unknown = rows.flatMap(({ id, voidedBy }) => {
    if (voidedBy === undefined || seen.has(voidedBy)) return [];
    const message = renderCopy(decisionsCopy.void.byNotFound.message, {
      project: projectId,
      by: voidedBy,
    });
    return [importIssue(id, "voidedBy", message)];
  });
  return (
    failWith("RULE_BLOCKED", missing) ??
    failWith("BAD_REQUEST", shape) ??
    failWith("CONFLICT", duplicates) ??
    failWith("NOT_FOUND", unknown)
  );
}

/**
 * 迁移时在调用者的写事务里导入旧决定（第 61 步），核对不过时调用者整批撤回。
 * 编号、日期、状态都照旧表。推翻它的那一条可以排在后面，也可以是项目里已有的。
 * 迁移完成以前项目还不能写，所以这里不查 requireWritable。
 * 同一类的问题一次报全，先报哪一类见 importFailure。
 * 每导入一条记一条事件。返回导入的决定，按编号排。
 */
export function importDecisions(
  w: WriteScope,
  projectId: string,
  rows: readonly ImportedDecision[],
): Result<Decision[], ErrorBody<"RULE_BLOCKED" | "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND">> {
  const project = findProject(w.tx, projectId);
  if (!project.ok) return project;
  const ofProject = eq(decisions.projectId, projectId);
  const existing = new Set(
    w.tx
      .select({ id: decisions.id })
      .from(decisions)
      .where(ofProject)
      .all()
      .map((row) => row.id),
  );
  const failure = importFailure(projectId, rows, existing);
  if (failure !== undefined) return err(failure);
  // 先都按有效的写进去，再补上作废的信息，所以推翻它的那一条可以排在后面。
  for (const row of rows) {
    w.tx
      .insert(decisions)
      .values({
        projectId,
        id: row.id,
        kind: row.kind,
        decision: text(row.decision),
        reason: text(row.reason),
        case: text(row.case),
        date: row.date,
        status: "active",
        createdAt: w.now,
      })
      .run();
  }
  // 查过以后，写了被哪一条推翻的正好是已作废的。
  for (const row of rows) {
    if (row.voidedBy === undefined) continue;
    w.tx
      .update(decisions)
      .set({ status: "voided", voidedBy: row.voidedBy, voidReason: row.voidReason?.trim() || null })
      .where(and(ofProject, eq(decisions.id, row.id)))
      .run();
  }
  const ids = new Set(rows.map((row) => row.id));
  const imported = w.tx
    .select()
    .from(decisions)
    .where(ofProject)
    .orderBy(asc(decisions.id))
    .all()
    .filter((row) => ids.has(row.id))
    .map(toDecision);
  for (const decision of imported) {
    appendEvent(w, {
      projectId,
      kind: "decision.imported",
      objectType,
      objectId: String(decision.id),
      detail: detailOf(decision),
    });
  }
  return ok(imported);
}
