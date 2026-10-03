import {
  type ErrorBody,
  formatRoundLabel,
  ok,
  type Result,
  renderCopy,
  type SkillIssueStatus,
  skillIssueStatus,
} from "@product-loop/model";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { skillIssuesCopy } from "../copy/skill.ts";
import { rounds, skillIssues } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { fail, findProject, iso, type Reader, requireWritable } from "./projects.ts";
import { type WriteContext, writeTx } from "./tx.ts";
import { currentVersionRow, roundsOf } from "./versions.ts";

// skill 的问题：ploop skill report 和 ploop skill issues，见「04 命令行」第十一节。
// 接口是 POST /skill/issues、GET /skill/issues 和 PATCH /skill/issues/:id，见「05 接口」第四节。
// 报告时由后端带上项目、轮次和 skill 版本，报告者取自请求头的客户端。
// 每次新报和处理都记一条 skillIssue.reported 或 skillIssue.updated 事件，事件流里就是 issue.changed。

type Row = typeof skillIssues.$inferSelect;

/** 接口和命令行看到的一个问题。 */
export type SkillIssueView = {
  readonly id: number;
  readonly project: string;
  readonly round: string | null;
  readonly reportedAt: string;
  readonly reporter: string;
  readonly aspect: string;
  readonly issueClass: string;
  readonly example: string;
  readonly skillVersion: string | null;
  readonly status: SkillIssueStatus;
  readonly note: string | null;
  readonly fixedIn: string | null;
  readonly updatedAt: string;
};

export type SkillIssueReport = {
  readonly project: string;
  readonly aspect: string;
  readonly issueClass: string;
  readonly example: string;
};

export type SkillIssuePatch = {
  readonly status: SkillIssueStatus;
  readonly note?: string | undefined;
  readonly fixedIn?: string | undefined;
};

export type SkillIssueFilter = {
  readonly status?: SkillIssueStatus | undefined;
  readonly project?: string | undefined;
};

type Failure = ErrorBody<"BAD_REQUEST" | "NOT_FOUND" | "NEEDS_DOCTOR">;

function toView(db: Reader, row: Row): SkillIssueView {
  const round =
    row.roundId === null
      ? undefined
      : db.select().from(rounds).where(eq(rounds.id, row.roundId)).get();
  return {
    id: row.id,
    project: row.projectId,
    round: round === undefined ? null : formatRoundLabel(round),
    reportedAt: iso(row.reportedAt),
    reporter: row.reporter,
    aspect: row.aspect,
    issueClass: row.issueClass,
    example: row.example,
    skillVersion: row.skillVersion,
    status: row.status,
    note: row.note,
    fixedIn: row.fixedIn,
    updatedAt: iso(row.updatedAt),
  };
}

/** 项目这一版最近的一轮：开着的，或最后收尾的。和 ploop status 看的是同一轮。 */
export function latestRoundOf(db: Reader, projectId: string) {
  const { version } = currentVersionRow(db, projectId);
  return roundsOf(db, projectId, version).at(-1);
}

/** 报一个问题，返回它的编号和内容。 */
export function reportSkillIssue(
  ctx: WriteContext,
  input: SkillIssueReport,
): Result<SkillIssueView, Failure> {
  return writeTx<SkillIssueView, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, input.project);
    if (!project.ok) return project;
    const round = latestRoundOf(w.tx, input.project);
    const row = w.tx
      .insert(skillIssues)
      .values({
        projectId: input.project,
        roundId: round?.id ?? null,
        reportedAt: w.now,
        reporter: w.actor.client,
        session: w.actor.session ?? null,
        aspect: input.aspect,
        issueClass: input.issueClass,
        example: input.example,
        skillVersion: project.value.skillVersion,
        status: "new",
        updatedAt: w.now,
      })
      .returning()
      .get();
    appendEvent(w, {
      projectId: input.project,
      kind: "skillIssue.reported",
      objectType: "skillIssue",
      objectId: String(row.id),
      detail: { aspect: row.aspect, issueClass: row.issueClass },
    });
    return ok(toView(w.tx, row));
  });
}

/** 问题的列表，按编号从小到大排。 */
export function listSkillIssues(
  db: Reader,
  filter: SkillIssueFilter = {},
): Result<SkillIssueView[], ErrorBody<"NOT_FOUND">> {
  if (filter.project !== undefined) {
    const project = findProject(db, filter.project);
    if (!project.ok) return project;
  }
  const where: SQL[] = [];
  if (filter.status !== undefined) where.push(eq(skillIssues.status, filter.status));
  if (filter.project !== undefined) where.push(eq(skillIssues.projectId, filter.project));
  const rows = db
    .select()
    .from(skillIssues)
    .where(and(...where))
    .orderBy(asc(skillIssues.id))
    .all();
  return ok(rows.map((row) => toView(db, row)));
}

/**
 * 处理一个问题：回理解、确认、改了、不改。
 * 回理解和不改要写说明，改了要写在哪一版改的。处理过的不能改回「新」。
 */
export function updateSkillIssue(
  ctx: WriteContext,
  id: number,
  patch: SkillIssuePatch,
): Result<SkillIssueView, Failure> {
  const text = skillIssuesCopy;
  return writeTx<SkillIssueView, Failure>(ctx, (w) => {
    const row = w.tx.select().from(skillIssues).where(eq(skillIssues.id, id)).get();
    if (row === undefined) {
      return fail("NOT_FOUND", {
        message: renderCopy(text.notFound.message, { id }),
        hint: renderCopy(text.notFound.hint),
      });
    }
    const where = String(id);
    if (patch.status === "new") {
      return fail("BAD_REQUEST", {
        message: renderCopy(text.backToNew.message, { id }),
        hint: renderCopy(text.backToNew.hint),
        where,
      });
    }
    const note = patch.note ?? row.note;
    if ((patch.status === "understood" || patch.status === "wontFix") && patch.note === undefined) {
      return fail("BAD_REQUEST", {
        message: renderCopy(text.noteMissing.message, {
          id,
          status: skillIssueStatus.label(patch.status),
        }),
        hint: renderCopy(text.noteMissing.hint),
        where,
      });
    }
    if (patch.status === "fixed" && patch.fixedIn === undefined) {
      return fail("BAD_REQUEST", {
        message: renderCopy(text.fixedInMissing.message, { id }),
        hint: renderCopy(text.fixedInMissing.hint),
        where,
      });
    }
    const updated = w.tx
      .update(skillIssues)
      .set({
        status: patch.status,
        note,
        fixedIn: patch.fixedIn ?? row.fixedIn,
        updatedAt: w.now,
      })
      .where(eq(skillIssues.id, id))
      .returning()
      .get();
    appendEvent(w, {
      projectId: row.projectId,
      kind: "skillIssue.updated",
      objectType: "skillIssue",
      objectId: where,
      detail: { from: row.status, to: patch.status },
    });
    return ok(toView(w.tx, updated));
  });
}
