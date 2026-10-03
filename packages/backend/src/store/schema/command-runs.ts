import { commandRunPurpose } from "@product-loop/model";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { bareColumn, enumCheck, enumText } from "./enum.ts";
import { projects } from "./projects.ts";
import { rounds } from "./rounds.ts";

/**
 * 命令运行记录：命令行替 AI 在项目里跑的一次命令，字段见「03 数据模型」第二节「落地和命令运行」。
 * 只加不改。落地的记录指向它，同一件改动重跑时，新的一次另记一行，旧的留着。
 * 后端不跑命令，这里的每一行都是命令行跑完交来的，见「04 命令行」第十一节。
 */
export const commandRuns = sqliteTable(
  "command_runs",
  {
    id: integer().primaryKey({ autoIncrement: true }),
    projectId: text()
      .notNull()
      .references(() => projects.id),
    /** 在哪一轮里跑的。不在任何一轮里跑的为空，例如定时跑的使用代码。 */
    roundId: integer().references(() => rounds.id),
    purpose: enumText(commandRunPurpose).notNull(),
    /** 程序和参数，存成文字的 JSON 数组，原样记下，不经过 shell。 */
    command: text({ mode: "json" }).$type<readonly [string, ...string[]]>().notNull(),
    /** 在哪个目录里运行，是项目的某个根目录。 */
    cwd: text().notNull(),
    /** 被信号终止时，按 shell 的惯例记 128 加信号的编号。 */
    exitCode: integer().notNull(),
    /** 输出的末尾：标准输出在前、标准错误在后，留最后四十行。 */
    outputTail: text().notNull(),
    /** 运行时的 HEAD，完整的提交号。项目不在 git 仓库里时为空。 */
    commit: text(),
    /** 命令行开始运行的时间。 */
    startedAt: integer({ mode: "timestamp_ms" }).notNull(),
    durationMs: integer().notNull(),
    /** 执行它的命令行的版本，也就是构建号，开发时是 dev。 */
    cliVersion: text().notNull(),
    /** 后端收下这条记录的时间。评审以后又记的通过，按它认出来。 */
    recordedAt: integer({ mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    // 按轮次查这一轮跑过的命令。
    index("command_runs_round").on(t.roundId),
    enumCheck(t.purpose, commandRunPurpose),
    check("command_runs_exit_code", sql`${bareColumn(t.exitCode)} >= 0`),
    check("command_runs_duration_ms", sql`${bareColumn(t.durationMs)} >= 0`),
  ],
);
