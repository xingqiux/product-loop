import { existsSync, readFileSync } from "node:fs";
import { defaultPort, err, ok, type Result } from "@product-loop/model";
import { z } from "zod";

// 集中存储里的 config.json，放端口、缓存保留天数这类设置，见「03 数据模型」第四节。
// 用户手动改，后端只读。文件不在、某一项没写，都用默认值。不认识的项忽略，旧版本的程序也能读新的文件。

const configSchema = z.object({
  /** 后端的端口，见「05 接口」第一节。写 0 时由系统分配一个空闲端口，测试时用。 */
  port: z.int().min(0).max(65535).default(defaultPort),
  /** 项目缓存里已收尾的轮次保留几天，见「03 数据模型」第五节。 */
  cacheRetentionDays: z.int().nonnegative().default(14),
  /** 评审界线：这一批的改动不超过这些行数和文件数，才能跳过评审，见「04 命令行」第十一节。 */
  reviewThreshold: z
    .object({
      lines: z.int().nonnegative().default(60),
      files: z.int().nonnegative().default(3),
      /**
       * 数据格式的路径：改动命中其中一条，就算改了数据格式，不能跳过评审，见约定 0001 第 12 条。
       * 每条是 glob，对着文件在根目录下的相对路径匹配，例如 packages/backend/drizzle/**。
       */
      dataFormatPaths: z.array(z.string().min(1)).default([]),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;

/**
 * config.json 写错了。fields 列出写错的几项，例如 `reviewThreshold.lines`。
 * 整个文件不是 JSON 对象时，fields 为空。
 */
export type ConfigError = {
  readonly kind: "configInvalid";
  readonly file: string;
  readonly fields: readonly string[];
};

/** 全部取默认值的设置。 */
export function defaultConfig(): Config {
  return configSchema.parse({});
}

export function readConfig(file: string): Result<Config, ConfigError> {
  if (!existsSync(file)) return ok(defaultConfig());
  const parsed = configSchema.safeParse(parseJson(readFileSync(file, "utf8")));
  if (parsed.success) return ok(parsed.data);
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).filter((f) => f !== "");
  return err({ kind: "configInvalid", file, fields });
}

/** 不是合法的 JSON 时返回 undefined，交给 Zod 按整个文件写错报。 */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
