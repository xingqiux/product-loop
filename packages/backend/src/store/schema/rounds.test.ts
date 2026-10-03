import type { RoundStatus, Stage } from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { productVersions, projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

const at = new Date("2026-09-28T08:00:00Z");

/** 登记一个项目并建好第 1 版。 */
function addProject(db: Db, id: string): void {
  db.insert(projects).values({ id, name: id, repoKind: "own", createdAt: at }).run();
  db.insert(productVersions)
    .values({ projectId: id, version: 1, status: "open", startedAt: at })
    .run();
}

/** 第 1 版构思的第 n 轮，总序号也是 n。 */
const round = (projectId: string, n: number, status: RoundStatus = "open") => ({
  projectId,
  version: 1,
  stage: "think" as const,
  seq: n,
  ordinal: n,
  status,
  startedAt: at,
});

async function twoProjects(): Promise<Db> {
  const { db } = await openTempDatabase(tempHome());
  addProject(db, "a");
  addProject(db, "b");
  return db;
}

describe("轮次表", () => {
  it.each<RoundStatus>(["open", "waiting", "replied"])(
    "同一项目有一轮是 %s 时，第二个没收尾的轮次被索引拒绝",
    async (status) => {
      const db = await twoProjects();
      db.insert(rounds)
        .values(round("a", 1, status))
        .run();
      expect(sqliteError(() => db.insert(rounds).values(round("a", 2)).run())).toBe(
        "UNIQUE constraint failed: rounds.project_id",
      );
    },
  );

  it("换一个项目可以开，第一轮收尾以后同一项目可以再开", async () => {
    const db = await twoProjects();
    db.insert(rounds).values(round("a", 1)).run();
    db.insert(rounds).values(round("b", 1)).run();
    db.update(rounds)
      .set({ status: "closed", closedAt: at })
      .where(and(eq(rounds.projectId, "a"), eq(rounds.seq, 1)))
      .run();
    db.insert(rounds).values(round("a", 2)).run();
    const open = db.select().from(rounds).where(eq(rounds.status, "open")).all();
    expect(open.map((r) => [r.projectId, r.seq])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it.each(["修复", "fix"])("阶段写成 %s 时被检查约束拒绝", async (bad) => {
    const db = await twoProjects();
    const row = { ...round("a", 1), stage: bad as Stage };
    expect(sqliteError(() => db.insert(rounds).values(row).run())).toBe(
      "CHECK constraint failed: rounds_stage_enum",
    );
  });

  it("状态写成中文标签时被检查约束拒绝，库里只存英文键", async () => {
    const db = await twoProjects();
    const row = { ...round("a", 1), status: "进行中" as RoundStatus };
    expect(sqliteError(() => db.insert(rounds).values(row).run())).toBe(
      "CHECK constraint failed: rounds_status_enum",
    );
  });

  it("同一版同一阶段的轮号不重复", async () => {
    const db = await twoProjects();
    db.insert(rounds)
      .values(round("a", 1, "closed"))
      .run();
    const again = { ...round("a", 1), ordinal: 2 };
    expect(sqliteError(() => db.insert(rounds).values(again).run())).toBe(
      "UNIQUE constraint failed: rounds.project_id, rounds.version, rounds.stage, rounds.seq",
    );
  });

  it("轮次挂的版本必须已经建好", async () => {
    const db = await twoProjects();
    const row = { ...round("a", 1), version: 2 };
    expect(sqliteError(() => db.insert(rounds).values(row).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });
});
