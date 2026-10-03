import type { ErrorBody, Result } from "@product-loop/model";
import { type BlobHash, blobs } from "../../store/schema/index.ts";
import { recordGreen, recordPlan, recordRed, recordReview, recordTidy } from "../land/steps.ts";
import { addQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore, type TestCore } from "../testing.ts";
import type { PresentDeps, PresentInput } from "./present.ts";

// 给出信息、填充和撤回的测试共用的东西，只给测试用。
// 项目 app 开着第一轮落地，拿出了三件事，附件库里有两张截图。
// 合格的一页用疑问卡处理 Q1，用更改处理 Q2 和 Q3。

/** 六十四位的哈希，由一个字符重复而成。 */
export const hash = (digit: string) => digit.repeat(64);

/** 附件库里有的哈希。 */
const storedHashes = new Set([hash("a"), hash("c")]);

export const deps: PresentDeps = { hasBlob: (value) => storedHashes.has(value) };

/** 成功时取出结果，失败时抛出，测试随之失败。 */
export function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(`${result.error.code} ${result.error.message}`);
  return result.value;
}

/** 失败时取出错误，成功时抛出。 */
export function failure<T>(result: Result<T, ErrorBody>): ErrorBody {
  if (result.ok) throw new Error("应当失败，却成功了");
  return result.error;
}

/** 登记项目 app，放进三件落地的事，开始第一轮落地，三件都拿出来。 */
export async function landRound(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  for (const content of [
    "看板放到首页的第一屏",
    "提交以后写明回复被取走了",
    "场景的步骤写成动宾短语",
  ]) {
    succeed(addQueueItem(core.ctx, "app", { content, stage: "land", proposer: "ai" }));
  }
  succeed(startRound(core.ctx, "app", { stage: "land" }));
  recordLandSteps(core);
  registerBlobs(core);
  return core;
}

/** 附件库里登记假的两份。文件本身不在，所以附件库有没有由 deps 的假函数回答。 */
export function registerBlobs(core: TestCore): void {
  const at = core.ctx.now();
  for (const value of storedHashes) {
    core.ctx.db
      .insert(blobs)
      .values({
        hash: value as BlobHash,
        contentType: "image/png",
        size: 1,
        createdAt: at,
        firstSource: "测试",
      })
      .run();
  }
}

/**
 * 记齐落地五步，给出验收页不被 land.steps 拦截：计划不重构，一件功能改动先失败后通过，
 * 改动规模为零时跳过评审。
 * 要看 land.steps 本身的测试另开一轮，不调用它。
 */
export function recordLandSteps(core: TestCore, round = "v1-落地-1"): void {
  const plan = [
    "## 要做的事",
    "三件页面上的小改动。",
    "## 现状",
    "读过了。",
    "## 要不要先重构",
    "不要。改动都很小。",
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
  succeed(recordPlan(core.ctx, "app", round, plan));
  succeed(recordTidy(core.ctx, "app", round, { skip: true }));
  const run = (exitCode: number, commit: string) => ({
    command: ["node", "check.js"] as [string, ...string[]],
    cwd: "/work/app",
    exitCode,
    outputTail: "",
    commit,
    startedAt: core.ctx.now().toISOString(),
    durationMs: 10,
    cliVersion: "dev",
  });
  const [red, green] = ["1".repeat(40), "2".repeat(40)] as const;
  succeed(recordRed(core.ctx, "app", round, "看板放到首页", run(1, red)));
  const greenRun = { run: run(0, green), commitsAfterRed: [green] };
  const threshold = { lines: 60, files: 3, dataFormatPaths: [] };
  succeed(recordGreen(core.ctx, "app", round, "看板放到首页", greenRun, threshold));
  succeed(recordReview(core.ctx, "app", round, { skip: "改动很小", changed: [] }, threshold));
}

/** 合格的一页：疑问卡处理 Q1，更改处理 Q2 和 Q3。 */
export function pageData() {
  return {
    asks: [
      {
        queue: ["Q1"],
        title: "看板放在哪里",
        why: "看板在首页最下面，要翻两屏才看得到。",
        sources: [{ name: "工作台首页", saw: "看板在最下面。", img: "img/home.png" }],
      },
    ],
    changes: [
      {
        queue: ["Q2", "Q3"],
        title: "提交以后写明回复被取走",
        problem: "提交以后看不出 AI 有没有收到。",
        fix: "按钮下面写「AI 已收到」。",
        after: { img: "img/after.png" },
      },
    ],
  };
}

const images = [
  { path: "img/home.png", hash: hash("a") },
  { path: "img/after.png", hash: hash("c") },
];

/** 给出信息的请求：第一轮落地，两张截图都已上传。 */
export function presentInput(data: unknown, more: Partial<PresentInput> = {}): PresentInput {
  return { round: "v1-落地-1", data, images, ...more };
}
