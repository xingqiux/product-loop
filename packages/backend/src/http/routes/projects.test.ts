import { designSpecItem, mainlinePart } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appSkillVersion, getProject } from "../../core/projects.ts";
import { addRound, startAt } from "../../core/testing.ts";
import { projects } from "../../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 项目、版本和状态的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 业务规则的细节在内核的测试里，这里只看请求和响应：中文进出、状态码、外壳的警告和下一步。

const at = startAt.toISOString();
const later = (ms: number) => new Date(startAt.getTime() + ms);
const day = 24 * 60 * 60 * 1000;

/** 刚登记的项目在接口上的样子。 */
function projectAt(id: string, root: string, extra: object = {}) {
  return {
    id,
    name: root.split("/").at(-1),
    repoKind: "自己的",
    ignoreFile: null,
    skillVersion: appSkillVersion,
    legacySource: null,
    roots: [root],
    createdAt: at,
    ...extra,
  };
}

/** 进行中的第 1 版在接口上的样子。 */
const versionOne = {
  version: 1,
  status: "进行中",
  startedAt: at,
  endedAt: null,
  summary: null,
  endReason: null,
};

const zeroQueue = ["构思", "使用", "检查", "落地", "提升"].map((stage) => ({
  stage,
  count: 0,
  stale: 0,
}));

/** 经接口登记一个项目，返回它的编号。 */
async function register(t: TestApp, root: string, extra: object = {}): Promise<string> {
  const res = await t.request("POST", "/api/v1/projects", {
    body: { root, repoKind: "自己的", ...extra },
  });
  return (dataOf(res) as { project: { id: string } }).project.id;
}

describe("POST /projects", () => {
  it("登记项目，返回项目和第 1 版，枚举写中文", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: {
        root: "/Users/someone/proj/product-loop",
        name: "产品循环",
        repoKind: "共用的",
        ignoreFile: "/Users/someone/proj/product-loop/.git/info/exclude",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      ok: true,
      data: {
        project: projectAt("product-loop", "/Users/someone/proj/product-loop", {
          name: "产品循环",
          repoKind: "共用的",
          ignoreFile: "/Users/someone/proj/product-loop/.git/info/exclude",
        }),
        version: 1,
      },
      warnings: [],
      next: [],
    });
  });

  it("家目录不能当根目录，返回 BAD_REQUEST，写明怎么改", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: { root: "/Users/someone", repoKind: "自己的" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res)).toEqual({
      code: "BAD_REQUEST",
      message: "「/Users/someone」是家目录，不能当项目根目录。",
      hint: "换成项目自己的文件夹，例如 ~/proj/<项目名>。",
      where: "/Users/someone",
    });
  });

  it("根目录已经登记给别的项目，返回 CONFLICT", async () => {
    const t = await testApp();
    await register(t, "/work/app");
    const res = await t.request("POST", "/api/v1/projects", {
      body: { root: "/work/app/", repoKind: "共用的" },
    });
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: "CONFLICT",
      message: "根目录「/work/app」已经登记给项目「app」。",
    });
  });

  it("名称写成空的，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const res = await t.request("POST", "/api/v1/projects", {
      body: { root: "/work/app", repoKind: "自己的", name: "  " },
    });
    expect(errorOf(res)).toMatchObject({ code: "BAD_REQUEST", message: "项目的名称不能是空的。" });
  });
});

describe("GET /projects/:pid", () => {
  it("返回项目的详情", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("GET", `/api/v1/projects/${id}`);
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual(projectAt("app", "/work/app"));
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app");
    expect(res.status).toBe(404);
    expect(errorOf(res)).toEqual({
      code: "NOT_FOUND",
      message: "没有叫「app」的项目。",
      hint: "运行 ploop status --all，查看已登记的项目。",
    });
  });
});

describe("PATCH /projects/:pid", () => {
  it("改名称、仓库类别、忽略规则的位置和根目录，中文的仓库类别存成英文键", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app", { ignoreFile: "/work/app/.gitignore" });
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, {
      body: {
        name: "演示",
        repoKind: "共用的",
        ignoreFile: null,
        addRoots: ["/work/app-wt"],
        removeRoots: ["/work/app"],
      },
    });
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual(
      projectAt("app", "/work/app", { name: "演示", repoKind: "共用的", roots: ["/work/app-wt"] }),
    );
    const stored = getProject(t.core.ctx.db, id);
    expect(stored.ok && [stored.value.repoKind, stored.value.ignoreFile]).toEqual(["shared", null]);
  });

  it("没写的不改", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, { body: {} });
    expect(dataOf(res)).toEqual(projectAt("app", "/work/app"));
  });

  it("迁移没完成的项目，返回 NEEDS_DOCTOR", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app", { legacySource: "/work/app/docs" });
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, { body: { name: "演示" } });
    expect(res.status).toBe(412);
    expect(errorOf(res)).toMatchObject({
      code: "NEEDS_DOCTOR",
      message: "项目「app」的迁移还没完成，要先做迁移检查。",
    });
  });

  it("删完以后一个根目录都不剩，返回 CONFLICT", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("PATCH", `/api/v1/projects/${id}`, {
      body: { removeRoots: ["/work/app"] },
    });
    expect(res.status).toBe(409);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("PATCH", "/api/v1/projects/app", { body: { name: "演示" } });
    expect(res.status).toBe(404);
  });
});

