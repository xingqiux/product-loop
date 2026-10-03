import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type BlobHash, blobRefs, blobs, pages, rounds } from "../store/schema/index.ts";
import { tempDir } from "../store/testing.ts";
import { presentPage } from "./pages/present.ts";
import { deps, landRound, pageData, presentInput, succeed } from "./pages/testing.ts";
import { storageUsage } from "./storage.ts";
import { addProject } from "./testing.ts";

// 集中存储的占用：附件按引用它的对象归到项目，合计里每个附件只算一次，数据库只给合计。

const hash = (digit: string) => digit.repeat(64) as BlobHash;

describe("集中存储的占用", () => {
  it("页面引用的附件归到页面的项目，同一个附件在一个项目里只算一次", async () => {
    const core = await landRound();
    const data = pageData();
    const change = { ...data.changes[0], before: { img: "img/home.png" } };
    succeed(presentPage(core.ctx, "app", presentInput({ ...data, changes: [change] }), deps));
    addProject(core, "/work/other");
    const usage = storageUsage(core.ctx.db, join(tempDir("storage"), "ploop.db"));
    expect(usage.projects).toEqual([
      { project: "app", name: "app", blobs: { count: 2, bytes: 2 } },
      { project: "other", name: "other", blobs: { count: 0, bytes: 0 } },
    ]);
    expect(usage.blobs).toEqual({ count: 2, bytes: 2 });
    expect(usage.unreferenced).toEqual({ count: 0, bytes: 0 });
    expect(usage.database).toEqual({ bytes: 0 });
  });

  it("没有引用的附件单独统计。两个项目都引用的附件，各算一次，合计只算一次", async () => {
    const core = await landRound();
    const presented = succeed(presentPage(core.ctx, "app", presentInput(pageData()), deps));
    addProject(core, "/work/other");
    const { db } = core.ctx;
    const at = core.ctx.now();
    db.insert(blobs)
      .values({
        hash: hash("f"),
        contentType: "image/png",
        size: 5,
        createdAt: at,
        firstSource: "测试",
      })
      .run();
    // 另一个项目的旧页面引用了同一张图。页面直接写在库里，只为了有一条引用。
    const row = db.select().from(pages).get();
    if (row === undefined) throw new Error("应当有一页");
    const { id: _, ...copy } = row;
    const other = db
      .insert(pages)
      .values({ ...copy, projectId: "other", seq: 9, status: "withdrawn", withdrawnAt: at })
      .returning()
      .get();
    db.insert(blobRefs)
      .values({
        blobHash: hash("a"),
        referrerKind: "page",
        referrerId: String(other.id),
        purpose: "img",
      })
      .run();
    const usage = storageUsage(db, join(tempDir("storage"), "ploop.db"));
    expect(presented.page.project).toBe("app");
    expect(usage.projects.map((p) => [p.project, p.blobs])).toEqual([
      ["app", { count: 2, bytes: 2 }],
      ["other", { count: 1, bytes: 1 }],
    ]);
    expect(usage.blobs).toEqual({ count: 3, bytes: 7 });
    expect(usage.unreferenced).toEqual({ count: 1, bytes: 5 });
  });

  it("阶段引用的附件归到阶段的项目，例如迁移进来的旧截图", async () => {
    const core = await landRound();
    const { db } = core.ctx;
    const round = db.select({ id: rounds.id }).from(rounds).get();
    if (round === undefined) throw new Error("应当有一轮");
    db.insert(blobRefs)
      .values({
        blobHash: hash("c"),
        referrerKind: "round",
        referrerId: String(round.id),
        purpose: "img",
      })
      .run();
    const usage = storageUsage(db, join(tempDir("storage"), "ploop.db"));
    expect(usage.projects).toEqual([
      { project: "app", name: "app", blobs: { count: 1, bytes: 1 } },
    ]);
    expect(usage.unreferenced).toEqual({ count: 1, bytes: 1 });
  });

  it("数据库的字节数含 -wal 和 -shm 两个文件", async () => {
    const core = await landRound();
    const file = join(tempDir("storage"), "ploop.db");
    writeFileSync(file, "12345");
    writeFileSync(`${file}-wal`, "12");
    writeFileSync(`${file}-shm`, "1");
    expect(storageUsage(core.ctx.db, file).database).toEqual({ bytes: 8 });
  });
});
