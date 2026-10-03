import { afterEach, describe, expect, it, vi } from "vitest";
import { failureOf, load, serviceLost } from "./api.ts";

// 读不到时页面上怎么写：连不上本机服务只写一句，不带英文码；后端报了错，写它的原因，只写一遍。

const read = () => load((api) => api.api.v1.projects.$get({ query: {} }));

function respond(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

async function failure(): Promise<unknown> {
  try {
    await read();
  } catch (error) {
    return error;
  }
  throw new Error("应当读不到");
}

afterEach(() => vi.unstubAllGlobals());

describe("读不到时的写法", () => {
  it("连不上本机服务：一句话，没有英文码", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:1" } });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await failure();
    expect(failureOf(error)).toEqual({ lost: true, reason: undefined });
    expect((error as Error).message).toBe(serviceLost);
    expect((error as Error).message).not.toMatch(/network|refused|timeout/iu);
  });

  it("后端报了错：写它的原因", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:1" } });
    respond(409, {
      ok: false,
      error: { code: "CONFLICT", message: "这一页已经回复过。" },
    });
    expect(failureOf(await failure())).toEqual({ lost: false, reason: "这一页已经回复过。" });
  });

  it("后端自己出错：原话里有「后端」，页面上写本机服务", async () => {
    vi.stubGlobal("window", { location: { origin: "http://127.0.0.1:1" } });
    respond(500, {
      ok: false,
      error: { code: "INTERNAL", message: "后端内部出错。", hint: "日志在 ~/.product-loop/logs。" },
    });
    expect(failureOf(await failure())).toEqual({ lost: false, reason: "本机服务内部出错" });
  });

  it("不是接口的报错，没有原因可写", () => {
    expect(failureOf(new Error("boom"))).toEqual({ lost: false, reason: undefined });
    expect(failureOf(undefined)).toEqual({ lost: false, reason: undefined });
  });
});
