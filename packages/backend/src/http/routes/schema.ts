import { jsonSchemaSchema, pageJsonSchema, pageSchemaQuerySchema } from "@product-loop/model";
import { Hono } from "hono";
import { reply } from "../respond.ts";
import { queryParams } from "../validate.ts";

// 页面数据的 JSON Schema，见「05 接口」第一节和第四节。ploop page schema 打印的就是它。
// 内容取自共用定义的 pageJsonSchema，按阶段给出，枚举列中文，见约定 0002 第 1 条。

export function schemaRoutes() {
  return (
    new Hono()
      /** 一个阶段的页面数据的定义，阶段写中文，例如 ?stage=检查。 */
      .get("/schema/page", queryParams(pageSchemaQuerySchema), (c) => {
        const { stage } = c.req.valid("query");
        return reply(c, 200, jsonSchemaSchema, pageJsonSchema(stage));
      })
  );
}
