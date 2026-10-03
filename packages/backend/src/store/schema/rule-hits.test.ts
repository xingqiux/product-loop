import { describe, expect, it } from "vitest";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { projects } from "./projects.ts";
import { ruleHits } from "./rule-hits.ts";

const at = new Date("2026-09-28T08:00:00Z");

const hit = {
  createdAt: at,
  projectId: "app",
  command: "page check",
  mode: "current",
  layer: "rule",
  rule: "card.source.visual",
  level: "block",
  message: "来源没有图。",
} as const;

async function openDb() {
  const { db } = await openTempDatabase(tempHome());
  db.insert(projects).values({ id: "app", name: "演示", repoKind: "own", createdAt: at }).run();
  return db;
}

describe("拦截和警告的记录表", () => {
  it("平时不写页面的日期，历史页面模式要写", async () => {
    const db = await openDb();
    db.insert(ruleHits).values(hit).run();
    db.insert(ruleHits)
      .values({ ...hit, mode: "history", pageDate: "2026-09-25" })
      .run();
    expect(
      sqliteError(() =>
        db
          .insert(ruleHits)
          .values({ ...hit, mode: "history" })
          .run(),
      ),
    ).toBe("CHECK constraint failed: rule_hits_page_date");
    expect(
      sqliteError(() =>
        db
          .insert(ruleHits)
          .values({ ...hit, pageDate: "2026-09-25" })
          .run(),
      ),
    ).toBe("CHECK constraint failed: rule_hits_page_date");
  });

  it("层、级别和方式只收英文键，项目要登记过", async () => {
    const db = await openDb();
    const bad = (values: Record<string, unknown>) =>
      sqliteError(() =>
        db
          .insert(ruleHits)
          .values({ ...hit, ...values } as typeof hit)
          .run(),
      );
    expect(bad({ level: "拦截" })).toBe("CHECK constraint failed: rule_hits_level_enum");
    expect(bad({ layer: "写作校验" })).toBe("CHECK constraint failed: rule_hits_layer_enum");
    expect(bad({ mode: "平时" })).toBe("CHECK constraint failed: rule_hits_mode_enum");
    expect(bad({ projectId: "nope" })).toBe("FOREIGN KEY constraint failed");
  });
});
