import { err, localDate, ok, type Result } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { homePaths } from "../store/home.ts";
import {
  type CommandFailure,
  type CommandOutput,
  checkTimeMachine,
  dailyTimeMachineCheck,
  type Exec,
  timeMachineIssue,
} from "./time-machine.ts";

type Reply = Result<CommandOutput, CommandFailure>;

const exited = (stdout: string, stderr = "", status = 0): Reply => ok({ status, stdout, stderr });

const paths = homePaths("/Users/someone/.product-loop");
const items = [paths.home, paths.dirs.data, paths.dirs.blobs];
const dayMs = 24 * 60 * 60 * 1000;
/** 现在是本地时间 2026 年 9 月 28 日晚上八点。 */
const now = new Date(2026, 8, 28, 20);
const daysBefore = (days: number) => new Date(now.getTime() - days * dayMs);

// 下面几段输出照 macOS 26.6 上真实运行的结果写，另有两段注明了出处。
// 那台电脑的备份盘「小仓」是一块没接上的外接盘。

/** tmutil destinationinfo：设了一个备份盘。 */
const oneDestination = [
  "====================================================",
  "Name          : 小仓",
  "Kind          : Local",
  "ID            : 4B2CE124-87A7-4863-8BFF-CD99F8C0DD0F",
  "",
].join("\n");

/** tmutil isexcluded 集中存储 data/ blobs/：每项一行，标记后面补空格对齐到第 13 列。 */
const marks = (...tags: readonly string[]) =>
  items.map((item, i) => `${`[${tags[i]}]`.padEnd(12)}${item}\n`).join("");

/** plist 里的时间：UTC，不带毫秒。 */
const plistDate = (date: Date) => `<date>${date.toISOString().replace(/\.\d{3}Z$/u, "Z")}</date>`;

/**
 * plutil -extract Destinations xml1 -o - 读出的 Time Machine 设置。
 * 每个参数是一个备份盘，列出它做成的各次备份的时间。
 * 每个备份盘还记着最近尝试备份的时间 AttemptDates，比做成的新，检查不能认它。
 */
function preferences(...destinations: readonly (readonly Date[])[]): string {
  const dict = (dates: readonly Date[]) => [
    "\t<dict>",
    "\t\t<key>AttemptDates</key>",
    "\t\t<array>",
    `\t\t\t${plistDate(daysBefore(1))}`,
    "\t\t</array>",
    "\t\t<key>DestinationID</key>",
    "\t\t<string>4B2CE124-87A7-4863-8BFF-CD99F8C0DD0F</string>",
    ...(dates.length === 0
      ? []
      : [
          "\t\t<key>SnapshotDates</key>",
          "\t\t<array>",
          ...dates.map((date) => `\t\t\t${plistDate(date)}`),
          "\t\t</array>",
        ]),
    "\t</dict>",
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<array>",
    ...destinations.flatMap(dict),
    "</array>",
    "</plist>",
    "",
  ].join("\n");
}

/** tmutil latestbackup 在备份盘没接上时，仍以 0 退出，只在标准错误写一句。 */
const mountFailed = exited(
  "",
  'Failed to mount backup destination, error: Error Domain=com.apple.backupd.ErrorDomain Code=18 "Failed to mount destination." UserInfo={NSLocalizedDescription=Failed to mount destination.}\n',
);

/** 没有权限读 Time Machine 的设置时，plutil 以 1 退出。文字仿照它读不到文件时的报错，没有见过原样。 */
const preferencesDenied = exited(
  "",
  "/Library/Preferences/com.apple.TimeMachine.plist: (The file “com.apple.TimeMachine.plist” couldn’t be opened because you don’t have permission to view it.)\n",
  1,
);

/** 两个条件都满足：设了备份盘，都没被排除，两天前刚做成一次备份。 */
const healthy: readonly (readonly [string, Reply])[] = [
  ["tmutil destinationinfo", exited(oneDestination)],
  ["tmutil isexcluded", exited(marks("Included", "Included", "Included"))],
  ["plutil -extract", exited(preferences([daysBefore(2)]))],
];

