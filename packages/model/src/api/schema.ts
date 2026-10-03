import { z } from "zod";
import { stage } from "../names.ts";

// 页面数据的定义导出成 JSON Schema：GET /schema/page?stage=，见「05 接口」第一节和第四节。
// ploop page schema 打印的就是它。内容由 page/stages.ts 的 pageJsonSchema 给出，
// 取输入一侧，枚举列中文，见约定 0002 第 1 条。第 21 步的快照锁住了它的样子。

/** GET /schema/page 的查询参数：阶段写中文，例如 ?stage=检查。 */
export const pageSchemaQuerySchema = z.strictObject({ stage: stage.codec });

/** 一份 JSON Schema。接口只原样转交，不再查它的写法。 */
export const jsonSchemaSchema = z.record(z.string(), z.unknown());
