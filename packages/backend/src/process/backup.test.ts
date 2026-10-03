import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beijingDay, logFileName, ok } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { startAt } from "../core/testing.ts";
import type { Exec, TimeMachineWarning } from "../core/time-machine.ts";
import { openTempDatabase, tempDir, tempHome } from "../store/testing.ts";
import { backupWarnings, dailySnapshotHook, loggedTimeMachineCheck } from "./backup.ts";
import { openLog } from "./log.ts";

// 备份在进程这一层的接线：写请求之前的每日快照、备份的警告，见「03 数据模型」第七节。

/** 日志里的每一行。 */
function logLines(dir: string): Record<string, unknown>[] {
  const file = join(dir, logFileName);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** tmutil 说没有设置备份盘。检查只会运行这一条命令。 */
const noDestination: Exec = async () =>
  ok({ status: 0, stdout: "", stderr: "tmutil: No destinations configured.\n" });

describe("写请求之前的每日快照", () => {
  it("当天第一次调用时做快照，日志记一行。当天再调用不做，也不再记", async () => {
    const paths = tempHome();
    const { sqlite } = await openTempDatabase(paths);
    const logs = tempDir("ploop-logs-");
    const log = openLog({ dir: logs });
    const hook = dailySnapshotHook({
      sqlite,
      backupsDir: paths.dirs.backups,
      now: () => startAt,
      log,
    });
    await Promise.all([hook(), hook()]);
    await hook();
    const file = join(paths.dirs.backups, `daily-${beijingDay(startAt)}.db`);
    expect(existsSync(file)).toBe(true);
    expect(logLines(logs)).toEqual([
      expect.objectContaining({
        level: "info",
        event: "snapshotTaken",
        message: `今天的数据库快照做好了：${file}。`,
        file,
        removed: [],
      }),
    ]);
  });

  it("快照没做成时不抛出，日志记一行警告，写明怎么办。当天再调用不重复记", async () => {
    const paths = tempHome();
    const { sqlite } = await openTempDatabase(paths);
    const logs = tempDir("ploop-logs-");
    const backupsDir = join(paths.home, "no-such-dir");
    const hook = dailySnapshotHook({
      sqlite,
      backupsDir,
      now: () => startAt,
      log: openLog({ dir: logs }),
    });
    await hook();
    await hook();
    const lines = logLines(logs);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      event: "snapshotFailed",
      hint: `检查磁盘空间和 ${backupsDir} 的写入权限，再运行 ploop backup now。`,
    });
    expect(String(lines[0]?.message)).toMatch(/^今天的数据库快照没有做成，报错是：/u);
  });
});

describe("备份的警告", () => {
  it("今天的快照没做成时有一条警告，Time Machine 的警告接在后面", async () => {
    const paths = tempHome();
    const { sqlite } = await openTempDatabase(paths);
    const backupsDir = join(paths.home, "no-such-dir");
    const log = openLog({ dir: tempDir("ploop-logs-") });
    await dailySnapshotHook({ sqlite, backupsDir, now: () => startAt, log })();
    const timeMachine = loggedTimeMachineCheck(noDestination, paths, log);
    const warnings = await backupWarnings({ backupsDir, timeMachine, waitMs: 1000 })(startAt);
    expect(warnings.map((warning) => warning.message)).toEqual([
      expect.stringMatching(/^今天的数据库快照没有做成/u),
      "Time Machine 没有设置备份盘，集中存储没有第二份。",
    ]);
  });

  it("不要 Time Machine 时只有快照没做成的那一条，也不去查 Time Machine", async () => {
    const paths = tempHome();
    const { sqlite } = await openTempDatabase(paths);
    const backupsDir = join(paths.home, "no-such-dir");
    const log = openLog({ dir: tempDir("ploop-logs-") });
    await dailySnapshotHook({ sqlite, backupsDir, now: () => startAt, log })();
    let checked = 0;
    const timeMachine = async () => {
      checked += 1;
      return [{ kind: "noRecord" }] as const;
    };
    const warnings = await backupWarnings({ backupsDir, timeMachine, waitMs: 1000 })(startAt, {
      timeMachine: false,
    });
    expect(warnings.map((warning) => warning.message)).toEqual([
      expect.stringMatching(/^今天的数据库快照没有做成/u),
    ]);
    expect(checked).toBe(0);
  });

  it("都正常时没有警告", async () => {
    const paths = tempHome();
    const warnings = await backupWarnings({ backupsDir: paths.dirs.backups, waitMs: 1000 })(
      startAt,
    );
    expect(warnings).toEqual([]);
  });

  it("当天的 Time Machine 检查还没做完：到时先不带它的警告", async () => {
    const paths = tempHome();
    const never = () => new Promise<readonly TimeMachineWarning[]>(() => {});
    const started = Date.now();
    const warnings = await backupWarnings({
      backupsDir: paths.dirs.backups,
      timeMachine: never,
      waitMs: 50,
    })(startAt);
    expect(warnings).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("每天查一次 Time Machine", () => {
  it("同一天只运行一次检查，结果只记一次日志", async () => {
    const paths = tempHome();
    const logs = tempDir("ploop-logs-");
    let runs = 0;
    const exec: Exec = async (...args) => {
      runs += 1;
      return noDestination(...args);
    };
    const check = loggedTimeMachineCheck(exec, paths, openLog({ dir: logs }));
    await check(startAt);
    await check(new Date(startAt.getTime() + 60_000));
    expect(runs).toBe(1);
    expect(logLines(logs)).toEqual([
      expect.objectContaining({
        level: "warn",
        event: "timeMachine",
        message: "Time Machine 没有设置备份盘，集中存储没有第二份。",
        hint: "在系统设置的 Time Machine 里添加备份盘。",
        warning: { kind: "noDestination" },
      }),
    ]);
  });

  it("两个条件都满足时记一行说明", async () => {
    const paths = tempHome();
    const logs = tempDir("ploop-logs-");
    const items = [paths.home, paths.dirs.data, paths.dirs.blobs];
    const plist = [
      '<plist version="1.0"><array><dict>',
      "<key>SnapshotDates</key><array><date>2026-09-28T07:00:00Z</date></array>",
      "</dict></array></plist>",
    ].join("");
    const outputs: Readonly<Record<string, string>> = {
      destinationinfo: "ID            : 4B2CE124-87A7-4863-8BFF-CD99F8C0DD0F\n",
      isexcluded: items.map((item) => `[Included]  ${item}\n`).join(""),
      "-extract": plist,
    };
    const exec: Exec = async (_command, args) =>
      ok({ status: 0, stdout: outputs[args[0] ?? ""] ?? "", stderr: "" });
    const check = loggedTimeMachineCheck(exec, paths, openLog({ dir: logs }));
    expect(await check(startAt)).toEqual([]);
    expect(logLines(logs)).toEqual([
      expect.objectContaining({
        level: "info",
        event: "timeMachine",
        message: "检查了 Time Machine，两个条件都满足。",
      }),
    ]);
  });
});
