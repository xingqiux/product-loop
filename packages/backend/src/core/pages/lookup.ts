import {
  formatPageName,
  formatQueueId,
  formatRoundLabel,
  type PagePurpose,
} from "@product-loop/model";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { cards, pages, rounds } from "../../store/schema/index.ts";
import { iso, type Reader } from "../projects.ts";
import type { PageLookup } from "./check.ts";

// 按页面表查的几样：在等的页、这一轮已给出的页引用过的事项。
// 校验管线、状态、给出信息和收尾都用这里的查法，所以「在等」的意思只有一处。

/**
 * 一页在等用户：已给出、还没回复、没撤回的页，并且它的一轮还没收尾。
 * 要用户点的页占「一页在等」的名额，只看的页不占，见「04 命令行」第十节。
 */
export type OpenPage = {
  readonly id: number;
  /** 这一页在所在阶段里的第几页。 */
  readonly seq: number;
  /** 这一页所在阶段的标识，写成 v2-检查-1。 */
  readonly round: string;
  readonly purpose: PagePurpose;
  readonly presentedAt: string;
};

/**
 * 项目里在等用户的页。要用户点的排在前面，同一种按给出的先后，新的在前。
 * ploop reply wait 等的就是第一页，见约定 0001 第 20 条。
 */
export function openPagesOf(db: Reader, projectId: string): OpenPage[] {
  const rows = db
    .select({ page: pages, round: rounds })
    .from(pages)
    .innerJoin(rounds, eq(rounds.id, pages.roundId))
    .where(
      and(
        eq(pages.projectId, projectId),
        eq(pages.status, "presented"),
        ne(rounds.status, "closed"),
      ),
    )
    // 用途的键 ask 排在 view 前面。
    .orderBy(asc(pages.purpose), desc(pages.id))
    .all();
  return rows.map(({ page, round }) => ({
    id: page.id,
    seq: page.seq,
    round: formatRoundLabel(round),
    purpose: page.purpose,
    presentedAt: iso(page.presentedAt),
  }));
}

/** 一个阶段里在等用户点的页，至多一页。id 是页面的编号，seq 是它在这个阶段里的第几页。收尾和撤回用它。 */
export function waitingPageIn(
  db: Reader,
  roundId: number,
): { readonly id: number; readonly seq: number } | undefined {
  return db
    .select({ id: pages.id, seq: pages.seq })
    .from(pages)
    .where(and(eq(pages.roundId, roundId), eq(pages.purpose, "ask"), eq(pages.status, "presented")))
    .get();
}

/** 一页在文字里的叫法：第 2 版的检查阶段的第 2 页。报错和输出里指一页都写它，不写全局的页面编号。 */
export function pageNameOf(
  db: Reader,
  page: { readonly roundId: number; readonly seq: number },
): string {
  const round = db.select().from(rounds).where(eq(rounds.id, page.roundId)).get();
  // 页面挂在存在的阶段上，由外键保证。
  if (round === undefined) throw new Error(`阶段 ${page.roundId} 不存在，数据不一致。`);
  return formatPageName(round, page.seq);
}

/** 页面表上的两样查法，交给校验管线，见 check.ts 的 PageLookup。 */
export const pageLookup: PageLookup = {
  waitingPages: (db, projectId) =>
    openPagesOf(db, projectId)
      .filter((page) => page.purpose === "ask")
      .map(({ id, seq, round }) => ({ id, seq, round })),
  coveredInRound: (db, roundId) => {
    const rows = db
      .select({ page: cards.pageId, queue: cards.queue })
      .from(cards)
      .innerJoin(pages, eq(pages.id, cards.pageId))
      .where(and(eq(pages.roundId, roundId), ne(pages.status, "withdrawn")))
      .orderBy(asc(cards.pageId), asc(cards.position))
      .all();
    const covered = new Map<string, number>();
    for (const row of rows) {
      for (const number of row.queue) {
        const id = formatQueueId(number);
        if (!covered.has(id)) covered.set(id, row.page);
      }
    }
    return covered;
  },
};
