import { z } from "zod";

// 导出：GET /projects/:pid/export，ploop export 用，见「03 数据模型」第九节。
// 后端给出每个文件的路径和全文，命令行写成文件夹。legacy=true 时给出旧格式的文件，
// 命令行写回项目缓存，见「08 版本与迁移」第八节。

export const exportQuerySchema = z.strictObject({
  legacy: z.stringbool({ truthy: ["true"], falsy: ["false"] }).optional(),
});

export const exportBundleSchema = z.strictObject({
  project: z.string(),
  legacy: z.boolean(),
  /** 路径相对导出的文件夹，用 / 分隔。 */
  files: z.array(z.strictObject({ path: z.string(), text: z.string() })).readonly(),
});
