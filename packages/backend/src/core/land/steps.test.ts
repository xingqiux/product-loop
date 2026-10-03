import type { ErrorBody, Issue, Result } from "@product-loop/model";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  commandRuns,
  events,
  landChanges,
  landRecords,
  pages,
  projects,
  type ReviewOpinion,
  rounds,
} from "../../store/schema/index.ts";
import { sqliteError } from "../../store/testing.ts";
import { addQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, addRound, emptyCore, startAt, type TestCore } from "../testing.ts";
import type { WriteContext } from "../tx.ts";
import { landRules } from "./rules.ts";
import type { RunInput } from "./shared.ts";
import { landStatus } from "./status.ts";
import {
  type GreenInput,
  type ReviewInput,
  recordGreen,
  recordPlan,
  recordRed,
  recordReview,
  recordTidy,
} from "./steps.ts";
import type { ChangedFile, ReviewThreshold } from "./threshold.ts";

// 落地五步的用例，对着临时数据库跑，见「07 校验」第六节。
// 旧 check-land.py 的十七个用例逐个改写，另加「07 校验」第六节的三条，和新规矩的用例。
// 旧用例的计划里「功能改动」只写了「1. 一件。」。新规矩要求检查命令原样写在这一件下面，
// 所以计划的样子按 land.change.planned 补上了检查命令，其余照旧。

const round = "v1-落地-1";
const root = "/work/app";
const minute = 60 * 1000;
const later = (ms: number) => new Date(startAt.getTime() + ms);

/** 几个提交：这一轮开始时、重构以后、改完以后，还有一个更早的。 */
const baseCommit = "a".repeat(40);
const tidyCommit = "b".repeat(40);
const greenCommit = "c".repeat(40);
const midCommit = "d".repeat(40);
const earlierCommit = "e".repeat(40);

/** 旧 check-land.py 的计划，「要不要先重构」一节由参数写。 */
function planText(
  tidy = "要。拆一个函数。",
  changes = "1. 一件\n   对应 Q1。检查 `node check.js`，查这一件改好了。",
): string {
  return [
    "# 计划",
    "",
    "## 要做的事",
    "一件。",
    "",
    "## 现状",
    "读过了。",
    "",
    "## 要不要先重构",
    tidy,
    "",
    "## 功能改动",
    changes,
    "",
    "## 用什么锁住现有的行为",
    "反例测试：`pnpm test`。",
    "",
    "## 对应哪个场景",
    "验收更改。",
    "",
    "## 裁决",
    "| 裁决 | 理由 | 错了的代价 |",
    "| --- | --- | --- |",
    "| 先失败后通过由命令行去跑 | 证据要跑出来 | 小 |",
  ].join("\n");
}

/** 命令行交来的一次运行。默认是这一件的检查，改之前失败。 */
function run(over: Partial<RunInput> = {}): RunInput {
  return {
    command: ["node", "check.js"],
    cwd: root,
    exitCode: 1,
    outputTail: "FAIL 一件",
    commit: tidyCommit,
    startedAt: startAt.toISOString(),
    durationMs: 120,
    cliVersion: "2.0.0",
    ...over,
  };
}

/** 重构以后的检查：通过，提交在这一轮开始以后。 */
const tidyRun = (over: Partial<RunInput> = {}) =>
  run({ command: ["pnpm", "test"], exitCode: 0, outputTail: "PASS", ...over });

/** 改之后的一次：同一条命令通过，提交在失败以后，中间只有这一个提交。 */
const green = (over: Partial<RunInput> = {}): GreenInput => ({
  run: run({ exitCode: 0, outputTail: "PASS 一件", commit: greenCommit, ...over }),
  commitsAfterRed: [greenCommit],
});

/** 旧 check-land.py 的评审意见：一条阻塞的有处置，一条建议的没写处置。 */
const goodReview: readonly ReviewOpinion[] = [
  { file: "a.py", line: 3, level: "block", text: "这里会漏", disposition: "改了" },
  { file: "a.py", line: 9, level: "suggest", text: "名字" },
];

const threshold: ReviewThreshold = {
  lines: 60,
  files: 3,
  dataFormatPaths: ["packages/backend/drizzle/**"],
};

const small: readonly ChangedFile[] = [{ root, path: "src/list.ts", added: 12, deleted: 3 }];

/**
 * 登记项目 app，队列里有落地的 Q1、Q2 和检查的 Q3。
 * 开始 v1-落地-1，这一批只拿 Q1，记下开始时的提交。
 */
async function landCore(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, root);
  for (const [content, stage] of [
    ["空列表显示一句提示", "land"],
    ["保存按钮不被挡住", "land"],
    ["检查设置页", "check"],
  ] as const) {
    succeed(addQueueItem(core.ctx, "app", { content, stage, proposer: "ai" }));
  }
  succeed(
    startRound(core.ctx, "app", {
      stage: "land",
      take: ["Q1"],
      baseCommits: [{ root, commit: baseCommit }],
    }),
  );
  return core;
}

