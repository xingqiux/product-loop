import { describe, expect, it } from "vitest";
import { errorOf, port, testApp } from "../testing.ts";

// GET /health，见「05 接口」第四节和第八节。

describe("GET /health", () => {
  it("返回运行状态、构建号、接口版本、数据结构版本、进程号和数据目录", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: {
        status: "正常",
        build: "dev",
        apiVersion: 1,
        schemaVersion: 1790000000000,
        pid: process.pid,
        home: t.paths.home,
      },
      warnings: [],
      next: [],
    });
  });

  it("只查 Host：Host 不对时拒绝", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/health", {
      headers: { host: `evil.example:${port}` },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("Host");
  });
});
