import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { beijingDay, err, type Issue, ok, type Result, renderCopy } from "@product-loop/model";
import Database from "better-sqlite3";
import { backupCopy } from "../copy/backup.ts";

// 每日快照，见「03 数据模型」第七节。当天第一次写入时做一份，保留最近十四份。天按北京时间分，和别处的日期一致。
// 快照写好以后以只读方式打开，做一次完整性检查，通过了才算数。
// 状态都在 backups/ 的文件名里，不另建表：daily-2026-09-28.db 就是那一天的快照。
// 迁移前的快照由 db.ts 做，名字是 pre-migration-<UTC 时间>.db。
// 每日的轮换不碰迁移前的快照，它保留到下一次升级。

/** 每日快照保留几份。 */
const keepDaily = 14;

const dailyName = /^daily-(\d{4}-\d{2}-\d{2})\.db$/u;
const preMigrationName = /^pre-migration-(\d{8}T\d{9}Z)\.db$/u;
/** ploop backup now 做的手动快照，不轮换，由用户自己删。 */
const manualName = /^manual-(\d{8}T\d{9}Z)\.db$/u;
/** 恢复之前留下的当前数据库，恢复错了可以再恢复回来。 */
const preRestoreName = /^pre-restore-(\d{8}T\d{9}Z)\.db$/u;
/** 没做完的快照，以及 SQLite 在它旁边留下的日志文件。 */
const partialName =
  /^(?:daily-\d{4}-\d{2}-\d{2}|manual-\d{8}T\d{9}Z)\.db\.partial(?:-journal|-wal|-shm)?$/u;
const sidecars = ["", "-journal", "-wal", "-shm"];

/** backups/ 里的一份快照。when 取自文件名：每日快照是北京时间的日期，别的快照是 UTC 时间。 */
type SnapshotFile = { readonly name: string; readonly file: string; readonly when: string };

export type SnapshotList = {
  /** 每日快照，新的在前。 */
  readonly daily: readonly SnapshotFile[];
  /** 迁移前的快照，新的在前。 */
  readonly preMigration: readonly SnapshotFile[];
  /** ploop backup now 做的快照，新的在前。 */
  readonly manual: readonly SnapshotFile[];
  /** 恢复之前留下的数据库，新的在前。 */
  readonly preRestore: readonly SnapshotFile[];
};

/** 列出 backups/ 里的快照。名字对不上的文件不算，例如没做完的快照。 */
export function listSnapshots(backupsDir: string): SnapshotList {
  const names = readdirSync(backupsDir);
  const pick = (pattern: RegExp): SnapshotFile[] =>
    names
      .flatMap((name) => {
        const when = pattern.exec(name)?.[1];
        return when === undefined ? [] : [{ name, file: join(backupsDir, name), when }];
      })
      .sort((a, b) => b.when.localeCompare(a.when));
  return {
    daily: pick(dailyName),
    preMigration: pick(preMigrationName),
    manual: pick(manualName),
    preRestore: pick(preRestoreName),
  };
}

export type DailySnapshotOptions = {
  /** 后端正在用的连接。快照用它的 backup() 做，是 SQLite 的在线备份。 */
  readonly sqlite: Database.Database;
  readonly backupsDir: string;
  /** better-sqlite3 的原生文件，和 openDatabase 用的相同。打包以后必须写。 */
  readonly nativeBinding?: string | undefined;
};

export type DailySnapshot = {
  /** 今天的快照。 */
  readonly file: string;
  /** 这一次调用做了快照。今天已经做过时是 false。 */
  readonly taken: boolean;
  /** 轮换删掉的旧快照。 */
  readonly removed: readonly string[];
};

/** 今天的快照没做成，没做完的文件已经删掉。file 是它本该在的位置。 */
export type SnapshotError =
  /** backup() 或文件操作出错，例如磁盘满了。 */
  | { readonly kind: "snapshotFailed"; readonly file: string; readonly message: string }
  /** 快照做出来了，完整性检查没通过。problems 是 integrity_check 报的每一处问题。 */
  | {
      readonly kind: "snapshotCorrupt";
      readonly file: string;
      readonly problems: readonly string[];
    };

