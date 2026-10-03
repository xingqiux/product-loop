import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addQueueItem } from "../../core/queue.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import { type BlobHash, putBlob } from "../../store/blobs.ts";
import { encodePng, productScreen } from "../../store/screen-testing.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 使用记录和屏的接口，用 app.request 测，见「05 接口」第四节。每个接口一成一败。
// 收下一次运行的规矩在 core/use/ingest.test.ts 里逐条测过，这里只测路由、编码和状态码。

/** 项目 app 开着第一轮使用。 */
async function useApp(): Promise<TestApp> {
  const t = await testApp();
  addProject(t.core, "/work/app");
  addQueueItem(t.core.ctx, "app", { content: "走一遍看队列", stage: "use", proposer: "ai" });
  const started = startRound(t.core.ctx, "app", { stage: "use" });
  if (!started.ok) throw new Error(started.error.message);
  return t;
}

/** 把一张产品截图放进附件库，返回哈希。 */
async function shot(t: TestApp): Promise<BlobHash> {
  const bytes = encodePng(productScreen());
  const hash = createHash("sha256").update(bytes).digest("hex") as BlobHash;
  const stored = await putBlob({ db: t.core.ctx.db, dir: t.paths.dirs.blobs }, bytes, hash, {
    contentType: "image/png",
    source: "test",
  });
  if (!stored.ok) throw new Error(stored.error.kind);
  return hash;
}

const output = {
  schemaVersion: 1,
  scenes: [
    {
      scene: "S1",
      steps: [
        {
          step: 1,
          width: 1400,
          do: "点队列",
          expect: "五列看板",
          result: "通过",
          screenshot: "s1-1.png",
        },
        { step: 2, do: "点一件事", expect: "右边摆出详情", result: "断了", error: "没有详情" },
      ],
    },
  ],
};

describe("使用记录和屏的接口", () => {
  it("收下一次运行，最近一次和变过的屏都能取到，结果写中文", async () => {
    const t = await useApp();
    const hash = await shot(t);
    const posted = await t.request("POST", "/api/v1/projects/app/use-runs", {
      body: { output, screenshots: [{ path: "s1-1.png", hash }], coverage: "| 东西 | 场景 |" },
    });
    expect(posted.status).toBe(200);
    expect(dataOf(posted)).toMatchObject({
      run: { round: "v1-使用-1", results: { pass: 1, broken: 1 } },
      newScreens: [{ scene: "S1", step: 1, width: 1400 }],
    });

    const latest = await t.request("GET", "/api/v1/projects/app/use-runs/latest");
    expect(dataOf(latest)).toMatchObject({
      coverage: "| 东西 | 场景 |",
      scenes: [{ scene: "S1", steps: [{ result: "通过" }, { result: "断了" }] }],
    });

    const changed = await t.request("GET", "/api/v1/projects/app/screens/changed");
    expect(dataOf(changed)).toMatchObject({
      version: 1,
      scenes: [{ scene: "S1", screens: [{ step: 1, status: "新出现", shot: hash }] }],
    });

    const schema = await t.request("GET", "/api/v1/schema/use-run");
    expect(dataOf(schema)).toMatchObject({ type: "object" });
  });

  it("截图没上传返回 RULE_BLOCKED；查不存在的项目返回 NOT_FOUND", async () => {
    const t = await useApp();
    const posted = await t.request("POST", "/api/v1/projects/app/use-runs", {
      body: { output, screenshots: [{ path: "s1-1.png", hash: "a".repeat(64) }] },
    });
    expect(errorOf(posted).code).toBe("RULE_BLOCKED");
    const latest = await t.request("GET", "/api/v1/projects/nope/use-runs/latest");
    expect(errorOf(latest).code).toBe("NOT_FOUND");
    const changed = await t.request("GET", "/api/v1/projects/app/screens/changed?version=x");
    expect(changed.status).toBe(400);
  });
});
