import { copy } from "@product-loop/model";

// ploop backup now|list|restore|gc 的文案，见「03 数据模型」第七节和「04 命令行」第二节。
// 暂时放在命令行里，以后并进共用定义的文案表。

const snapshot = "daily-2026-09-20.db";

export const backupCmdCopy = {
  help: {
    description: copy("备份和恢复"),
    details: { bare: copy("不写子命令时，列出快照。") },
    now: {
      description: copy("立即做一份快照"),
      details: {
        checked: copy("做好后查过完整性才算数。"),
        manual: copy("手动的快照不会被自动删掉。"),
      },
      reads: copy("集中存储的数据库"),
      writes: copy("集中存储的 backups/manual-<时间>.db"),
      examples: { plain: copy("ploop backup now") },
      after: copy("ploop backup list"),
    },
    list: {
      description: copy("列出所有快照"),
      details: {
        kinds: copy("每日的、手动的、迁移前的、恢复前留存的。"),
        when: copy("每份写明时间，都是北京时间。"),
        warnings: copy("备份的警告只在这里写。"),
      },
      reads: copy("集中存储的 backups/"),
      writes: copy("不写"),
      examples: { plain: copy("ploop backup list") },
      after: copy("ploop backup restore <快照>"),
    },
    restore: {
      description: copy("从快照恢复"),
      details: {
        preview: copy("先预告：会换成哪份快照，哪些项目会没有。"),
        confirm: copy("确认了加 --yes 才真的恢复。"),
        keep: copy("恢复前先留存现在的数据库，可以撤销。"),
        busy: copy("恢复期间，写请求返回忙。"),
        check: copy("恢复后做一次完整性检查。"),
      },
      snapshot: copy("快照的文件名，例如 daily-2026-09-20.db"),
      yes: copy("看过预告，确认恢复"),
      blocks: {
        missing: {
          situation: copy("快照不在 backups 里"),
          fix: copy("运行 ploop backup list，写列出的文件名"),
        },
        corrupt: { situation: copy("快照没有通过完整性检查"), fix: copy("换一份更早的快照") },
        unconfirmed: {
          situation: copy("没有加 --yes"),
          fix: copy("只做预告，不恢复；确认后加 --yes"),
        },
      },
      reads: copy("集中存储的 backups/"),
      writes: copy("集中存储的数据库，backups/pre-restore-<时间>.db"),
      examples: {
        preview: copy(`ploop backup restore ${snapshot}`),
        confirmed: copy(`ploop backup restore ${snapshot} --yes`),
      },
      after: copy("ploop status"),
    },
    gc: {
      description: copy("清理没用的附件"),
      details: { what: copy("删掉没有引用、存下超过七天的附件。") },
      reads: copy("集中存储的附件库"),
      writes: copy("集中存储的附件库"),
      examples: { plain: copy("ploop backup gc") },
      after: copy("ploop storage"),
    },
  },
  output: {
    taken: copy("做好了快照：{name}（{size}）", {
      name: "manual-20260928T080500123Z.db",
      size: "1.2 MB",
    }),
    listed: copy("快照：{count} 份，在 {dir}", { count: 3, dir: "~/.product-loop/backups" }),
    none: copy("还没有快照。"),
    section: copy("{kind}：", { kind: "每日" }),
    kinds: {
      daily: copy("每日"),
      manual: copy("手动"),
      preMigration: copy("迁移前"),
      preRestore: copy("恢复前留存"),
    },
    /** 一份快照：时间、大小、文件名。每日的快照只写日期。 */
    row: copy("  {time}  {size}  {name}", {
      time: "2026-09-20",
      size: "1.2 MB",
      name: snapshot,
    }),
    /** 没加 --yes：只预告，不恢复。 */
    preview: {
      head: copy("没有恢复，先看一下会怎样。"),
      replace: copy("现在的数据库会换成 {snapshot}。", { snapshot }),
      lost: copy("恢复以后，这 {count} 个项目就没有了：", { count: 1 }),
      lostRow: copy("  {project}", { project: "app（/Users/me/proj/app）" }),
      lostWhy: copy("它们是这份快照以后才登记的。"),
      lostNote: copy("队列、决定和回复也是以后写的，恢复不回来。"),
      allKept: copy("已登记的项目恢复以后都还在。"),
      unknown: copy("查不到现在登记了哪些项目，没法预告。"),
      keep: copy("换之前会先留存现在的数据库，能撤销。"),
      confirm: copy("要恢复，先问用户；同意了加 --yes 再运行。"),
    },
    restored: copy("恢复了：{snapshot}", { snapshot }),
    kept: copy("恢复之前的数据库留在 {kept}", { kept: "pre-restore-20260928T090000000Z.db" }),
    migrated: copy("恢复以后执行了 {count} 个迁移", { count: 1 }),
    /** 恢复以后集中存储里少了这几个项目：备份之后才登记的。 */
    vanished: copy("恢复以后没有了这几个项目：{projects}", {
      projects: "app（/Users/me/proj/app）",
    }),
    vanishedNote: copy("到项目根目录运行 ploop init 重新登记。"),
    undo: copy("要撤销这次恢复，运行 ploop backup restore {kept} --yes。", {
      kept: "pre-restore-20260928T090000000Z.db",
    }),
    healthy: copy("完整性检查：没有问题"),
    unhealthy: copy("完整性检查：查出 {count} 处问题，见警告", { count: 1 }),
    collected: copy("清理了 {count} 个附件和 {temp} 个临时文件，腾出 {size}", {
      count: 3,
      temp: 0,
      size: "1.2 MB",
    }),
  },
};
