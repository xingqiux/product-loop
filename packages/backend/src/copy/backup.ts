import { copy, type ErrorCopy } from "@product-loop/model";
import type { TimeMachineWarning } from "../core/time-machine.ts";
import type { SnapshotError } from "../store/backup.ts";

// 备份出了问题时给人和 AI 看的警告，见「03 数据模型」第七节和「06 工作台」第一节。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。
// 键和数据里的 kind 相同，例如 timeMachine.stale 对应 kind 为 stale 的警告。

export const backupCopy = {
  /** 每日快照没有做成，见 store/backup.ts。 */
  snapshot: {
    snapshotFailed: {
      message: copy("今天的数据库快照没有做成，报错是：{detail}", {
        detail: "database or disk is full",
      }),
      hint: copy("检查磁盘空间和 {dir} 的写入权限，再运行 ploop backup now。", {
        dir: "~/.product-loop/backups",
      }),
    },
    snapshotCorrupt: {
      message: copy(
        "今天的数据库快照没有通过完整性检查，共 {count} 处问题，已删除。第一处是：{problem}",
        { count: 3, problem: "row 1 missing from index rounds_one_open" },
      ),
      hint: copy("运行 ploop backup now 再试一次。仍不通过时，以前的快照在 {dir}。", {
        dir: "~/.product-loop/backups",
      }),
    },
  } satisfies Record<SnapshotError["kind"], ErrorCopy>,
  /** Time Machine 的检查，见 core/time-machine.ts。前两条是条件一，再两条是条件二，最后两条是没查成。 */
  timeMachine: {
    noDestination: {
      message: copy("Time Machine 没有设置备份盘，集中存储没有第二份。"),
      hint: copy("在系统设置的 Time Machine 里添加备份盘。"),
    },
    excluded: {
      message: copy("集中存储的 {path} 被排除在 Time Machine 的备份之外。", {
        path: "/Users/someone/.product-loop/blobs",
      }),
      hint: copy("在系统设置的 Time Machine 选项里，从排除列表中移除它或它的上级文件夹。"),
    },
    stale: {
      message: copy("Time Machine 最近一次备份在 {date}，已有 {days} 天没有备份。", {
        date: "2026-06-29",
        days: 91,
      }),
      hint: copy("确认备份盘已连接，并在系统设置里打开 Time Machine 的自动备份。"),
    },
    noRecord: {
      message: copy("查不到 Time Machine 完成过的备份。"),
      hint: copy("确认备份盘已连接，并在系统设置里打开 Time Machine 的自动备份。"),
    },
    missing: {
      message: copy("找不到 {command}，没能检查 Time Machine。", { command: "/usr/bin/tmutil" }),
      hint: copy("Time Machine 的检查只能在 macOS 上运行。"),
    },
    unchecked: {
      message: copy("没能检查 Time Machine，{command} 没有给出能识别的结果。", {
        command: "tmutil latestbackup",
      }),
      hint: copy("在终端运行 {command}，查看它的输出。", { command: "tmutil latestbackup" }),
    },
  } satisfies Record<TimeMachineWarning["kind"], ErrorCopy>,
  /** 从快照恢复出了问题，见 store/backup.ts 的 restoreSnapshot。 */
  restore: {
    notFound: {
      message: copy("backups 里没有名为 {name} 的快照。", { name: "daily-2026-09-20.db" }),
      hint: copy("运行 ploop backup list 看有哪些快照，写它的文件名。"),
    },
    corrupt: {
      message: copy("快照 {name} 没有通过完整性检查，共 {count} 处问题，没有恢复。", {
        name: "daily-2026-09-20.db",
        count: 2,
      }),
      hint: copy("换一份更早的快照再恢复。"),
    },
    keepFailed: {
      message: copy("留存当前的数据库时出错，没有恢复：{detail}", {
        detail: "database or disk is full",
      }),
      hint: copy("检查磁盘空间，再运行一次。日志在 {log}。", { log: "~/.product-loop/logs" }),
    },
    restoreFailed: {
      message: copy("放回快照时出错：{detail}", { detail: "database is locked" }),
      hint: copy(
        "恢复之前的数据库留在 {kept}，可以用 ploop backup restore 放回它。日志在 {log}。",
        {
          kept: "pre-restore-20260928T090000000Z.db",
          log: "~/.product-loop/logs",
        },
      ),
    },
    problems: {
      message: copy("恢复以后的完整性检查发现 {count} 处问题，第一处是：{problem}", {
        count: 1,
        problem: "row 1 missing from index rounds_one_open",
      }),
      hint: copy("恢复之前的数据库留在 {kept}，可以换一份快照再恢复。", {
        kept: "pre-restore-20260928T090000000Z.db",
      }),
    },
  },
};