/** 某个 backups/ 目录正在做的快照，或者今天失败了的那一次。只在这个进程里有效。 */
type Attempt = {
  readonly day: string;
  readonly result: Promise<Result<DailySnapshot, SnapshotError>>;
  running: boolean;
  failure: SnapshotError | undefined;
};

const attempts = new Map<string, Attempt>();

/**
 * 写入的钩子：每个写事务开始之前调用，只有当天第一次调用会做快照，之后只查一次文件在不在。
 * 快照要 await，写事务是同步的，所以要在事务外面先调用，做完再开事务。
 * 这样快照里是当天第一次写入之前的数据。同时来的几次调用共用同一次快照。
 * 失败时返回错误，不抛出。调用方记进日志，照常写入，不让备份挡住用户的操作。
 * 同一天失败过就不再重试，免得每次写入都做一遍，当天之后的调用都返回同一个结果对象。
 * 第二天，或者后端重启以后，再做一次。
 */
export async function ensureDailySnapshot(
  options: DailySnapshotOptions,
  now: Date,
): Promise<Result<DailySnapshot, SnapshotError>> {
  const { backupsDir } = options;
  const day = beijingDay(now);
  let current = attempts.get(backupsDir);
  // 跨过零点时，昨天的快照可能还在做。等它做完，不同时做两份。
  while (current?.running === true && current.day !== day) {
    await current.result;
    current = attempts.get(backupsDir);
  }
  if (current?.day === day) return current.result;
  const file = join(backupsDir, `daily-${day}.db`);
  if (existsSync(file)) return ok({ file, taken: false, removed: [] });
  const attempt: Attempt = {
    day,
    running: true,
    failure: undefined,
    result: takeDaily(options, file).then((result) => {
      attempt.running = false;
      // 做成的不用记着，文件在就说明今天做过了。失败的一直记到第二天。
      if (!result.ok) attempt.failure = result.error;
      else if (attempts.get(backupsDir) === attempt) attempts.delete(backupsDir);
      return result;
    }),
  };
  attempts.set(backupsDir, attempt);
  return attempt.result;
}

/** 这个 backups/ 目录正在做每日快照。进程入口据此让 shutdown 返回 BUSY，见「05 接口」第四节。 */
export function snapshotRunning(backupsDir: string): boolean {
  return attempts.get(backupsDir)?.running === true;
}

/**
 * 今天的快照失败了时返回错误，没失败或者今天还没做时返回 undefined。它自己不做快照。
 * 供 ploop status 和工作台顶上显示警告，见「06 工作台」第一节。
 */
export function snapshotFailure(backupsDir: string, now: Date): SnapshotError | undefined {
  const attempt = attempts.get(backupsDir);
  return attempt?.day === beijingDay(now) ? attempt.failure : undefined;
}

/**
 * 先写到 .partial，检查通过再改名，所以名字对的快照都是查过的。
 * 进程在中途退出时留下的 .partial，下一次开始时删掉。
 */
async function takeChecked(
  { sqlite, backupsDir, nativeBinding }: DailySnapshotOptions,
  file: string,
): Promise<Result<string, SnapshotError>> {
  const partial = `${file}.partial`;
  try {
    for (const name of readdirSync(backupsDir)) {
      if (partialName.test(name)) rmSync(join(backupsDir, name), { force: true });
    }
    await sqlite.backup(partial);
    useRollbackJournal(partial, nativeBinding);
    const problems = integrityProblems(partial, nativeBinding);
    if (problems.length > 0) {
      removeQuietly(partial);
      return err({ kind: "snapshotCorrupt", file, problems });
    }
    renameSync(partial, file);
  } catch (error) {
    removeQuietly(partial);
    return err({ kind: "snapshotFailed", file, message: messageOf(error) });
  }
  return ok(file);
}

async function takeDaily(
  options: DailySnapshotOptions,
  file: string,
): Promise<Result<DailySnapshot, SnapshotError>> {
  const taken = await takeChecked(options, file);
  if (!taken.ok) return taken;
  return ok({ file, taken: true, removed: rotateDaily(options.backupsDir, file) });
}

/** UTC 时间写成 20260928T080500123Z，和迁移前的快照相同。 */
const stampOf = (now: Date) => now.toISOString().replace(/[-:.]/g, "");

