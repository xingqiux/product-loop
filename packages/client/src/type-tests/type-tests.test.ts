import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createClient } from "../client.ts";
import { errorResponse, fakeFetch, okResponse } from "../testing.ts";
import type { Assertions, CallAssertions } from "./assertions.ts";
import { missingField, missingParam, missingRoute, wrongEnum } from "./wrong-usage.ts";

// 照搬验证代码的类型断言和故意写错的调用。它们由 pnpm typecheck 检查，这里核对条数。
// 运行时 hc 不查这些错误，写错的请求照样发出。只有类型检查能在发出之前拦下。

describe("类型断言", () => {
  it("七条照搬的断言和两条解包的断言都成立", () => {
    expectTypeOf<Assertions>().toEqualTypeOf<[true, true, true, true, true, true, true]>();
    expectTypeOf<CallAssertions>().toEqualTypeOf<[true, true]>();
  });

  it("四处写错的调用各有一条 @ts-expect-error", () => {
    const text = readFileSync(new URL("./wrong-usage.ts", import.meta.url), "utf8");
    expect(text.match(/^\s*\/\/ @ts-expect-error /gmu)).toHaveLength(4);
  });
});

describe("运行时不查这些错误", () => {
  it("写错的请求照样发出，由后端拦下", async () => {
    const backend = fakeFetch(
      errorResponse("BAD_REQUEST", [{ message: "repoKind 写的是「shared」。", where: "repoKind" }]),
      errorResponse("NOT_FOUND", [{ message: "没有这个接口。" }]),
      okResponse({ project: { id: "app" }, version: 1 }, { status: 201 }),
      errorResponse("NOT_FOUND", [{ message: "没有这个接口。" }]),
    );
    const client = createClient({ baseUrl: "http://127.0.0.1:4731", client: "cli", ...backend });
    expect(await wrongEnum(client)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(await missingParam(client)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await missingField(client)).toBeUndefined();
    expect(await missingRoute(client)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const sent = backend.received.map(({ method, url, body }) => [method, url, body]);
    expect(sent).toEqual([
      ["POST", "http://127.0.0.1:4731/api/v1/projects", '{"root":"/work/app","repoKind":"shared"}'],
      ["POST", "http://127.0.0.1:4731/api/v1/projects/:pid/versions/next", '{"reason":"跳过提升"}'],
      ["POST", "http://127.0.0.1:4731/api/v1/projects", '{"root":"/work/app","repoKind":"自己的"}'],
      ["DELETE", "http://127.0.0.1:4731/api/v1/projects/app", undefined],
    ]);
  });
});