function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(`${result.error.message}（${result.error.rule ?? ""}）`);
  return result.value;
}

/** 失败的结果里全部问题的规矩编号，按报出的先后。 */
function rulesOf(result: Result<unknown, ErrorBody>): (string | undefined)[] {
  if (result.ok) return ["通过了"];
  return (result.error.issues ?? [result.error]).map((issue: Issue) => issue.rule);
}

const plan = (core: TestCore, text = planText()) => recordPlan(core.ctx, "app", round, text);
const tidy = (core: TestCore, over: Partial<RunInput> = {}) =>
  recordTidy(core.ctx, "app", round, { run: tidyRun(over) });
const skipTidy = (core: TestCore) => recordTidy(core.ctx, "app", round, { skip: true });
const red = (core: TestCore, over: Partial<RunInput> = {}, name = "一件") =>
  recordRed(core.ctx, "app", round, name, run(over));
const pass = (core: TestCore, input: GreenInput = green(), name = "一件") =>
  recordGreen(core.ctx, "app", round, name, input, threshold);
const review = (core: TestCore, input: ReviewInput = { opinions: goodReview }) =>
  recordReview(core.ctx, "app", round, input, threshold);
const status = (core: TestCore) => succeed(landStatus(core.ctx.db, "app", round));

/** 计划、重构、先失败后通过都记好，时钟每一步往后拨一分钟。 */
function through(core: TestCore): void {
  succeed(plan(core));
  core.setNow(later(minute));
  succeed(tidy(core));
  core.setNow(later(2 * minute));
  succeed(red(core));
  core.setNow(later(3 * minute));
  succeed(pass(core));
  core.setNow(later(4 * minute));
}

/** 几张表的行数。被拦截以后它们都不该变。 */
function rowCounts(core: TestCore) {
  const { db } = core.ctx;
  return [landRecords, landChanges, commandRuns, events].map(
    (table) => db.select({ n: count() }).from(table).get()?.n,
  );
}

