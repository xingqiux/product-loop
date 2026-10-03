import {
  allRules,
  backendRules,
  formatQueueId,
  formatRoundLabel,
  type QueueStatus,
  type RoundStatus,
  renderCopy,
} from "@product-loop/model";
import { and, desc, eq, gte, inArray, isNull, max, ne, notLike } from "drizzle-orm";
import {
  events,
  projects,
  queueEvents,
  queueItems,
  rounds,
  ruleHits,
} from "../store/schema/index.ts";
import { appSkillVersion, iso, type Reader, skillState } from "./projects.ts";

// skill 的三类信号，见「06 工作台」第七节和「03 数据模型」第二节的末尾：
// 反复被拦截的规矩、停在旧版本的项目、停了很多天的事。全部从数据里算出，不靠谁报告。
// 接口是 GET /skill/signals，见「05 接口」第四节。时间由调用的一方传进来，测试用假时钟。

const dayMs = 24 * 60 * 60 * 1000;
/** 数拦截的天数。 */
const blockedDays = 14;
/** 最多列几条反复被拦截的规矩。 */
const blockedTop = 5;
/** 十四天里被拦截几次起算反复：一次不叫反复。 */
const blockedMin = 2;
/** 进行中的轮次超过几天没有变化算停了。 */
const roundStaleDays = 3;
/** 待办或进行中的队列事项超过几天没有变化算停了。 */
const queueStaleDays = 7;

type BlockedRule = {
  readonly rule: string;
  readonly summary: string | null;
  readonly count: number;
  readonly projects: number;
  readonly projectIds: readonly string[];
  readonly latestMessage: string;
  readonly latestAt: string;
};

type OutdatedProject = {
  readonly project: string;
  readonly name: string;
  readonly skillVersion: string | null;
  readonly reason: "migrationIncomplete" | "skillOutdated";
};

type StalledRound = {
  readonly project: string;
  readonly name: string;
  readonly round: string;
  readonly status: Exclude<RoundStatus, "closed">;
  readonly lastChangedAt: string;
  readonly days: number;
};

type StalledQueueItem = {
  readonly project: string;
  readonly name: string;
  readonly item: string;
  readonly content: string;
  readonly status: Extract<QueueStatus, "todo" | "doing">;
  readonly lastChangedAt: string;
  readonly days: number;
};

export type SkillSignals = {
  readonly blockedRules: readonly BlockedRule[];
  readonly outdatedProjects: readonly OutdatedProject[];
  readonly stalledRounds: readonly StalledRound[];
  readonly stalledQueueItems: readonly StalledQueueItem[];
};

/** 规矩查什么，一句话，取自规则登记表，共用定义和后端的两处都找。登记表里没有的为空。 */
function summaryOf(rule: string): string | null {
  const found = [...allRules(), ...backendRules()].find((item) => item.id === rule);
  return found === undefined ? null : renderCopy(found.about.summary);
}

/** 反复被拦截的规矩：最近十四天里级别是拦截的记录，按规矩的编号数，两次以上的才算，次数多的在前。 */
function blockedRules(db: Reader, now: Date): BlockedRule[] {
  const since = new Date(now.getTime() - blockedDays * dayMs);
  const hits = db
    .select()
    .from(ruleHits)
    .where(and(eq(ruleHits.level, "block"), gte(ruleHits.createdAt, since)))
    .orderBy(desc(ruleHits.createdAt), desc(ruleHits.id))
    .all();
  // 记录已按时间从新到旧排，每条规矩遇到的第一条就是最近一次。
  const byRule = new Map<
    string,
    { latest: (typeof hits)[number]; perProject: Map<string, number>; count: number }
  >();
  for (const hit of hits) {
    const found = byRule.get(hit.rule) ?? { latest: hit, perProject: new Map(), count: 0 };
    found.perProject.set(hit.projectId, (found.perProject.get(hit.projectId) ?? 0) + 1);
    found.count += 1;
    byRule.set(hit.rule, found);
  }
  return [...byRule.entries()]
    .filter(([, { count }]) => count >= blockedMin)
    .map(([rule, { latest, perProject, count }]): BlockedRule => {
      const ids = [...perProject.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      return {
        rule,
        summary: summaryOf(rule),
        count,
        projects: ids.length,
        projectIds: ids.map(([id]) => id),
        latestMessage: latest.message,
        latestAt: iso(latest.createdAt),
      };
    })
    .sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt))
    .slice(0, blockedTop);
}

