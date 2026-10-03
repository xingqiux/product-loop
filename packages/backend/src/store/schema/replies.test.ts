import { describe, expect, it } from "vitest";
import { migrationsBefore, openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { pages } from "./pages.ts";
import { productVersions, projects } from "./projects.ts";
import { queueItems } from "./queue.ts";
import { replyLines, submissions } from "./replies.ts";
import { rounds } from "./rounds.ts";

const at = new Date("2026-09-28T08:00:00Z");

/** 项目 app 开着一轮落地，给出了一页，队列里有 Q1。 */
async function openDb() {
  return seed((await openTempDatabase(tempHome())).db);
}

type Db = Awaited<ReturnType<typeof openTempDatabase>>["db"];

/**
 * 摆好项目、一轮和一页，队列里有 Q1。旧库里队列事项的表还没有后来加的列，
 * 用 rawQueue 写一行：传进旧库的原始连接，这一行按当时的列直接写。
 */
function seed(
  db: Db,
  rawQueue?: { prepare(sql: string): { run(...args: unknown[]): unknown } },
): Db {
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
      status: "waiting",
      startedAt: at,
    })
    .run();
  db.insert(pages)
    .values({
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
    })
    .run();
  if (rawQueue !== undefined) {
    rawQueue
      .prepare(
        `insert into queue_items (project_id, number, content, stage, proposer, created_at, status, sub_items, edit_count)
         values ('app', 1, '看板放到首页', 'land', 'ai', ?, 'todo', '[]', 0)`,
      )
      .run(at.getTime());
    return db;
  }
  db.insert(queueItems)
    .values({
      projectId: "app",
      number: 1,
      content: "看板放到首页",
      stage: "land",
      proposer: "ai",
      createdAt: at,
      status: "todo",
      subItems: [],
      editCount: 0,
    })
    .run();
  return db;
}

const submission = {
  projectId: "app",
  pageId: 1,
  source: "legacyTemplate",
  submittedAt: at,
  text: "落地第 1 轮\n疑问 1a",
} as const;

const line = {
  submissionId: 1,
  line: 1,
  projectId: "app",
  kind: "agree",
  images: [],
  imagesRead: false,
} as const;

describe("回复和回复的一行的表", () => {
  it("一页只有一份回复，文字和结构化内容只存一样", async () => {
    const db = await openDb();
    expect(
      sqliteError(() =>
        db
          .insert(submissions)
          .values({ ...submission, text: null })
          .run(),
      ),
    ).toBe("CHECK constraint failed: submissions_body");
    expect(
      sqliteError(() =>
        db
          .insert(submissions)
          .values({ ...submission, content: [] })
          .run(),
      ),
    ).toBe("CHECK constraint failed: submissions_body");
    db.insert(submissions).values(submission).run();
    expect(sqliteError(() => db.insert(submissions).values(submission).run())).toBe(
      "UNIQUE constraint failed: submissions.page_id",
    );
  });

  it("选了选项写选项，想法写备注，取消队列事项写是哪一件，那一件要在队列里", async () => {
    const db = await openDb();
    db.insert(submissions).values(submission).run();
    const bad = (values: Record<string, unknown>) =>
      sqliteError(() =>
        db
          .insert(replyLines)
          .values({ ...line, ...values })
          .run(),
      );
    expect(bad({ kind: "option" })).toBe("CHECK constraint failed: reply_lines_option");
    expect(bad({ kind: "idea" })).toBe("CHECK constraint failed: reply_lines_note");
    expect(bad({ kind: "queueDrop" })).toBe("CHECK constraint failed: reply_lines_queue");
    expect(bad({ kind: "queueDrop", queue: 9 })).toBe("FOREIGN KEY constraint failed");
    expect(bad({ section: "rethink" })).toBe("CHECK constraint failed: reply_lines_section_enum");
    db.insert(replyLines)
      .values({ ...line, kind: "queueDrop", queue: 1, section: "queue" })
      .run();
  });

  it("去处、处理的时间和执行者同时有或同时没有，每种去处写它指向的东西", async () => {
    const db = await openDb();
    db.insert(submissions).values(submission).run();
    const bad = (values: Record<string, unknown>) =>
      sqliteError(() =>
        db
          .insert(replyLines)
          .values({ ...line, ...values })
          .run(),
      );
    const handled = { handledAt: at, handledBy: "后端" };
    expect(bad({ destination: "queue", toQueue: 1 })).toBe(
      "CHECK constraint failed: reply_lines_handled",
    );
    expect(bad({ destination: "queue", ...handled })).toBe(
      "CHECK constraint failed: reply_lines_to_queue",
    );
    expect(bad({ toQueue: 1 })).toBe("CHECK constraint failed: reply_lines_to_queue");
    expect(bad({ destination: "noAction", ...handled })).toBe(
      "CHECK constraint failed: reply_lines_handled_note",
    );
    expect(bad({ destination: "decision", toDecision: 3, ...handled })).toBe(
      "FOREIGN KEY constraint failed",
    );
    db.insert(replyLines)
      .values({ ...line, destination: "noAction", handledNote: "用户只是看看", ...handled })
      .run();
    db.insert(replyLines)
      .values({ ...line, line: 2, destination: "queue", toQueue: 1, ...handled })
      .run();
  });
});

describe("回复行的种类加了认可一条更改", () => {
  it("旧库里的回复行原样带过来，之后能存认可一条更改，别的种类照样拦", async () => {
    const paths = tempHome();
    const old = await openTempDatabase(paths, migrationsBefore("0016_reply-line-approved"));
    const oldDb = seed(old.db, old.sqlite);
    oldDb.insert(submissions).values(submission).run();
    expect(
      sqliteError(() =>
        oldDb
          .insert(replyLines)
          .values({ ...line, kind: "changeApproved" })
          .run(),
      ),
    ).toBe("CHECK constraint failed: reply_lines_kind_enum");
    oldDb
      .insert(replyLines)
      .values({ ...line, kind: "idea", note: "看板按阶段分列", queue: 1 })
      .run();
    old.sqlite.close();

    const next = await openTempDatabase(paths);
    // 0016 之后又有了 0017，两个迁移都要跑。
    expect(next.migrated).toBe(2);
    const db = next.db;
    expect(db.select().from(replyLines).all()).toMatchObject([
      { submissionId: 1, line: 1, kind: "idea", note: "看板按阶段分列", queue: 1 },
    ]);
    db.insert(replyLines)
      .values({ ...line, line: 2, kind: "changeApproved", section: "changes", card: "board" })
      .run();
    expect(
      sqliteError(() =>
        db
          .insert(replyLines)
          .values({ ...line, line: 3, kind: "nope" as never })
          .run(),
      ),
    ).toBe("CHECK constraint failed: reply_lines_kind_enum");
    // 外键照常检查：这一行点名的队列事项不在了就存不下。
    expect(
      sqliteError(() =>
        db
          .insert(replyLines)
          .values({ ...line, line: 4, kind: "queueDrop", queue: 9 })
          .run(),
      ),
    ).toBe("FOREIGN KEY constraint failed");
  });
});
