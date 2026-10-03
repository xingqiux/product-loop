import { describe, expect, it } from "vitest";
import { projects } from "../store/schema/index.ts";
import { bodyLimitBytes } from "./security.ts";
import { dataOf, errorOf, host, port, testApp } from "./testing.ts";

// 安全检查，见「05 接口」第二节。拒绝时什么都不写。
// Host 不对、写请求缺 X-Ploop-Client、Origin 不是后端自己、请求体超过五兆，都拒绝。

const register = { root: "/work/app", repoKind: "自己的" };

describe("请求头 Host", () => {
  it.each([
    ["127.0.0.1", host],
    ["localhost", `localhost:${port}`],
    ["大写的 localhost", `LOCALHOST:${port}`],
  ])("%s 加后端的端口，照常处理", async (_name, value) => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/health", { headers: { host: value } });
    expect(res.status).toBe(200);
  });

  it.each([
    ["别的域名，防止 DNS 重绑定", `evil.example:${port}`],
    ["端口不对", "127.0.0.1:9999"],
    ["没写端口", "127.0.0.1"],
    ["IPv6 的本机地址", `[::1]:${port}`],
  ])("%s，拒绝", async (_name, value) => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/health", { headers: { host: value } });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: `请求头 Host 是「${value}」，不是后端的地址。`,
      hint: `用 http://127.0.0.1:${port} 访问后端。`,
      where: "Host",
    });
  });

  it("没带 Host，拒绝", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/health", { headers: { host: undefined } });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({ message: "请求没有带请求头 Host。", where: "Host" });
  });

  it("端口由系统分配时，按实际监听的端口检查", async () => {
    let listening = 0;
    const t = await testApp({ port: () => listening });
    listening = 51234;
    const ok = await t.request("GET", "/api/v1/health", { headers: { host: "127.0.0.1:51234" } });
    expect(ok.status).toBe(200);
    const stale = await t.request("GET", "/api/v1/health");
    expect(stale.status).toBe(400);
  });

  it("Host 不对的写请求被拦下，什么都不写", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { host: `evil.example:${port}` },
    });
    expect(res.status).toBe(400);
    expect(t.core.ctx.db.select().from(projects).all()).toEqual([]);
  });
});

describe("请求头 Origin", () => {
  it.each([`http://127.0.0.1:${port}`, `http://localhost:${port}`])(
    "是后端自己的地址 %s，照常处理",
    async (origin) => {
      const t = await testApp();
      const res = await t.request("POST", "/api/v1/projects", {
        body: register,
        headers: { origin: origin },
      });
      expect(res.status).toBe(201);
    },
  );

  it.each([
    ["别的网站", "https://evil.example"],
    ["同一台机器的别的端口", "http://127.0.0.1:3000"],
    ["https 的本机地址", `https://127.0.0.1:${port}`],
    ["沙盒里的页面", "null"],
  ])("是%s，拒绝", async (_name, origin) => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { origin: origin },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: `请求来自「${origin}」，只有后端自己的页面能调用接口。`,
      hint: `从 http://127.0.0.1:${port} 打开工作台，在工作台里操作。`,
      where: "Origin",
    });
    expect(t.core.ctx.db.select().from(projects).all()).toEqual([]);
  });

  it("读数据的请求带了别的网站的 Origin，也拒绝", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects", {
      headers: { origin: "https://evil.example" },
    });
    expect(res.status).toBe(400);
  });

  it("别的网站发来的预检被拒绝，响应不带允许跨站的请求头", async () => {
    const t = await testApp();
    const res = await t.request("OPTIONS", "/api/v1/projects", {
      headers: {
        origin: "https://evil.example",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "x-ploop-client, content-type",
      },
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Access-Control-Allow-Headers")).toBeNull();
  });
});

describe("请求头 X-Ploop-Client", () => {
  it.each([
    ["POST", "/api/v1/projects", register],
    ["PATCH", "/api/v1/projects/app", { name: "新名字" }],
    ["POST", "/api/v1/projects/app/versions/next", { reason: "跳过提升" }],
    ["POST", "/api/v1/admin/shutdown", undefined],
    ["DELETE", "/api/v1/projects/app", undefined],
  ])("%s %s 没带，拒绝，什么都不做", async (method, path, body) => {
    const t = await testApp();
    const res = await t.request(method, path, { body, headers: { "X-Ploop-Client": undefined } });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "会改数据的请求要带请求头 X-Ploop-Client。",
      hint: "写上客户端和版本，例如 cli/2.0.0。",
      where: "X-Ploop-Client",
    });
    expect(t.core.ctx.db.select().from(projects).all()).toEqual([]);
    expect(t.shutdowns()).toBe(0);
  });

  it("写成空的，也拒绝", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { "X-Ploop-Client": "" },
    });
    expect(res.status).toBe(400);
  });

  it("读数据的请求不用带", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects");
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual([]);
  });

  it("带了空的 Idempotency-Key，拒绝", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: register,
      headers: { "Idempotency-Key": "" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({
      message: "请求头 Idempotency-Key 是空的。",
      where: "Idempotency-Key",
    });
  });
});

describe("请求体的上限", () => {
  /** 正好 size 个字节的登记请求：名称用 ASCII 字母补足长度。 */
  function registerOfSize(size: number): string {
    const empty = JSON.stringify({ ...register, name: "" });
    return JSON.stringify({ ...register, name: "x".repeat(size - Buffer.byteLength(empty)) });
  }

  it("正好五兆，照常处理", async () => {
    const t = await testApp();
    const body = registerOfSize(bodyLimitBytes);
    expect(Buffer.byteLength(body)).toBe(5 * 1024 * 1024);
    const res = await t.request("POST", "/api/v1/projects", { body });
    expect(res.status).toBe(201);
  });

  it("超过五兆一个字节，边读边数时拒绝，什么都不写", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: registerOfSize(bodyLimitBytes + 1),
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "请求体超过了 5 MB 的上限。",
      hint: "截图先经附件的接口上传，页面数据里只写哈希。",
    });
    expect(t.core.ctx.db.select().from(projects).all()).toEqual([]);
  });

  it("Content-Length 写明超过五兆时，不读请求体就拒绝", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: JSON.stringify(register),
      headers: { "Content-Length": String(bodyLimitBytes + 1) },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("请求体超过了 5 MB 的上限。");
  });
});
