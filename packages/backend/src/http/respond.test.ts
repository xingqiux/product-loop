import {
  apiEnvelopeSchema,
  type ErrorCode,
  errorBody,
  errorCodeInfo,
  errorCodes,
  projectViewSchema,
} from "@product-loop/model";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { failure, reply, respond, retryAfterSeconds } from "./respond.ts";

// 内核的结果变成响应外壳，见「05 接口」第一节和第九节。
// 错误码表的每一行都在这里核对一遍，包括这一步的接口还用不到的错误码。

/** 「05 接口」第九节的表：错误码和 HTTP 状态。 */
const table: readonly (readonly [ErrorCode, number])[] = [
  ["RULE_BLOCKED", 422],
  ["BAD_REQUEST", 400],
  ["CONFLICT", 409],
  ["NOT_FOUND", 404],
  ["BUSY", 503],
  ["NEEDS_DOCTOR", 412],
  ["PAGE_GONE", 410],
  ["CLIENT_TOO_OLD", 426],
  ["INTERNAL", 500],
];

/** 返回一个错误码的最小应用。RULE_BLOCKED 要写规矩的编号，INTERNAL 要写日志的位置。 */
function failing(code: ErrorCode) {
  const issue = { message: "出错了。", rule: "demo.rule", hint: "看日志。" };
  return new Hono().get("/", (c) => failure(c, errorBody(code, [issue])));
}

const view = {
  id: "app",
  name: "演示",
  repoKind: "shared" as const,
  ignoreFile: null,
  skillVersion: "2.0.0",
  legacySource: null,
  roots: ["/work/app"],
  createdAt: "2026-09-28T08:00:00.000Z",
};

describe("失败的响应", () => {
  it("表里的错误码一个不少", () => {
    expect(table.map(([code]) => code)).toEqual(errorCodes.map((row) => row.code));
  });

  it.each(table)("%s 返回 HTTP %i，外壳合定义", async (code, status) => {
    const res = await failing(code).request("/");
    expect(res.status).toBe(status);
    expect(res.status).toBe(errorCodeInfo(code).http);
    const body = apiEnvelopeSchema.parse(await res.json());
    expect(body).toEqual({
      ok: false,
      error: { code, message: "出错了。", rule: "demo.rule", hint: "看日志。" },
    });
  });

  it.each(table)("只有 BUSY 带 Retry-After：%s", async (code) => {
    const res = await failing(code).request("/");
    const expected = code === "BUSY" ? String(retryAfterSeconds) : null;
    expect(res.headers.get("Retry-After")).toBe(expected);
  });

  it("多条问题：顶层写第一条，另写全部和总条数", async () => {
    const issues = [{ message: "第一条。" }, { message: "第二条。", where: "name" }] as const;
    const app = new Hono().get("/", (c) => failure(c, errorBody("BAD_REQUEST", issues)));
    const body = apiEnvelopeSchema.parse(await (await app.request("/")).json());
    expect(body).toEqual({
      ok: false,
      error: { code: "BAD_REQUEST", message: "第一条。", issues, total: 2 },
    });
  });
});

describe("成功的响应", () => {
  it("数据按接口的定义编码：枚举由英文键换成中文", async () => {
    const app = new Hono().get("/", (c) => reply(c, 200, projectViewSchema, view));
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      data: { ...view, repoKind: "共用的" },
      warnings: [],
      next: [],
    });
  });

  it("警告和下一步写进外壳", async () => {
    const warnings = [{ message: "要先做迁移检查。", hint: "运行 ploop doctor。" }];
    const app = new Hono().get("/", (c) =>
      reply(c, 201, projectViewSchema, view, { warnings, next: ["ploop doctor"] }),
    );
    const res = await app.request("/");
    expect(res.status).toBe(201);
    expect(apiEnvelopeSchema.parse(await res.json())).toMatchObject({
      warnings,
      next: ["ploop doctor"],
    });
  });

  it("数据不合定义时抛出，不发出不合定义的响应", async () => {
    const app = new Hono().get("/", (c) =>
      reply(c, 200, projectViewSchema, { ...view, repoKind: "public" as "own" }),
    );
    const thrown: unknown[] = [];
    app.onError((error) => {
      thrown.push(error);
      return new Response("拦下了", { status: 500 });
    });
    const res = await app.request("/");
    expect(await res.text()).toBe("拦下了");
    expect(thrown).toHaveLength(1);
  });

  it("内核的结果：成功按定义编码，失败按错误码", async () => {
    const found = new Hono().get("/", (c) =>
      respond(c, { ok: true, value: view }, 200, projectViewSchema),
    );
    expect((await found.request("/")).status).toBe(200);
    const missing = new Hono().get("/", (c) =>
      respond(
        c,
        { ok: false, error: errorBody("NOT_FOUND", [{ message: "没有这个项目。" }]) },
        200,
        projectViewSchema,
      ),
    );
    const res = await missing.request("/");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "没有这个项目。" },
    });
  });
});
