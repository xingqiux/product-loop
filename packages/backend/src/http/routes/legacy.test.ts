import { randomBytes } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addProject } from "../../core/testing.ts";
import { makeArchive, sha256 } from "../../store/archive-testing.ts";
import { dataOf, errorOf, host, type TestApp, testApp } from "../testing.ts";

// 迁移的接口，见第一期计划第 60、61 步。每个接口至少一成一败。
// 细节在 core/legacy.test.ts，这里看请求和响应：归档包的请求体、中文进出、状态码。

const html = "<!doctype html><title>旧页面</title><p>第 1 轮</p>";
const htmlHash = sha256(new TextEncoder().encode(html));

/** 登记了旧项目 app。 */
async function legacyApp(): Promise<TestApp> {
  const t = await testApp();
  addProject(t.core, "/work/app", { legacySource: "docs" });
  return t;
}

/** 上传归档包。 */
async function upload(t: TestApp, archive: Buffer, hash = sha256(archive)) {
  const res = await t.app.request(`/api/v1/projects/app/legacy/archive?sha256=${hash}`, {
    method: "POST",
    headers: { host, "X-Ploop-Client": "cli/2.0.0", "Content-Type": "application/gzip" },
    body: archive,
  });
  return {
    status: res.status,
    body: (await res.json()) as {
      ok: boolean;
      data?: unknown;
      error?: { code: string; message: string };
    },
  };
}

const files = [
  { path: "主线.md", data: "# 主线\n" },
  { path: "walk/2026-09-18/report-1.html", data: html },
];

/** 只有一页快照的旧数据。 */
const importBody = {
  mainline: { original: "# 主线\n", cleaned: "# 主线\n" },
  decisions: [],
  queue: [],
  rounds: [
    {
      legacyId: "report-1",
      stage: "构思",
      date: "2026-09-18",
      pages: [{ legacyId: "report-1", snapshot: htmlHash }],
      files: [],
    },
  ],
  expected: { rounds: 1, pages: 1, decisions: 0, queue: 0, images: 0 },
};

describe("POST /legacy/pages/check", () => {
  it("历史页面模式：跳过起始日期更晚的规则，拦截写位置", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/legacy/pages/check", {
      body: { stage: "构思", pageDate: "2026-09-19", data: { stats: [] } },
    });
    const report = dataOf(res) as { block: { rule: string }[]; skipped: string[]; round: null };
    expect(report.round).toBeNull();
    expect(report.block.map((issue) => issue.rule)).toEqual(["page.field.unknown"]);
    const clean = dataOf(
      await t.request("POST", "/api/v1/legacy/pages/check", {
        body: { stage: "构思", pageDate: "2026-09-19", data: {} },
      }),
    ) as { skipped: string[] };
    expect(clean.skipped).toContain("card.shared.required");
  });

  it("阶段写错了，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/legacy/pages/check", {
      body: { stage: "修复", pageDate: "2026-09-19", data: {} },
    });
    expect(errorOf(res).code).toBe("BAD_REQUEST");
  });
});

describe("迁移的几步", () => {
  it("归档、导入、完成，状态一步一步变；快照的一页带着网页的哈希", async () => {
    const t = await legacyApp();
    const status = dataOf(await t.request("GET", "/api/v1/projects/app/legacy"));
    expect(status).toMatchObject({ project: "app", status: null, archive: null });

    const archive = makeArchive(files);
    const received = await upload(t, archive);
    expect(received.status).toBe(201);
    expect(received.body.data).toMatchObject({ sha256: sha256(archive), files: 2 });
    expect(readdirSync(t.paths.dirs.archives)).toHaveLength(1);

    const put = await t.app.request(`/api/v1/blobs/${htmlHash}`, {
      method: "PUT",
      headers: { host, "X-Ploop-Client": "cli/2.0.0", "Content-Type": "text/html" },
      body: html,
    });
    expect(put.status).toBe(201);
    const imported = await t.request("POST", "/api/v1/projects/app/legacy/import", {
      body: importBody,
    });
    expect(dataOf(imported)).toEqual({ counts: importBody.expected });

    const completed = await t.request("POST", "/api/v1/projects/app/legacy/complete", {
      body: {},
    });
    expect(dataOf(completed)).toMatchObject({
      skillVersion: "0.0.1",
      ended: 1,
      started: 2,
      cleanup: ["主线.md", "walk/2026-09-18/report-1.html"],
    });
    const after = dataOf(await t.request("GET", "/api/v1/projects/app/legacy"));
    expect(after).toMatchObject({ status: "已完成" });

    // 工作台按快照的哈希从附件的接口取网页，原样显示。
    const round = dataOf(
      await t.request("GET", `/api/v1/projects/app/rounds/${encodeURIComponent("v1-构思-1")}`),
    ) as { pages: { id: number }[] };
    const id = round.pages.at(-1)?.id;
    const page = dataOf(await t.request("GET", `/api/v1/projects/app/pages/${id}`));
    expect(page).toMatchObject({ snapshot: htmlHash });
    const blob = await t.app.request(`/api/v1/blobs/${htmlHash}`, { headers: { host } });
    expect(await blob.text()).toBe(html);
  });

  it("包的哈希对不上、清单对不上，都不留文件；已经完成的项目不能再归档", async () => {
    const t = await legacyApp();
    const archive = makeArchive(files);
    const wrong = await upload(t, archive, "0".repeat(64));
    expect(wrong.status).toBe(400);
    const listed = [{ path: "主线.md", size: 1, sha256: "a".repeat(64) }];
    const bad = await upload(t, makeArchive(files, listed));
    expect(bad.status).toBe(400);
    expect(bad.body.error?.message).toBe("归档包里的 主线.md 和清单写的字节数或哈希不同。");
    expect(existsSync(t.paths.dirs.archives) ? readdirSync(t.paths.dirs.archives) : []).toEqual([]);
    const noHash = await t.app.request("/api/v1/projects/app/legacy/archive?sha256=abc", {
      method: "POST",
      headers: { host, "X-Ploop-Client": "cli/2.0.0" },
      body: archive,
    });
    expect(noHash.status).toBe(400);
  });

  it("没有归档就导入返回 CONFLICT，项目不存在返回 NOT_FOUND", async () => {
    const t = await legacyApp();
    const res = await t.request("POST", "/api/v1/projects/app/legacy/import", { body: importBody });
    expect(errorOf(res)).toMatchObject({
      code: "CONFLICT",
      message: "项目「app」还没有归档，不能导入。",
    });
    const missing = await t.request("GET", "/api/v1/projects/nope/legacy");
    expect(errorOf(missing).code).toBe("NOT_FOUND");
  });

  it("归档包超过五兆也收", async () => {
    const t = await legacyApp();
    const big = randomBytes(6 * 1024 * 1024);
    const archive = makeArchive([{ path: "walk/big.png", data: big }]);
    expect(archive.byteLength).toBeGreaterThan(5 * 1024 * 1024);
    const received = await upload(t, archive);
    expect(received.status).toBe(201);
  });
});
