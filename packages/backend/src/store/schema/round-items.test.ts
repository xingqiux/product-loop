import type { RoundItemResult, Stage } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { productVersions, projects } from "./projects.ts";
import { queueItems } from "./queue.ts";
import { roundItems } from "./round-items.ts";
import { rounds } from "./rounds.ts";

const at = new Date("2026-09-28T08:00:00Z");

/** 项目 a 的第 1 版里开着一轮构思，队列里有 Q1。返回轮次和事项在库里的编号。 */
async function oneRound(): Promise<{ db: Db; roundId: number; itemId: number }> {
  const { db } = await openTempDatabase(tempHome());
  db.insert(projects).values({ id: "a", name: "a", repoKind: "own", createdAt: at }).run();
  db.insert(productVersions)
    .values({ projectId: "a", version: 1, status: "open", startedAt: at })
    .run();
  const round = db
    .insert(rounds)
    .values({
      projectId: "a",
      version: 1,
      stage: "think",
      seq: 1,
      ordinal: 1,
      status: "open",
      startedAt: at,
    })
    .returning()
    .get();
  const item = db
    .insert(queueItems)
    .values({
      projectId: "a",
      number: 1,
      content: "理清给谁用",
      stage: "think",
      proposer: "ai",
      createdAt: at,
      status: "doing",
      subItems: [],
      editCount: 0,
    })
    .returning()
    .get();
  return { db, roundId: round.id, itemId: item.id };
}

describe("拿出的事表", () => {
  it("开始时只记轮次、事项和拿出的时间，结果、退回的阶段和说明为空", async () => {
    const { db, roundId, itemId } = await oneRound();
    db.insert(roundItems).values({ roundId, queueItemId: itemId, takenAt: at }).run();
    expect(db.select().from(roundItems).all()).toEqual([
      { roundId, queueItemId: itemId, result: null, returnedTo: null, note: null, takenAt: at },
    ]);
  });

  it("一件事在同一轮里只记一次", async () => {
    const { db, roundId, itemId } = await oneRound();
    const row = { roundId, queueItemId: itemId, takenAt: at };
    db.insert(roundItems).values(row).run();
    expect(sqliteError(() => db.insert(roundItems).values(row).run())).toBe(
      "UNIQUE constraint failed: round_items.round_id, round_items.queue_item_id",
    );
  });

  it("轮次和事项必须已经存在", async () => {
    const { db, roundId, itemId } = await oneRound();
    for (const row of [
      { roundId: roundId + 1, queueItemId: itemId, takenAt: at },
      { roundId, queueItemId: itemId + 1, takenAt: at },
    ]) {
      expect(sqliteError(() => db.insert(roundItems).values(row).run())).toBe(
        "FOREIGN KEY constraint failed",
      );
    }
  });

  it.each([
    ["结果写成中文标签", { result: "做完" as RoundItemResult }, "round_items_result_enum"],
    ["退回的阶段写成旧名字", { returnedTo: "修复" as Stage }, "round_items_returned_to_enum"],
    [
      "做完的事写了退回到哪个阶段",
      { result: "done" as const, returnedTo: "think" as const },
      "round_items_returned_to",
    ],
  ])("%s时被检查约束拒绝", async (_case, fields, check) => {
    const { db, roundId, itemId } = await oneRound();
    const row = { roundId, queueItemId: itemId, takenAt: at, ...fields };
    expect(sqliteError(() => db.insert(roundItems).values(row).run())).toBe(
      `CHECK constraint failed: ${check}`,
    );
  });

  it("退回的事可以写退回到哪个阶段和说明", async () => {
    const { db, roundId, itemId } = await oneRound();
    const row = {
      roundId,
      queueItemId: itemId,
      takenAt: at,
      result: "returned",
      returnedTo: "think",
      note: "定义不对，先回到构思",
    } as const;
    db.insert(roundItems).values(row).run();
    expect(db.select().from(roundItems).get()).toEqual(row);
  });
});
