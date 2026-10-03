import { type LegacyReplyPage, legacyReplyPage } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { type pages, rounds } from "../../store/schema/index.ts";
import type { PageFill } from "../pages/fill.ts";
import type { Reader } from "../projects.ts";

// 存下的一页在旧模板上的样子，旧格式的回复文字按它对回卡片编号和队列编号，见 model 的 legacyReplyPage。
// 看板和「这一轮开始时取消的事」取给出时存下的填充部分，和用户看到的一致，见 core/pages/fill.ts。

type PageRow = typeof pages.$inferSelect;

/** 一页在旧模板上的样子。次数是这一版里这个阶段的第几次，旧模板的页头写成「第 3 轮」。 */
export function legacyPageOf(db: Reader, page: PageRow): LegacyReplyPage {
  const round = db.select().from(rounds).where(eq(rounds.id, page.roundId)).get();
  // 页面挂在存在的轮次上，由外键保证。
  if (round === undefined) throw new Error(`阶段 ${page.roundId} 不存在，数据不一致。`);
  // 存下时就是 fillParts 算出的样子。
  const fill = page.fill as PageFill;
  const board = [...fill.queue.waiting, ...fill.queue.columns.flatMap((column) => column.items)];
  return legacyReplyPage({
    version: round.version,
    stage: round.stage,
    round: round.seq,
    sections: page.sections,
    queue: board.map(({ id, content }) => ({ id, content })),
    droppedAtStart: fill.droppedAtStart.length > 0,
  });
}
