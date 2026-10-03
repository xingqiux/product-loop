import { z } from "zod";
import { defineEnum } from "../enum.ts";

// 后端本身的接口：GET /health 和 POST /admin/shutdown，见「05 接口」第四节和第八节。
// 命令行每次调用前请求 health，按构建号判断要不要替换后端，见「01 架构」第六节。

/** 后端的运行状态。迁移和恢复期间，写请求返回 BUSY。 */
export const backendState = defineEnum({ running: "正常" });

/** GET /health 的结果。 */
export const healthSchema = z.strictObject({
  status: backendState.codec,
  /** 构建号：版本、提交短号和构建时间，开发时写 dev（第一期约定第 22 条）。 */
  build: z.string().min(1),
  /** 接口版本，就是路径里的 v1。 */
  apiVersion: z.literal(1),
  /** 数据结构版本：数据库里已执行的最后一个迁移的生成时间，毫秒数。 */
  schemaVersion: z.int().min(0),
  /** 后端的进程号。 */
  pid: z.int().min(1),
  /** 集中存储的目录。 */
  home: z.string().min(1),
});

/**
 * 从 GET /health 的结果里认后端用的三样：进程号、集中存储的目录、构建号。
 * 只取这三样，别的字段不管，新旧版本的后端都认得出。
 * 后端查端口的占用者、命令行找后端时都用它，见「01 架构」第六节。
 */
export const backendIdentitySchema = z.object({
  pid: z.int().min(1),
  home: z.string().min(1),
  build: z.string().min(1),
});

/** POST /admin/shutdown 的结果：要退出的后端的进程号，命令行据此等它退出。 */
export const shutdownSchema = z.strictObject({ pid: z.int().min(1) });

// ── 备份和恢复：/admin/backup、/admin/backups、/admin/restore、/admin/gc，见「03 数据模型」第七节 ──

const snapshotEntrySchema = z.strictObject({
  /** 文件名，恢复时写它，例如 daily-2026-09-28.db。 */
  name: z.string(),
  /** 取自文件名：每日快照是北京时间的日期，别的是 UTC 时间。 */
  when: z.string(),
  bytes: z.int().min(0),
});

/** GET /admin/backups：四种快照，各自新的在前。 */
export const backupListSchema = z.strictObject({
  daily: z.array(snapshotEntrySchema).readonly(),
  manual: z.array(snapshotEntrySchema).readonly(),
  preMigration: z.array(snapshotEntrySchema).readonly(),
  preRestore: z.array(snapshotEntrySchema).readonly(),
});

/** POST /admin/backup：立即做的一份手动快照。 */
export const backupTakenSchema = snapshotEntrySchema;

/** POST /admin/restore 的请求和 GET /admin/restore/preview 的查询：哪一份快照，写文件名。 */
export const restoreRequestSchema = z.strictObject({ snapshot: z.string().min(1) });

/** GET /admin/restore/preview?snapshot= 的结果：快照里登记的项目编号，恢复前预览用。 */
export const restorePreviewSchema = z.strictObject({
  snapshot: z.string(),
  projects: z.array(z.string()).readonly(),
});

/** 恢复的结果：放回的快照、留存的数据库、执行的迁移数和体检查出的问题。 */
export const restoredSchema = z.strictObject({
  snapshot: z.string(),
  kept: z.string(),
  migrated: z.int().min(0),
  problems: z.array(z.string()).readonly(),
});

/** POST /admin/gc：删掉的附件个数、腾出的字节数和删掉的临时文件个数。 */
export const gcResultSchema = z.strictObject({
  removed: z.int().min(0),
  bytes: z.int().min(0),
  tempFiles: z.int().min(0),
});
