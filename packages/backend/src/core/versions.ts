import {
  type ErrorBody,
  formatRoundLabel,
  formatRoundName,
  ok,
  type Result,
  type RoundStatus,
  renderCopy,
  type Stage,
  type VersionStatus,
} from "@product-loop/model";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { projectsCopy } from "../copy/projects.ts";
import { productVersions, rounds } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { fail, findProject, iso, isoOrNull, type Reader, requireWritable } from "./projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

// 产品版本的用例：看当前版本、列出各版和每版下的轮次、结束这一版并开始下一版。
// 见「08 版本与迁移」第二节和「04 命令行」第二节的 ploop version show|next。
// 提升轮收尾以后自动进入下一版，由开始一轮的用例做，见 rounds/start.ts 的 versionForRound。
// 两处换版都用这里的 endVersion 和 startNextVersion。

/** 接口和命令行看到的一版。 */
export type VersionView = {
  readonly version: number;
  readonly status: VersionStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  /** 一句话小结。 */
  readonly summary: string | null;
  /** 结束这一版的原因：ploop version next 写的原因，或者提升轮收尾以后换版时写明是哪一轮。 */
  readonly endReason: string | null;
};

/** 接口和命令行看到的一轮。 */
export type RoundView = {
  /** 轮次的写法，例如 v2-落地-3。 */
  readonly label: string;
  readonly version: number;
  readonly stage: Stage;
  readonly seq: number;
  readonly status: RoundStatus;
  readonly startedAt: string;
  readonly closedAt: string | null;
  /** 迁移前的旧编号，例如 fix-13。 */
  readonly legacyId: string | null;
  /** 收尾时写的一句话小结。没收尾或没写时为空。 */
  readonly summary: string | null;
};

/** 一版和这一版下的轮次，轮次按开始的先后排。 */
export type VersionDetail = VersionView & { readonly rounds: readonly RoundView[] };

type VersionRow = typeof productVersions.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

export function toVersionView(row: VersionRow): VersionView {
  return {
    version: row.version,
    status: row.status,
    startedAt: iso(row.startedAt),
    endedAt: isoOrNull(row.endedAt),
    summary: row.summary,
    endReason: row.endReason,
  };
}

export function toRoundView(row: RoundRow): RoundView {
  return {
    label: formatRoundLabel(row),
    version: row.version,
    stage: row.stage,
    seq: row.seq,
    status: row.status,
    startedAt: iso(row.startedAt),
    closedAt: isoOrNull(row.closedAt),
    legacyId: row.legacyId,
    summary: row.closeNote,
  };
}

/**
 * 当前的一版：没结束的那一版。都结束了，就是最新的一版。
 * 没结束的一版总是最新的，因为下一版只在上一版结束以后才建。
 * 迁移完成时第 1 版结束，下一版等开始一轮时才建，这期间当前的一版是已结束的第 1 版。
 */
export function currentVersionRow(tx: Reader, projectId: string): VersionRow {
  const row = tx
    .select()
    .from(productVersions)
    .where(eq(productVersions.projectId, projectId))
    .orderBy(desc(productVersions.version))
    .limit(1)
    .get();
  // 登记项目时就建好了第 1 版，所以一定有。
  if (row === undefined) throw new Error(`项目 ${projectId} 没有任何版本，数据不一致。`);
  return row;
}

/** 这一版里的轮次，按开始的先后排。 */
export function roundsOf(tx: Reader, projectId: string, version: number): RoundRow[] {
  return tx
    .select()
    .from(rounds)
    .where(and(eq(rounds.projectId, projectId), eq(rounds.version, version)))
    .orderBy(asc(rounds.ordinal))
    .all();
}

/** 当前的一版和它下面的轮次，ploop version show 用。 */
export function currentVersion(
  db: Reader,
  projectId: string,
): Result<VersionDetail, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = currentVersionRow(db, projectId);
  const list = roundsOf(db, projectId, row.version).map(toRoundView);
  return ok({ ...toVersionView(row), rounds: list });
}

/** 各版和每版下的轮次，从第 1 版排起，接口 GET /projects/:pid/versions 用。 */
export function listVersions(
  db: Reader,
  projectId: string,
): Result<VersionDetail[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const all = db
    .select()
    .from(rounds)
    .where(eq(rounds.projectId, projectId))
    .orderBy(asc(rounds.ordinal))
    .all();
  const versions = db
    .select()
    .from(productVersions)
    .where(eq(productVersions.projectId, projectId))
    .orderBy(asc(productVersions.version))
    .all();
  return ok(
    versions.map((row) => ({
      ...toVersionView(row),
      rounds: all.filter((round) => round.version === row.version).map(toRoundView),
    })),
  );
}

/** ploop version next 的结果：结束的一版和新开始的一版。 */
export type VersionChange = { readonly ended: VersionView; readonly started: VersionView };

/**
 * 提前结束当前的一版，记下原因，再开始下一版，见「08 版本与迁移」第二节。
 * 例如跳过提升。还有一轮没收尾时不能结束，否则那一轮会留在已结束的一版里开着。
 */
export function nextVersion(
  ctx: WriteContext,
  projectId: string,
  reason: string,
): Result<VersionChange, ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  const endReason = reason.trim();
  if (endReason === "") {
    const text = projectsCopy.version.reasonEmpty;
    return fail("BAD_REQUEST", { message: renderCopy(text.message), hint: renderCopy(text.hint) });
  }
  type Failure = ErrorBody<"CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<VersionChange, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const current = currentVersionRow(w.tx, projectId);
    if (current.status === "closed") {
      const text = projectsCopy.version.ended;
      const { version } = current;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { version, next: version + 1 }),
        hint: renderCopy(text.hint),
      });
    }
    const open = w.tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.projectId, projectId), ne(rounds.status, "closed")))
      .get();
    if (open !== undefined) {
      const text = projectsCopy.version.roundOpen;
      const round = formatRoundName(open);
      return fail("CONFLICT", {
        message: renderCopy(text.message, { round, version: current.version }),
        hint: renderCopy(text.hint),
        where: round,
      });
    }
    const ended = endVersion(w, current, endReason);
    const started = startNextVersion(w, ended);
    return ok({ ended: toVersionView(ended), started: toVersionView(started) });
  });
}

/**
 * 在调用者的写事务里结束进行中的一版，记下时间和原因，记一条 version.ended。
 * 调用的一方先确认没有开着的一轮，再接着用 startNextVersion 开始下一版。
 */
export function endVersion(w: WriteScope, current: VersionRow, endReason: string): VersionRow {
  const { projectId, version } = current;
  const ended = w.tx
    .update(productVersions)
    .set({ status: "closed", endedAt: w.now, endReason })
    .where(and(eq(productVersions.projectId, projectId), eq(productVersions.version, version)))
    .returning()
    .get();
  appendEvent(w, {
    projectId,
    kind: "version.ended",
    objectType: "productVersion",
    objectId: String(version),
    detail: { reason: endReason },
  });
  return ended;
}

/** 在调用者的写事务里开始下一版，记一条 version.started。上一版要已经结束。 */
export function startNextVersion(w: WriteScope, previous: VersionRow): VersionRow {
  const { projectId } = previous;
  const started = w.tx
    .insert(productVersions)
    .values({ projectId, version: previous.version + 1, status: "open", startedAt: w.now })
    .returning()
    .get();
  appendEvent(w, {
    projectId,
    kind: "version.started",
    objectType: "productVersion",
    objectId: String(started.version),
  });
  return started;
}