describe("旧 check-land.py 的十七个用例", () => {
  it("放行：合格的计划", async () => {
    const core = await landCore();
    const result = succeed(plan(core));
    expect(result).toMatchObject({
      round,
      replaced: false,
      warnings: [],
      next: ["ploop land tidy -- pnpm test"],
      plan: {
        tidy: { wanted: true },
        verdicts: [["先失败后通过由命令行去跑", "证据要跑出来", "小"]],
        changes: [{ name: "一件", queue: ["Q1"] }],
      },
    });
  });

  it("拦住：计划缺标题，六节合成一条，缺的节名一行一个（N26）", async () => {
    const core = await landCore();
    const result = plan(core, "# 计划\n\n## 要做的事\n一件。\n");
    expect(rulesOf(result)).toEqual([landRules.planSections]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        message: [
          "计划缺 6 节：",
          "  现状",
          "  要不要先重构",
          "  功能改动",
          "  用什么锁住现有的行为",
          "  对应哪个场景",
          "  裁决",
        ].join("\n"),
        hint: "每节写成一个二级标题，例如「## 现状」。七节的名字见 ploop land plan --help。小改动只写要做的事、功能改动、用什么锁住现有的行为三节也行。",
        where: ".product-loop/rounds/v1-落地-1/计划.md",
      },
    });
    expect(core.ctx.db.select().from(landRecords).all()).toEqual([]);
  });

  it("拦住：要不要先重构那一节是空的", async () => {
    const core = await landCore();
    const result = plan(core, planText(""));
    expect(rulesOf(result)).toEqual([landRules.planSections]);
    expect(result).toMatchObject({
      error: {
        message: "计划里「要不要先重构」这一节是空的。",
        where: ".product-loop/rounds/v1-落地-1/计划.md 第 9 行",
      },
    });
  });

  it("拦住：写了不要重构，没写理由", async () => {
    const core = await landCore();
    expect(rulesOf(plan(core, planText("不要。")))).toEqual([landRules.planTidy]);
  });

  it("拦住：没有计划就记重构", async () => {
    const core = await landCore();
    expect(tidy(core)).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: landRules.order,
        message: "第 1 版的落地阶段还没有交计划。",
      },
    });
  });

  it("拦住：重构以后检查不通过，这一次不记", async () => {
    const core = await landCore();
    succeed(plan(core));
    const before = rowCounts(core);
    expect(tidy(core, { exitCode: 1 })).toMatchObject({
      error: { rule: landRules.tidyPassed, message: "重构以后检查没有通过，退出码是 1。" },
    });
    expect(rowCounts(core)).toEqual(before);
  });

  it("拦住：没有先失败的记录就记通过", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    expect(pass(core)).toMatchObject({
      error: { rule: landRules.order, message: "「一件」没有改之前失败的记录。" },
    });
  });

  it("拦住：该失败的那一次其实通过了", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    expect(red(core, { exitCode: 0 })).toMatchObject({
      error: { rule: landRules.redFailed, message: "改之前这条检查就通过了，它证明不了这件改动。" },
    });
  });

  it("拦住：通过用的不是失败时的那条命令", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const other = green({ command: ["pnpm", "test"] });
    expect(pass(core, other)).toMatchObject({
      error: {
        rule: landRules.greenSameCommand,
        message:
          "通过时运行的命令和失败时的不是同一条。失败时是 node check.js，通过时是 pnpm test。",
      },
    });
  });

  it("放行：五步的记录齐了", async () => {
    const core = await landCore();
    through(core);
    expect(succeed(review(core))).toEqual({
      round,
      review: {
        state: "done",
        opinions: goodReview,
        reason: null,
        diff: null,
        reviewedAt: later(4 * minute).toISOString(),
      },
      next: ["ploop page example --stage 落地"],
    });
    expect(status(core)).toMatchObject({ complete: true, missing: [], uncoveredQueue: [] });
  });

  it("拦住：评审意见没有指到行", async () => {
    const core = await landCore();
    through(core);
    const noLine = { file: "a.py", level: "suggest", text: "名字" } as unknown as ReviewOpinion;
    expect(review(core, { opinions: [noLine] })).toMatchObject({
      error: {
        rule: landRules.reviewLocated,
        message: "第 1 条评审意见没有指到文件和行。",
        where: "opinions[0]",
      },
    });
  });

  it("拦住：阻塞的意见没有处置", async () => {
    const core = await landCore();
    through(core);
    const open: ReviewOpinion = { file: "a.py", line: 1, level: "block", text: "会漏" };
    expect(review(core, { opinions: [open] })).toMatchObject({
      error: { rule: landRules.reviewDisposed, message: "a.py 第 1 行的阻塞意见没有写处置。" },
    });
  });

  it("拦住：只有计划，问齐了没有", async () => {
    const core = await landCore();
    succeed(plan(core));
    const result = status(core);
    expect(result.complete).toBe(false);
    expect(result.missing.map((issue) => issue.message)).toEqual([
      "还没有记重构。",
      "「一件」还没有改之前失败的记录。",
      "还没有评审，也没有写明跳过评审的理由。",
    ]);
    expect(result.next).toEqual(["ploop land tidy -- pnpm test"]);
  });

  it("放行：「要重构一处：……」这种正常的写法", async () => {
    const core = await landCore();
    expect(succeed(plan(core, planText("要整理一处：拆一个函数。"))).plan.tidy).toEqual({
      wanted: true,
    });
  });

  it("拦住：手写的记录只有通过、没有失败。用例不收，表也不收", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    expect(rulesOf(pass(core))).toEqual([landRules.order]);
    const record = core.ctx.db.select().from(landRecords).get();
    const handWritten = { landRecordId: record?.id ?? 0, name: "一件", queueNumbers: [] };
    expect(
      sqliteError(() =>
        core.ctx.db
          .insert(landChanges)
          .values(handWritten as unknown as typeof landChanges.$inferInsert)
          .run(),
      ),
    ).toBe("NOT NULL constraint failed: land_changes.red_run_id");
  });

  it("拦住：命令不存在时说一句没跑起来，不算失败", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    for (const exitCode of [126, 127]) {
      expect(red(core, { exitCode })).toMatchObject({
        error: {
          rule: landRules.redFailed,
          message: `检查命令 node check.js 没有跑起来，退出码是 ${exitCode}。没跑起来不算失败。`,
        },
      });
    }
  });

  it("放行：小改动写明理由跳过重构，理由取自计划", async () => {
    const core = await landCore();
    succeed(plan(core, planText("不要。只改一句文案，不碰结构。")));
    expect(succeed(skipTidy(core))).toEqual({
      round,
      tidy: { state: "skipped", reason: "只改一句文案，不碰结构。", run: null },
      next: ["ploop land red 一件 -- node check.js"],
    });
  });
});