/** ploop backup now：立即做一份手动快照，查过完整性才算数。不轮换。 */
export async function takeManualSnapshot(
  options: DailySnapshotOptions,
  now: Date,
): Promise<Result<string, SnapshotError>> {
  return takeChecked(options, join(options.backupsDir, `manual-${stampOf(now)}.db`));
}

export type RestoreOptions = DailySnapshotOptions & {
  /** 后端正在用的数据库文件。快照的内容用 SQLite 的在线备份写进它。 */
  readonly databaseFile: string;
  /** 恢复以后执行没执行过的迁移，快照可能是旧的数据结构。 */
  readonly migrate: () => number;
};

export type Restored = {
  /** 放回的快照。 */
  readonly snapshot: string;
  /** 恢复之前留下的数据库。 */
  readonly kept: string;
  /** 恢复以后执行的迁移数。 */
  readonly migrated: number;
};

export type RestoreError =
  | { readonly kind: "notFound"; readonly name: string }
  | { readonly kind: "corrupt"; readonly name: string; readonly problems: readonly string[] }
  | { readonly kind: "keepFailed"; readonly message: string }
  | { readonly kind: "restoreFailed"; readonly message: string; readonly kept: string };

/**
 * 从快照恢复，见「03 数据模型」第七节。调用方要先挡住写请求，见 process.during。
 * 1. 快照按名字在 backups/ 里找，先做完整性检查。
 * 2. 把当前的数据库做一份 pre-restore 快照留存。
 * 3. 用 SQLite 的在线备份把快照写进正在用的数据库文件，后端的连接随后读到的就是快照的内容。
 * 4. 执行没执行过的迁移。
 * 恢复以后的完整性检查由调用方做，见 restoreHealth。
 */
export async function restoreSnapshot(
  options: RestoreOptions,
  name: string,
  now: Date,
): Promise<Result<Restored, RestoreError>> {
  const { sqlite, backupsDir, nativeBinding } = options;
  const list = listSnapshots(backupsDir);
  const found = [...list.daily, ...list.manual, ...list.preMigration, ...list.preRestore].find(
    (snapshot) => snapshot.name === name,
  );
  if (found === undefined) return err({ kind: "notFound", name });
  const problems = integrityProblems(found.file, nativeBinding);
  if (problems.length > 0) return err({ kind: "corrupt", name, problems });

  const kept = join(backupsDir, `pre-restore-${stampOf(now)}.db`);
  try {
    await sqlite.backup(kept);
    useRollbackJournal(kept, nativeBinding);
  } catch (error) {
    removeQuietly(kept);
    return err({ kind: "keepFailed", message: messageOf(error) });
  }

  let source: Database.Database | undefined;
  try {
    source = new Database(found.file, { readonly: true, fileMustExist: true, nativeBinding });
    await source.backup(options.databaseFile);
  } catch (error) {
    return err({ kind: "restoreFailed", message: messageOf(error), kept });
  } finally {
    source?.close();
  }
  const migrated = options.migrate();
  return ok({ snapshot: found.file, kept, migrated });
}

/** 恢复之前的预览：这份快照里登记着哪些项目。快照没找到或没通过完整性检查时和恢复一样报错。 */
export type RestorePreview = {
  /** 快照的文件名。 */
  readonly snapshot: string;
  /** 快照里登记的项目编号。当前登记的项目不在其中，恢复以后就没有了。 */
  readonly projects: readonly string[];
};

/** 只读地打开快照，列出里面登记的项目，不改任何文件。 */
export function previewRestore(
  options: Pick<DailySnapshotOptions, "backupsDir" | "nativeBinding">,
  name: string,
): Result<RestorePreview, RestoreError> {
  const { backupsDir, nativeBinding } = options;
  const list = listSnapshots(backupsDir);
  const found = [...list.daily, ...list.manual, ...list.preMigration, ...list.preRestore].find(
    (snapshot) => snapshot.name === name,
  );
  if (found === undefined) return err({ kind: "notFound", name });
  const problems = integrityProblems(found.file, nativeBinding);
  if (problems.length > 0) return err({ kind: "corrupt", name, problems });
  let source: Database.Database | undefined;
  try {
    source = new Database(found.file, { readonly: true, fileMustExist: true, nativeBinding });
    const projects = source
      .prepare("select id from projects order by id")
      .pluck()
      .all()
      .map(String);
    return ok({ snapshot: name, projects });
  } catch (error) {
    return err({ kind: "corrupt", name, problems: [messageOf(error)] });
  } finally {
    source?.close();
  }
}

