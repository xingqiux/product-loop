import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  ensureDailySnapshot,
  listSnapshots,
  previewRestore,
  prunePreMigrationSnapshots,
  restoreHealth,
  restoreSnapshot,
  snapshotFailure,
  snapshotIssue,
  snapshotRunning,
  takeManualSnapshot,
} from "./backup.ts";
import { type Db, migratePending } from "./db.ts";
import { projects } from "./schema/index.ts";
import { migrationsFolder, openTempDatabase, tempHome } from "./testing.ts";

/** 2026 年 9 月某一天的北京时间。快照按北京时间的日期分天，用北京时间构造，结果不随本机时区变。 */
const onSeptember = (day: number, hour = 9) => new Date(Date.UTC(2026, 8, day, hour - 8));

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** 临时的集中存储，数据库里有一个项目。 */
async function storeWithProject() {
  const paths = tempHome();
  const opened = await openTempDatabase(paths);
  addProject(opened.db, "demo");
  return { paths, opened, options: { sqlite: opened.sqlite, backupsDir: paths.dirs.backups } };
}

function addProject(db: Db, id: string): void {
  db.insert(projects).values({ id, name: id, repoKind: "own", createdAt: new Date() }).run();
}

/** 以只读方式读出快照里的项目编号。 */
function projectIds(file: string): unknown[] {
  const copy = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return copy.prepare("select id from projects order by id").pluck().all();
  } finally {
    copy.close();
  }
}

/** 每轮事件循环查一次条件，直到满足。查满一千次仍不满足就报错。 */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("等了一千轮事件循环，条件仍不满足");
}

/**
 * 让索引和表对不上：把索引的定义从 body 列改成 n 列，索引里存的内容不变。
 * 完整的 integrity_check 查得出来，quick_check 查不出来。
 */
function breakIndex(sqlite: Database.Database): void {
  sqlite.exec("create table notes (n integer, body text); create index notes_body on notes (body)");
  sqlite.exec("insert into notes values (1, '一'), (2, '二'), (3, '三')");
  sqlite.unsafeMode(true);
  sqlite.pragma("writable_schema = ON");
  sqlite
    .prepare("update sqlite_schema set sql = ? where name = 'notes_body'")
    .run("CREATE INDEX notes_body ON notes (n)");
  sqlite.pragma("writable_schema = OFF");
  sqlite.unsafeMode(false);
}

