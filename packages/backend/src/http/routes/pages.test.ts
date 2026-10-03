import { createHash } from "node:crypto";
import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import { pageData, recordLandSteps } from "../../core/pages/testing.ts";
import { addQueueItem } from "../../core/queue.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import type { AppType } from "../../index.ts";
import { pages, ruleHits } from "../../store/schema/index.ts";
import { dataOf, errorOf, host, type TestApp, testApp } from "../testing.ts";

// 页面的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 校验、填充和撤回的细节在内核的测试里，这里只看请求和响应：中文进出、状态码、外壳的警告和下一步。
// 截图经附件的接口真的上传，给出信息时附件库按哈希找得到完整的一份。

/** 两张截图的内容，和页面数据里引用它们的路径。 */
const shots = [
  { path: "img/home.png", bytes: new TextEncoder().encode("首页的截图") },
  { path: "img/after.png", bytes: new TextEncoder().encode("改后的截图") },
];

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** 请求里的截图：路径和哈希。 */
const images = shots.map(({ path, bytes }) => ({ path, hash: sha256(bytes) }));

/** 一句四十多字的话，写作校验警告。 */
const longish =
  "看板现在放在首页的最下面，用户每次打开首页都要先翻过两屏的项目列表，才能看到自己关心的那几件事。";

/** 登记项目 app，放进三件落地的事，开始第一轮落地。截图 uploaded 为 true 时先上传。 */
async function landApp(uploaded = true): Promise<TestApp> {
  const t = await testApp();
  addProject(t.core, "/work/app");
  for (const content of [
    "看板放到首页的第一屏",
    "提交以后写明回复被取走了",
    "场景的步骤写成动宾短语",
  ]) {
    const added = addQueueItem(t.core.ctx, "app", { content, stage: "land", proposer: "ai" });
    if (!added.ok) throw new Error(added.error.message);
  }
  const started = startRound(t.core.ctx, "app", { stage: "land" });
  if (!started.ok) throw new Error(started.error.message);
  recordLandSteps(t.core);
  if (uploaded) {
    for (const { bytes } of shots) {
      const res = await t.app.request(`/api/v1/blobs/${sha256(bytes)}`, {
        method: "PUT",
        headers: { host, "X-Ploop-Client": "cli/2.0.0", "Content-Type": "image/png" },
        body: bytes,
      });
      expect(res.status).toBe(201);
    }
  }
  return t;
}

/** 给出一页，请求体可以另加字段。 */
function present(t: TestApp, more: object = {}, data: unknown = pageData()) {
  return t.request("POST", "/api/v1/projects/app/pages", {
    body: { round: "v1-落地-1", data, images, ...more },
  });
}

/** 给出一页，返回它的编号。 */
async function presentedId(t: TestApp): Promise<number> {
  return (dataOf(await present(t)) as { page: { id: number } }).page.id;
}

