import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished } from "vitest";
import { type OpenedDatabase, openDatabase } from "./db.ts";
import { ensureHome, type HomePaths, homePaths } from "./home.ts";

// 测试用的集中存储，只给测试用。每个测试一个临时目录，测试结束就删掉。
// 不碰真实的 ~/.product-loop，见「10 工程规范与流程」第五节。

/** 程序自带的迁移文件夹。 */
export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/**
 * 只带到某个迁移之前的迁移文件夹：tag 是那个迁移的名字，例如 0017_queue-note，它和它以后的都不带。
 * 用它打开一个旧库，摆好旧数据，再用完整的迁移文件夹打开，看旧数据带过来没有。
 */
export function migrationsBefore(tag: string): string {
  const folder = tempDir("ploop-migrations-");
  cpSync(migrationsFolder, folder, { recursive: true });
  const file = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(file, "utf8")) as { entries: { tag: string }[] };
  const at = journal.entries.findIndex((entry) => entry.tag === tag);
  if (at < 0) throw new Error(`迁移里没有 ${tag}。`);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(file, JSON.stringify(journal));
  return folder;
}

/** 在系统的临时目录下建一个空目录，测试结束时删掉。 */
export function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 临时的集中存储，各个目录都已建好。 */
export function tempHome(): HomePaths {
  const paths = homePaths(tempDir("ploop-home-"));
  ensureHome(paths);
  return paths;
}

/** 打开临时集中存储里的数据库并执行迁移，测试结束时关掉。 */
export async function openTempDatabase(
  paths: HomePaths,
  folder: string = migrationsFolder,
): Promise<OpenedDatabase> {
  const opened = await openDatabase({
    file: paths.database,
    migrationsFolder: folder,
    backupsDir: paths.dirs.backups,
  });
  if (!opened.ok) throw new Error(`打不开测试用的数据库：${opened.error.kind}`);
  onTestFinished(() => {
    opened.value.sqlite.close();
  });
  return opened.value;
}

/** 执行一次写入，返回 SQLite 报的错。drizzle 有的调用把它包在 cause 里。 */
export function sqliteError(write: () => unknown): string {
  try {
    write();
  } catch (error) {
    const root = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return root instanceof Error ? root.message : String(root);
  }
  return "没有报错";
}
