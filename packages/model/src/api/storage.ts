import { z } from "zod";
import { projectIdSchema } from "../project-cache.ts";

// 集中存储的占用：GET /storage，ploop storage 用，见「05 接口」第四节和「03 数据模型」第六节。
// 附件按项目统计。一个附件被几个项目引用时，每个项目各算一次，合计里只算一次。
// 数据库是一个文件，分不出每个项目各占多少，所以只给合计。

/** 几个附件和它们的字节数。 */
const blobUsageSchema = z.strictObject({
  count: z.int().min(0),
  bytes: z.int().min(0),
});

/** 一个项目引用的附件。 */
const projectStorageSchema = z.strictObject({
  project: projectIdSchema,
  /** 页头上的系统名。 */
  name: z.string(),
  blobs: blobUsageSchema,
});

export const storageUsageSchema = z.strictObject({
  /** 每个项目一项，按登记的先后排。 */
  projects: z.array(projectStorageSchema).readonly(),
  /** 附件库的合计，每个附件算一次。 */
  blobs: blobUsageSchema,
  /** 没有任何引用的附件。超过七天的由 ploop backup gc 删除。 */
  unreferenced: blobUsageSchema,
  /** 数据库文件的字节数，含旁边的 -wal 和 -shm 两个文件。 */
  database: z.strictObject({ bytes: z.int().min(0) }),
});
