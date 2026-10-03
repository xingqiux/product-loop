import type { ErrorCode, Issue } from "@product-loop/model";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import {
  type CallResult,
  type ClientOptions,
  createClient,
  type Fetch,
  isUnreachable,
} from "./client.ts";
import {
  busyIssue,
  busyResponse,
  errorResponse,
  fakeClock,
  fakeFetch,
  okResponse,
  type Received,
} from "./testing.ts";

// 客户端对着假后端的行为：请求头、请求编号、外壳的解包、后端忙时的重发、连不上时的结果。
// 类型一侧的断言在 type-tests/ 里，运行时不加载后端的证明在 isolation.test.ts 里。

const baseUrl = "http://127.0.0.1:4731";
const health = {
  status: "正常",
  build: "dev",
  apiVersion: 1,
  schemaVersion: 1790000000000,
  pid: 4242,
  home: "/tmp/ploop-home",
};
const register = { root: "/work/app", repoKind: "自己的" } as const;
const registered = {
  project: {
    id: "app",
    name: "app",
    repoKind: "自己的",
    ignoreFile: null,
    skillVersion: "2.0.0",
    legacySource: null,
    roots: ["/work/app"],
    createdAt: "2026-09-28T03:00:00.000+08:00",
  },
  version: 1,
};

/** 用假后端建一个客户端。时钟是假的，请求编号按 key-1、key-2 的顺序生成。 */
function clientWith(fetch: Fetch, overrides: Partial<ClientOptions> = {}) {
  const clock = fakeClock();
  let keys = 0;
  const newKey = () => {
    keys += 1;
    return `key-${keys}`;
  };
  const client = createClient({
    baseUrl,
    client: "cli",
    fetch,
    now: clock.now,
    sleep: clock.sleep,
    newKey,
    ...overrides,
  });
  return { client, clock };
}

/** 失败的结果里的 error。成功时测试失败。 */
function errorOf<D>(result: CallResult<D>) {
  if (result.ok) throw new Error("应当失败，却成功了。");
  return result.error;
}

/** 连接被拒绝时 Node 的 fetch 抛出的错误。 */
function refused(port = 4731) {
  const cause = Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), {
    code: "ECONNREFUSED",
  });
  return new TypeError("fetch failed", { cause });
}

/** 一直不回的假后端，直到请求被取消。和 fetch 一样，已经取消的请求立即失败。 */
function hanging({ signal }: Received): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) reject(signal.reason);
    signal?.addEventListener("abort", () => reject(signal.reason));
  });
}