/** 恢复以后的体检：完整性检查和外键核对，没有问题时返回空数组。 */
export function restoreHealth(sqlite: Database.Database): string[] {
  const rows = sqlite.prepare("pragma integrity_check").pluck().all().map(String);
  const integrity = rows.length === 1 && rows[0] === "ok" ? [] : rows;
  const foreign = (sqlite.pragma("foreign_key_check") as { table: string }[]).map(
    (row) => `foreign key: ${row.table}`,
  );
  return [...integrity, ...foreign];
}

/**
 * 快照随原库是预写日志模式，只读打开时会在旁边留下 -wal 和 -shm。
 * 所以和迁移前的快照一样，改成回滚日志模式，让快照只有一个文件。
 */
function useRollbackJournal(file: string, nativeBinding: string | undefined): void {
  const copy = new Database(file, { fileMustExist: true, nativeBinding });
  try {
    copy.pragma("journal_mode = DELETE");
  } finally {
    copy.close();
  }
}

/**
 * 以只读方式打开快照，做完整的 integrity_check。没有问题时返回空数组。
 * quick_check 不核对索引和表的内容，不够用。
 * 只读的连接不解析 CHECK 约束，所以这一步查不到违反 CHECK 的行，这类问题写入时已经拦下。
 */
function integrityProblems(file: string, nativeBinding: string | undefined): string[] {
  let copy: Database.Database | undefined;
  try {
    copy = new Database(file, { readonly: true, fileMustExist: true, nativeBinding });
    const rows = copy.prepare("pragma integrity_check").pluck().all().map(String);
    return rows.length === 1 && rows[0] === "ok" ? [] : rows;
  } catch (error) {
    return [messageOf(error)];
  } finally {
    copy?.close();
  }
}

/** 只留最近十四份每日快照。刚做的这份一定留下，时钟往回拨过也不会删掉它。 */
function rotateDaily(backupsDir: string, keep: string): string[] {
  const removed: string[] = [];
  try {
    const older = listSnapshots(backupsDir).daily.filter((snapshot) => snapshot.file !== keep);
    for (const { file } of older.slice(keepDaily - 1)) {
      rmSync(file, { force: true });
      removed.push(file);
    }
  } catch {
    // 轮换出错不影响刚做成的快照。没删掉的旧快照，下一次轮换时再删。
  }
  return removed;
}

/** 删掉没做成的快照和它旁边的日志文件。删不掉的留给下一次开始时清理。 */
function removeQuietly(partial: string): void {
  for (const suffix of sidecars) {
    try {
      rmSync(`${partial}${suffix}`, { force: true });
    } catch {
      // 下一次开始时按名字再删一遍。
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 升级做完以后调用：只留这一次迁移前的快照，删掉更早的，见「03 数据模型」第七节。
 * 「保留到下一次升级」理解为：下一次升级的迁移做完，上一次的迁移前快照就不再需要。
 * keep 是 openDatabase 返回的 snapshot，它不在 backups/ 里时什么都不删。每日快照不动。
 */
export function prunePreMigrationSnapshots(backupsDir: string, keep: string): string[] {
  const { preMigration } = listSnapshots(backupsDir);
  const kept = basename(keep);
  if (!preMigration.some((snapshot) => snapshot.name === kept)) return [];
  const stale = preMigration.filter((snapshot) => snapshot.name !== kept);
  for (const { file } of stale) rmSync(file, { force: true });
  return stale.map((snapshot) => snapshot.file);
}

/** 把快照的错误写成一条警告，供 ploop status 和工作台顶上显示。 */
export function snapshotIssue(error: SnapshotError): Issue {
  const dir = dirname(error.file);
  if (error.kind === "snapshotFailed") {
    const { message, hint } = backupCopy.snapshot.snapshotFailed;
    return {
      message: renderCopy(message, { detail: error.message }),
      hint: renderCopy(hint, { dir }),
    };
  }
  const { message, hint } = backupCopy.snapshot.snapshotCorrupt;
  return {
    message: renderCopy(message, {
      count: error.problems.length,
      problem: error.problems[0] ?? "",
    }),
    hint: renderCopy(hint, { dir }),
  };
}
