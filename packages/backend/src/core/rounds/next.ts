import {
  formatCommand,
  type PagePurpose,
  renderCopy,
  type Stage,
  stage,
} from "@product-loop/model";
import { and, count, eq, inArray, ne } from "drizzle-orm";
import { projectsCopy } from "../../copy/projects.ts";
import {
  cards,
  landRecords,
  pages,
  queueItems,
  roundItems,
  type rounds,
} from "../../store/schema/index.ts";
import type { MainlineStatus } from "../mainline.ts";
import type { Reader } from "../projects.ts";
import { unhandledReplies } from "../replies/pending.ts";
import { latestUseRun } from "../use/runs.ts";
import { lastUseCommand, useLeaveIssues } from "./use-leave.ts";

// 下一步：状态、开始一轮、收尾、给出页面各处给的下一步都从这里来，见「04 命令行」第五节。
// 每一条都是一条现在敲了就能成功的完整命令，已经知道的值直接写进去：
// 没有要用户点的页时不叫 AI 去等，进入检查会被拦下时先看主线，没有页面数据时先看页面怎么写。
// 解释性的话不放在这里，放在命令输出的正文里，见命令行的 round start 和 status。

type RoundRow = typeof rounds.$inferSelect;

const text = projectsCopy.next;
const start = (key: Stage) => renderCopy(text.roundStart, { stage: stage.label(key) });

/** 各阶段队列里还在待办的事的件数。等待和进行中的不算，开始一轮拿不出它们。 */
function todoCounts(db: Reader, projectId: string): Partial<Record<Stage, number>> {
  const rows = db
    .select({ stage: queueItems.stage, n: count() })
    .from(queueItems)
    .where(and(eq(queueItems.projectId, projectId), eq(queueItems.status, "todo")))
    .groupBy(queueItems.stage)
    .all();
  const counts: Partial<Record<Stage, number>> = {};
  for (const row of rows) counts[row.stage] = row.n;
  return counts;
}

/** 这一轮里给出过、没撤回的页，按用途数。 */
export function shownPages(db: Reader, roundId: number): Record<"ask" | "view", number> {
  const rows = db
    .select({ purpose: pages.purpose, n: count() })
    .from(pages)
    .where(
      and(
        eq(pages.roundId, roundId),
        ne(pages.status, "withdrawn"),
        inArray(pages.purpose, ["ask", "view"] satisfies PagePurpose[]),
      ),
    )
    .groupBy(pages.purpose)
    .all();
  const found = new Map(rows.map((row) => [row.purpose, row.n]));
  return { ask: found.get("ask") ?? 0, view: found.get("view") ?? 0 };
}

/**
 * 落地阶段收尾要看过的页数：要用户点的页，和有更改卡的只看页。空的只看页不算，
 * 免得用一张空页满足「给用户看过一页」，见决定 206。
 */
export function shownLandPages(db: Reader, roundId: number): number {
  const rows = db
    .select({ id: pages.id, purpose: pages.purpose, section: cards.section })
    .from(pages)
    .leftJoin(cards, eq(cards.pageId, pages.id))
    .where(
      and(
        eq(pages.roundId, roundId),
        ne(pages.status, "withdrawn"),
        inArray(pages.purpose, ["ask", "view"] satisfies PagePurpose[]),
      ),
    )
    .all();
  const counted = new Set<number>();
  for (const row of rows) {
    if (row.purpose === "ask" || row.section === "changes") counted.add(row.id);
  }
  return counted.size;
}

/** 进入一个阶段的命令。进入检查要设计规范十二样齐全，缺的时候先看主线。 */
function enter(key: Stage, mainline: MainlineStatus): string {
  return key === "check" && mainline.missingDesignSpec.length > 0
    ? renderCopy(text.mainlineCheck)
    : start(key);
}

/**
 * 一轮收尾以后的下一步，最多两条：这个阶段的队列里还有待办的事时，先写再开一次这个阶段，
 * 再写往下走的阶段。往下走的阶段按用得着才开：落地队列里没有事就直接到提升，
 * 提升收尾以后开始新的一版，见 versionStart。使用和检查靠运行、看产品产出内容，不看队列。
 * 阶段按用得着才开，见决定 216。放弃的阶段只写再开一次。
 */
export function closedNext(
  db: Reader,
  projectId: string,
  closed: Stage,
  mainline: MainlineStatus,
  aborted = false,
): string[] {
  // 放弃的阶段没有做完，往下走没有意义：拿出的事退回了待办，接着再开这个阶段。
  if (aborted) return [start(closed)];
  const todo = todoCounts(db, projectId);
  const same = (todo[closed] ?? 0) > 0 && closed !== "improve" ? [start(closed)] : [];
  return [...same, enter(nextStage(closed, todo, mainline), mainline)];
}

/**
 * 新的一版从哪个阶段开始：主线还有缺的部分，或者构思队列里有事，就从构思开始，
 * 否则从使用开始，不为了走完五个阶段而开一个没有内容的构思。
 */
export function versionStart(db: Reader, projectId: string, mainline: MainlineStatus): string {
  return start(startStage(todoCounts(db, projectId), mainline));
}

function startStage(todo: Partial<Record<Stage, number>>, mainline: MainlineStatus): Stage {
  return (todo.think ?? 0) > 0 || mainline.missingParts.length > 0 ? "think" : "use";
}