/**
 * 假的执行器：按「程序名 子命令」回答，后写的覆盖先写的，没准备的命令算没运行完。
 * calls 记下每次调用的完整命令。
 */
function fakeExec(...overrides: readonly (readonly [string, Reply])[]) {
  const replies = new Map([...healthy, ...overrides]);
  const calls: string[] = [];
  const exec: Exec = async (command, args) => {
    calls.push([command, ...args].join(" "));
    const reply = replies.get(`${command.split("/").at(-1)} ${args[0]}`);
    return reply ?? err({ kind: "failed", message: "测试没有准备这条命令的输出" });
  };
  return { exec, calls };
}

describe("检查 Time Machine", () => {
  it("两个条件都满足时没有警告，也不去问 tmutil latestbackup", async () => {
    const { exec, calls } = fakeExec();
    expect(await checkTimeMachine(exec, paths, now)).toEqual([]);
    expect(calls).toEqual([
      "/usr/bin/tmutil destinationinfo",
      `/usr/bin/tmutil isexcluded ${items.join(" ")}`,
      "/usr/bin/plutil -extract Destinations xml1 -o - /Library/Preferences/com.apple.TimeMachine.plist",
    ]);
  });

  it("条件一：没设备份盘时出一条警告，不再查别的", async () => {
    // 这句取自网上的实录。本机设了备份盘，没法原样重现，所以写在标准错误、退出码不是 0 也要认。
    const { exec, calls } = fakeExec([
      "tmutil destinationinfo",
      exited("", "tmutil: No destinations configured.\n", 1),
    ]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([{ kind: "noDestination" }]);
    expect(calls).toHaveLength(1);
  });

  it("条件一：集中存储被排除时出一条警告", async () => {
    const { exec } = fakeExec([
      "tmutil isexcluded",
      exited(marks("Excluded", "Excluded", "Excluded")),
    ]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "excluded", path: paths.home },
    ]);
  });

  it("条件一：只有附件库被排除时，写明是 blobs/", async () => {
    const { exec } = fakeExec([
      "tmutil isexcluded",
      exited(marks("Included", "Included", "Excluded")),
    ]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "excluded", path: paths.dirs.blobs },
    ]);
  });

  it("条件二：最近一次做成的备份超过七天时出一条警告，尝试备份的时间不算", async () => {
    const lastBackup = new Date(2026, 5, 29, 9, 31, 23);
    const { exec } = fakeExec([
      "plutil -extract",
      exited(preferences([new Date(2026, 1, 22, 21, 14, 51), lastBackup])),
    ]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "stale", lastBackup, days: 91 },
    ]);
  });

  it("条件二：正好七天不警告，再早一分钟就警告", async () => {
    const exactly = fakeExec(["plutil -extract", exited(preferences([daysBefore(7)]))]);
    expect(await checkTimeMachine(exactly.exec, paths, now)).toEqual([]);

    const lastBackup = new Date(daysBefore(7).getTime() - 60_000);
    const older = fakeExec(["plutil -extract", exited(preferences([lastBackup]))]);
    expect(await checkTimeMachine(older.exec, paths, now)).toEqual([
      { kind: "stale", lastBackup, days: 7 },
    ]);
  });

  it("条件二：有几个备份盘时，按最新的一次备份算", async () => {
    const { exec } = fakeExec([
      "plutil -extract",
      exited(preferences([daysBefore(30)], [daysBefore(40), daysBefore(3)])),
    ]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([]);
  });

  it("条件二：读不到 Time Machine 的设置时改问 tmutil，路径末尾是本地时间", async () => {
    const recent = fakeExec(
      ["plutil -extract", preferencesDenied],
      [
        "tmutil latestbackup",
        exited(
          "/Volumes/.timemachine/F2D2AFD3/2026-09-26-093123.backup/2026-09-26-093123.backup\n",
        ),
      ],
    );
    expect(await checkTimeMachine(recent.exec, paths, now)).toEqual([]);
    expect(recent.calls.at(-1)).toBe("/usr/bin/tmutil latestbackup");

    const old = fakeExec(
      ["plutil -extract", preferencesDenied],
      ["tmutil latestbackup", exited("/Volumes/小仓/Backups.backupdb/Mac/2026-06-29-093123\n")],
    );
    expect(await checkTimeMachine(old.exec, paths, now)).toEqual([
      { kind: "stale", lastBackup: new Date(2026, 5, 29, 9, 31, 23), days: 91 },
    ]);
  });

  it("条件二：两处都查过，没有做成的备份时，出一条查不到备份的警告", async () => {
    const noSnapshots = fakeExec(
      ["plutil -extract", exited(preferences([]))],
      ["tmutil latestbackup", mountFailed],
    );
    expect(await checkTimeMachine(noSnapshots.exec, paths, now)).toEqual([{ kind: "noRecord" }]);

    const emptyDisk = fakeExec(
      ["plutil -extract", preferencesDenied],
      ["tmutil latestbackup", exited("")],
    );
    expect(await checkTimeMachine(emptyDisk.exec, paths, now)).toEqual([{ kind: "noRecord" }]);
  });

  it("两个条件都不满足时各出一条警告", async () => {
    const lastBackup = daysBefore(10);
    const { exec } = fakeExec(
      ["tmutil isexcluded", exited(marks("Excluded", "Excluded", "Excluded"))],
      ["plutil -extract", exited(preferences([lastBackup]))],
    );
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "excluded", path: paths.home },
      { kind: "stale", lastBackup, days: 10 },
    ]);
  });
});