describe("请求头", () => {
  it("每个请求都带 X-Ploop-Client，写客户端和版本", async () => {
    const backend = fakeFetch(okResponse(health), okResponse(health));
    await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    await clientWith(backend.fetch, { client: "web" }).client.call((api) =>
      api.api.v1.health.$get(),
    );
    const sent = backend.received.map((request) => request.headers.get("X-Ploop-Client"));
    expect(sent).toEqual([`cli/${packageJson.version}`, `web/${packageJson.version}`]);
  });

  it("传了会话才带 X-Ploop-Session", async () => {
    const backend = fakeFetch(okResponse(health), okResponse(health));
    await clientWith(backend.fetch, { session: "s-42" }).client.call((api) =>
      api.api.v1.health.$get(),
    );
    await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    const sent = backend.received.map((request) => request.headers.get("X-Ploop-Session"));
    expect(sent).toEqual(["s-42", null]);
  });

  it("写请求带请求编号，读请求不带", async () => {
    const backend = fakeFetch(okResponse(registered, { status: 201 }), okResponse(health));
    const { client } = clientWith(backend.fetch);
    await client.call((api) => api.api.v1.projects.$post({ json: register }));
    await client.call((api) => api.api.v1.health.$get());
    const keys = backend.received.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys).toEqual(["key-1", null]);
  });

  it("每个写请求用一个新的编号", async () => {
    const backend = fakeFetch(
      okResponse(registered, { status: 201 }),
      okResponse(registered.project),
      errorResponse("CONFLICT", [{ message: "这一版已经结束。" }]),
    );
    const { client } = clientWith(backend.fetch);
    await client.call((api) => api.api.v1.projects.$post({ json: register }));
    await client.call((api) =>
      api.api.v1.projects[":pid"].$patch({ param: { pid: "app" }, json: { name: "新名字" } }),
    );
    await client.call((api) =>
      api.api.v1.projects[":pid"].versions.next.$post({
        param: { pid: "app" },
        json: { reason: "跳过提升" },
      }),
    );
    const keys = backend.received.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys).toEqual(["key-1", "key-2", "key-3"]);
  });

  it("地址、方法和请求体照 hc 的写法发出", async () => {
    const backend = fakeFetch(okResponse(registered, { status: 201 }), okResponse(null));
    const { client } = clientWith(backend.fetch);
    await client.call((api) => api.api.v1.projects.$post({ json: register }));
    await client.call((api) => api.api.v1.projects.$get({ query: { path: "/work/app/src" } }));
    const [post, get] = backend.received;
    expect(post).toMatchObject({ method: "POST", url: `${baseUrl}/api/v1/projects` });
    expect(post?.headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(post?.body ?? "")).toEqual(register);
    expect(get).toMatchObject({
      method: "GET",
      url: `${baseUrl}/api/v1/projects?path=%2Fwork%2Fapp%2Fsrc`,
      body: undefined,
    });
  });

  it("发请求的函数可以直接返回响应，和 app.request 一样", async () => {
    const seen: string[] = [];
    const client = createClient({
      baseUrl,
      client: "cli",
      fetch: (url, init) => {
        seen.push(`${init.method} ${url}`);
        return okResponse(health);
      },
    });
    const result = await client.call((api) => api.api.v1.health.$get());
    expect(result.ok && result.value.data.status).toBe("正常");
    expect(seen).toEqual([`GET ${baseUrl}/api/v1/health`]);
  });
});

describe("解包响应外壳", () => {
  it("成功时解出 data、warnings 和 next", async () => {
    const warnings: Issue[] = [{ message: "主线缺三样。", where: "主线.md" }];
    const next = ["ploop round start 构思"];
    const backend = fakeFetch(okResponse(health, { warnings, next }));
    const result = await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    expect(result).toEqual({ ok: true, value: { data: health, warnings, next } });
  });

  it("失败时解出带错误码的 error，多条拦截一并带上", async () => {
    const issues: [Issue, Issue] = [
      { rule: "card.title.length", message: "行名超过八个字。", where: "cards[0].title" },
      { rule: "card.cell.length", message: "一格超过六十字。", where: "cards[1].rows[2]" },
    ];
    const backend = fakeFetch(errorResponse("RULE_BLOCKED", issues));
    const result = await clientWith(backend.fetch).client.call((api) =>
      api.api.v1.projects.$post({ json: register }),
    );
    expect(errorOf(result)).toEqual({ code: "RULE_BLOCKED", ...issues[0], issues, total: 2 });
  });

  const failures: [ErrorCode, Issue][] = [
    ["BAD_REQUEST", { message: "请求的格式不对。", where: "repoKind" }],
    ["CONFLICT", { message: "根目录已经登记给别的项目。" }],
    ["NOT_FOUND", { message: "没有这个项目：app。" }],
    ["NEEDS_DOCTOR", { message: "项目停在旧版本的 skill，要先体检。" }],
    ["PAGE_GONE", { message: "在等的那一页已撤回。" }],
    ["CLIENT_TOO_OLD", { message: "命令行的版本太低。" }],
    ["INTERNAL", { message: "后端内部出错。", hint: "日志在 /tmp/ploop-home/logs。" }],
  ];

  it.each(failures)("%s 原样解出，不重发", async (code, issue) => {
    const backend = fakeFetch(errorResponse(code, [issue]));
    const { client, clock } = clientWith(backend.fetch);
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(errorOf(result)).toEqual({ code, ...issue });
    expect([backend.received.length, clock.waits]).toEqual([1, []]);
  });

  it("回来的不是 JSON 时报 badResponse，写明状态和正文的开头", async () => {
    const page = `<html>${"x".repeat(300)}</html>`;
    const backend = fakeFetch(new Response(page, { status: 404 }));
    const result = await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    const error = errorOf(result);
    expect(error).toEqual({ unreachable: "badResponse", status: 404, detail: page.slice(0, 200) });
    expect(isUnreachable(error)).toBe(true);
  });

  it.each([
    ["错误码表里没有的错误码", { ok: false, error: { code: "TEAPOT", message: "我是茶壶。" } }],
    ["成功却缺 warnings 和 next", { ok: true, data: health }],
    ["成功却带着 error", { ok: true, data: 1, warnings: [], next: [], error: {} }],
    ["INTERNAL 缺日志的位置", { ok: false, error: { code: "INTERNAL", message: "出错了。" } }],
  ])("JSON 不合外壳的定义时报 badResponse：%s", async (_name, body) => {
    const backend = fakeFetch(new Response(JSON.stringify(body), { status: 200 }));
    const result = await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    expect(errorOf(result)).toMatchObject({ unreachable: "badResponse", status: 200 });
  });
});

