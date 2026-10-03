import { randomUUID } from "node:crypto";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeSync,
} from "node:fs";

// 启动锁 run/start.lock，见「01 架构」第六节第 5 步：几个会话同时发现后端没开时，只有占到锁的一个拉起后端。
// 锁是用独占方式新建的文件，里面写着占锁的进程号、时间和一个随机编号。放开时只删自己的那一把。
// 占着锁的一方等后端就绪期间，每次查看时更新文件的修改时间。等迁移时可能占到六十秒，不会被当成异常。
// 锁超过三十秒没更新，视为上一个启动者已经异常退出，别人可以接手。
// 接手时先把锁挪开，确认挪开的就是看过的那一把再删掉，几个会话同时接手时只有一个挪得到。
// 极少的情况下两个会话都以为占着锁，这时多拉起的后端发现已有实例，安静退出，见后端的 process/start.ts。

export type StartLock = {
  /** 更新锁的时间，表示占锁的一方还在等后端。锁已被接手时什么也不做。 */
  readonly refresh: () => void;
  /** 放开锁。锁已被接手时不动别人的。 */
  readonly release: () => void;
};

/** 占锁的一方：写进锁里的进程号，和时钟。 */
type Owner = { readonly pid: number; readonly now: () => number };

/** 试一次，不等。占到了返回锁，别人占着时返回 undefined。 */
export function tryStartLock(file: string, owner: Owner): StartLock | undefined {
  let fd: number;
  try {
    fd = openSync(file, "wx");
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "EEXIST") return undefined;
    throw error;
  }
  const token = randomUUID();
  try {
    const startedAt = new Date(owner.now()).toISOString();
    writeSync(fd, JSON.stringify({ pid: owner.pid, startedAt, token }));
  } finally {
    closeSync(fd);
  }
  const touch = () => {
    const seconds = owner.now() / 1000;
    utimesSync(file, seconds, seconds);
  };
  touch();
  const mine = () => tokenOf(file) === token;
  return {
    refresh: () => {
      try {
        if (mine()) touch();
      } catch {
        // 刚被接手，文件已经挪走了。
      }
    },
    release: () => {
      if (mine()) rmSync(file, { force: true });
    },
  };
}

/** 锁里写的随机编号。文件不在或写得不对时返回 undefined。 */
function tokenOf(file: string): string | undefined {
  try {
    const token: unknown = Reflect.get(Object(JSON.parse(readFileSync(file, "utf8"))), "token");
    return typeof token === "string" ? token : undefined;
  } catch {
    return undefined;
  }
}

/** 别人占着的锁：离上一次更新过了多久，毫秒，以及文件的编号。锁不在时返回 undefined。 */
export function startLockAge(
  file: string,
  now: number,
): { readonly ageMs: number; readonly ino: number } | undefined {
  try {
    const stat = statSync(file);
    return { ageMs: now - stat.mtimeMs, ino: stat.ino };
  } catch {
    return undefined;
  }
}

/**
 * 接手一把没更新的锁：挪开它，确认挪开的是看过的那一把，也就是文件编号相同，再删掉。
 * 删掉了返回 true，调用的一方接着去占。挪开的是别人刚占的新锁时，原处还空着就放回去，返回 false。
 * 锁已经不在时也返回 false。
 */
export function takeOverStartLock(file: string, ino: number): boolean {
  const moved = `${file}.${randomUUID()}.stale`;
  try {
    renameSync(file, moved);
  } catch {
    return false;
  }
  let same: boolean;
  try {
    same = statSync(moved).ino === ino;
  } catch {
    same = false;
  }
  if (!same) {
    try {
      // 放回原处。原处已经有了新的锁时不覆盖，link 在目标存在时报错。
      linkSync(moved, file);
    } catch {
      // 原处已经有了新的锁。
    }
  }
  rmSync(moved, { force: true });
  return same;
}
