import type { Issue } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { dataOf, type TestApp, testApp } from "../testing.ts";

// 备份的警告放进状态接口的 warnings，见「03 数据模型」第七节。
// 命令行（客户端是 cli/…）读状态时不带 Time Machine 的那几条，它们只在 ploop backup list 里写（P29）。
// 警告本身怎么来的在 process/backup.test.ts，这里只看接口带不带、放在哪里。

const backup: Issue = {
  message: "Time Machine 没有设置备份盘，集中存储没有第二份。",
  hint: "在系统设置的 Time Machine 里添加备份盘。",
};

async function withWarnings(): Promise<{
  t: TestApp;
  asked: Date[];
  asks: (boolean | undefined)[];
}> {
  const asked: Date[] = [];
  // 每次被问到时，要不要 Time Machine 的警告。
  const asks: (boolean | undefined)[] = [];
  const t = await testApp({
    backupWarnings: async (now, only) => {
      asked.push(now);
      asks.push(only?.timeMachine);
      return only?.timeMachine === false ? [] : [backup];
    },
  });
  return { t, asked, asks };
}

async function register(t: TestApp, extra: object = {}): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", {
    body: { root: "/work/app", repoKind: "自己的", ...extra },
  });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

describe("状态里的备份警告", () => {
  it("GET /projects/:pid/status：接在项目自己的警告后面，时间用接口的时钟", async () => {
    const { t, asked } = await withWarnings();
    const id = await register(t, { legacySource: "/work/app/docs" });
    const res = await t.request("GET", `/api/v1/projects/${id}/status`);
    expect(res.status).toBe(200);
    const warnings = res.body.ok ? res.body.warnings : [];
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.message).toMatch(/ploop doctor|迁移检查/u);
    expect(warnings[1]).toEqual(backup);
    expect(asked).toEqual([t.deps.now()]);
  });

  it("GET /projects：所有项目的状态也带上，只带一次", async () => {
    const { t } = await withWarnings();
    await register(t);
    const res = await t.request("GET", "/api/v1/projects");
    expect(res.body.ok ? res.body.warnings : []).toEqual([backup]);
  });

  it("GET /projects?path= 按路径找项目，不带", async () => {
    const { t, asked } = await withWarnings();
    await register(t);
    const res = await t.request("GET", `/api/v1/projects?path=${encodeURIComponent("/work/app")}`);
    expect(res.body.ok ? res.body.warnings : undefined).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("命令行读状态：状态和所有项目的状态都不带 Time Machine 的警告，工作台照旧带", async () => {
    const { t, asks } = await withWarnings();
    const id = await register(t);
    const cli = { "X-Ploop-Client": "cli/2.0.0" };
    const status = await t.request("GET", `/api/v1/projects/${id}/status`, { headers: cli });
    expect(status.body.ok ? status.body.warnings : undefined).toEqual([]);
    const all = await t.request("GET", "/api/v1/projects", { headers: cli });
    expect(all.body.ok ? all.body.warnings : undefined).toEqual([]);
    expect(asks).toEqual([false, false]);

    const web = { "X-Ploop-Client": "web/2.0.0" };
    const shown = await t.request("GET", `/api/v1/projects/${id}/status`, { headers: web });
    expect(shown.body.ok ? shown.body.warnings : undefined).toEqual([backup]);
  });

  it("GET /admin/backups：备份的警告放在这里，命令行 ploop backup list 显示", async () => {
    const { t, asks } = await withWarnings();
    const res = await t.request("GET", "/api/v1/admin/backups");
    expect(res.status).toBe(200);
    expect(res.body.ok ? res.body.warnings : undefined).toEqual([backup]);
    expect(asks).toEqual([undefined]);
    // 命令行来的请求也带：ploop backup list 就是这个接口。
    const cli = await t.request("GET", "/api/v1/admin/backups", {
      headers: { "X-Ploop-Client": "cli/2.0.0" },
    });
    expect(cli.body.ok ? cli.body.warnings : undefined).toEqual([backup]);
  });

  it("项目不存在时照常返回 NOT_FOUND", async () => {
    const { t } = await withWarnings();
    const res = await t.request("GET", "/api/v1/projects/nothing/status");
    expect(res.status).toBe(404);
  });
});
