import { describe, expect, it } from "vitest";
import { z } from "zod";
import { pageJsonSchema } from "../page/stages.ts";
import { jsonSchemaSchema, pageSchemaQuerySchema } from "./schema.ts";

// 页面数据的 JSON Schema 的接口：查询参数里的阶段写中文，响应原样转交 pageJsonSchema 的结果。

describe("GET /schema/page 的查询参数", () => {
  it("阶段写中文，解码成英文键", () => {
    expect(pageSchemaQuerySchema.parse({ stage: "检查" })).toEqual({ stage: "check" });
  });

  it("英文键、没写阶段、不认识的参数，都拒绝", () => {
    for (const query of [{ stage: "check" }, {}, { stage: "检查", io: "output" }]) {
      expect(pageSchemaQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});

describe("JSON Schema 的响应", () => {
  it("编码前后不变，和 pageJsonSchema 给出的相同", () => {
    const json = pageJsonSchema("land");
    expect(z.encode(jsonSchemaSchema, json)).toEqual(json);
  });
});