/** 往下走的阶段：落地队列里没有事就跳过，提升收尾以后回到新一版的开头。 */
function nextStage(
  closed: Stage,
  todo: Partial<Record<Stage, number>>,
  mainline: MainlineStatus,
): Stage {
  switch (closed) {
    case "think":
      return "use";
    case "use":
      return "check";
    case "check":
      return (todo.land ?? 0) > 0 ? "land" : "improve";
    case "land":
      return "improve";
    case "improve":
      return startStage(todo, mainline);
  }
}

/**
 * 收尾的命令。只写命令本身，不带占位符：拿出的事还在进行中时，收尾会拦下并写明每件事怎么记结果，
 * ploop status 里也会列出这些事。
 */
export function closeCommand(): string {
  return renderCopy(text.roundClose);
}

/**
 * 使用阶段：运行使用代码，没有断点、没有缺口时后端自动给用户看一页（ingest 里做），
 * 下一次开始阶段时自动收尾，所以下一步直接往下走。拿出的事还没有结果时先收尾。
 * 页没有给出，例如是撤回了，才写 page present。
 */
function useNext(
  db: Reader,
  round: RoundRow,
  viewShown: boolean,
  mainline: MainlineStatus | undefined,
): string[] {
  const command = lastUseCommand(db, round.projectId);
  const rerun =
    command === null ? [] : [renderCopy(text.useRun, { command: formatCommand(command) })];
  const latest = latestUseRun(db, round.projectId, { round });
  if (!latest.ok || latest.value === null) {
    return command === null ? [renderCopy(text.useSchema)] : rerun;
  }
  if (useLeaveIssues(db, round).length > 0) return rerun;
  if (!viewShown) return [renderCopy(text.pagePresent)];
  if (unfinishedCount(db, round.id) > 0 || mainline === undefined) return [closeCommand()];
  return closedNext(db, round.projectId, round.stage, mainline);
}

/**
 * 落地阶段：还没交计划，下一步就是交计划（先写好计划.md，「先做」里写了七节的名字）；
 * 交过计划的，看五步做到哪一步；给用户看过页，收尾。
 */
function landNext(db: Reader, round: RoundRow, shown: boolean): string[] {
  if (shown) return [closeCommand()];
  const planned = db
    .select({ id: landRecords.id })
    .from(landRecords)
    .where(eq(landRecords.roundId, round.id))
    .get();
  return [renderCopy(planned === undefined ? text.landPlan : text.landStatus)];
}

/**
 * 开着、没有页在等的一轮：还没写页面就先看页面怎么写，给用户看过以后收尾。
 * 构思阶段主线有缺时，先看主线缺什么：「先做」里第一件事就是补主线。
 */
function openNext(db: Reader, round: RoundRow, mainline?: MainlineStatus): string[] {
  const shown = shownPages(db, round.id);
  if (round.stage === "use") return useNext(db, round, shown.view > 0, mainline);
  if (round.stage === "land") return landNext(db, round, shown.ask + shown.view > 0);
  if (shown.view > 0) return [closeCommand()];
  if (round.stage === "think" && mainline !== undefined && mainline.missingParts.length > 0) {
    return [renderCopy(text.mainlineCheck)];
  }
  return [renderCopy(text.pageExample, { stage: stage.label(round.stage) })];
}

/** 这一轮拿出来、现在还在进行中的事的件数：收尾要给它们各写一个结果。 */
function unfinishedCount(db: Reader, roundId: number): number {
  const row = db
    .select({ n: count() })
    .from(roundItems)
    .innerJoin(queueItems, eq(queueItems.id, roundItems.queueItemId))
    .where(and(eq(roundItems.roundId, roundId), eq(queueItems.status, "doing")))
    .get();
  return row?.n ?? 0;
}

/** 一轮现在的下一步，按这一轮的状态选。状态、开始一轮和处理回复以后都用它。 */
export function roundNext(
  db: Reader,
  projectId: string,
  round: RoundRow,
  mainline: MainlineStatus,
): string[] {
  switch (round.status) {
    case "waiting":
      return [renderCopy(text.replyWait)];
    case "replied":
      if (unhandledReplies(db, projectId).length > 0) return [renderCopy(text.replyShow)];
      // 落地阶段要查代码全部提交，一定要明确收尾；拿出的事还没有结果时也要先写结果。
      // 别的阶段回复处理完、事都有结果，下一次开始阶段时自动收尾，不用再敲收尾。
      return round.stage === "land" || unfinishedCount(db, round.id) > 0
        ? [closeCommand()]
        : closedNext(db, projectId, round.stage, mainline);
    case "closed":
      // 回复还有行没处理时收尾也被拦，这里是迁移来的旧数据，先把这几行处理完。
      return unhandledReplies(db, projectId).length > 0
        ? [renderCopy(text.replyShow)]
        : closedNext(db, projectId, round.stage, mainline);
    case "open":
      return openNext(db, round, mainline);
  }
}

/**
 * 撤回一页以后的下一步：用户在对话里回答了，就按回答处理，再收尾；页不对，重新给出。
 * 有回复没处理完时不能给出新的一页，所以撤回时不会有没处理的行。
 */
export function withdrawnNext(): string[] {
  return [closeCommand(), renderCopy(text.pagePresent)];
}

/** 给出一页以后的下一步：要用户点的页去等回复，只看的页不等，接着按这一轮的状态走。 */
export function presentedNext(
  db: Reader,
  round: RoundRow,
  purpose: PagePurpose,
  mainline: MainlineStatus,
): string[] {
  if (purpose === "ask") return [renderCopy(text.replyWait)];
  return openNext(db, round, mainline);
}
