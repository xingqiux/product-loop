import { type Issue, ok, type Result, renderCopy } from "@product-loop/model";
import type Database from "better-sqlite3";
import { processCopy } from "../copy/process.ts";
import {
  dailyTimeMachineCheck,
  type Exec,
  type TimeMachineWarning,
  timeMachineIssue,
} from "../core/time-machine.ts";
import {
  ensureDailySnapshot,
  previewRestore,
  type Restored,
  type RestoreError,
  type RestorePreview,
  restoreHealth,
  restoreSnapshot,
  type SnapshotError,
  snapshotFailure,
  snapshotIssue,
  takeManualSnapshot,
} from "../store/backup.ts";
import { type Db, migratePending } from "../store/db.ts";
import type { HomePaths } from "../store/home.ts";
import type { Logger } from "./log.ts";

// 备份在进程这一层的接线，见「03 数据模型」第七节：
// - 每日快照：写请求执行之前调用，当天第一次写入时做一份。结果只记一次日志。
// - 备份的警告：今天的快照没有做成，Time Machine 不满足，放进 ploop status 的 warnings。
// Time Machine 每天查一次，查到的结果也只记一次日志。

export type DailySnapshotHookOptions = {
  readonly sqlite: Database.Database;
  readonly backupsDir: string;
  readonly nativeBinding?: string | undefined;
  readonly now: () => Date;
  readonly log: Logger;
};

/**
 * 写请求之前做今天的快照。它不抛出，快照失败时照常写入，见 store/backup.ts。
 * 同一天失败过的快照不再重试，ensureDailySnapshot 当天都返回同一个结果对象，所以按对象只记一次。
 */
export function dailySnapshotHook(options: DailySnapshotHookOptions): () => Promise<void> {
  const { sqlite, backupsDir, nativeBinding, now, log } = options;
  const logged = new WeakSet<object>();
  return async () => {
    const result = await ensureDailySnapshot({ sqlite, backupsDir, nativeBinding }, now());
    if (logged.has(result)) return;
    if (!result.ok) {
      logged.add(result);
      const { message, hint } = snapshotIssue(result.error);
      log.warn("snapshotFailed", { message, hint, file: result.error.file, cause: result.error });
    } else if (result.value.taken) {
      logged.add(result);
      const { file, removed } = result.value;
      log.info("snapshotTaken", {
        message: renderCopy(processCopy.log.snapshotTaken, { file }),
        file,
        removed,
      });
    }
  };
}

/** 每天查一次 Time Machine，每天的结果写一次日志：满足时一行，不满足时每条警告一行。 */
export function loggedTimeMachineCheck(
  exec: Exec,
  paths: HomePaths,
  log: Logger,
): (now: Date) => Promise<readonly TimeMachineWarning[]> {
  const check = dailyTimeMachineCheck(exec, paths);
  const seen = new WeakSet<object>();
  return (now) => {
    const warnings = check(now);
    if (!seen.has(warnings)) {
      seen.add(warnings);
      void warnings.then((found) => {
        if (found.length === 0) {
          log.info("timeMachine", { message: renderCopy(processCopy.log.timeMachineOk) });
        }
        for (const warning of found) {
          const { message, hint } = timeMachineIssue(warning);
          log.warn("timeMachine", { message, hint, warning });
        }
      });
    }
    return warnings;
  };
}

export type BackupWarningsOptions = {
  readonly backupsDir: string;
  /** 每天查一次 Time Machine。不写时不查，测试和 PLOOP_TIME_MACHINE=off 时这样。 */
  readonly timeMachine?: ((now: Date) => Promise<readonly TimeMachineWarning[]>) | undefined;
  /**
   * 当天的检查还没做完时最多等多久，毫秒。tmutil 在备份盘没接上时可能很慢，
   * 到时还没做完，这一次先不带 Time Machine 的警告，下一次再带。
   */
  readonly waitMs: number;
};

/**
 * 备份的警告：今天的快照没有做成，Time Machine 不满足。工作台顶上和 ploop backup list 显示。
 * ploop status 只要快照没做成的那一条，运行时写 timeMachine: false，见审查报告 P29。
 */
export function backupWarnings(
  options: BackupWarningsOptions,
): (now: Date, only?: { readonly timeMachine?: boolean }) => Promise<readonly Issue[]> {
  const { backupsDir, timeMachine, waitMs } = options;
  return async (now, only = {}) => {
    const failure = snapshotFailure(backupsDir, now);
    const snapshot = failure === undefined ? [] : [snapshotIssue(failure)];
    if (timeMachine === undefined || only.timeMachine === false) return snapshot;
    const warnings = await within(timeMachine(now), waitMs);
    return [...snapshot, ...(warnings ?? []).map(timeMachineIssue)];
  };
}

/** 等 promise 最多 ms 毫秒，到时没有结果就返回 undefined。定时器不拖住进程的退出。 */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(resolve, ms, undefined);
    timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type BackupActionsOptions = {
  readonly sqlite: Database.Database;
  readonly db: Db;
  readonly backupsDir: string;
  readonly nativeBinding?: string | undefined;
  readonly migrationsFolder: string;
  readonly now: () => Date;
};

/** 恢复的结果，加上恢复以后体检查出的问题。 */
type RestoreReport = Restored & { readonly problems: readonly string[] };

/** 手动快照和恢复，接口层经 AppDeps 调用，见 http/routes/admin.ts。 */
export type BackupActions = {
  readonly snapshotNow: () => Promise<Result<string, SnapshotError>>;
  /** 调用方要先用 process.during("restore") 挡住写请求。 */
  readonly restore: (name: string) => Promise<Result<RestoreReport, RestoreError>>;
  /** 恢复之前看一眼：快照里登记着哪些项目。只读，不用挡写请求。 */
  readonly preview: (name: string) => Result<RestorePreview, RestoreError>;
};

export function backupActions(options: BackupActionsOptions): BackupActions {
  const { sqlite, db, backupsDir, nativeBinding, migrationsFolder, now } = options;
  const snapshot = { sqlite, backupsDir, nativeBinding };
  return {
    snapshotNow: () => takeManualSnapshot(snapshot, now()),
    preview: (name) => previewRestore({ backupsDir, nativeBinding }, name),
    restore: async (name) => {
      const restored = await restoreSnapshot(
        {
          ...snapshot,
          databaseFile: sqlite.name,
          migrate: () => migratePending(sqlite, db, migrationsFolder),
        },
        name,
        now(),
      );
      if (!restored.ok) return restored;
      return ok({ ...restored.value, problems: restoreHealth(sqlite) });
    },
  };
}