describe("检查本身没做成", () => {
  it("找不到 tmutil 时出一条警告，不再查别的", async () => {
    const { exec, calls } = fakeExec(["tmutil destinationinfo", err({ kind: "notFound" })]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "missing", command: "/usr/bin/tmutil" },
    ]);
    expect(calls).toHaveLength(1);
  });

  it("tmutil destinationinfo 的输出认不出来时出一条警告", async () => {
    const { exec } = fakeExec(["tmutil destinationinfo", exited("", "Unexpected failure\n", 1)]);
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      { kind: "unchecked", command: "tmutil destinationinfo", detail: "Unexpected failure" },
    ]);
  });

  it("命令超时，或者执行器自己抛出时，出一条警告", async () => {
    const timedOut = fakeExec([
      "tmutil destinationinfo",
      err({ kind: "failed", message: "Command failed: /usr/bin/tmutil destinationinfo" }),
    ]);
    expect(await checkTimeMachine(timedOut.exec, paths, now)).toEqual([
      {
        kind: "unchecked",
        command: "tmutil destinationinfo",
        detail: "Command failed: /usr/bin/tmutil destinationinfo",
      },
    ]);

    const throwing: Exec = async () => {
      throw new Error("spawn EACCES");
    };
    expect(await checkTimeMachine(throwing, paths, now)).toEqual([
      { kind: "unchecked", command: "tmutil destinationinfo", detail: "spawn EACCES" },
    ]);
  });

  it("isexcluded 认不出来时只影响条件一，条件二照常检查", async () => {
    const lastBackup = daysBefore(10);
    const { exec } = fakeExec(
      ["tmutil isexcluded", exited(marks("UNKNOWN", "Included", "Included"))],
      ["plutil -extract", exited(preferences([lastBackup]))],
    );
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      {
        kind: "unchecked",
        command: `tmutil isexcluded ${items.join(" ")}`,
        detail: `[UNKNOWN]   ${paths.home}`,
      },
      { kind: "stale", lastBackup, days: 10 },
    ]);
  });

  it("设置读不到、备份盘又没接上时，出一条警告，写明 tmutil latestbackup", async () => {
    const { exec } = fakeExec(
      ["plutil -extract", preferencesDenied],
      ["tmutil latestbackup", mountFailed],
    );
    expect(await checkTimeMachine(exec, paths, now)).toEqual([
      {
        kind: "unchecked",
        command: "tmutil latestbackup",
        detail: expect.stringMatching(/^Failed to mount backup destination/u),
      },
    ]);
  });

  it("集中存储的路径带空格时，命令里给它加上引号", async () => {
    const spaced = homePaths("/Users/some one/.product-loop");
    const { exec } = fakeExec(["tmutil isexcluded", exited("")]);
    const [warning] = await checkTimeMachine(exec, spaced, now);
    expect(warning).toMatchObject({
      kind: "unchecked",
      command: `tmutil isexcluded "${spaced.home}" "${spaced.dirs.data}" "${spaced.dirs.blobs}"`,
    });
  });
});

