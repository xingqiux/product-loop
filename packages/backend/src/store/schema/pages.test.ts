import { describe, expect, it } from "vitest";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { cards, excerpts, pages } from "./pages.ts";
import { productVersions, projects } from "./projects.ts";
import { rounds } from "./rounds.ts";
import { ruleHits } from "./rule-hits.ts";

const at = new Date("2026-09-28T08:00:00Z");

/** 项目 app 的第一版里开着一轮落地。 */
async function openDb() {
  const { db } = await openTempDatabase(tempHome());
  db.insert(projects).values({ id: "app", name: "演示", repoKind: "own", createdAt: at }).run();
  db.insert(productVersions)
    .values({ projectId: "app", version: 1, status: "open", startedAt: at })
    .run();
  db.insert(rounds)
    .values({
      projectId: "app",
      version: 1,
      stage: "land",
      seq: 1,
      ordinal: 1,
      status: "open",
      startedAt: at,
    })
    .run();
  return db;
}

const page = {
  projectId: "app",
  roundId: 1,
  seq: 1,
  purpose: "ask",
  formatVersion: 2,
  sections: {},
  images: [],
  fill: {},
  status: "presented",
  presentedAt: at,
} as const;

describe("页面、卡片索引和原文摘录的表", () => {
  it("撤回的页写撤回的时间，别的页不写", async () => {
    const db = await openDb();
    expect(
      sqliteError(() =>
        db
          .insert(pages)
          .values({ ...page, status: "withdrawn" })
          .run(),
      ),
    ).toBe("CHECK constraint failed: pages_withdrawn_at");
    expect(
      sqliteError(() =>
        db
          .insert(pages)
          .values({ ...page, withdrawnAt: at })
          .run(),
      ),
    ).toBe("CHECK constraint failed: pages_withdrawn_at");
    db.insert(pages)
      .values({ ...page, status: "withdrawn", withdrawnAt: at })
      .run();
  });

  it("用途、状态和区块只收英文键，同一轮的页序号不重复", async () => {
    const db = await openDb();
    const bad = (values: Record<string, unknown>) =>
      sqliteError(() =>
        db
          .insert(pages)
          .values({ ...page, ...values } as typeof page)
          .run(),
      );
    expect(bad({ purpose: "只看" })).toBe("CHECK constraint failed: pages_purpose_enum");
    expect(bad({ status: "已给出" })).toBe("CHECK constraint failed: pages_status_enum");
    db.insert(pages)
      .values({ ...page, purpose: "view" })
      .run();
    expect(bad({ purpose: "view" })).toBe("UNIQUE constraint failed: pages.round_id, pages.seq");
    const card = { pageId: 1, section: "asks", cardId: "ask-a", position: 0, title: "标题" };
    expect(
      sqliteError(() =>
        db
          .insert(cards)
          .values({ ...card, section: "疑问" as "asks", queue: [], scenes: [] })
          .run(),
      ),
    ).toBe("CHECK constraint failed: cards_section_enum");
  });

  it("原文摘录的起止行从 1 数，起始行不在结束行后面", async () => {
    const db = await openDb();
    db.insert(pages).values(page).run();
    const excerpt = {
      pageId: 1,
      where: "asks[0].sources[0]",
      file: "skill/SKILL.md",
      text: "第三行",
      fileHash: "f".repeat(64),
      createdAt: at,
    };
    for (const [startLine, endLine] of [
      [0, 1],
      [4, 3],
    ] as const) {
      expect(
        sqliteError(() =>
          db
            .insert(excerpts)
            .values({ ...excerpt, startLine, endLine })
            .run(),
        ),
      ).toBe("CHECK constraint failed: excerpts_lines");
    }
  });

  it("拦截和警告的记录指到存下的页面", async () => {
    const db = await openDb();
    const hit = {
      createdAt: at,
      projectId: "app",
      command: "page present",
      mode: "current",
      layer: "rule",
      rule: "blob.present",
      level: "block",
      message: "截图没有上传。",
    } as const;
    expect(
      sqliteError(() =>
        db
          .insert(ruleHits)
          .values({ ...hit, pageId: 1 })
          .run(),
      ),
    ).toBe("FOREIGN KEY constraint failed");
    db.insert(pages).values(page).run();
    db.insert(ruleHits)
      .values({ ...hit, pageId: 1 })
      .run();
  });
});
