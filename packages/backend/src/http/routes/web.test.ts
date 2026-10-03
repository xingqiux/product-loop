import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { host, testApp } from "../testing.ts";

// 工作台的静态文件，见第二期计划第 5 步。

/** 一份假的构建结果：首页、一个带哈希的脚本、一份许可文本。 */
function builtWeb(): string {
  const dir = mkdtempSync(join(tmpdir(), "ploop-web-"));
  mkdirSync(join(dir, "assets"));
  mkdirSync(join(dir, "licenses"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>工作台</title>");
  writeFileSync(join(dir, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(join(dir, "licenses", "inter.txt"), "SIL Open Font License");
  writeFileSync(join(tmpdir(), "outside.txt"), "不该读到");
  return dir;
}

/** 失败的响应里的错误。 */
async function errorOf(res: Response): Promise<{ code: string; message: string; hint: string }> {
  const body = (await res.json()) as { error: { code: string; message: string; hint: string } };
  return body.error;
}

async function get(path: string, webDir = builtWeb()) {
  const t = await testApp({ webDir });
  return t.app.request(path, { headers: { host } });
}

describe("工作台的静态文件", () => {
  it("首页每次重新取", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>工作台</title>");
  });

  it("带哈希的脚本长期缓存", async () => {
    const res = await get("/assets/index-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(await res.text()).toBe("console.log(1)");
  });

  it("不认得的地址回到首页，由工作台的路由处理", async () => {
    for (const path of ["/p/app", "/p/app/queue", `/p/app/decisions?all=1`]) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).toContain("<title>工作台</title>");
    }
  });

  it("像文件的地址找不到时返回 NOT_FOUND，不拿首页冒充", async () => {
    const res = await get("/assets/missing.js");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).code).toBe("NOT_FOUND");
  });

  it("跑出目录的地址读不到", async () => {
    for (const path of [
      "/../outside.txt",
      "/%2e%2e/outside.txt",
      "/assets/%2e%2e/%2e%2e/outside.txt",
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it("接口的地址不回到首页", async () => {
    const res = await get("/api/v1/nothing");
    expect(res.status).toBe(404);
    expect((await errorOf(res)).message).toContain("没有这个接口");
  });

  it("没有构建结果时报错，写明目录和怎么装", async () => {
    const res = await get("/p/app", join(tmpdir(), "ploop-web-none"));
    expect(res.status).toBe(404);
    const error = await errorOf(res);
    expect(error.message).toContain("工作台的文件不在");
    expect(error.hint).toContain("ploop setup");
  });
});
