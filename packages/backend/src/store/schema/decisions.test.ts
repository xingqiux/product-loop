import type { DecisionKind, DecisionStatus } from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { decisions } from "./decisions.ts";
import { projects } from "./projects.ts";

const at = new Date("2026-09-28T08:00:00Z");

/** 项目里编号是 id 的一条有效的决定。 */
const decision = (projectId: string, id: number) => ({
  projectId,
  id,
  kind: "decision" as const,
  decision: "颜色表示分类，选中另用描边",
  reason: "去掉颜色后整页只剩灰",
  case: "模板页第三行标签",
  date: "2026-09-18",
  status: "active" as const,
  createdAt: at,
});

async function twoProjects(): Promise<Db> {
  const { db } = await openTempDatabase(tempHome());
  for (const id of ["a", "b"]) {
    db.insert(projects).values({ id, name: id, repoKind: "own", createdAt: at }).run();
  }
  return db;
}

/** 把项目 a 里编号是 id 的一条改成别的样子，返回 SQLite 报的错。 */
const change = (db: Db, id: number, set: Partial<typeof decisions.$inferInsert>) =>
  sqliteError(() =>
    db
      .update(decisions)
      .set(set)
      .where(and(eq(decisions.projectId, "a"), eq(decisions.id, id)))
      .run(),
  );

describe("决定表", () => {
  it("同一个项目里编号不重复，别的项目可以用同一个编号", async () => {
    const db = await twoProjects();
    db.insert(decisions).values(decision("a", 1)).run();
    db.insert(decisions).values(decision("b", 1)).run();
    expect(sqliteError(() => db.insert(decisions).values(decision("a", 1)).run())).toBe(
      "UNIQUE constraint failed: decisions.project_id, decisions.id",
    );
  });

  it("种类和状态写成中文标签时被检查约束拒绝，库里只存英文键", async () => {
    const db = await twoProjects();
    const kind = { ...decision("a", 1), kind: "以后再说" as DecisionKind };
    expect(sqliteError(() => db.insert(decisions).values(kind).run())).toBe(
      "CHECK constraint failed: decisions_kind_enum",
    );
    const status = { ...decision("a", 1), status: "有效" as DecisionStatus };
    expect(sqliteError(() => db.insert(decisions).values(status).run())).toBe(
      "CHECK constraint failed: decisions_status_enum",
    );
  });

  it("已作废的要写被哪一条推翻，有效的不能写；作废原因只有已作废的有", async () => {
    const db = await twoProjects();
    db.insert(decisions)
      .values([decision("a", 1), decision("a", 2)])
      .run();
    expect(change(db, 1, { status: "voided" })).toBe(
      "CHECK constraint failed: decisions_voided_by",
    );
    expect(change(db, 1, { voidedBy: 2 })).toBe("CHECK constraint failed: decisions_voided_by");
    expect(change(db, 1, { voidReason: "改主意了" })).toBe(
      "CHECK constraint failed: decisions_void_reason",
    );
    expect(change(db, 1, { status: "voided", voidedBy: 2, voidReason: "改主意了" })).toBe(
      "没有报错",
    );
  });

  it("不能被自己推翻", async () => {
    const db = await twoProjects();
    db.insert(decisions).values(decision("a", 1)).run();
    expect(change(db, 1, { status: "voided", voidedBy: 1 })).toBe(
      "CHECK constraint failed: decisions_not_self",
    );
  });

  it("推翻它的那一条要在同一个项目里，并且已经存在", async () => {
    const db = await twoProjects();
    db.insert(decisions)
      .values([decision("a", 1), decision("b", 2)])
      .run();
    expect(change(db, 1, { status: "voided", voidedBy: 2 })).toBe("FOREIGN KEY constraint failed");
  });

  it("回复的编号和行号同时有或同时没有", async () => {
    const db = await twoProjects();
    const half = { ...decision("a", 1), fromSubmission: 4 };
    expect(sqliteError(() => db.insert(decisions).values(half).run())).toBe(
      "CHECK constraint failed: decisions_from_line",
    );
    const both = { ...decision("a", 1), fromSubmission: 4, fromLine: 2 };
    expect(sqliteError(() => db.insert(decisions).values(both).run())).toBe("没有报错");
  });

  it("日期写成年月日", async () => {
    const db = await twoProjects();
    for (const date of ["2026/09/18", "9月18日", "2026-9-18", ""]) {
      const row = { ...decision("a", 1), date };
      expect(sqliteError(() => db.insert(decisions).values(row).run())).toBe(
        "CHECK constraint failed: decisions_date",
      );
    }
  });

  it("项目必须已经登记", async () => {
    const db = await twoProjects();
    expect(sqliteError(() => db.insert(decisions).values(decision("ghost", 1)).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });
});
