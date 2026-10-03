import { join } from "node:path";
import { err, ok, type Result } from "@product-loop/model";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { readMigrationFiles } from "drizzle-orm/migrator";
import * as schema from "./schema/index.ts";

// 打开集中存储的数据库，是后端启动的第 2 步，见「01 架构」第六节。
// 先对照迁移记录，有没执行的迁移时先做快照，再执行迁移，见「03 数据模型」第八节。

export type Db = BetterSQLite3Database<typeof schema>;

export type OpenDatabaseOptions = {
  readonly file: string;
  /** better-sqlite3 的原生文件。打包以后必须写，不写时从依赖目录里找，见「02 技术选型」第十五节。 */
  readonly nativeBinding?: string | undefined;
  /** drizzle-kit 生成的迁移文件夹，随程序一起发布。 */
  readonly migrationsFolder: string;
  /** 迁移前的快照放在这里。 */
  readonly backupsDir: string;
};

export type OpenedDatabase = {
  readonly sqlite: Database.Database;
  readonly db: Db;
  /** 这次执行了几个迁移。 */
  readonly migrated: number;
  /** 迁移前的快照。没有执行迁移，或者数据库原来是空的，就没有快照。 */
  readonly snapshot: string | undefined;
};

/** 数据库已被更新的版本迁移过，旧程序不能打开，要运行 ploop setup 安装新版本。 */
export type DbNewer = {
  readonly kind: "dbNewer";
  /** 数据库里最新一条迁移记录的生成时间，毫秒数。 */
  readonly databaseLatest: number;
  /** 程序自带的最后一个迁移的生成时间，毫秒数。没带迁移时是 0。 */
  readonly appLatest: number;
};

/** 等别的连接放开锁的最长时间，毫秒。超过就报 SQLITE_BUSY。 */
const busyTimeoutMs = 5000;

/**
 * 打开数据库，设好预写日志、外键和 busy_timeout，再执行没执行过的迁移。
 * 数据库所在的目录要先建好，见 ensureHome。数据库比程序新时返回 dbNewer，不改动数据库。
 */
export async function openDatabase(
  options: OpenDatabaseOptions,
): Promise<Result<OpenedDatabase, DbNewer>> {
  const { file, nativeBinding, migrationsFolder, backupsDir } = options;
  const bundled = readMigrationFiles({ migrationsFolder });
  const sqlite = new Database(file, { nativeBinding });
  try {
    sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
    // 先只读地对照迁移记录。数据库比程序新时，什么都不写就关掉，防止旧程序改坏新数据。
    const databaseLatest = latestMigration(sqlite);
    const appLatest = bundled.at(-1)?.folderMillis ?? 0;
    if (databaseLatest !== undefined && databaseLatest > appLatest) {
      sqlite.close();
      return err({ kind: "dbNewer", databaseLatest, appLatest });
    }
    sqlite.pragma("journal_mode = WAL");
    const pending = bundled.filter(
      (migration) => databaseLatest === undefined || migration.folderMillis > databaseLatest,
    );
    const snapshot =
      pending.length > 0 && hasTables(sqlite)
        ? await takeSnapshot(sqlite, backupsDir, nativeBinding)
        : undefined;
    const db = drizzle({ client: sqlite, schema, casing: "snake_case" });
    if (pending.length > 0) migrateWithForeignKeysOff(sqlite, db, migrationsFolder);
    sqlite.pragma("foreign_keys = ON");
    return ok({ sqlite, db, migrated: pending.length, snapshot });
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

/** 数据库里最新一条迁移记录的生成时间。还没执行过迁移时是 undefined。 */
function latestMigration(sqlite: Database.Database): number | undefined {
  const table = sqlite
    .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
    .get();
  if (table === undefined) return undefined;
  const latest = sqlite.prepare("select max(created_at) from __drizzle_migrations").pluck().get();
  return latest === null || latest === undefined ? undefined : Number(latest);
}

/** 空的数据库没有可丢的数据，迁移前不用做快照。 */
function hasTables(sqlite: Database.Database): boolean {
  return (
    sqlite.prepare("select 1 from sqlite_master where type = 'table' limit 1").get() !== undefined
  );
}

/**
 * 迁移前的快照，用 better-sqlite3 的 backup() 做，见「03 数据模型」第七节。
 * 快照随原库是预写日志模式，只读打开时会在旁边留下 -wal 和 -shm。
 * 所以改成回滚日志模式，让快照只有一个文件。
 */
async function takeSnapshot(
  sqlite: Database.Database,
  backupsDir: string,
  nativeBinding: string | undefined,
): Promise<string> {
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const file = join(backupsDir, `pre-migration-${stamp}.db`);
  await sqlite.backup(file);
  const copy = new Database(file, { fileMustExist: true, nativeBinding });
  try {
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
  return file;
}

/**
 * drizzle 把全部迁移放进一个事务执行。
 * drizzle-kit 重建表时会先关外键，但这一句在事务里无效。
 * 重建被引用的表时，DROP TABLE 会被外键挡住。
 * 所以迁移期间由这里关掉外键，迁移完再核对一遍。
 */
function migrateWithForeignKeysOff(
  sqlite: Database.Database,
  db: Db,
  migrationsFolder: string,
): void {
  sqlite.pragma("foreign_keys = OFF");
  migrate(db, { migrationsFolder });
  const broken = sqlite.pragma("foreign_key_check") as unknown[];
  if (broken.length > 0) {
    throw new Error(`迁移以后有 ${broken.length} 处外键对不上，迁移文件有错。`);
  }
}

/**
 * 从快照恢复以后执行没执行过的迁移，返回执行了几个。快照可能是旧的数据结构。
 * 和打开数据库时一样，迁移期间关掉外键，迁移完再打开。
 */
export function migratePending(
  sqlite: Database.Database,
  db: Db,
  migrationsFolder: string,
): number {
  const latest = latestMigration(sqlite);
  const pending = readMigrationFiles({ migrationsFolder }).filter(
    (migration) => latest === undefined || migration.folderMillis > latest,
  );
  if (pending.length > 0) migrateWithForeignKeysOff(sqlite, db, migrationsFolder);
  sqlite.pragma("foreign_keys = ON");
  return pending.length;
}