describe("「07 校验」第六节另加的三条", () => {
  it("同一件改动先失败后通过，用的不是同一条命令：参数多一个也不行", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const more = green({ command: ["node", "check.js", "--update"] });
    expect(rulesOf(pass(core, more))).toEqual([landRules.greenSameCommand]);
  });

  it("通过时的提交早于失败时的提交", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const earlier = { run: green().run, commitsAfterRed: [] };
    earlier.run = { ...earlier.run, commit: earlierCommit };
    expect(pass(core, earlier)).toMatchObject({
      error: {
        rule: landRules.greenLater,
        message: "通过时的提交 eeeeeee 不在失败时的提交 bbbbbbb 之后。",
      },
    });
  });

  it.each<[string, readonly ChangedFile[], string]>([
    [
      "改了六十一行",
      [{ root, path: "src/list.ts", added: 40, deleted: 21 }],
      "改了 61 行，界线是 60 行",
    ],
    [
      "改了四个文件",
      ["a", "b", "c", "d"].map((n) => ({ root, path: `src/${n}.ts`, added: 1, deleted: 0 })),
      "改了 4 个文件，界线是 3 个",
    ],
    [
      "加了依赖",
      [{ root, path: "package.json", added: 1, deleted: 0 }],
      "改了依赖的文件 /work/app/package.json",
    ],
    [
      "改了数据格式",
      [{ root, path: "packages/backend/drizzle/0009_x.sql", added: 2, deleted: 0 }],
      "改了数据格式的文件 /work/app/packages/backend/drizzle/0009_x.sql",
    ],
  ])("超过界线却跳过评审：%s", async (_case, changed, reason) => {
    const core = await landCore();
    through(core);
    const before = rowCounts(core);
    expect(review(core, { skip: "改动很小", changed })).toMatchObject({
      ok: false,
      error: {
        code: "RULE_BLOCKED",
        rule: landRules.reviewRequired,
        message: `这一批的改动超过了评审界线，不能跳过评审：${reason}。`,
      },
    });
    expect(rowCounts(core)).toEqual(before);
  });

  it("在界线以内可以跳过评审，记下理由和改动的规模。超过界线时照常评审", async () => {
    const core = await landCore();
    through(core);
    const skipped = succeed(review(core, { skip: " 只改了一句提示 ", changed: small }));
    expect(skipped.review).toMatchObject({
      state: "skipped",
      reason: "只改了一句提示",
      opinions: null,
      diff: { lines: 15, files: 1, within: true, maxLines: 60, maxFiles: 3 },
    });
    const big = [{ root, path: "src/list.ts", added: 500, deleted: 0 }];
    const reviewed = succeed(review(core, { opinions: [], changed: big }));
    expect(reviewed.review).toMatchObject({
      state: "done",
      reason: null,
      opinions: [],
      diff: { lines: 500, within: false },
    });
  });
});

describe("land.change.planned：检查命令原样写在计划里，功能改动在计划和这一批里", () => {
  it("重构的检查命令没写在「用什么锁住现有的行为」里", async () => {
    const core = await landCore();
    succeed(plan(core));
    expect(tidy(core, { command: ["pnpm", "lint"] })).toMatchObject({
      error: {
        rule: landRules.changePlanned,
        message: "重构的检查命令 pnpm lint 没有原样写在计划「用什么锁住现有的行为」里。",
      },
    });
  });

  it("计划里没有这个名字，报出计划里有的几件", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    expect(red(core, {}, "另一件")).toMatchObject({
      error: {
        rule: landRules.changePlanned,
        message: "计划「功能改动」里没有叫「另一件」的一件。计划里有的是：一件。",
      },
    });
  });

  it("名字按计划里这一件的标题比，去掉末尾的标点，记下的是计划里的名字", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    expect(succeed(red(core, {}, " 一件。")).change).toMatchObject({
      name: "一件",
      queue: ["Q1"],
      planned: true,
      state: "failed",
    });
  });

  it("检查命令没写在这一件下面，写在别的一件下面也不算", async () => {
    const core = await landCore();
    const changes = ["1. 一件", "   只写了查什么。", "2. 另一件", "   检查 `node check.js`。"].join(
      "\n",
    );
    succeed(plan(core, planText(undefined, changes)));
    succeed(tidy(core));
    expect(red(core)).toMatchObject({
      error: {
        rule: landRules.changePlanned,
        message: "检查命令 node check.js 没有原样写在计划「一件」这一件下面。",
      },
    });
  });

  it("这一件写到的队列事项不在这一批里", async () => {
    const core = await landCore();
    const changes = "1. 一件\n   对应 Q1、Q2。检查 `node check.js`。";
    succeed(plan(core, planText(undefined, changes)));
    succeed(tidy(core));
    expect(red(core)).toMatchObject({
      error: {
        rule: landRules.changePlanned,
        message: "「一件」对应的 Q2 不在这一批里。",
      },
    });
  });

  it("通过时提交说明里写的队列事项不在这一批里", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const input = { ...green(), queue: ["Q1", "Q3"] };
    expect(pass(core, input)).toMatchObject({
      error: { rule: landRules.changePlanned, message: "「一件」对应的 Q3 不在这一批里。" },
    });
  });

  it("功能改动里认不出任何一件时，交计划只警告，记失败时拦截", async () => {
    const core = await landCore();
    const result = succeed(plan(core, planText(undefined, "把空列表的提示改好。")));
    expect(result.warnings).toEqual([
      {
        rule: landRules.changePlanned,
        message: "计划「功能改动」里没有列出任何一件。",
        hint: "每件写成一个顶格的列表项或三级标题。标题写这一件的名字，下面写检查命令和它查的是什么。",
        where: ".product-loop/rounds/v1-落地-1/计划.md",
      },
    ]);
    succeed(tidy(core));
    expect(red(core)).toMatchObject({
      error: {
        rule: landRules.changePlanned,
        message: "计划「功能改动」里没有列出任何一件，找不到「一件」。",
      },
    });
  });
});

