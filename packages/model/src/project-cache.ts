import { z } from "zod";

// 项目缓存：每个项目根目录下的 .product-loop/，只放最近的、临时的东西，见「03 数据模型」第五节。
// 这里定义其中的身份文件 project.json。它只由命令写，AI 不改。
// 命令从当前目录往上找它，找到了就知道是哪个项目。找到的目录必须是这个项目登记过的根目录。

/** 项目缓存的文件夹名。 */
export const projectCacheDirName = ".product-loop";

/** 项目缓存里记身份的文件。 */
export const projectIdentityFileName = "project.json";

/** project.json 的格式版本。格式有不兼容的变化时才加一。 */
export const projectIdentityVersion = 1;

/**
 * 项目编号：根目录名转成的 ASCII 短名，重名时加数字，见第一期计划第三节。
 * 只用小写字母、数字和短横，短横不在头尾、不连用，因为它要放进接口的路径。
 */
export const projectIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

/** skill 的版本号，按语义化版本写，例如 0.0.1。开发中的版本带后缀，例如 0.0.1-dev.0。 */
const skillVersionSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  );

/**
 * project.json：对应的项目编号、停在哪一版 skill、主线的基准版本。
 * 主线的基准是项目缓存里的主线.md 上次和集中存储对上的那一版，记版本号和全文的 SHA-256。
 * 每条命令开始时拿文件的哈希和它比较，见「03 数据模型」第五节。还没交过主线时没有。
 */
export const projectIdentitySchema = z.strictObject({
  schemaVersion: z.literal(projectIdentityVersion),
  projectId: projectIdSchema,
  skillVersion: skillVersionSchema,
  mainlineBase: z
    .strictObject({
      revision: z.int().min(1),
      hash: z.string().regex(/^[0-9a-f]{64}$/u),
    })
    .optional(),
});
export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;