describe("后端忙", () => {
  it("按 Retry-After 等过再重发，直到不忙", async () => {
    const backend = fakeFetch(
      busyResponse("2"),
      busyResponse("3"),
      okResponse(registered, { status: 201 }),
    );
    const { client, clock } = clientWith(backend.fetch);
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(result).toEqual({ ok: true, value: { data: registered, warnings: [], next: [] } });
    expect(clock.waits).toEqual([2_000, 3_000]);
  });

  it("重发时沿用同一个请求编号，下一次调用换新的", async () => {
    const backend = fakeFetch(
      busyResponse("1"),
      busyResponse("1"),
      okResponse(registered, { status: 201 }),
      okResponse(registered, { status: 201 }),
    );
    const { client } = clientWith(backend.fetch);
    await client.call((api) => api.api.v1.projects.$post({ json: register }));
    await client.call((api) => api.api.v1.projects.$post({ json: register }));
    const keys = backend.received.map((request) => request.headers.get("Idempotency-Key"));
    expect(keys).toEqual(["key-1", "key-1", "key-1", "key-2"]);
  });

  it("一共最多等六十秒，之后返回 BUSY", async () => {
    const backend = fakeFetch(...Array.from({ length: 100 }, () => () => busyResponse("1")));
    const { client, clock } = clientWith(backend.fetch);
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(errorOf(result)).toEqual({ code: "BUSY", ...busyIssue });
    expect(clock.waits).toEqual(Array.from({ length: 60 }, () => 1_000));
    expect(backend.received).toHaveLength(61);
  });

  it("最后一次只等到六十秒为止", async () => {
    const backend = fakeFetch(...Array.from({ length: 10 }, () => () => busyResponse("25")));
    const { client, clock } = clientWith(backend.fetch);
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(errorOf(result)).toMatchObject({ code: "BUSY" });
    expect(clock.waits).toEqual([25_000, 25_000, 10_000]);
    expect(backend.received).toHaveLength(4);
  });

  it("没带 Retry-After 时等一秒，写成 HTTP 日期时等到那个时间", async () => {
    const start = Date.parse("2026-09-28T03:00:00Z");
    const later = new Date(start + 7_000).toUTCString();
    const backend = fakeFetch(busyResponse(), busyResponse(later), okResponse(health));
    const clock = fakeClock(start);
    const { client } = clientWith(backend.fetch, { now: clock.now, sleep: clock.sleep });
    const result = await client.call((api) => api.api.v1.health.$get());
    expect(result.ok).toBe(true);
    expect(clock.waits).toEqual([1_000, 6_000]);
  });

  it("每次等之前告诉调用的一方，读请求也重发", async () => {
    const onBusy = vi.fn();
    const backend = fakeFetch(busyResponse("4"), okResponse(health));
    const { client } = clientWith(backend.fetch, { onBusy });
    const result = await client.call((api) => api.api.v1.health.$get());
    expect(result.ok).toBe(true);
    expect(onBusy.mock.calls).toEqual([[{ code: "BUSY", ...busyIssue }, 4_000]]);
    expect(backend.received.map((request) => request.headers.has("Idempotency-Key"))).toEqual([
      false,
      false,
    ]);
  });
});