describe("重构", () => {
  it("计划写了要重构时不能跳过", async () => {
    const core = await landCore();
    succeed(plan(core));
    expect(rulesOf(skipTidy(core))).toEqual([landRules.tidySkip]);
  });

  it("重构还没有提交：检查时的提交就是这个阶段开始时的提交", async () => {
    const core = await landCore();
    succeed(plan(core));
    expect(tidy(core, { commit: baseCommit })).toMatchObject({
      error: {
        rule: landRules.tidyCommitted,
        message: "重构还没有提交：检查时的提交 aaaaaaa 就是这个阶段开始时的提交。",
      },
    });
  });

  it("没记下提交、检查没通过、命令没写进计划，一次报齐", async () => {
    const core = await landCore();
    succeed(plan(core));
    const { commit: _commit, ...rest } = tidyRun({ exitCode: 2, command: ["pnpm", "lint"] });
    expect(rulesOf(recordTidy(core.ctx, "app", round, { run: rest }))).toEqual([
      landRules.tidyPassed,
      landRules.commitRecorded,
      landRules.changePlanned,
    ]);
  });

  it("记下检查命令的那次运行，它的提交就是重构的提交", async () => {
    const core = await landCore();
    succeed(plan(core));
    const result = succeed(tidy(core));
    expect(result.tidy).toMatchObject({
      state: "done",
      reason: null,
      run: { command: ["pnpm", "test"], exitCode: 0, commit: tidyCommit, cwd: root },
    });
    expect(core.ctx.db.select().from(commandRuns).get()).toMatchObject({
      purpose: "tidyCheck",
      projectId: "app",
      recordedAt: startAt,
    });
  });

  it("计划后来改成了要重构，之前记的跳过不再算数，记失败时拦截", async () => {
    const core = await landCore();
    succeed(plan(core, planText("不要。只改一句文案，不碰结构。")));
    succeed(skipTidy(core));
    const replaced = succeed(plan(core));
    expect(replaced.replaced).toBe(true);
    expect(status(core).tidy.state).toBe("stale");
    expect(rulesOf(red(core))).toEqual([landRules.order]);
  });
});

describe("先失败后通过", () => {
  it("不先记重构就记失败", async () => {
    const core = await landCore();
    succeed(plan(core));
    expect(red(core)).toMatchObject({
      error: { rule: landRules.order, message: "还没有记重构。" },
    });
  });

  it("失败那一次没有记下提交", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    const { commit: _commit, ...rest } = run();
    expect(rulesOf(recordRed(core.ctx, "app", round, "一件", rest))).toEqual([
      landRules.commitRecorded,
    ]);
  });

  it("改动还没有提交就记通过，两次的提交相同", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const same = { run: green({ commit: tidyCommit }).run, commitsAfterRed: [] };
    expect(rulesOf(pass(core, same))).toEqual([landRules.greenLater]);
  });

  it("通过时检查仍然没有通过", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    expect(rulesOf(pass(core, green({ exitCode: 1 })))).toEqual([landRules.greenPassed]);
  });

  it("记下通过的一次、对应的提交和队列事项，一个提交时不警告", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const result = succeed(pass(core, { ...green(), queue: ["Q1"] }));
    expect(result.warnings).toEqual([]);
    expect(result.change).toMatchObject({
      name: "一件",
      state: "passed",
      queue: ["Q1"],
      commit: greenCommit,
      commitsAfterRed: [greenCommit],
      red: { exitCode: 1, commit: tidyCommit },
      green: { exitCode: 0, commit: greenCommit },
    });
    expect(result.next).toEqual(["ploop land diff", "ploop land review"]);
  });

  it("land.oneCommit：失败和通过之间多于一个提交时警告，照常记下", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    const result = succeed(pass(core, { ...green(), commitsAfterRed: [midCommit, greenCommit] }));
    expect(result.warnings).toEqual([
      {
        rule: landRules.oneCommit,
        message: "「一件」失败和通过之间有 2 个提交。",
        hint: "一件功能改动只提交一次。多出来的提交如果是别的改动，拆成另一件记。",
        where: "一件",
      },
    ]);
    expect(result.change.state).toBe("passed");
  });

  it("再记一次失败，换成新的一次，之前记的通过作废", async () => {
    const core = await landCore();
    through(core);
    succeed(red(core, { commit: greenCommit, outputTail: "FAIL 又坏了" }));
    const change = status(core).changes[0];
    expect(change).toMatchObject({
      state: "failed",
      green: null,
      commit: null,
      red: { outputTail: "FAIL 又坏了" },
    });
    expect(core.ctx.db.select({ n: count() }).from(landChanges).get()?.n).toBe(1);
    expect(core.ctx.db.select({ n: count() }).from(commandRuns).get()?.n).toBe(4);
  });

  it("请求本身写错的地方返回 BAD_REQUEST：名字是空的、提交号和队列编号写错", async () => {
    const core = await landCore();
    expect(recordRed(core.ctx, "app", round, "  ", run())).toMatchObject({
      error: { code: "BAD_REQUEST", message: "功能改动的名字是空的。" },
    });
    const wrong = { run: run({ commit: "HEAD" }), commitsAfterRed: ["abc"], queue: ["q1"] };
    const result = pass(core, wrong);
    expect(result.ok ? [] : result.error.issues?.map((issue) => issue.message)).toEqual([
      "提交号「HEAD」写得不对。",
      "提交号「abc」写得不对。",
    ]);
    const badQueue = { ...green(), queue: ["q1"] };
    expect(pass(core, badQueue)).toMatchObject({
      error: { code: "BAD_REQUEST", message: "队列编号「q1」写得不对。" },
    });
  });
});