describe("每日快照", () => {
  it("当天第一次写入之前做一份快照，同一天再调用不再做", async () => {
    const { paths, opened, options } = await storeWithProject();
    const file = join(paths.dirs.backups, "daily-2026-09-28.db");

    expect(await ensureDailySnapshot(options, onSeptember(28, 9))).toEqual({
      ok: true,
      value: { file, taken: true, removed: [] },
    });
    const hash = sha256(file);

    // 快照以后的写入不在快照里，同一天再调用也不再做快照。
    addProject(opened.db, "later");
    expect(await ensureDailySnapshot(options, onSeptember(28, 18))).toEqual({
      ok: true,
      value: { file, taken: false, removed: [] },
    });
    expect(sha256(file)).toBe(hash);
    expect(projectIds(file)).toEqual(["demo"]);
  });

  it("快照只有一个文件，是回滚日志模式，只读打开以后旁边不留别的文件", async () => {
    const { paths, options } = await storeWithProject();
    await ensureDailySnapshot(options, onSeptember(28));
    const file = join(paths.dirs.backups, "daily-2026-09-28.db");

    const copy = new Database(file, { readonly: true, fileMustExist: true });
    expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
    expect(readdirSync(paths.dirs.backups)).toEqual(["daily-2026-09-28.db"]);
  });

  it("第二天第一次写入之前再做一份", async () => {
    const { paths, opened, options } = await storeWithProject();
    await ensureDailySnapshot(options, onSeptember(28, 23));
    addProject(opened.db, "later");

    const next = await ensureDailySnapshot(options, onSeptember(29, 0));
    expect(next).toMatchObject({ ok: true, value: { taken: true } });
    expect(readdirSync(paths.dirs.backups).sort()).toEqual([
      "daily-2026-09-28.db",
      "daily-2026-09-29.db",
    ]);
    expect(projectIds(join(paths.dirs.backups, "daily-2026-09-29.db"))).toEqual(["demo", "later"]);
  });

  it("同时来的几次调用共用一次快照", async () => {
    const { options } = await storeWithProject();
    const backup = vi.spyOn(options.sqlite, "backup");

    const results = await Promise.all([
      ensureDailySnapshot(options, onSeptember(28, 9)),
      ensureDailySnapshot(options, onSeptember(28, 10)),
      ensureDailySnapshot(options, onSeptember(28, 11)),
    ]);
    expect(backup).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toMatchObject({ ok: true, value: { taken: true } });
  });

  it("跨过零点时昨天的快照还在做，先等它做完，再做今天的", async () => {
    const { paths, options } = await storeWithProject();
    const yesterday = ensureDailySnapshot(options, onSeptember(28, 23));
    // 等到昨天的快照已经写在磁盘上、还没改名时，今天的第一次写入到了。
    await until(() => existsSync(join(paths.dirs.backups, "daily-2026-09-28.db.partial")));
    const today = ensureDailySnapshot(options, onSeptember(29, 0));

    expect(await yesterday).toMatchObject({ ok: true, value: { taken: true } });
    expect(await today).toMatchObject({ ok: true, value: { taken: true } });
    expect(readdirSync(paths.dirs.backups).sort()).toEqual([
      "daily-2026-09-28.db",
      "daily-2026-09-29.db",
    ]);
  });

  it("做快照期间 snapshotRunning 为真，做完为假", async () => {
    const { options } = await storeWithProject();
    const pending = ensureDailySnapshot(options, onSeptember(28));
    expect(snapshotRunning(options.backupsDir)).toBe(true);
    await pending;
    expect(snapshotRunning(options.backupsDir)).toBe(false);
  });

  it("以只读方式打开快照，做完整的 integrity_check，不用 quick_check", async () => {
    const { paths, options } = await storeWithProject();
    const prepare = vi.spyOn(Database.prototype, "prepare");
    onTestFinished(() => {
      prepare.mockRestore();
    });

    await ensureDailySnapshot(options, onSeptember(28));
    const sqls = prepare.mock.calls.map(([sql]) => sql);
    // 每次调用 prepare 时的 this，就是发出这条语句的连接。
    const connections = prepare.mock.contexts as Database.Database[];
    const checks = connections.filter((_, i) => /integrity_check/u.test(sqls[i] ?? ""));
    expect(checks).toHaveLength(1);
    // 检查的是改名之前的 .partial，通过了才改成正式的名字。
    expect(checks[0]?.readonly).toBe(true);
    expect(checks[0]?.name).toBe(join(paths.dirs.backups, "daily-2026-09-28.db.partial"));
    expect(sqls.filter((sql) => /quick_check/u.test(sql))).toEqual([]);
  });

  it("完整性检查不通过时删掉快照并返回错误，以前的快照都不动", async () => {
    const { paths, opened, options } = await storeWithProject();
    const dir = paths.dirs.backups;
    writeFileSync(join(dir, "daily-2026-09-27.db"), "昨天的快照");
    writeFileSync(join(dir, "pre-migration-20260901T000000000Z.db"), "迁移前的快照");
    breakIndex(opened.sqlite);

    // quick_check 查不出这种问题，所以一定要用 integrity_check。
    const reader = new Database(paths.database, { readonly: true, fileMustExist: true });
    expect(reader.pragma("quick_check", { simple: true })).toBe("ok");
    reader.close();

    const result = await ensureDailySnapshot(options, onSeptember(28));
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "snapshotCorrupt",
        file: join(dir, "daily-2026-09-28.db"),
        problems: [1, 2, 3].map((row) => `row ${row} missing from index notes_body`),
      },
    });
    expect(readdirSync(dir).sort()).toEqual([
      "daily-2026-09-27.db",
      "pre-migration-20260901T000000000Z.db",
    ]);
  });

  it("失败以后同一天不再重试，第二天再做", async () => {
    const { opened, options } = await storeWithProject();
    breakIndex(opened.sqlite);
    const backup = vi.spyOn(options.sqlite, "backup");

    const first = await ensureDailySnapshot(options, onSeptember(28, 9));
    expect(await ensureDailySnapshot(options, onSeptember(28, 18))).toBe(first);
    expect(backup).toHaveBeenCalledTimes(1);

    await ensureDailySnapshot(options, onSeptember(29, 9));
    expect(backup).toHaveBeenCalledTimes(2);
  });

  it("做快照出错时返回错误，不抛出", async () => {
    const { paths, options } = await storeWithProject();
    rmSync(paths.dirs.backups, { recursive: true });

    const result = await ensureDailySnapshot(options, onSeptember(28));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "snapshotFailed", file: join(paths.dirs.backups, "daily-2026-09-28.db") },
    });
    expect(snapshotRunning(options.backupsDir)).toBe(false);
  });

  it("snapshotFailure 只报今天失败的那一次，自己不做快照", async () => {
    const { opened, options } = await storeWithProject();
    const dir = options.backupsDir;
    const backup = vi.spyOn(options.sqlite, "backup");
    expect(snapshotFailure(dir, onSeptember(27))).toBeUndefined();

    // 做成了就没有错误。
    await ensureDailySnapshot(options, onSeptember(27));
    expect(snapshotFailure(dir, onSeptember(27, 18))).toBeUndefined();

    breakIndex(opened.sqlite);
    const failed = await ensureDailySnapshot(options, onSeptember(28));
    expect(failed.ok).toBe(false);
    expect({ ok: false, error: snapshotFailure(dir, onSeptember(28, 18)) }).toEqual(failed);
    // 第二天还没做快照，不报昨天的错误。
    expect(snapshotFailure(dir, onSeptember(29))).toBeUndefined();
    expect(backup).toHaveBeenCalledTimes(2);
  });
});