describe("连不上后端", () => {
  it("连接被拒绝时报 refused，不重发", async () => {
    const backend = fakeFetch(refused());
    const result = await clientWith(backend.fetch).client.call((api) => api.api.v1.health.$get());
    const error = errorOf(result);
    expect(error).toEqual({
      unreachable: "refused",
      detail: "connect ECONNREFUSED 127.0.0.1:4731",
    });
    expect(isUnreachable(error)).toBe(true);
    expect(backend.received).toHaveLength(1);
  });

  it("超过时限报 timeout，调用时写的时限优先", async () => {
    const backend = fakeFetch(hanging, hanging);
    const { client } = clientWith(backend.fetch, { timeoutMs: 60_000 });
    const result = await client.call((api) => api.api.v1.health.$get(), { timeoutMs: 20 });
    expect(errorOf(result)).toMatchObject({ unreachable: "timeout" });
    const late = clientWith(backend.fetch, { timeoutMs: 20 }).client;
    const other = await late.call((api) => api.api.v1.health.$get());
    expect(errorOf(other)).toMatchObject({ unreachable: "timeout" });
  });

  it("onUnreachable 返回 true 时重发：重新取地址，沿用请求编号", async () => {
    const backend = fakeFetch(refused(), okResponse(registered, { status: 201 }));
    const ports = [4731, 4732];
    const onUnreachable = vi.fn(() => {
      ports.shift();
      return true;
    });
    const { client } = clientWith(backend.fetch, {
      baseUrl: async () => `http://127.0.0.1:${ports[0]}`,
      onUnreachable,
    });
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(result.ok).toBe(true);
    expect(onUnreachable.mock.calls).toEqual([
      [{ unreachable: "refused", detail: "connect ECONNREFUSED 127.0.0.1:4731" }, 1],
    ]);
    const sent = backend.received.map((r) => [r.url, r.headers.get("Idempotency-Key")]);
    expect(sent).toEqual([
      ["http://127.0.0.1:4731/api/v1/projects", "key-1"],
      ["http://127.0.0.1:4732/api/v1/projects", "key-1"],
    ]);
  });

  it("onUnreachable 返回 false 时不重发，count 从 1 数起", async () => {
    const backend = fakeFetch(refused(), refused(), refused());
    const onUnreachable = vi.fn((_failure: unknown, count: number) => count < 2);
    const { client } = clientWith(backend.fetch, { onUnreachable });
    const result = await client.call((api) => api.api.v1.health.$get());
    expect(errorOf(result)).toMatchObject({ unreachable: "refused" });
    expect(onUnreachable.mock.calls.map(([, count]) => count)).toEqual([1, 2]);
    expect(backend.received).toHaveLength(2);
  });

  it("调用的一方取消时照原样抛出，不当成连不上", async () => {
    const controller = new AbortController();
    const backend = fakeFetch((request) => {
      controller.abort();
      return hanging(request);
    });
    const onUnreachable = vi.fn(() => true);
    const { client } = clientWith(backend.fetch, { onUnreachable });
    const call = client.call((api) => api.api.v1.health.$get(), { signal: controller.signal });
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    expect(onUnreachable).not.toHaveBeenCalled();
  });
});

describe("send 的写法", () => {
  it("没有发出请求时报错", async () => {
    const { client } = clientWith(fakeFetch().fetch);
    await expect(client.call(async () => undefined)).rejects.toThrow("send 没有发出请求。");
  });

  it("一次调用发了两个请求时报错", async () => {
    const backend = fakeFetch(okResponse(health), okResponse(health));
    const { client } = clientWith(backend.fetch);
    const twice = client.call(async (api) => {
      await api.api.v1.health.$get();
      return api.api.v1.health.$get();
    });
    await expect(twice).rejects.toThrow("一次调用只能发一个请求。");
  });

  it("send 自己抛出的错误照原样抛出", async () => {
    const backend = fakeFetch(refused());
    const { client } = clientWith(backend.fetch);
    const broken = client.call(async (api) => {
      await api.api.v1.health.$get().catch(() => undefined);
      throw new RangeError("写错了");
    });
    await expect(broken).rejects.toThrow(RangeError);
  });
});
