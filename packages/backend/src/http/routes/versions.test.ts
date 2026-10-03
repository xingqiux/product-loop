import { describe, expect, it } from "vitest";
import { addRound, startAt } from "../../core/testing.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 产品版本的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 换版的细节在内核 versions.test.ts 里，这里只看请求和响应：中文进出、状态码。

const at = startAt.toISOString();
const later = (ms: number) => new Date(startAt.getTime() + ms);
const day = 24 * 60 * 60 * 1000;

/** 进行中的第 1 版在接口上的样子。 */
const versionOne = {
  version: 1,
  status: "进行中",
  startedAt: at,
  endedAt: null,
  summary: null,
  endReason: null,
};

/** 经接口登记一个项目，返回它的编号。 */
async function register(t: TestApp, root: string, extra: object = {}): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", {
    body: { root, repoKind: "自己的", ...extra },
  });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

describe("GET /projects/:pid/versions", () => {
  it("各版和每版下的阶段，从第 1 版排起", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    addRound(t.core, id, { version: 1, stage: "think", seq: 1 });
    await t.request("POST", `/api/v1/projects/${id}/versions/next`, { body: { reason: "跳过" } });
    const res = await t.request("GET", `/api/v1/projects/${id}/versions`);
    expect(res.status).toBe(200);
    const data = dataOf(res) as { version: number; status: string; rounds: { label: string }[] }[];
    expect(data.map((v) => [v.version, v.status, v.rounds.map((r) => r.label)])).toEqual([
      [1, "已结束", ["v1-构思-1"]],
      [2, "进行中", []],
    ]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/versions");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/versions/current", () => {
  it("当前的一版和它下面的阶段", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    addRound(t.core, id, { version: 1, stage: "use", seq: 1, status: "waiting" });
    const res = await t.request("GET", `/api/v1/projects/${id}/versions/current`);
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      ...versionOne,
      rounds: [{ label: "v1-使用-1", stage: "使用", status: "等用户回复" }],
    });
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/versions/current");
    expect(res.status).toBe(404);
  });
});

describe("POST /projects/:pid/versions/next", () => {
  it("结束当前的一版并记下原因，开始下一版", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    t.core.setNow(later(day));
    const res = await t.request("POST", `/api/v1/projects/${id}/versions/next`, {
      body: { reason: "跳过提升，先做下一版" },
    });
    expect(res.status).toBe(201);
    const now = later(day).toISOString();
    expect(dataOf(res)).toEqual({
      ended: { ...versionOne, status: "已结束", endedAt: now, endReason: "跳过提升，先做下一版" },
      started: { ...versionOne, version: 2, startedAt: now },
    });
  });

  it("原因是空的，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("POST", `/api/v1/projects/${id}/versions/next`, {
      body: { reason: " " },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("提前结束一版要写一句原因。");
  });

  it("还有一个阶段没收尾，返回 CONFLICT，写明是哪个阶段", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    addRound(t.core, id, { version: 1, stage: "check", seq: 1, status: "replied" });
    const res = await t.request("POST", `/api/v1/projects/${id}/versions/next`, {
      body: { reason: "跳过" },
    });
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({ code: "CONFLICT", where: "第 1 版的检查阶段" });
  });

  it("迁移没完成的项目，返回 NEEDS_DOCTOR", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app", { legacySource: "/work/app/docs" });
    const res = await t.request("POST", `/api/v1/projects/${id}/versions/next`, {
      body: { reason: "跳过" },
    });
    expect(res.status).toBe(412);
  });

  it("没写原因，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("POST", `/api/v1/projects/${id}/versions/next`, { body: {} });
    expect(errorOf(res)).toMatchObject({ message: "没有写 reason。", where: "reason" });
  });
});
