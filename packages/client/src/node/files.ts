import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import {
  instanceLockFileName,
  logDirName,
  logFileName,
  parseRunInfo,
  type RunInfo,
  runDirName,
  runInfoFileName,
  startLockFileName,
} from "@product-loop/model";

// 命令行在集中存储里碰的几个文件，名字取自共用定义，见「01 架构」第六节和第八节。
// 命令行不读写集中存储里的数据，只碰这几个：读 run/backend.json 找后端，
// 读实例锁的文件头看后端是不是正在启动，占 run/start.lock 拉起后端，起不来时读 logs/ 下的日志。

export type BackendFiles = {
  readonly home: string;
  readonly runDir: string;
  readonly runInfo: string;
  readonly instanceLock: string;
  readonly startLock: string;
  readonly log: string;
};

export function backendFiles(home: string): BackendFiles {
  const runDir = join(home, runDirName);
  return {
    home,
    runDir,
    runInfo: join(runDir, runInfoFileName),
    instanceLock: join(runDir, instanceLockFileName),
    startLock: join(runDir, startLockFileName),
    log: join(home, logDirName, logFileName),
  };
}

/** 读 run/backend.json。文件不在、不是 JSON、不合定义，都返回 undefined。 */
export function readRunInfo(file: string): RunInfo | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  return parseRunInfo(text);
}

/** SQLite 文件开头的十六个字节。 */
const sqliteMagic = "SQLite format 3\u0000";

/** 文件头里 user_version 的位置：第 60 字节起的四个字节，按大端存的整数。 */
const userVersionOffset = 60;

/**
 * 占着实例锁的进程号。后端占锁时把自己的进程号写进 SQLite 文件头的 user_version，
 * 见后端的 process/lock.ts。放开锁以后号码还留着，所以还要另看那个进程在不在。
 * 文件不在、不是 SQLite 文件、没写进程号时返回 undefined。
 */
export function instanceHolder(file: string): number | undefined {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch {
    return undefined;
  }
  try {
    const head = Buffer.alloc(userVersionOffset + 4);
    const read = readSync(fd, head, 0, head.length, 0);
    if (read < head.length || head.toString("latin1", 0, sqliteMagic.length) !== sqliteMagic) {
      return undefined;
    }
    const pid = head.readUInt32BE(userVersionOffset);
    return pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/** 进程在不在。没有权限给它发信号的也算在：它存在，只是属于别的用户。 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Reflect.get(Object(error), "code") === "EPERM";
  }
}