describe("评审", () => {
  it("还有功能改动没有通过时不能评审，也不能跳过", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    for (const input of [{ opinions: goodReview }, { skip: "改动很小", changed: small }]) {
      expect(review(core, input)).toMatchObject({
        error: { rule: landRules.order, message: "还有功能改动没有通过：一件。" },
      });
    }
  });

  it("一件功能改动都没有时不能评审", async () => {
    const core = await landCore();
    succeed(plan(core, planText(undefined, "把空列表的提示改好。")));
    succeed(tidy(core));
    expect(review(core)).toMatchObject({
      error: { rule: landRules.order, message: "还没有记任何一件功能改动。" },
    });
  });

  it("意见没写内容、跳过没写理由、行数写错，返回 BAD_REQUEST", async () => {
    const core = await landCore();
    through(core);
    const blank: ReviewOpinion = { file: "a.py", line: 1, level: "suggest", text: " " };
    expect(review(core, { opinions: [blank] })).toMatchObject({
      error: { code: "BAD_REQUEST", message: "第 1 条评审意见没有写内容。" },
    });
    const bad = [{ root, path: "src/a.ts", added: -1, deleted: 0 }];
    const result = review(core, { skip: " ", changed: bad });
    expect(result.ok ? [] : result.error.issues?.map((issue) => issue.message)).toEqual([
      "跳过评审要写理由。",
      "改动的文件「src/a.ts」的行数写得不对。",
    ]);
  });

  it("存下的意见去掉首尾的空白，没写处置的不带处置", async () => {
    const core = await landCore();
    through(core);
    const opinions: ReviewOpinion[] = [
      { file: " a.py ", line: 3, level: "block", text: " 这里会漏 ", disposition: " 改了 " },
      { file: "b.py", line: 1, level: "suggest", text: "名字", disposition: "  " },
    ];
    expect(succeed(review(core, { opinions })).review.opinions).toEqual([
      { file: "a.py", line: 3, level: "block", text: "这里会漏", disposition: "改了" },
      { file: "b.py", line: 1, level: "suggest", text: "名字" },
    ]);
  });

  it("评审以后又记了通过，评审不再算数，要重新评审", async () => {
    const core = await landCore();
    through(core);
    succeed(review(core));
    core.setNow(later(10 * minute));
    succeed(red(core, { commit: greenCommit }));
    core.setNow(later(11 * minute));
    const after = { run: green({ commit: midCommit }).run, commitsAfterRed: [midCommit] };
    succeed(pass(core, after));
    const result = status(core);
    expect(result.review.state).toBe("stale");
    expect(result.missing.map((issue) => issue.message)).toEqual([
      "评审以后又记了功能改动：一件。",
    ]);
    expect(result.next).toEqual(["ploop land diff", "ploop land review"]);
  });
});