describe("每天只检查一次", () => {
  it("当天第一次调用时检查，当天之后的调用用同一份结果，第二天再查", async () => {
    const { exec, calls } = fakeExec();
    const check = dailyTimeMachineCheck(exec, paths);

    const morning = await check(new Date("2026-09-28T09:00:00+08:00"));
    const perCheck = calls.length;
    expect(await check(new Date("2026-09-28T23:59:00+08:00"))).toBe(morning);
    expect(calls).toHaveLength(perCheck);

    await check(new Date("2026-09-29T00:01:00+08:00"));
    expect(calls).toHaveLength(perCheck * 2);
  });

  it("同时来的几次调用只检查一次", async () => {
    const { exec, calls } = fakeExec();
    const check = dailyTimeMachineCheck(exec, paths);
    const at = new Date(2026, 8, 28, 9);
    const [first, second] = await Promise.all([check(at), check(at)]);
    expect(second).toBe(first);
    expect(calls).toHaveLength(3);
  });
});

describe("警告的文字", () => {
  it("条件一的两种", () => {
    expect(timeMachineIssue({ kind: "noDestination" })).toEqual({
      message: "Time Machine 没有设置备份盘，集中存储没有第二份。",
      hint: "在系统设置的 Time Machine 里添加备份盘。",
    });
    expect(timeMachineIssue({ kind: "excluded", path: paths.dirs.blobs })).toEqual({
      message: "集中存储的 /Users/someone/.product-loop/blobs 被排除在 Time Machine 的备份之外。",
      hint: "在系统设置的 Time Machine 选项里，从排除列表中移除它或它的上级文件夹。",
    });
  });

  it("条件二的两种，日期按本机的时区写", () => {
    const lastBackup = new Date("2026-06-28T16:31:23Z");
    expect(timeMachineIssue({ kind: "stale", lastBackup, days: 91 })).toEqual({
      message: `Time Machine 最近一次备份在 ${localDate(lastBackup)}，已有 91 天没有备份。`,
      hint: "确认备份盘已连接，并在系统设置里打开 Time Machine 的自动备份。",
    });
    expect(timeMachineIssue({ kind: "noRecord" })).toEqual({
      message: "查不到 Time Machine 完成过的备份。",
      hint: "确认备份盘已连接，并在系统设置里打开 Time Machine 的自动备份。",
    });
  });

  it("检查没做成的两种，写明要在终端运行的命令", () => {
    expect(timeMachineIssue({ kind: "missing", command: "/usr/bin/tmutil" })).toEqual({
      message: "找不到 /usr/bin/tmutil，没能检查 Time Machine。",
      hint: "Time Machine 的检查只能在 macOS 上运行。",
    });
    expect(
      timeMachineIssue({
        kind: "unchecked",
        command: "tmutil latestbackup",
        detail: "Failed to mount backup destination",
      }),
    ).toEqual({
      message: "没能检查 Time Machine，tmutil latestbackup 没有给出能识别的结果。",
      hint: "在终端运行 tmutil latestbackup，查看它的输出。",
    });
  });
});