describe("GET /projects?path=", () => {
  it("按路径找项目：路径在根目录下面，返回项目和那个根目录", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request(
      "GET",
      `/api/v1/projects?path=${encodeURIComponent("/work/app/src/中文")}`,
    );
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({ project: projectAt(id, "/work/app"), root: "/work/app" });
  });

  it("不在任何登记过的根目录里，返回 NOT_FOUND，写明是哪个路径", async () => {
    const t = await testApp();
    await register(t, "/work/app");
    const res = await t.request("GET", "/api/v1/projects?path=/work/app-2");
    expect(res.status).toBe(404);
    expect(errorOf(res)).toMatchObject({
      code: "NOT_FOUND",
      message: "「/work/app-2」不在任何登记过的项目根目录里。",
      where: "/work/app-2",
    });
  });

  it("不是绝对路径，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects?path=work/app");
    expect(res.status).toBe(400);
  });
});

describe("GET /projects", () => {
  it("没有项目时是空的", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects");
    expect(res.body).toEqual({ ok: true, data: [], warnings: [], next: [] });
  });

  it("所有项目的状态，最近改过的在前。要先做迁移检查的写进外壳的警告，写明是哪个项目", async () => {
    const t = await testApp();
    await register(t, "/work/old", { legacySource: "/work/old/docs" });
    t.core.setNow(later(2 * day));
    await register(t, "/work/app");
    t.core.setNow(later(5 * day));
    const res = await t.request("GET", "/api/v1/projects");
    expect(res.status).toBe(200);
    const data = dataOf(res) as { project: { id: string }; idleDays: number; skill: object }[];
    expect(data.map((status) => [status.project.id, status.idleDays, status.skill])).toEqual([
      [
        "app",
        3,
        { version: appSkillVersion, current: appSkillVersion, doctor: null, newerRules: false },
      ],
      [
        "old",
        5,
        { version: null, current: appSkillVersion, doctor: "迁移未完成", newerRules: false },
      ],
    ]);
    expect(res.body.ok && res.body.warnings).toEqual([
      {
        message: "项目「old」的迁移还没完成，要先做迁移检查。",
        hint: "运行 ploop doctor，按报告做完迁移。迁移完成以前，这个项目的旧文件仍可以用旧的脚本处理。",
      },
    ]);
    expect(res.body.ok && res.body.next).toEqual([]);
  });

  it("查询参数写错，返回 BAD_REQUEST", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects?all=1");
    expect(res.status).toBe(400);
  });
});

describe("GET /projects/:pid/status", () => {
  it("刚登记的项目：第 1 版，还没开始任何阶段，下一步放进外壳", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    const res = await t.request("GET", `/api/v1/projects/${id}/status`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: {
        project: projectAt("app", "/work/app"),
        version: versionOne,
        round: null,
        waitingPages: [],
        queue: zeroQueue,
        skill: {
          version: appSkillVersion,
          current: appSkillVersion,
          doctor: null,
          newerRules: false,
        },
        mainline: {
          revision: null,
          missingParts: mainlinePart.labels,
          missingDesignSpec: designSpecItem.labels,
        },
        lastChangedAt: at,
        idleDays: 0,
      },
      warnings: [],
      next: ["ploop round start 构思"],
    });
  });

  it("一个阶段进行中：阶段的种类和状态写中文", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    addRound(t.core, id, { version: 1, stage: "land", seq: 3, status: "open" });
    const res = await t.request("GET", `/api/v1/projects/${id}/status`);
    const data = dataOf(res) as { round: object };
    expect(data.round).toEqual({
      label: "v1-落地-3",
      version: 1,
      stage: "落地",
      seq: 3,
      status: "进行中",
      startedAt: at,
      closedAt: null,
      legacyId: null,
      summary: null,
    });
    expect(res.body.ok && res.body.next).toEqual(["ploop land plan"]);
  });

  it("要先做迁移检查的项目照常能查状态，警告和下一步放进外壳", async () => {
    const t = await testApp();
    const id = await register(t, "/work/app");
    t.core.ctx.db
      .update(projects)
      .set({ skillVersion: "v1-final" })
      .where(eq(projects.id, id))
      .run();
    const res = await t.request("GET", `/api/v1/projects/${id}/status`);
    expect(res.status).toBe(200);
    expect(dataOf(res)).toMatchObject({
      skill: { version: "v1-final", doctor: "停在旧版本", newerRules: false },
    });
    expect(res.body.ok && res.body.next).toEqual(["ploop doctor"]);
    expect(res.body.ok && res.body.warnings).toEqual([
      {
        message: "项目「app」停在 skill v1-final，现在的软件要求 0.0.1 以上。",
        hint: "运行 ploop doctor，把这个项目的数据升级到现在的格式。",
      },
    ]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/status");
    expect(res.status).toBe(404);
  });
});
