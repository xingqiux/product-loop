import {
  type ErrorBody,
  type Issue,
  ok,
  type Result,
  renderCopy,
  type Stage,
  stage,
} from "@product-loop/model";
import { eq, max } from "drizzle-orm";
import { projectsCopy } from "../copy/projects.ts";
import { events, type rounds } from "../store/schema/index.ts";
import { type MainlineStatus, mainlineStatus } from "./mainline.ts";
import { type OpenPage, openPagesOf } from "./pages/lookup.ts";
import {
  doctorIssue,
  getProject,
  iso,
  listProjects,
  type ProjectView,
  type Reader,
  type SkillState,
  skillState,
} from "./projects.ts";
import { queueCounts, staleCounts } from "./queue.ts";
import { roundNext, versionStart } from "./rounds/next.ts";
import {
  currentVersionRow,
  type RoundView,
  roundsOf,
  toRoundView,
  toVersionView,
  type VersionView,
} from "./versions.ts";

// 项目的状态：第几版、哪个阶段、第几轮，哪一页在等，队列剩什么，主线缺哪几样，下一步做什么。
// 见「04 命令行」第二节的 ploop status，和「05 接口」第四节的 GET /projects/:pid/status。
// 状态只读不写，所以要先体检的项目也能查，下一步写着 ploop doctor。

type RoundRow = typeof rounds.$inferSelect;

/** 一个阶段在队列里还没做完的件数：待办、进行中、等待三种状态的合计。 */
type QueueCount = {
  readonly stage: Stage;
  readonly count: number;
  /** 其中停了七天以上的件数，见「06 工作台」第二节。 */
  readonly stale: number;
};

/**
 * 状态里由别的表提供的三样。队列的件数从第 30 步的 queue_items 表取。
 * 主线缺哪几样从第 32 步的 mainline_revisions 表取。
 * 在等的页从第 40 步的 pages 表取。测试可以传别的实现。
 */
export type StatusSources = {
  readonly waitingPages: (db: Reader, projectId: string) => readonly OpenPage[];
  /** 没写的阶段按 0 件算。 */
  readonly queueCounts: (db: Reader, projectId: string) => Partial<Record<Stage, number>>;
  /** 没写的阶段按 0 件算。 */
  readonly staleCounts: (
    db: Reader,
    projectId: string,
    now: Date,
  ) => Partial<Record<Stage, number>>;
  readonly mainline: (db: Reader, projectId: string) => MainlineStatus;
};

const defaultSources: StatusSources = {
  waitingPages: openPagesOf,
  queueCounts,
  staleCounts,
  mainline: mainlineStatus,
};

export type StatusOptions = {
  /** 算停了几天用的现在的时间。 */
  readonly now: Date;
  readonly sources?: StatusSources | undefined;
};

export type ProjectStatus = {
  readonly project: ProjectView;
  /** 当前的一版。迁移完成以后、开始一轮以前，是已结束的第 1 版。 */
  readonly version: VersionView;
  /** 当前的一版里最近的一轮，它的阶段就是当前的阶段。还没开始任何阶段时为空。 */
  readonly round: RoundView | null;
  /** 给用户的页：要用户点的在前，只看的页在后。只有要用户点的页算在等，只看的页不等回复。 */
  readonly waitingPages: readonly OpenPage[];
  /** 五个阶段各一项，按阶段的顺序排。 */
  readonly queue: readonly QueueCount[];
  /** 主线缺哪几样。刚开工的项目十样都缺，见 S13 第 3 步。 */
  readonly mainline: MainlineStatus;
  readonly skill: SkillState;
  /** 最近一次改动的时间，取自事件表。 */
  readonly lastChangedAt: string;
  /** 从最近一次改动到现在停了几天。 */
  readonly idleDays: number;
  /** 下一步：一到两条完整的命令。接口层把它放进响应外壳的 next。 */
  readonly next: readonly string[];
  /** 警告：要先体检时写明原因和怎么做。接口层把它放进响应外壳的 warnings。 */
  readonly warnings: readonly Issue[];
};

const dayMs = 24 * 60 * 60 * 1000;

/** 一个项目的状态，ploop status 和 ploop 不带子命令时用。 */
export function projectStatus(
  db: Reader,
  projectId: string,
  options: StatusOptions,
): Result<ProjectStatus, ErrorBody<"NOT_FOUND">> {
  const project = getProject(db, projectId);
  return project.ok ? ok(statusOf(db, project.value, options)) : project;
}