describe("POST /projects/:pid/pages/check", () => {
  it("只校验，不存页。有拦截时照样返回 200，拦截写规矩和位置，命中记下", async () => {
    const t = await landApp();
    const res = await t.request("POST", "/api/v1/projects/app/pages/check", {
      body: { round: "v1-落地-1", data: { ...pageData(), stats: [] }, images },
    });
    expect(res.status).toBe(200);
    const report = dataOf(res) as { block: { rule: string; where: string }[] };
    expect(report).toMatchObject({ stage: "落地", round: "v1-落地-1", warn: [], skipped: [] });
    expect(report.block).toMatchObject([{ rule: "page.field.unknown", where: "stats" }]);
    expect(t.core.ctx.db.select().from(pages).all()).toEqual([]);
    expect(t.core.ctx.db.select().from(ruleHits).all()).toHaveLength(1);
  });

  it("没有这个阶段，返回 NOT_FOUND", async () => {
    const t = await landApp();
    const res = await t.request("POST", "/api/v1/projects/app/pages/check", {
      body: { round: "v1-落地-2", data: pageData(), images },
    });
    expect(res.status).toBe(404);
  });

  it("用途写英文键，返回 BAD_REQUEST", async () => {
    const t = await landApp();
    const res = await t.request("POST", "/api/v1/projects/app/pages/check", {
      body: { round: "v1-落地-1", data: pageData(), purpose: "view" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("purpose");
  });
});

describe("POST /projects/:pid/pages", () => {
  it("给出一页，返回 201。枚举写中文，地址里的中文按 URL 编码，下一步是等回复", async () => {
    const t = await landApp();
    const res = await present(t);
    expect(res.status).toBe(201);
    const id = t.core.ctx.db.select({ id: pages.id }).from(pages).get()?.id;
    expect(res.body).toEqual({
      ok: true,
      data: {
        page: {
          id,
          project: "app",
          round: "v1-落地-1",
          seq: 1,
          purpose: "要用户点",
          status: "已给出",
          presentedAt: "2026-09-28T08:00:00.000Z",
        },
        roundStatus: "等用户回复",
        path: `/p/app/r/v1-${encodeURIComponent("落地")}-1`,
        cards: 2,
      },
      warnings: [],
      next: ["ploop reply wait"],
    });
  });

  it("写作校验的警告不拦截，放进外壳的 warnings", async () => {
    const t = await landApp();
    const data = pageData();
    const res = await present(t, {}, { ...data, asks: [{ ...data.asks[0], why: longish }] });
    expect(res.status).toBe(201);
    if (!res.body.ok) throw new Error("应当成功");
    expect(res.body.warnings.map((issue) => issue.rule)).toEqual(["writing.sentence.long"]);
  });

  it("截图没有上传，返回 RULE_BLOCKED，列出每一张", async () => {
    const t = await landApp(false);
    const res = await present(t);
    expect(res.status).toBe(422);
    expect(errorOf(res).issues?.map((issue) => issue.rule)).toEqual([
      "blob.present",
      "blob.present",
    ]);
  });

  it("已有一页在等，返回 CONFLICT，先写在等的是哪一页", async () => {
    const t = await landApp();
    await presentedId(t);
    const res = await present(t);
    expect(res.status).toBe(409);
    const error = errorOf(res);
    expect(error.rule).toBe("page.oneWaiting");
    expect(error.message).toContain("第 1 版的落地阶段的第 1 页");
  });

  it("来源写了文件和行号，却没交原文，返回 BAD_REQUEST", async () => {
    const t = await landApp();
    const data = pageData();
    const source = { name: "状态接口", file: "src/status.ts", lines: "3-4" };
    const ask = { ...data.asks[0], sources: [source] };
    const res = await present(t, {}, { ...data, asks: [ask] });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("asks[0].sources[0]");
  });
});

describe("GET /projects/:pid/pages/:id", () => {
  it("返回填好的一页：页面数据带卡片编号，后端填的部分和原文摘录都在，枚举写中文", async () => {
    const t = await landApp();
    const data = pageData();
    const source = { name: "状态接口", file: "src/status.ts", lines: "3-4", mark: [4] };
    const [first] = data.asks;
    const ask = { ...first, sources: [...(first?.sources ?? []), source] };
    const fileHash = "e".repeat(64);
    const excerpts = [{ file: "src/status.ts", lines: "3-4", text: "甲\n乙", fileHash }];
    const presented = await present(t, { excerpts }, { ...data, asks: [ask] });
    const { id } = (dataOf(presented) as { page: { id: number } }).page;

    const res = await t.request("GET", `/api/v1/projects/app/pages/${id}`);
    expect(res.status).toBe(200);
    const page = dataOf(res) as Record<string, unknown> & {
      sections: { asks: { id: string }[] };
      fill: {
        header: { stage: string };
        strip: { stages: { stage: string; rounds: { status: string }[] }[] };
        queue: { columns: { stage: string; items: { stage: string; status: string }[] }[] };
      };
    };
    expect(page).toMatchObject({
      id,
      project: "app",
      round: "v1-落地-1",
      stage: "落地",
      purpose: "要用户点",
      status: "已给出",
      withdrawal: null,
      images,
      excerpts: [
        {
          where: "asks[0].sources[1]",
          file: "src/status.ts",
          lines: "3-4",
          start: 3,
          end: 4,
          mark: [4],
          text: "甲\n乙",
          fileHash,
        },
      ],
    });
    expect(page.sections.asks[0]?.id).toMatch(/^ask-/u);
    expect(page.fill.header.stage).toBe("落地");
    expect(page.fill.strip.stages.map((s) => s.stage)).toEqual([
      "构思",
      "使用",
      "检查",
      "落地",
      "提升",
    ]);
    expect(page.fill.strip.stages[3]?.rounds.map((r) => r.status)).toEqual(["等用户回复"]);
    const land = page.fill.queue.columns.find((column) => column.stage === "落地");
    expect(land?.items.map((item) => [item.stage, item.status])).toEqual([
      ["落地", "进行中"],
      ["落地", "进行中"],
      ["落地", "进行中"],
    ]);
  });

  it("撤回的页写撤回的时间和原因，状态是已撤回", async () => {
    const t = await landApp();
    const id = await presentedId(t);
    await t.request("POST", `/api/v1/projects/app/pages/${id}/withdraw`, {
      body: { reason: "卡片写错了" },
    });
    const page = dataOf(await t.request("GET", `/api/v1/projects/app/pages/${id}`));
    expect(page).toMatchObject({
      status: "已撤回",
      withdrawal: { at: "2026-09-28T08:00:00.000Z", reason: "卡片写错了", replacedBy: null },
    });
  });

  it("页面在别的项目里，返回 NOT_FOUND，写明是哪个项目", async () => {
    const t = await landApp();
    const id = await presentedId(t);
    addProject(t.core, "/work/other");
    const res = await t.request("GET", `/api/v1/projects/other/pages/${id}`);
    expect(res.status).toBe(404);
    expect(errorOf(res).message).toBe(`项目「other」里没有编号为 ${id} 的页面。`);
  });

  it("没有这一页返回 NOT_FOUND，编号写错返回 BAD_REQUEST", async () => {
    const t = await landApp();
    expect((await t.request("GET", "/api/v1/projects/app/pages/9")).status).toBe(404);
    const bad = await t.request("GET", "/api/v1/projects/app/pages/0");
    expect(bad.status).toBe(400);
    expect(errorOf(bad)).toMatchObject({ where: "0" });
  });
});

describe("POST /projects/:pid/pages/:id/withdraw", () => {
  it("撤回在等的一页，这个阶段回到进行中，下一步是按回答处理再收尾，或再给出一页", async () => {
    const t = await landApp();
    const id = await presentedId(t);
    const res = await t.request("POST", `/api/v1/projects/app/pages/${id}/withdraw`, { body: {} });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: {
        page: expect.objectContaining({ id, status: "已撤回", purpose: "要用户点" }),
        roundStatus: "进行中",
      },
      warnings: [],
      next: ["ploop round close", "ploop page present"],
    });
  });

  it("已经撤回的页再撤回，返回 CONFLICT", async () => {
    const t = await landApp();
    const id = await presentedId(t);
    await t.request("POST", `/api/v1/projects/app/pages/${id}/withdraw`, { body: {} });
    const res = await t.request("POST", `/api/v1/projects/app/pages/${id}/withdraw`, { body: {} });
    expect(res.status).toBe(409);
  });

  it("原因只写了空白，返回 BAD_REQUEST", async () => {
    const t = await landApp();
    const id = await presentedId(t);
    const res = await t.request("POST", `/api/v1/projects/app/pages/${id}/withdraw`, {
      body: { reason: " " },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).where).toBe("reason");
  });
});

describe("接口的类型", () => {
  // 类型化客户端从 AppType 看到的请求和响应，由类型检查核对，见「02 技术选型」第六节。
  const client = hc<AppType>("http://127.0.0.1:4731");
  type Pages = (typeof client.api.v1.projects)[":pid"]["pages"];
  type Present = Pages["$post"];
  type Page = Pages[":id"]["$get"];

  it("请求和响应里的用途、状态、阶段都写中文", () => {
    type Purpose = InferRequestType<Present>["json"]["purpose"];
    expectTypeOf<Purpose>().toEqualTypeOf<"要用户点" | "只看" | undefined>();
    type Status = InferResponseType<Present, 201>["data"]["page"]["status"];
    expectTypeOf<Status>().toEqualTypeOf<"已给出" | "已回复" | "已撤回">();
    type Stage = InferResponseType<Page, 200>["data"]["fill"]["header"]["stage"];
    expectTypeOf<Stage>().toEqualTypeOf<"构思" | "使用" | "检查" | "落地" | "提升">();
  });

  it("给出信息按状态码收窄：在等是 CONFLICT，拦截是 RULE_BLOCKED", () => {
    expectTypeOf<InferResponseType<Present, 409>["error"]["code"]>().toEqualTypeOf<"CONFLICT">();
    type Blocked = InferResponseType<Present, 422>["error"]["code"];
    expectTypeOf<Blocked>().toEqualTypeOf<"RULE_BLOCKED">();
    expectTypeOf<InferResponseType<Page, 404>["error"]["code"]>().toEqualTypeOf<"NOT_FOUND">();
  });
});
