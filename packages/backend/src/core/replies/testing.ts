import { asc, eq } from "drizzle-orm";
import { cards } from "../../store/schema/index.ts";
import { presentPage } from "../pages/present.ts";
import { deps, landRound, pageData, presentInput, succeed } from "../pages/testing.ts";
import type { TestCore } from "../testing.ts";
import type { SubmitDeps } from "./submit.ts";

// 提交和等回复的测试共用的东西，只给测试用。
// 项目 app 开着第一轮落地，拿出了 Q1 到 Q3。给出的一页有一张疑问卡，看板上是这三件事。
// 附件库里有两张图，哈希由 a 和 c 重复而成，见 pages/testing.ts。

export const submitDeps: SubmitDeps = deps;

/** 给出一页，返回页面编号。 */
export function present(core: TestCore, purpose: "ask" | "view" = "ask"): number {
  return succeed(presentPage(core.ctx, "app", presentInput(pageData(), { purpose }), deps)).page.id;
}

/** 开着第一轮落地，给出了一页要用户点的页。 */
export async function presented(): Promise<{ core: TestCore; pageId: number }> {
  const core = await landRound();
  return { core, pageId: present(core) };
}

/** 这一页的卡片编号，按页面上的顺序。 */
export function cardIds(core: TestCore, pageId: number): string[] {
  return core.ctx.db
    .select({ id: cards.cardId })
    .from(cards)
    .where(eq(cards.pageId, pageId))
    .orderBy(asc(cards.position))
    .all()
    .map((row) => row.id);
}

/** 旧模板复制出的一份回复：疑问卡写备注带一张图，取消 Q2，一条两行的想法。 */
export const legacyText = [
  "落地第 1 轮",
  "疑问 1（先放第一屏〔图 1〕）",
  "队列 不做了：「Q2 提交以后写明回复被取走了」",
  "想法：看板可以按阶段分列",
  "每列按放进来的先后排",
  "图：图 1=aaaaaa",
].join("\n");