/**
 * 所有项目的状态，ploop status --all 和所有项目的看板用。
 * 有页在等用户的排在最前，其余按最近的改动排，新的在前，见「06 工作台」第二节。
 */
export function allProjectStatuses(db: Reader, options: StatusOptions): ProjectStatus[] {
  return listProjects(db)
    .map((project) => statusOf(db, project, options))
    .sort(byAttention);
}

function statusOf(db: Reader, project: ProjectView, options: StatusOptions): ProjectStatus {
  const sources = options.sources ?? defaultSources;
  const versionRow = currentVersionRow(db, project.id);
  const latest = roundsOf(db, project.id, versionRow.version).at(-1);
  const version = toVersionView(versionRow);
  const round = latest === undefined ? null : toRoundView(latest);
  const skill = skillState(project.skillVersion);
  const counts = sources.queueCounts(db, project.id);
  const stale = sources.staleCounts(db, project.id, options.now);
  const mainline = sources.mainline(db, project.id);
  const last = lastChange(db, project.id) ?? new Date(project.createdAt);
  return {
    project,
    version,
    round,
    waitingPages: sources.waitingPages(db, project.id),
    queue: stage.keys.map((key) => ({
      stage: key,
      count: counts[key] ?? 0,
      stale: stale[key] ?? 0,
    })),
    mainline,
    skill,
    lastChangedAt: iso(last),
    idleDays: Math.max(0, Math.floor((options.now.getTime() - last.getTime()) / dayMs)),
    next: nextSteps(db, project.id, { skill, version, latest, mainline }),
    warnings: skill.doctor === null ? [] : [doctorIssue(project.id, skill.version, skill.doctor)],
  };
}

/** 事件表里这个项目最近一条事件的时间。登记项目时就有一条。 */
function lastChange(db: Reader, projectId: string): Date | undefined {
  const row = db
    .select({ at: max(events.createdAt) })
    .from(events)
    .where(eq(events.projectId, projectId))
    .get();
  return row?.at ?? undefined;
}

/**
 * 下一步按下表算，每一条都是现在敲了就能成功的命令，见 rounds/next.ts。
 *
 * | 情况 | 下一步 |
 * | --- | --- |
 * | 要先体检 | ploop doctor |
 * | 当前的一版还没开始任何阶段，或者已经结束 | 主线有缺或构思队列里有事，开始构思，否则开始使用 |
 * | 这一轮进行中 | 先看页面怎么写；使用阶段先跑使用代码；落地阶段先看五步到了哪一步 |
 * | 给用户看过只看的页 | 收尾 |
 * | 等用户回复 | 等回复 |
 * | 已回复，还有行没处理 | 看回复 |
 * | 已回复，都处理了 | 收尾 |
 * | 已收尾 | 队列里这个阶段还有待办的事就先写再开一次，再写下一个阶段，落地队列没有事就跳过；提升收尾以后开新的一版 |
 */
function nextSteps(
  db: Reader,
  projectId: string,
  state: {
    readonly skill: SkillState;
    readonly version: VersionView;
    readonly latest: RoundRow | undefined;
    readonly mainline: MainlineStatus;
  },
): string[] {
  const { skill, version, latest, mainline } = state;
  const text = projectsCopy.next;
  if (skill.doctor !== null) return [renderCopy(text.doctor)];
  if (version.status === "closed" || latest === undefined) {
    return [versionStart(db, projectId, mainline)];
  }
  return roundNext(db, projectId, latest, mainline);
}

/** 有要用户点的页在等：只看的页不算，它不等回复。 */
const waitsForUser = (status: ProjectStatus) =>
  status.waitingPages.some((page) => page.purpose === "ask");

/** 有页在等的在前，其余按最近的改动排，新的在前。都一样时按编号排，结果稳定。 */
function byAttention(a: ProjectStatus, b: ProjectStatus): number {
  const waiting = Number(waitsForUser(b)) - Number(waitsForUser(a));
  if (waiting !== 0) return waiting;
  if (a.lastChangedAt !== b.lastChangedAt) return a.lastChangedAt < b.lastChangedAt ? 1 : -1;
  return a.project.id < b.project.id ? -1 : 1;
}
