import { type MainlineSource, parseMainline } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { mainlineRevisions, scenes } from "./mainline.ts";
import { projects } from "./projects.ts";

const at = new Date("2026-09-28T08:00:00Z");

async function twoProjects(): Promise<Db> {
  const { db } = await openTempDatabase(tempHome());
  for (const id of ["a", "b"]) {
    db.insert(projects).values({ id, name: id, repoKind: "own", createdAt: at }).run();
  }
  return db;
}

/** 项目里的第 n 版，全文只有一句。 */
const revision = (projectId: string, n: number) => ({
  projectId,
  revision: n,
  text: `第 ${n} 版`,
  hash: "0".repeat(64),
  createdAt: at,
  source: "cache" as MainlineSource,
  parsed: parseMainline(`第 ${n} 版`),
  maxSceneId: 0,
});

/** 项目 a 的 S1，在第 1 版出现。 */
const scene = {
  projectId: "a",
  number: 1,
  name: "看所有项目停在哪",
  who: "你，每天打开工作台的第一眼。",
  steps: [{ step: 1, do: "打开工作台", expect: "看到每个项目停在哪一轮。" }],
  firstRevision: 1,
  latestRevision: 1,
};

describe("主线版本表", () => {
  it("同一项目里版本号不重复，换一个项目可以重复", async () => {
    const db = await twoProjects();
    db.insert(mainlineRevisions).values(revision("a", 1)).run();
    db.insert(mainlineRevisions).values(revision("b", 1)).run();
    expect(sqliteError(() => db.insert(mainlineRevisions).values(revision("a", 1)).run())).toBe(
      "UNIQUE constraint failed: mainline_revisions.project_id, mainline_revisions.revision",
    );
  });

  it("来源写成中文标签时被检查约束拒绝，库里只存英文键", async () => {
    const db = await twoProjects();
    const row = { ...revision("a", 1), source: "项目缓存" as MainlineSource };
    expect(sqliteError(() => db.insert(mainlineRevisions).values(row).run())).toBe(
      "CHECK constraint failed: mainline_revisions_source_enum",
    );
  });

  it("在哪一轮要是轮次表里有的", async () => {
    const db = await twoProjects();
    const row = { ...revision("a", 1), roundId: 99 };
    expect(sqliteError(() => db.insert(mainlineRevisions).values(row).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });
});

describe("场景表", () => {
  it("同一项目里场景编号不重复", async () => {
    const db = await twoProjects();
    db.insert(mainlineRevisions).values(revision("a", 1)).run();
    db.insert(scenes).values(scene).run();
    expect(sqliteError(() => db.insert(scenes).values(scene).run())).toBe(
      "UNIQUE constraint failed: scenes.project_id, scenes.number",
    );
  });

  it("首次出现、最近一次出现和不见的版本，都要是同一个项目的主线版本", async () => {
    const db = await twoProjects();
    db.insert(mainlineRevisions).values(revision("a", 1)).run();
    db.insert(mainlineRevisions).values(revision("b", 2)).run();
    for (const bad of [
      { firstRevision: 2, latestRevision: 2 },
      { latestRevision: 2 },
      { removedInRevision: 2 },
    ]) {
      expect(
        sqliteError(() =>
          db
            .insert(scenes)
            .values({ ...scene, ...bad })
            .run(),
        ),
      ).toBe("FOREIGN KEY constraint failed");
    }
  });

  it("首次出现不晚于最近一次出现，不见的那一版在最近一次出现以后", async () => {
    const db = await twoProjects();
    for (const n of [1, 2, 3]) db.insert(mainlineRevisions).values(revision("a", n)).run();
    const later = { ...scene, firstRevision: 2, latestRevision: 1 };
    expect(sqliteError(() => db.insert(scenes).values(later).run())).toBe(
      "CHECK constraint failed: scenes_first_latest",
    );
    const early = { ...scene, latestRevision: 2, removedInRevision: 2 };
    expect(sqliteError(() => db.insert(scenes).values(early).run())).toBe(
      "CHECK constraint failed: scenes_removed_after_latest",
    );
    db.insert(scenes)
      .values({ ...scene, latestRevision: 2, removedInRevision: 3 })
      .run();
  });
});
