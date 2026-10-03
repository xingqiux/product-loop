import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { apiEnvelopeSchema, blobCacheControl } from "@product-loop/model";
import { hc, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AppType } from "../../index.ts";
import { type BlobHash, blobPath } from "../../store/blobs.ts";
import { blobs } from "../../store/schema/index.ts";
import { bodyLimitBytes } from "../security.ts";
import { host, type TestApp, testApp } from "../testing.ts";

// 附件的接口，见「05 接口」第七节。HEAD、PUT、GET 各至少一成一败，哈希不符返回 400。
// 成功时 HEAD 和 GET 不是 JSON，所以这里直接用 app.request，失败时再按外壳解析。

const png = new TextEncoder().encode("一张截图的字节");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const pngHash = sha256(png);

/** 发一个附件的请求。写请求带上客户端。 */
function send(t: TestApp, method: string, hash: string, body?: Uint8Array, type = "image/png") {
  const writing = method === "PUT";
  return t.app.request(`/api/v1/blobs/${hash}`, {
    method,
    headers: { host, ...(writing ? { "X-Ploop-Client": "cli/2.0.0", "Content-Type": type } : {}) },
    ...(body === undefined ? {} : { body }),
  });
}

/** 失败的响应按外壳解析，取出 error。 */
async function errorIn(response: Response) {
  const envelope = apiEnvelopeSchema.parse(await response.json());
  if (envelope.ok) throw new Error("应当失败");
  return envelope.error;
}

/** 附件库里的临时文件。 */
function tempFiles(t: TestApp): string[] {
  const dir = join(t.paths.dirs.blobs, "tmp");
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe("PUT /blobs/:hash", () => {
  it("存下一个附件，返回 201 和登记的信息。再传一次返回 200，文件不重写", async () => {
    const t = await testApp();
    const res = await send(t, "PUT", pngHash, png);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ok: true,
      data: {
        hash: pngHash,
        contentType: "image/png",
        size: png.byteLength,
        width: null,
        height: null,
        stored: true,
      },
      warnings: [],
      next: [],
    });
    expect(existsSync(blobPath(t.paths.dirs.blobs, pngHash as BlobHash))).toBe(true);
    expect(t.core.ctx.db.select().from(blobs).get()?.firstSource).toBe("cli/2.0.0");

    const again = await send(t, "PUT", pngHash, png);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ data: { stored: false } });
  });

  it("内容和哈希对不上，返回 400，写明算出的哈希，不留下文件", async () => {
    const t = await testApp();
    const other = "0".repeat(64);
    const res = await send(t, "PUT", other, png);
    expect(res.status).toBe(400);
    expect(await errorIn(res)).toMatchObject({
      code: "BAD_REQUEST",
      message: `上传的内容算出的哈希是 ${pngHash}，和路径里的不同。`,
      where: other,
    });
    expect(existsSync(blobPath(t.paths.dirs.blobs, other as BlobHash))).toBe(false);
    expect(tempFiles(t)).toEqual([]);
    expect(t.core.ctx.db.select().from(blobs).all()).toEqual([]);
  });

  it("路径里的哈希写法不对、类型写错，都返回 400", async () => {
    const t = await testApp();
    const upper = pngHash.toUpperCase();
    expect(await errorIn(await send(t, "PUT", upper, png))).toMatchObject({ where: upper });
    const typed = await send(t, "PUT", pngHash, png, "png");
    expect(typed.status).toBe(400);
    expect(await errorIn(typed)).toMatchObject({ where: "Content-Type" });
  });

  it("附件不受页面数据五兆的上限，超过五兆也能上传", async () => {
    const t = await testApp();
    const big = new Uint8Array(bodyLimitBytes + 1024).fill(7);
    const res = await send(t, "PUT", sha256(big), big, "application/octet-stream");
    expect(res.status).toBe(201);
  });

  it("没带 X-Ploop-Client，由安全检查拦下", async () => {
    const t = await testApp();
    const res = await t.app.request(`/api/v1/blobs/${pngHash}`, {
      method: "PUT",
      headers: { host },
      body: png,
    });
    expect(res.status).toBe(400);
    expect(await errorIn(res)).toMatchObject({ where: "X-Ploop-Client" });
  });
});

describe("HEAD /blobs/:hash", () => {
  it("已有时返回 200，带类型和长度，没有响应体", async () => {
    const t = await testApp();
    await send(t, "PUT", pngHash, png);
    const res = await send(t, "HEAD", pngHash);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Length")).toBe(String(png.byteLength));
    expect(await res.text()).toBe("");
  });

  it("没有时返回 404，没有响应体", async () => {
    const t = await testApp();
    const res = await send(t, "HEAD", pngHash);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });
});

describe("GET /blobs/:hash", () => {
  it("返回文件本身，带类型、长度和长期缓存", async () => {
    const t = await testApp();
    await send(t, "PUT", pngHash, png);
    const res = await send(t, "GET", pngHash);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Length")).toBe(String(png.byteLength));
    expect(res.headers.get("Cache-Control")).toBe(blobCacheControl);
    expect(res.headers.get("ETag")).toBe(`"${pngHash}"`);
    expect(res.headers.get("Content-Security-Policy")).toBe("sandbox");
  });

  it("没有这个附件返回 404，哈希写法不对返回 400，都写明哈希", async () => {
    const t = await testApp();
    const missing = await send(t, "GET", pngHash);
    expect(missing.status).toBe(404);
    expect(await errorIn(missing)).toMatchObject({
      message: "附件库里没有这个附件。",
      where: pngHash,
    });
    const bad = await send(t, "GET", "abc");
    expect(bad.status).toBe(400);
    expect(await errorIn(bad)).toMatchObject({ where: "abc" });
  });
});

describe("接口的类型", () => {
  const client = hc<AppType>("http://127.0.0.1:4731");
  type Put = (typeof client.api.v1.blobs)[":hash"]["$put"];

  it("上传的结果按状态码收窄：新存下是 201，哈希不符是 BAD_REQUEST", () => {
    expectTypeOf<InferResponseType<Put, 201>["data"]["stored"]>().toEqualTypeOf<boolean>();
    type Rejected = InferResponseType<Put, 400>["error"]["code"];
    expectTypeOf<Rejected>().toEqualTypeOf<"BAD_REQUEST">();
  });
});
