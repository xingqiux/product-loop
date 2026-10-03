import { z } from "zod";
import { issueSchema } from "../envelope.ts";

// 写作校验的接口：POST /lint/text 和 POST /lint/reply，见「05 接口」第四节。
// ploop lint text 和 ploop lint reply 用。写了项目时按主线的写作规范查，
// 查回复时另查首行是不是以当前的轮次开头。

/** 要查的一段文字，和它属于哪个项目。 */
export const lintRequestSchema = z.strictObject({
  text: z.string(),
  project: z.string().optional(),
});

/** 查出的拦截和警告。有拦截时命令行退出码是 1。 */
export const lintResultSchema = z.strictObject({
  block: z.array(issueSchema).readonly(),
  warn: z.array(issueSchema).readonly(),
});
