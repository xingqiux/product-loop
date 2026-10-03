import type { QueueStatus, Stage } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { migrationsBefore, openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { productVersions, projects } from "./projects.ts";
import { queueEvents, queueItems } from "./queue.ts";

const at = new Date("2026-09-28T08:00:00Z");

async function twoProjects(): Promise<Db> {
  const { db } = await openTempDatabase(tempHome());
  for (const id of ["a", "b"]) {
    db.insert(projects).values({ id, name: id, repoKind: "own", createdAt: at }).run();
    db.insert(productVersions)
      .values({ projectId: id, version: 1, status: "open", startedAt: at })
      .run();
  }
  return db;
}

/** 项目 a 里的第 n 件，待办，没写的格都空着。 */
const item = (n: number, projectId = "a") => ({
  projectId,
  number: n,
  content: `第 ${n} 件事`,
  stage: "land" as Stage,
  proposer: "ai" as const,
  createdAt: at,
  status: "todo" as QueueStatus,
  subItems: [],
  editCount: 0,
});

describe("队列事项表", () => {
  it("同一项目里编号不重复，换一个项目可以重复", async () => {
    const db = await twoProjects();
    db.insert(queueItems).values(item(1)).run();
    db.insert(queueItems).values(item(1, "b")).run();
    expect(sqliteError(() => db.insert(queueItems).values(item(1)).run())).toBe(
      "UNIQUE constraint failed: queue_items.project_id, queue_items.number",
    );
  });

  // 旧 check-queue.py：阶段不是五个之一也放进去了，应当拦截。
  it("阶段写成五个之外的词时被检查约束拒绝，写成中文标签也不收", async () => {
    const db = await twoProjects();
    for (const bad of ["写代码", "落地"]) {
      const row = { ...item(1), stage: bad as Stage };
      expect(sqliteError(() => db.insert(queueItems).values(row).run())).toBe(
        "CHECK constraint failed: queue_items_stage_enum",
      );
    }
  });

  // 旧 check-queue.py：状态写成了定好的取值以外的词，读的时候应当拦截。库里根本存不进去。
  it("状态写成定好的取值以外的词时被检查约束拒绝", async () => {
    const db = await twoProjects();
    const row = { ...item(1), status: "做完啦" as QueueStatus };
    expect(sqliteError(() => db.insert(queueItems).values(row).run())).toBe(
      "CHECK constraint failed: queue_items_status_enum",
    );
  });

  it.each([
    ["waiting", "dependsOn", "queue_items_waiting_depends_on"],
    ["done", "evidence", "queue_items_done_evidence"],
    ["dropped", "statusNote", "queue_items_dropped_status_note"],
  ] as const)("状态是 %s 时 %s 不能空着", async (status, field, constraint) => {
    const db = await twoProjects();
    expect(
      sqliteError(() =>
        db
          .insert(queueItems)
          .values({ ...item(1), status })
          .run(),
      ),
    ).toBe(`CHECK constraint failed: ${constraint}`);
    db.insert(queueItems)
      .values({ ...item(1), status, [field]: "写上了" })
      .run();
  });

  it("来自哪一行回复：回复的编号和行号同时有或同时没有", async () => {
    const db = await twoProjects();
    for (const half of [{ fromSubmissionId: 7 }, { fromLine: 3 }]) {
      expect(
        sqliteError(() =>
          db
            .insert(queueItems)
            .values({ ...item(1), ...half })
            .run(),
        ),
      ).toBe("CHECK constraint failed: queue_items_from_line");
    }
    db.insert(queueItems)
      .values({ ...item(1), fromSubmissionId: 7, fromLine: 3 })
      .run();
  });

  it("提出时的轮次要是轮次表里有的", async () => {
    const db = await twoProjects();
    const row = { ...item(1), proposedInRoundId: 99 };
    expect(sqliteError(() => db.insert(queueItems).values(row).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });
});

describe("队列变动表", () => {
  it("挂的事项要存在", async () => {
    const db = await twoProjects();
    const event = { itemId: 99, at, toStatus: "todo" as const, actor: "cli/2.0.0" };
    expect(sqliteError(() => db.insert(queueEvents).values(event).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });

  it("从什么状态可以空着，写了就只收英文键", async () => {
    const db = await twoProjects();
    const { id } = db.insert(queueItems).values(item(1)).returning().get();
    const event = { itemId: id, at, toStatus: "todo" as const, actor: "cli/2.0.0" };
    db.insert(queueEvents).values(event).run();
    const bad = { ...event, fromStatus: "待办" as QueueStatus };
    expect(sqliteError(() => db.insert(queueEvents).values(bad).run())).toBe(
      "CHECK constraint failed: queue_events_from_status_enum",
    );
  });
});

describe("队列事项加了备注一列", () => {
  it("旧库里的事原样带过来，备注是空的，之后能存多行的备注", async () => {
    const paths = tempHome();
    const old = await openTempDatabase(paths, migrationsBefore("0017_queue-note"));
    old.db.insert(projects).values({ id: "a", name: "a", repoKind: "own", createdAt: at }).run();
    old.db
      .insert(productVersions)
      .values({ projectId: "a", version: 1, status: "open", startedAt: at })
      .run();
    old.sqlite
      .prepare(
        `insert into queue_items (project_id, number, content, stage, proposer, created_at, status, sub_items, edit_count, acceptance)
         values ('a', 1, '看板放到首页', 'land', 'ai', ?, 'todo', '["先做等待列"]', 3, '五列')`,
      )
      .run(at.getTime());
    old.sqlite.close();

    const next = await openTempDatabase(paths);
    expect(next.migrated).toBe(1);
    const { db } = next;
    expect(db.select().from(queueItems).all()).toMatchObject([
      { number: 1, content: "看板放到首页", subItems: ["先做等待列"], editCount: 3, note: null },
    ]);
    const note = "第一行\n第二行\n".repeat(200);
    db.update(queueItems).set({ note }).run();
    expect(db.select().from(queueItems).get()?.note).toBe(note);
  });
});