const wholeDays = (from: Date, now: Date) => Math.floor((now.getTime() - from.getTime()) / dayMs);

/**
 * 三类信号。已归档的项目不算。
 * - 旧版本：skill 版本为空表示迁移没完成，第一段比这一版的小表示停在旧版本，和写操作要不要体检同一个判断。
 * - 停了的轮次：还没收尾，项目最近一次改动（事件表里除了 skill 问题以外的任何一条）在三天以前。
 *   轮次本身没有修改时间，开这一轮以后项目里的改动都算它的变化。
 * - 停了的队列事项：待办或进行中，最近一次状态变化在七天以前。
 */
export function skillSignals(db: Reader, now: Date, app: string = appSkillVersion): SkillSignals {
  const live = db.select().from(projects).where(isNull(projects.archivedAt)).all();
  const names = new Map(live.map((row) => [row.id, row.name]));
  const nameOf = (id: string) => names.get(id) ?? id;

  const outdatedProjects = live.flatMap((row): OutdatedProject[] => {
    const { doctor } = skillState(row.skillVersion, app);
    return doctor === null
      ? []
      : [{ project: row.id, name: row.name, skillVersion: row.skillVersion, reason: doctor }];
  });

  const lastEvent = new Map(
    db
      .select({ project: events.projectId, at: max(events.createdAt) })
      .from(events)
      .where(notLike(events.kind, "skillIssue.%"))
      .groupBy(events.projectId)
      .all()
      .map((row) => [row.project, row.at]),
  );
  const stalledRounds = db
    .select()
    .from(rounds)
    .where(ne(rounds.status, "closed"))
    .all()
    .flatMap((round): StalledRound[] => {
      if (!names.has(round.projectId) || round.status === "closed") return [];
      const seen = lastEvent.get(round.projectId);
      const last = seen != null && seen > round.startedAt ? seen : round.startedAt;
      if (now.getTime() - last.getTime() <= roundStaleDays * dayMs) return [];
      return [
        {
          project: round.projectId,
          name: nameOf(round.projectId),
          round: formatRoundLabel(round),
          status: round.status,
          lastChangedAt: iso(last),
          days: wholeDays(last, now),
        },
      ];
    })
    .sort((a, b) => b.days - a.days);

  const moved = new Map(
    db
      .select({ id: queueEvents.itemId, at: max(queueEvents.at) })
      .from(queueEvents)
      .groupBy(queueEvents.itemId)
      .all()
      .map((row) => [row.id, row.at]),
  );
  const stalledQueueItems = db
    .select()
    .from(queueItems)
    .where(inArray(queueItems.status, ["todo", "doing"]))
    .orderBy(queueItems.projectId, queueItems.number)
    .all()
    .flatMap((item): StalledQueueItem[] => {
      if (!names.has(item.projectId) || (item.status !== "todo" && item.status !== "doing")) {
        return [];
      }
      const last = moved.get(item.id) ?? item.createdAt;
      if (now.getTime() - last.getTime() <= queueStaleDays * dayMs) return [];
      return [
        {
          project: item.projectId,
          name: nameOf(item.projectId),
          item: formatQueueId(item.number),
          content: item.content,
          status: item.status,
          lastChangedAt: iso(last),
          days: wholeDays(last, now),
        },
      ];
    })
    .sort((a, b) => b.days - a.days);

  return {
    blockedRules: blockedRules(db, now),
    outdatedProjects,
    stalledRounds,
    stalledQueueItems,
  };
}
