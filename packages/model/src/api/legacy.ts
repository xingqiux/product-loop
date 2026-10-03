import { z } from "zod";
import {
  decisionKind,
  decisionStatus,
  legacyMigrationStatus,
  proposer,
  queueStatus,
  stage,
} from "../names.ts";
import { queueIdSchema } from "../queue.ts";
import { blobHashPattern } from "./blobs.ts";

// 迁移的接口：历史页面的校验、归档、导入、状态、完成，见「05 接口」第四节和「08 版本与迁移」第四节。
// 枚举在接口上写中文，见约定 0002 第 1 条。导入的内容由命令行按 AI 确认过的 migrate/ 整理好交来。

const timestamp = z.iso.datetime({ offset: true });
const date = z.iso.date();
const blobHash = z.string().regex(blobHashPattern);
const count = z.int().min(0);

/** 历史页面模式的校验：POST /legacy/pages/check。项目还没登记时也能用。 */
export const legacyPageCheckSchema = z.strictObject({
  stage: stage.codec,
  /** 页面数据里的日期，起始日期晚于它的规则跳过。 */
  pageDate: date,
  data: z.unknown(),
});

/** 归档包里的一个文件：相对旧文件位置的路径、字节数和 SHA-256。 */
export const archiveEntrySchema = z.strictObject({
  path: z.string().min(1),
  size: count,
  sha256: blobHash,
});

/** 收下的归档包：存在 archives/ 下的文件名、包的哈希和文件清单。 */
export const archiveReceivedSchema = z.strictObject({
  file: z.string(),
  sha256: blobHash,
  files: count,
  bytes: count,
});

/** 导入的一条旧决定。编号照旧表保留，日期由 AI 在确认时补齐。 */
const legacyDecisionSchema = z.strictObject({
  id: z.int().min(1),
  kind: decisionKind.codec,
  decision: z.string(),
  reason: z.string(),
  case: z.string(),
  date,
  status: decisionStatus.codec,
  voidedBy: z.int().min(1).optional(),
  voidReason: z.string().optional(),
});

/** 导入的一件旧队列事项。待核对的已经由 AI 定成待办或已完成。 */
const legacyQueueItemSchema = z.strictObject({
  id: queueIdSchema,
  content: z.string(),
  stage: stage.codec,
  proposer: proposer.codec,
  createdAt: date,
  status: queueStatus.codec,
  statusNote: z.string().optional(),
  dependsOn: z.string().optional(),
  acceptance: z.string().optional(),
  evidence: z.string().optional(),
  subItems: z.array(z.string()),
  source: z.string().optional(),
});

/** 一页旧页面：转换好的页面数据和它的截图，或者只有网页时的快照。 */
const legacyPageSchema = z.union([
  z.strictObject({
    legacyId: z.string().min(1),
    /** 转换以后的页面数据，枚举写中文，和新写的页面相同。 */
    data: z.unknown(),
    images: z.array(z.strictObject({ path: z.string(), hash: blobHash })),
  }),
  z.strictObject({
    legacyId: z.string().min(1),
    /** 只有网页、没有数据的一页，网页先上传到附件库。 */
    snapshot: blobHash,
  }),
]);

/** 一轮旧轮次。按时间先后排好，后端按这个顺序在每个阶段里从 1 编号。 */
const legacyRoundSchema = z.strictObject({
  /** 旧编号，例如 fix-13、2026-09-21/report-11。 */
  legacyId: z.string().min(1),
  stage: stage.codec,
  date,
  pages: z.array(legacyPageSchema).min(1),
  /**
   * 挂在这一轮上的旧文件：这一轮的截图、使用阶段的截图和事实文件，路径相对 walk/。
   * 截图的数量按这里的路径数，页面里引用的截图也要列在这里。
   */
  files: z.array(z.strictObject({ path: z.string().min(1), hash: blobHash })),
});

/** 旧文件里数出的数量，导入以后逐项核对。 */
export const legacyCountsSchema = z.strictObject({
  rounds: count,
  pages: count,
  decisions: count,
  queue: count,
  images: count,
});

/** 导入：POST /projects/:pid/legacy/import。在一个事务里写入，核对不通过就整批撤回。 */
export const legacyImportSchema = z.strictObject({
  /** 主线：原文存成第 1 版，整理过的存成第 2 版。两份相同时只存一版。没有主线时为空。 */
  mainline: z.strictObject({ original: z.string(), cleaned: z.string() }).nullable(),
  decisions: z.array(legacyDecisionSchema),
  queue: z.array(legacyQueueItemSchema),
  rounds: z.array(legacyRoundSchema),
  expected: legacyCountsSchema,
});

/** 命令行交来的导入内容，枚举写中文。 */
export type LegacyImportBody = z.input<typeof legacyImportSchema>;

/** 导入以后：写进去的数量。 */
export const legacyImportedSchema = z.strictObject({
  counts: legacyCountsSchema,
});

/** 迁移停在哪里：GET /projects/:pid/legacy。还没开始时 status 为空。 */
export const legacyStatusSchema = z.strictObject({
  project: z.string(),
  status: legacyMigrationStatus.codec.nullable(),
  archive: archiveReceivedSchema.nullable(),
  counts: legacyCountsSchema.nullable(),
  /** 上一次没做成的一步和原因。 */
  failure: z.strictObject({ step: z.string(), message: z.string(), at: timestamp }).nullable(),
  updatedAt: timestamp.nullable(),
});

/** 完成：核对数量，标记迁移完成，返回要清理的旧文件，路径相对旧文件的位置。 */
export const legacyCompletedSchema = z.strictObject({
  counts: legacyCountsSchema,
  skillVersion: z.string(),
  /** 结束的一版和开始的一版。 */
  ended: z.int().min(1),
  started: z.int().min(1),
  cleanup: z.array(z.string()).readonly(),
});