describe("每日快照的轮换", () => {
  it("只留最近十四份每日快照，迁移前的快照和别的文件不动", async () => {
    const { paths, options } = await storeWithProject();
    const dir = paths.dirs.backups;
    const days = Array.from({ length: 20 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    for (const day of days) writeFileSync(join(dir, `daily-${day}.db`), day);
    const others = [
      "pre-migration-20260801T000000000Z.db",
      "pre-migration-20260901T000000000Z.db",
      "说明.txt",
    ];
    for (const name of others) writeFileSync(join(dir, name), name);
    // 上一次做到一半留下的文件，开始做新的快照时删掉。
    writeFileSync(join(dir, "daily-2026-09-20.db.partial"), "");
    writeFileSync(join(dir, "daily-2026-09-20.db.partial-journal"), "");

    const result = await ensureDailySnapshot(options, onSeptember(28));
    const oldest = days.slice(0, 7).reverse();
    expect(result).toEqual({
      ok: true,
      value: {
        file: join(dir, "daily-2026-09-28.db"),
        taken: true,
        removed: oldest.map((day) => join(dir, `daily-${day}.db`)),
      },
    });
    const kept = listSnapshots(dir).daily.map((snapshot) => snapshot.when);
    expect(kept).toEqual(["2026-09-28", ...days.slice(7).reverse()]);
    expect(kept).toHaveLength(14);
    expect(readdirSync(dir)).toEqual(expect.arrayContaining(others));
    expect(readdirSync(dir).filter((name) => name.includes(".partial"))).toEqual([]);
  });

  it("时钟往回拨过时，刚做的快照也留下", async () => {
    const { paths, options } = await storeWithProject();
    const dir = paths.dirs.backups;
    const later = Array.from({ length: 14 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    for (const day of later) writeFileSync(join(dir, `daily-${day}.db`), day);

    const result = await ensureDailySnapshot(options, onSeptember(28));
    expect(result).toMatchObject({
      ok: true,
      value: { removed: [join(dir, "daily-2026-10-01.db")] },
    });
    const kept = listSnapshots(dir).daily.map((snapshot) => snapshot.when);
    expect(kept).toHaveLength(14);
    expect(kept).toContain("2026-09-28");
  });
});

describe("快照的列表", () => {
  it("按文件名认出四种快照，新的在前，别的文件不算", () => {
    const dir = tempHome().dirs.backups;
    const names = [
      "daily-2026-09-27.db",
      "daily-2026-09-28.db",
      "daily-2026-09-28.db.partial",
      "daily-2026-9-29.db",
      "pre-migration-20260901T000000000Z.db",
      "pre-migration-20260928T015100123Z.db",
      "pre-migration-2026.db",
      "manual-20260928T080500123Z.db",
      "pre-restore-20260928T090000000Z.db",
      "说明.txt",
    ];
    for (const name of names) writeFileSync(join(dir, name), name);

    expect(listSnapshots(dir)).toEqual({
      daily: [
        { name: "daily-2026-09-28.db", file: join(dir, "daily-2026-09-28.db"), when: "2026-09-28" },
        { name: "daily-2026-09-27.db", file: join(dir, "daily-2026-09-27.db"), when: "2026-09-27" },
      ],
      preMigration: [
        {
          name: "pre-migration-20260928T015100123Z.db",
          file: join(dir, "pre-migration-20260928T015100123Z.db"),
          when: "20260928T015100123Z",
        },
        {
          name: "pre-migration-20260901T000000000Z.db",
          file: join(dir, "pre-migration-20260901T000000000Z.db"),
          when: "20260901T000000000Z",
        },
      ],
      manual: [
        {
          name: "manual-20260928T080500123Z.db",
          file: join(dir, "manual-20260928T080500123Z.db"),
          when: "20260928T080500123Z",
        },
      ],
      preRestore: [
        {
          name: "pre-restore-20260928T090000000Z.db",
          file: join(dir, "pre-restore-20260928T090000000Z.db"),
          when: "20260928T090000000Z",
        },
      ],
    });
  });
});

describe("迁移前的快照", () => {
  const older = "pre-migration-20260801T000000000Z.db";
  const previous = "pre-migration-20260901T000000000Z.db";
  const current = "pre-migration-20260928T015100123Z.db";

  it("升级做完以后只留这一次迁移前的快照，每日快照不动", () => {
    const dir = tempHome().dirs.backups;
    for (const name of [older, previous, current, "daily-2026-09-27.db"]) {
      writeFileSync(join(dir, name), name);
    }

    expect(prunePreMigrationSnapshots(dir, join(dir, current))).toEqual([
      join(dir, previous),
      join(dir, older),
    ]);
    expect(readdirSync(dir).sort()).toEqual(["daily-2026-09-27.db", current]);
  });

  it("要留的快照不在 backups/ 里时什么都不删", () => {
    const dir = tempHome().dirs.backups;
    for (const name of [older, previous]) writeFileSync(join(dir, name), name);

    expect(prunePreMigrationSnapshots(dir, join(dir, current))).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([older, previous]);
  });
});

describe("每日快照按北京时间分天", () => {
  it("UTC 的 9 月 27 日 17 点已经是北京时间 28 日 1 点，快照记在 28 日", async () => {
    const { paths, options } = await storeWithProject();
    const taken = await ensureDailySnapshot(options, new Date("2026-09-27T17:00:00.000Z"));
    expect(taken).toMatchObject({ ok: true, value: { taken: true } });
    expect(listSnapshots(paths.dirs.backups).daily.map((s) => s.name)).toEqual([
      "daily-2026-09-28.db",
    ]);
  });
});

describe("快照的警告", () => {
  const file = "/Users/someone/.product-loop/backups/daily-2026-09-28.db";

  it("没做成时写出报错，提示检查 backups/", () => {
    expect(
      snapshotIssue({ kind: "snapshotFailed", file, message: "database or disk is full" }),
    ).toEqual({
      message: "今天的数据库快照没有做成，报错是：database or disk is full",
      hint: "检查磁盘空间和 /Users/someone/.product-loop/backups 的写入权限，再运行 ploop backup now。",
    });
  });

  it("完整性检查不通过时写出问题的个数和第一处", () => {
    const problems = ["row 1 missing from index notes_body", "row 2 missing from index notes_body"];
    expect(snapshotIssue({ kind: "snapshotCorrupt", file, problems })).toEqual({
      message:
        "今天的数据库快照没有通过完整性检查，共 2 处问题，已删除。第一处是：row 1 missing from index notes_body",
      hint: "运行 ploop backup now 再试一次。仍不通过时，以前的快照在 /Users/someone/.product-loop/backups。",
    });
  });
});

describe("手动快照和恢复", () => {
  it("手动快照查过完整性，列在 manual 里，不参与每日的轮换", async () => {
    const { paths, options } = await storeWithProject();
    const taken = await takeManualSnapshot(options, new Date("2026-09-28T08:05:00.123Z"));
    const file = join(paths.dirs.backups, "manual-20260928T080500123Z.db");
    expect(taken).toEqual({ ok: true, value: file });
    expect(projectIds(file)).toEqual(["demo"]);
    expect(listSnapshots(paths.dirs.backups).manual.map((s) => s.name)).toEqual([
      "manual-20260928T080500123Z.db",
    ]);
  });

  it("恢复：先留存当前的数据库，再放回快照，后端的连接随即读到快照的内容", async () => {
    const { paths, opened, options } = await storeWithProject();
    await takeManualSnapshot(options, new Date("2026-09-28T08:00:00.000Z"));
    addProject(opened.db, "later");
    const restored = await restoreSnapshot(
      {
        ...options,
        databaseFile: paths.database,
        migrate: () => migratePending(opened.sqlite, opened.db, migrationsFolder),
      },
      "manual-20260928T080000000Z.db",
      new Date("2026-09-28T09:00:00.000Z"),
    );
    if (!restored.ok) throw new Error(restored.error.kind);
    expect(restored.value.migrated).toBe(0);
    const ids = opened.sqlite.prepare("select id from projects order by id").pluck().all();
    expect(ids).toEqual(["demo"]);
    expect(projectIds(restored.value.kept)).toEqual(["demo", "later"]);
    expect(restoreHealth(opened.sqlite)).toEqual([]);
    // 恢复以后照常能写。
    addProject(opened.db, "after");
    expect(opened.sqlite.prepare("select count(*) from projects").pluck().get()).toBe(2);
  });

  it("快照的名字不在 backups/ 里，返回 notFound，不动当前的数据库", async () => {
    const { paths, opened, options } = await storeWithProject();
    const restored = await restoreSnapshot(
      { ...options, databaseFile: paths.database, migrate: () => 0 },
      "daily-2020-01-01.db",
      new Date(),
    );
    expect(restored).toEqual({
      ok: false,
      error: { kind: "notFound", name: "daily-2020-01-01.db" },
    });
    expect(opened.sqlite.prepare("select id from projects").pluck().all()).toEqual(["demo"]);
    expect(listSnapshots(paths.dirs.backups).preRestore).toEqual([]);
  });

  it("恢复之前的预览：列出快照里登记的项目，不改任何文件（N17）", async () => {
    const { paths, opened, options } = await storeWithProject();
    await takeManualSnapshot(options, new Date("2026-09-28T08:00:00.000Z"));
    addProject(opened.db, "later");
    const before = readdirSync(paths.dirs.backups).sort();
    expect(previewRestore(options, "manual-20260928T080000000Z.db")).toEqual({
      ok: true,
      value: { snapshot: "manual-20260928T080000000Z.db", projects: ["demo"] },
    });
    expect(readdirSync(paths.dirs.backups).sort()).toEqual(before);
    expect(opened.sqlite.prepare("select id from projects order by id").pluck().all()).toEqual([
      "demo",
      "later",
    ]);
    expect(previewRestore(options, "daily-2020-01-01.db")).toEqual({
      ok: false,
      error: { kind: "notFound", name: "daily-2020-01-01.db" },
    });
  });
});
