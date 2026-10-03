import { describe, expect, it } from "vitest";
import { addQueueItem } from "../../core/queue.ts";
import { startRound } from "../../core/rounds/start.ts";
import { addProject } from "../../core/testing.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 落地五步的接口，用 app.request 测，见「05 接口」第四节。每个接口一成一败。
// 五步本身的规矩在 core/land/steps.test.ts 里逐条测过，这里只测路由、编码和状态码。

const base = "/api/v1/projects/app/rounds/v1-%E8%90%BD%E5%9C%B0-1/land";
const name = encodeURIComponent("看板放到首页");

const plan = [
  "## 要做的事",
  "看板放到首页。",
  "## 现状",
  "读过了。",
  "## 要不要先重构",
  "不要。改动都很小，不碰结构。",
  "## 功能改动",
  "1. 看板放到首页",
  "   对应 Q1。检查 `node check.js`，查看板在第一屏。",
  "## 用什么锁住现有的行为",
  "`pnpm test`",
  "## 对应哪个场景",
  "S1 看队列。",
  "## 裁决",
  "| 裁决 | 理由 | 错了的代价 |",
  "| --- | --- | --- |",
  "| 不重构 | 改动小 | 小 |",
].join("\n");

const run = (exitCode: number, commit: string) => ({
  command: ["node", "check.js"],
  cwd: "/work/app",
  exitCode,
  outputTail: exitCode === 0 ? "ok" : "not ok",
  commit,
  startedAt: "2026-09-28T08:00:00.000Z",
  durationMs: 12,
  cliVersion: "dev",
});
const red = "1".repeat(40);
const green = "2".repeat(40);

/** 项目 app 开着第一轮落地，拿出了 Q1。 */
async function landApp(): Promise<TestApp> {
  const t = await testApp();
  addProject(t.core, "/work/app");
  addQueueItem(t.core.ctx, "app", { content: "看板放到首页", stage: "land", proposer: "ai" });
  const started = startRound(t.core.ctx, "app", { stage: "land" });
  if (!started.ok) throw new Error(started.error.message);
  return t;
}

describe("落地五步的接口", () => {
  it("依次交计划、跳过重构、先失败后通过、跳过评审，状态里五步齐了，枚举写中文", async () => {
    const t = await landApp();
    const planned = await t.request("PUT", `${base}/plan`, { body: { text: plan } });
    expect(planned.status).toBe(200);
    expect(dataOf(planned)).toMatchObject({ round: "v1-落地-1", replaced: false });

    const tidy = await t.request("POST", `${base}/tidy`, { body: { skip: true } });
    expect(dataOf(tidy)).toMatchObject({ tidy: { state: "跳过了" } });

    const failed = await t.request("POST", `${base}/changes/${name}/red`, {
      body: { run: run(1, red) },
    });
    expect(dataOf(failed)).toMatchObject({ change: { name: "看板放到首页", state: "只有失败" } });

    const passed = await t.request("POST", `${base}/changes/${name}/green`, {
      body: { run: run(0, green), commitsAfterRed: [green] },
    });
    expect(dataOf(passed)).toMatchObject({ change: { state: "先失败后通过", commit: green } });

    const reviewed = await t.request("POST", `${base}/review`, {
      body: {
        skip: "改动很小",
        changed: [{ root: "/work/app", path: "a.ts", added: 3, deleted: 1 }],
      },
    });
    expect(dataOf(reviewed)).toMatchObject({
      review: { state: "跳过了", diff: { lines: 4, files: 1, within: true } },
    });

    const status = await t.request("GET", base);
    expect(status.status).toBe(200);
    expect(dataOf(status)).toMatchObject({ complete: true, missing: [], uncoveredQueue: [] });
  });

  it("计划缺节返回 RULE_BLOCKED；没交计划就记重构是 land.order", async () => {
    const t = await landApp();
    const bad = await t.request("PUT", `${base}/plan`, { body: { text: "## 要做的事\n一件。" } });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).rule).toBe("land.plan.sections");
    const tidy = await t.request("POST", `${base}/tidy`, { body: { skip: true } });
    expect(errorOf(tidy).rule).toBe("land.order");
  });

  it("失败的运行其实通过了，返回 RULE_BLOCKED；通过没带提交列表，返回 BAD_REQUEST", async () => {
    const t = await landApp();
    await t.request("PUT", `${base}/plan`, { body: { text: plan } });
    await t.request("POST", `${base}/tidy`, { body: { skip: true } });
    const red0 = await t.request("POST", `${base}/changes/${name}/red`, {
      body: { run: run(0, red) },
    });
    expect(errorOf(red0).rule).toBe("land.red.failed");
    const green0 = await t.request("POST", `${base}/changes/${name}/green`, {
      body: { run: run(0, green) },
    });
    expect(green0.status).toBe(400);
  });

  it("超过界线却跳过评审，返回 RULE_BLOCKED；不是落地阶段的状态，返回 CONFLICT", async () => {
    const t = await landApp();
    await t.request("PUT", `${base}/plan`, { body: { text: plan } });
    await t.request("POST", `${base}/tidy`, { body: { skip: true } });
    await t.request("POST", `${base}/changes/${name}/red`, { body: { run: run(1, red) } });
    await t.request("POST", `${base}/changes/${name}/green`, {
      body: { run: run(0, green), commitsAfterRed: [green] },
    });
    const big = [{ root: "/work/app", path: "a.ts", added: 80, deleted: 0 }];
    const skipped = await t.request("POST", `${base}/review`, {
      body: { skip: "想跳过", changed: big },
    });
    expect(errorOf(skipped).rule).toBe("land.review.required");

    addQueueItem(t.core.ctx, "app", { content: "理清给谁用", stage: "think", proposer: "ai" });
    const other = await t.request(
      "GET",
      "/api/v1/projects/app/rounds/v1-%E6%9E%84%E6%80%9D-1/land",
    );
    expect([404, 409]).toContain(other.status);
  });
});
