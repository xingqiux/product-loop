import type { RepoKind } from "@product-loop/model";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { productVersions, projectRoots, projects } from "./projects.ts";

const at = new Date("2026-09-28T08:00:00Z");

describe("项目和产品版本", () => {
  it("同一个项目最多一版没结束，结束以后才能开下一版", async () => {
    const { db } = await openTempDatabase(tempHome());
    db.insert(projects).values({ id: "a", name: "甲", repoKind: "own", createdAt: at }).run();
    const version = (n: number) => ({
      projectId: "a",
      version: n,
      status: "open" as const,
      startedAt: at,
    });
    db.insert(productVersions).values(version(1)).run();
    expect(sqliteError(() => db.insert(productVersions).values(version(2)).run())).toBe(
      "UNIQUE constraint failed: product_versions.project_id",
    );
    db.update(productVersions)
      .set({ status: "closed", endedAt: at })
      .where(and(eq(productVersions.projectId, "a"), eq(productVersions.version, 1)))
      .run();
    db.insert(productVersions).values(version(2)).run();
  });

  it("同一个目录只能登记给一个项目", async () => {
    const { db } = await openTempDatabase(tempHome());
    for (const id of ["a", "b"]) {
      db.insert(projects).values({ id, name: id, repoKind: "shared", createdAt: at }).run();
    }
    db.insert(projectRoots).values({ projectId: "a", path: "/work/app", addedAt: at }).run();
    db.insert(projectRoots).values({ projectId: "a", path: "/work/app-2", addedAt: at }).run();
    expect(
      sqliteError(() =>
        db.insert(projectRoots).values({ projectId: "b", path: "/work/app", addedAt: at }).run(),
      ),
    ).toBe("UNIQUE constraint failed: project_roots.path");
  });

  it("仓库类别写成中文标签时被检查约束拒绝", async () => {
    const { db } = await openTempDatabase(tempHome());
    const row = { id: "a", name: "甲", repoKind: "自己的" as RepoKind, createdAt: at };
    expect(sqliteError(() => db.insert(projects).values(row).run())).toBe(
      "CHECK constraint failed: projects_repo_kind_enum",
    );
  });
});