describe("这个阶段能不能记", () => {
  it("阶段写错返回 BAD_REQUEST，找不到返回 NOT_FOUND", async () => {
    const core = await landCore();
    expect(recordPlan(core.ctx, "app", "v1-修复-1", planText())).toMatchObject({
      error: { code: "BAD_REQUEST", message: "阶段「v1-修复-1」用了改过名的阶段名「修复」。" },
    });
    expect(recordPlan(core.ctx, "app", "v1-落地-2", planText())).toMatchObject({
      error: { code: "NOT_FOUND", message: "项目「app」没有第 1 版的落地阶段（第 2 次）。" },
    });
    expect(recordPlan(core.ctx, "ghost", round, planText())).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });

  it("不是落地阶段、已经收尾的落地阶段，返回 CONFLICT", async () => {
    const core = await landCore();
    addRound(core, "app", { version: 1, stage: "check", seq: 1 });
    expect(recordPlan(core.ctx, "app", "v1-检查-1", planText())).toMatchObject({
      error: { code: "CONFLICT", message: "第 1 版的检查阶段不是落地阶段，不记落地的五步。" },
    });
    core.ctx.db.update(rounds).set({ status: "closed" }).where(eq(rounds.stage, "land")).run();
    expect(plan(core)).toMatchObject({
      error: { code: "CONFLICT", message: "第 1 版的落地阶段已经收尾，不能再记落地的五步。" },
    });
  });

  it("已经收尾的落地阶段仍然能查状态，不是落地阶段的查不了", async () => {
    const core = await landCore();
    through(core);
    core.ctx.db.update(rounds).set({ status: "closed" }).where(eq(rounds.stage, "land")).run();
    expect(status(core).changes).toHaveLength(1);
    addRound(core, "app", { version: 1, stage: "check", seq: 1 });
    expect(landStatus(core.ctx.db, "app", "v1-检查-1")).toMatchObject({
      error: { code: "CONFLICT" },
    });
  });

  it.each<[string, string | null, string]>([
    ["迁移还没完成", null, "项目「app」的迁移还没完成，要先做迁移检查。"],
    [
      "停在旧版本的 skill",
      "v1-final",
      "项目「app」停在 skill v1-final，现在的软件要求 0.0.1 以上。",
    ],
  ])(
    "%s的项目，五步都返回 NEEDS_DOCTOR，什么都不写，状态照常能查",
    async (_c, version, message) => {
      const core = await landCore();
      through(core);
      core.ctx.db
        .update(projects)
        .set({ skillVersion: version })
        .where(eq(projects.id, "app"))
        .run();
      const before = rowCounts(core);
      const received = core.received.length;
      for (const result of [
        plan(core),
        tidy(core),
        red(core),
        pass(core),
        review(core),
        skipTidy(core),
      ]) {
        expect(result).toMatchObject({ ok: false, error: { code: "NEEDS_DOCTOR", message } });
      }
      expect(rowCounts(core)).toEqual(before);
      expect(core.received).toHaveLength(received);
      expect(status(core).changes).toHaveLength(1);
    },
  );
});

describe("事件和请求编号", () => {
  it("每一步提交以后发一条事件，写明记了什么。拦截时不发", async () => {
    const core = await landCore();
    const before = core.received.length;
    through(core);
    expect(rulesOf(red(core, { exitCode: 0 }))).toEqual([landRules.redFailed]);
    succeed(review(core));
    const sent = core.received.slice(before);
    expect(sent.map((event) => [event.kind, event.objectType, event.objectId])).toEqual([
      ["land.planned", "landRecord", round],
      ["land.tidied", "landRecord", round],
      ["land.redRecorded", "landChange", `${round}/一件`],
      ["land.greenRecorded", "landChange", `${round}/一件`],
      ["land.reviewed", "landRecord", round],
    ]);
    expect(sent.map((event) => event.detail)).toEqual([
      { replaced: false, tidy: true, short: false, changes: ["一件"] },
      { skipped: false, command: ["pnpm", "test"], commit: tidyCommit },
      {
        command: ["node", "check.js"],
        exitCode: 1,
        commit: tidyCommit,
        queue: ["Q1"],
        replaced: false,
      },
      { commit: greenCommit, commitsAfterRed: 1, queue: ["Q1"] },
      { skipped: false, opinions: 2, blocking: 1 },
    ]);
    expect(sent[0]).toMatchObject({ client: "cli/2.0.0", session: "session-1" });
  });

  it("带着请求编号重发记失败的请求，返回第一次的结果，不会把后来记的通过作废", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    const idempotency = {
      key: "7f3a9c2e",
      operation: "POST /api/v1/rounds/:rid/land/changes/:name/red",
    };
    const ctx: WriteContext = { ...core.ctx, idempotency };
    const first = recordRed(ctx, "app", round, "一件", run());
    expect(first.ok).toBe(true);
    succeed(pass(core));
    expect(recordRed(ctx, "app", round, "一件", run())).toEqual(first);
    expect(status(core).changes[0]?.state).toBe("passed");
    expect(core.ctx.db.select({ n: count() }).from(commandRuns).get()?.n).toBe(3);
  });

  it("带着请求编号重发交计划的请求，这个阶段收尾以后也返回第一次的结果", async () => {
    const core = await landCore();
    const idempotency = { key: "1b2c", operation: "PUT /api/v1/rounds/:rid/land/plan" };
    const ctx: WriteContext = { ...core.ctx, idempotency };
    const first = recordPlan(ctx, "app", round, planText());
    core.ctx.db.update(rounds).set({ status: "closed" }).where(eq(rounds.stage, "land")).run();
    expect(recordPlan(ctx, "app", round, planText())).toEqual(first);
  });
});

