import { createHash } from "node:crypto";
import { hc, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AppType } from "../../index.ts";
import { dataOf, errorOf, host, testApp } from "../testing.ts";

// 集中存储的占用，见「05 接口」第四节。统计的细节在 core/storage.test.ts。

describe("GET /storage", () => {
  it("列出每个项目引用的附件，另给附件库和数据库的合计", async () => {
    const t = await testApp();
    await t.request("POST", "/api/v1/projects", {
      body: { root: "/work/app", repoKind: "自己的" },
    });
    const bytes = new TextEncoder().encode("还没被引用的截图");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await t.app.request(`/api/v1/blobs/${hash}`, {
      method: "PUT",
      headers: { host, "X-Ploop-Client": "cli/2.0.0", "Content-Type": "image/png" },
      body: bytes,
    });
    const res = await t.request("GET", "/api/v1/storage");
    expect(res.status).toBe(200);
    const usage = { count: 1, bytes: bytes.byteLength };
    expect(dataOf(res)).toMatchObject({
      projects: [{ project: "app", name: "app", blobs: { count: 0, bytes: 0 } }],
      blobs: usage,
      unreferenced: usage,
      database: { bytes: expect.any(Number) },
    });
  });

  it("只能读，不能改。写方法返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/storage", { body: {} });
    expect(res.status).toBe(404);
    expect(errorOf(res).message).toBe("没有这个接口：POST /api/v1/storage。");
  });

  it("类型化客户端里，每个项目的附件有件数和字节数", () => {
    const client = hc<AppType>("http://127.0.0.1:4731");
    type Usage = InferResponseType<typeof client.api.v1.storage.$get, 200>["data"];
    expectTypeOf<Usage["projects"][number]["blobs"]>().toEqualTypeOf<{
      count: number;
      bytes: number;
    }>();
  });
});
