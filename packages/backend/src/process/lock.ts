import { rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { instanceLockFileName } from "@product-loop/model";
import Database from "better-sqlite3";

// 实例锁：一个集中存储同一时间只跑一个后端。
// 这是「01 架构」第六节后端启动的第 1 步：确认没有别的实例，再打开数据库。
// 两个后端同时迁移同一个数据库，改数据的迁移会执行两遍，所以要在打开数据库之前确认。
// 锁是 run/backend.lock 这个 SQLite 文件上的排他锁，用排他的加锁方式写一次文件头就一直占着。
// 进程结束时由系统放开，所以异常退出以后不会留下放不开的锁，也不怕进程号被别的进程重用。
// 文件头的 user_version 写着占锁的进程号，占着的时候别的 SQLite 连接读不到它。
// 命令行直接读文件头，看占锁的进程还在不在，见共用定义 process.ts 的 instanceLockFileName。
// 连接对象被回收时锁也会放开，所以占着的连接放在模块的集合里，直到 release。

export type InstanceLock = {
  /** 放开锁。只在后端退出前调用一次，多调用也没关系。 */
  readonly release: () => void;
};

const held = new Set<Database.Database>();

/** 试一次，不等。占到了返回锁，别的连接占着时返回 undefined。 */
export function tryInstanceLock(runDir: string, nativeBinding?: string): InstanceLock | undefined {
  const file = join(runDir, instanceLockFileName);
  const first = attempt(file, nativeBinding);
  if (first !== "notDatabase") return first;
  // 文件不是 SQLite 的，例如被别的程序写坏了。没有人能占着这样的文件，删掉重来一次。
  rmSync(file, { force: true });
  const second = attempt(file, nativeBinding);
  return second === "notDatabase" ? undefined : second;
}

/**
 * 占着锁的后端可能正在退出，最多等五秒，见「01 架构」第六节。
 * 所以隔一会儿试一次，最多等 waitMs。等到了返回锁，到时仍占不到返回 undefined。
 */
export async function waitForInstanceLock(
  runDir: string,
  options: { readonly waitMs: number; readonly pollMs: number; readonly nativeBinding?: string },
): Promise<InstanceLock | undefined> {
  const deadline = Date.now() + options.waitMs;
  for (;;) {
    const lock = tryInstanceLock(runDir, options.nativeBinding);
    if (lock !== undefined || Date.now() >= deadline) return lock;
    await sleep(options.pollMs);
  }
}

function attempt(file: string, nativeBinding: string | undefined) {
  // timeout 写 0：别的连接占着时立即返回 SQLITE_BUSY，不等。
  const db = new Database(file, { timeout: 0, nativeBinding });
  try {
    db.pragma("locking_mode = EXCLUSIVE");
    // 回滚日志放在内存里，占着锁的时候旁边不留 -journal 文件。
    db.pragma("journal_mode = MEMORY");
    db.pragma(`user_version = ${process.pid}`);
  } catch (error) {
    db.close();
    const code: unknown = Reflect.get(Object(error), "code");
    if (code === "SQLITE_BUSY") return undefined;
    if (code === "SQLITE_NOTADB") return "notDatabase" as const;
    throw error;
  }
  held.add(db);
  const lock: InstanceLock = {
    release: () => {
      if (held.delete(db)) db.close();
    },
  };
  return lock;
}