describe("状态", () => {
  it("还没交计划时只缺计划，这一批的事都还没有对应的功能改动", async () => {
    const core = await landCore();
    expect(status(core)).toEqual({
      round,
      plan: null,
      tidy: { state: "missing", reason: null, run: null },
      changes: [],
      review: { state: "missing", opinions: null, reason: null, diff: null, reviewedAt: null },
      uncoveredQueue: ["Q1"],
      complete: false,
      missing: [
        { message: "还没有交计划。", hint: "在项目缓存里写好计划.md，再运行 ploop land plan。" },
      ],
      next: ["ploop land plan"],
    });
  });

  it("下一步把已知的值填进去：名字有空格时加引号，失败时的命令取自记下的那一次", async () => {
    const core = await landCore();
    const spaced = "1. 空列表 显示提示\n   对应 Q1。检查 `pnpm vitest run a.test.ts`，查提示。";
    succeed(plan(core, planText(undefined, spaced)));
    succeed(tidy(core));
    expect(status(core).next).toEqual([
      "ploop land red '空列表 显示提示' -- pnpm vitest run a.test.ts",
    ]);
    const failed = { command: ["pnpm", "vitest", "run", "a.test.ts"] as [string, ...string[]] };
    const recorded = succeed(red(core, failed, "空列表 显示提示"));
    expect(recorded.next).toEqual([
      "ploop land green '空列表 显示提示' -- pnpm vitest run a.test.ts",
    ]);
    expect(status(core).next).toEqual(recorded.next);
  });

  it("P17 计划里的检查命令写成普通文字（不加反引号）也填进下一步；没写命令时下一步留空，不写占位符", async () => {
    const core = await landCore();
    const plain = "### 空输入不添加\n检查命令：node check.mjs，查空字符串不会进入列表。";
    succeed(plan(core, planText(undefined, plain)));
    succeed(tidy(core));
    expect(status(core).next).toEqual(["ploop land red 空输入不添加 -- node check.mjs"]);
    const unknown = await landCore();
    succeed(plan(unknown, planText(undefined, "1. 空列表\n   对应 Q1。查提示在不在。")));
    succeed(tidy(unknown));
    expect(status(unknown).next).toEqual([]);
  });

  it("给用户看过页以后下一步是收尾；落地阶段收尾以后，五步不用再做，下一步不再说给出验收页", async () => {
    const core = await landCore();
    through(core);
    succeed(review(core));
    expect(status(core).next).toEqual(["ploop page example --stage 落地"]);
    // 给用户看过一页以后，五步齐了的下一步是收尾，拿出的事还在进行中，命令里写好编号。
    const roundId = core.ctx.db.select().from(rounds).get()?.id ?? 0;
    core.ctx.db
      .insert(pages)
      .values({
        projectId: "app",
        roundId,
        seq: 1,
        purpose: "view",
        status: "presented",
        formatVersion: 1,
        sections: {},
        images: [],
        fill: {},
        presentedAt: startAt,
      })
      .run();
    expect(status(core).next).toEqual(["ploop round close"]);
    core.ctx.db.update(rounds).set({ status: "closed", closedAt: startAt }).run();
    expect(status(core).next).toEqual(["ploop status"]);
  });

  it("计划里拿掉的功能改动，记录留着，状态写明不在计划里", async () => {
    const core = await landCore();
    through(core);
    succeed(review(core));
    const renamed = "1. 改名以后的一件\n   检查 `node check.js`。";
    succeed(plan(core, planText(undefined, renamed)));
    const result = status(core);
    expect(result.changes.map((c) => [c.name, c.planned, c.state])).toEqual([
      ["一件", false, "passed"],
      ["改名以后的一件", true, "notStarted"],
    ]);
    expect(result.missing.map((issue) => issue.message)).toEqual([
      "「一件」不在现在的计划里。",
      "「改名以后的一件」还没有改之前失败的记录。",
    ]);
  });

  it("只有失败的记录时，下一步是记通过", async () => {
    const core = await landCore();
    succeed(plan(core));
    succeed(tidy(core));
    succeed(red(core));
    expect(status(core)).toMatchObject({
      complete: false,
      next: ["ploop land green 一件 -- node check.js"],
      missing: [
        { message: "「一件」只有失败的记录，还没有通过。", where: "一件" },
        { message: "还没有评审，也没有写明跳过评审的理由。" },
      ],
    });
  });

  it("阶段写错返回 BAD_REQUEST，项目不存在返回 NOT_FOUND", async () => {
    const core = await landCore();
    expect(landStatus(core.ctx.db, "app", "落地第一轮")).toMatchObject({
      error: { code: "BAD_REQUEST" },
    });
    expect(landStatus(core.ctx.db, "ghost", round)).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
  });
});
