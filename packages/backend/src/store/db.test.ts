import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase } from "./db.ts";
import { projects } from "./schema/index.ts";
import { migrationsFolder, openTempDatabase, tempDir, tempHome } from "./testing.ts";

type Journal = {
  version: string;
  dialect: string;
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};

const readJournal = (folder: string): Journal =>
  JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));

/**
 * 在临时目录里拼一个迁移文件夹：复制 base（不写就从空的开始），再依次追加迁移。
 * 追加的迁移比前一个晚一秒生成，用来模拟更新版本的程序。
 */
function migrationsWith(extra: readonly { tag: string; sql: string }[], base?: string): string {
  const folder = tempDir("ploop-migrations-");
  if (base !== undefined) cpSync(base, folder, { recursive: true });
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal: Journal =
    base === undefined ? { version: "7", dialect: "sqlite", entries: [] } : readJournal(base);
  for (const { tag, sql } of extra) {
    const when = (journal.entries.at(-1)?.when ?? 0) + 1000;
    journal.entries.push({
      idx: journal.entries.length,
      version: "6",
      when,
      tag,
      breakpoints: true,
    });
    writeFileSync(join(folder, `${tag}.sql`), sql);
  }
  writeFileSync(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
  return folder;
}

/** 更新版本的程序多带的一个迁移。 */
const addNotes = { tag: "0999_add_notes", sql: "CREATE TABLE `notes` (`id` integer PRIMARY KEY);" };

const sha256 = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("打开数据库", () => {
  it("迁移执行完，几张表都在，日志模式是 wal，外键和 busy_timeout 已设好", async () => {
    const { sqlite, migrated } = await openTempDatabase(tempHome());
    const tables = sqlite
      .prepare("select name from sqlite_master where type = 'table'")
      .pluck()
      .all();
    expect(tables).toEqual(
      expect.arrayContaining([
        "__drizzle_migrations",
        "projects",
        "project_roots",
        "product_versions",
        "rounds",
      ]),
    );
    expect(sqlite.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(sqlite.pragma("busy_timeout", { simple: true })).toBe(5000);
    expect(migrated).toBe(readJournal(migrationsFolder).entries.length);
  });

  it("新建的数据库是空的，迁移前不做快照", async () => {
    const paths = tempHome();
    const { snapshot } = await openTempDatabase(paths);
    expect(snapshot).toBeUndefined();
    expect(readdirSync(paths.dirs.backups)).toEqual([]);
  });

  it("有待执行的迁移时，先在 backups/ 做一份快照，快照能以只读方式打开", async () => {
    const paths = tempHome();
    const first = await openTempDatabase(paths);
    first.db
      .insert(projects)
      .values({ id: "demo", name: "演示", repoKind: "own", createdAt: new Date() })
      .run();
    first.sqlite.close();

    const second = await openTempDatabase(paths, migrationsWith([addNotes], migrationsFolder));
    expect(second.migrated).toBe(1);
    const snapshot = second.snapshot ?? "没有快照";
    expect(basename(snapshot)).toMatch(/^pre-migration-\d{8}T\d{9}Z\.db$/);
    expect(readdirSync(paths.dirs.backups)).toEqual([basename(snapshot)]);

    // 快照是迁移前的样子：原来的数据都在，新加的表还没有。
    const copy = new Database(snapshot, { readonly: true, fileMustExist: true });
    expect(copy.prepare("select id from projects").pluck().all()).toEqual(["demo"]);
    expect(
      copy.prepare("select name from sqlite_master where name = 'notes'").get(),
    ).toBeUndefined();
    expect(copy.pragma("integrity_check", { simple: true })).toBe("ok");
    copy.close();
    // 快照只有一个文件，只读打开以后旁边没有留下 -wal 和 -shm。
    expect(readdirSync(paths.dirs.backups)).toEqual([basename(snapshot)]);
  });

  it("没有待执行的迁移时不做快照", async () => {
    const paths = tempHome();
    const newer = migrationsWith([addNotes], migrationsFolder);
    (await openTempDatabase(paths)).sqlite.close();
    (await openTempDatabase(paths, newer)).sqlite.close();
    const backups = readdirSync(paths.dirs.backups);

    const again = await openTempDatabase(paths, newer);
    expect(again.migrated).toBe(0);
    expect(again.snapshot).toBeUndefined();
    expect(readdirSync(paths.dirs.backups)).toEqual(backups);
  });

  it("数据库比程序新时返回 dbNewer，数据库一个字节都没改", async () => {
    const paths = tempHome();
    const newer = migrationsWith([addNotes], migrationsFolder);
    (await openTempDatabase(paths, newer)).sqlite.close();
    const before = sha256(paths.database);

    // 旧程序的 journal 比新程序的少最后一个迁移。
    const result = await openDatabase({
      file: paths.database,
      migrationsFolder,
      backupsDir: paths.dirs.backups,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        kind: "dbNewer",
        databaseLatest: readJournal(newer).entries.at(-1)?.when,
        appLatest: readJournal(migrationsFolder).entries.at(-1)?.when,
      },
    });
    expect(sha256(paths.database)).toBe(before);
    expect(readdirSync(paths.dirs.data)).toEqual(["ploop.db"]);
    expect(readdirSync(paths.dirs.backups)).toEqual([]);
  });
});

describe("迁移期间关掉外键", () => {
  const parentAndChild = {
    tag: "0000_parent_and_child",
    sql: [
      "CREATE TABLE `parent` (`id` integer PRIMARY KEY);",
      "CREATE TABLE `child` (`id` integer PRIMARY KEY, `parent_id` integer NOT NULL REFERENCES `parent`(`id`));",
      "INSERT INTO `parent` VALUES (1);",
      "INSERT INTO `child` VALUES (1, 1);",
    ].join("\n--> statement-breakpoint\n"),
  };

  it("照 drizzle-kit 的做法重建被引用的表：迁移能执行，数据还在，之后外键照常检查", async () => {
    const recreateParent = {
      tag: "0001_recreate_parent",
      sql: [
        "PRAGMA foreign_keys=OFF;",
        "CREATE TABLE `__new_parent` (`id` integer PRIMARY KEY, `note` text);",
        "INSERT INTO `__new_parent`(`id`) SELECT `id` FROM `parent`;",
        "DROP TABLE `parent`;",
        "ALTER TABLE `__new_parent` RENAME TO `parent`;",
        "PRAGMA foreign_keys=ON;",
      ].join("\n--> statement-breakpoint\n"),
    };
    const { sqlite } = await openTempDatabase(
      tempHome(),
      migrationsWith([parentAndChild, recreateParent]),
    );
    expect(sqlite.prepare("select parent_id from child").pluck().all()).toEqual([1]);
    expect(() => sqlite.prepare("insert into child values (2, 99)").run()).toThrow(
      "FOREIGN KEY constraint failed",
    );
  });

  it("迁移留下对不上的外键时报错", async () => {
    const orphan = { tag: "0001_orphan", sql: "INSERT INTO `child` VALUES (2, 99);" };
    await expect(
      openTempDatabase(tempHome(), migrationsWith([parentAndChild, orphan])),
    ).rejects.toThrow("外键对不上");
  });
});
