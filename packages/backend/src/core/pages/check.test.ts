import { type ErrorBody, pageExample, type Result, type Stage, stage } from "@product-loop/model";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { projects, rounds, ruleHits } from "../../store/schema/index.ts";
import { pushRevision } from "../mainline.ts";
import { addQueueItem, type QueueChange, transitionQueueItem } from "../queue.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore, mainlineText, pushMainline, type TestCore } from "../testing.ts";
import { writeTx } from "../tx.ts";
import {
  checkPage,
  checkPageAndRecord,
  type PageCheckDeps,
  type PageCheckInput,
  type PageLookup,
  recordRuleHits,
} from "./check.ts";
import { recordLandSteps } from "./testing.ts";

// 给出信息以前的校验管线：三层依次执行、收齐全部结果、平时和历史页面模式、拦截和警告的记录。
// 后端规则各自的样本在 core/rules/registry.test.ts 里跑，这里看它们在管线里的位置和上下文。

const hash = (digit: string) => digit.repeat(64);

/** 附件库里有的哈希。 */
const storedHashes = new Set([hash("a"), hash("c")]);
const deps: PageCheckDeps = { hasBlob: (value) => storedHashes.has(value) };

/** 成功时取出结果，失败时抛出，测试随之失败。 */
function succeed<T>(result: Result<T, ErrorBody>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 登记项目 app，放进三件落地的事，开始第一轮落地，三件都拿出来。 */
async function landRound(): Promise<TestCore> {
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
  return core;
}

const move = (core: TestCore, id: string, change: QueueChange) =>
  succeed(transitionQueueItem(core.ctx, "app", id, change));

/** 合格的一页：疑问卡处理 Q1，更改处理 Q2。Q3 由各个用例自己处理。 */
function pageData() {
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

const homeImage = { path: "img/home.png", hash: hash("a") };
const images = [homeImage, { path: "img/after.png", hash: hash("c") }];

function current(data: unknown, more: Partial<PageCheckInput> = {}): PageCheckInput {
  return {
    data,
    command: "page present",
    images,
    run: { mode: "current", round: "v1-落地-1" },
    ...more,
  };
}

/** 一句超过六十字的话，写作校验拦截。 */
const tooLong =
  "看板现在放在首页的最下面，用户每次打开首页都要先翻过两屏的项目列表，才能看到自己关心的那几件事，而且这个列表还会随着项目增多不断变长。";
/** 一句四十多字的话，写作校验警告。 */
const longish =
  "看板现在放在首页的最下面，用户每次打开首页都要先翻过两屏的项目列表，才能看到自己关心的那几件事。";

/** 结果写成「编号 位置」，便于比较顺序。 */
const brief = (issues: readonly { readonly rule: string; readonly where?: string }[]) =>
  issues.map((issue) => `${issue.rule} ${issue.where ?? ""}`.trim());

describe("三层依次执行", () => {
  it("合格的一页三层都执行，没有拦截和警告", async () => {
    const core = await landRound();
    const checked = succeed(checkPage(core.ctx.db, "app", current(pageData()), deps));
    expect(checked.layers.map((layer) => layer.layer)).toEqual(["definition", "rule", "writing"]);
    expect(checked).toMatchObject({ stage: "land", mode: "current", pageDate: null, block: [] });
    expect(checked.warn).toEqual([]);
    expect(checked.round?.label).toBe("v1-落地-1");
    expect(checked.page?.asks?.[0]?.queue).toEqual(["Q1"]);
  });

  it("数据定义不通过时后两层不执行，定义的每条问题带着编号和位置", async () => {
    const core = await landRound();
    const data = { ...pageData(), system: "产品循环", asks: [{ title: "只有标题" }] };
    const checked = succeed(checkPage(core.ctx.db, "app", current(data), deps));
    expect(checked.layers.map((layer) => layer.layer)).toEqual(["definition"]);
    expect(checked.page).toBeUndefined();
    expect(checked.block.length).toBeGreaterThan(1);
    expect(brief(checked.block)).toContain("formatChange.header system");
    for (const issue of checked.block) {
      expect(issue.rule).not.toBe("");
      expect(issue.hint).toBeDefined();
    }
  });

  it("定义通过时收齐后两层的全部结果：共用的规则、后端的规则、写作校验，按这个顺序", async () => {
    const core = await landRound();
    const data = pageData();
    const [card] = data.asks;
    if (card === undefined) throw new Error("样本里没有疑问卡");
    card.why = `${tooLong}${longish}`;
    card.sources = [{ name: "工作台首页", saw: "看板在最下面。" } as (typeof card.sources)[number]];
    data.changes[0]?.queue.pop();
    const checked = succeed(checkPage(core.ctx.db, "app", current(data), deps));
    expect(brief(checked.block)).toEqual([
      "card.source.visual asks[0].sources[0]",
      "round.batch.covered Q3",
      "writing.sentence.tooLong asks[0].why",
    ]);
    expect(brief(checked.warn)).toEqual(["writing.sentence.long asks[0].why"]);
    expect(checked.layers.map((layer) => [layer.layer, layer.block.length])).toEqual([
      ["definition", 0],
      ["rule", 2],
      ["writing", 1],
    ]);
  });

  it("写作校验用项目主线的写作规范", async () => {
    const core = await landRound();
    const text = [
      "# 主线",
      "",
      "## 写作规范",
      "",
      "| 停用的说法 | 改成什么 |",
      "| --- | --- |",
      "| 看板 | 队列一览 |",
      "",
    ].join("\n");
    succeed(pushRevision(core.ctx, "app", { text, baseRevision: null, source: "cache" }));
    const checked = succeed(checkPage(core.ctx.db, "app", current(pageData()), deps));
    expect(brief(checked.block)).toContain("writing.term.banned asks[0].title");
  });
});

describe("空的页面数据", () => {
  it("要用户点的页一张卡都没有，两条命令都拦截，写明用户没有可点的内容（N03）", async () => {
    const core = await landRound();
    for (const command of ["page check", "page present"] as const) {
      const checked = succeed(checkPage(core.ctx.db, "app", current({}, { command }), deps));
      expect(brief(checked.block)).toContain("page.cards.none");
      const issue = checked.block.find((each) => each.rule === "page.cards.none");
      expect(issue?.message).toBe("这一页要用户点，却一张卡都没有，用户没有可点的内容。");
    }
  });

  it("只看的页可以没有卡", async () => {
    const core = await landRound();
    const checked = succeed(checkPage(core.ctx.db, "app", current({}, { purpose: "view" }), deps));
    expect(brief(checked.block)).not.toContain("page.cards.none");
  });

  it("使用阶段的页一律只看，系统填内容，页面数据写空对象也通过；别的阶段拦截", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    succeed(startRound(core.ctx, "app", { stage: "use" }));
    const input = current(
      {},
      { command: "page check", run: { mode: "current", round: "v1-使用-1" } },
    );
    const checked = succeed(checkPage(core.ctx.db, "app", input, deps));
    expect(checked.block).toEqual([]);
  });
});

describe("后端的规则", () => {
  it("只校验时不查截图，也不查在等的页", async () => {
    const core = await landRound();
    const pages: PageLookup = {
      waitingPages: () => [{ id: 7, seq: 1, round: "v1-落地-1" }],
      coveredInRound: () => new Map(),
    };
    const input = current(pageData(), { command: "page check", images: [] });
    const checked = succeed(checkPage(core.ctx.db, "app", input, { ...deps, pages }));
    expect(checked.block).toEqual([]);
  });

  it("给出信息时查截图和在等的页，只看的页不占名额", async () => {
    const core = await landRound();
    const pages: PageLookup = {
      waitingPages: () => [{ id: 7, seq: 1, round: "v1-落地-1" }],
      coveredInRound: () => new Map(),
    };
    const missing = [
      { path: "img/home.png", hash: hash("a") },
      { path: "img/after.png", hash: hash("d") },
    ];
    const input = current(pageData(), { images: missing });
    const checked = succeed(checkPage(core.ctx.db, "app", input, { ...deps, pages }));
    expect(brief(checked.block)).toEqual([
      "page.oneWaiting 第 1 版的落地阶段",
      "blob.present changes[0].after.img",
    ]);
    const view = current(pageData(), { purpose: "view" });
    const viewed = succeed(checkPage(core.ctx.db, "app", view, { ...deps, pages }));
    expect(viewed.block).toEqual([]);
  });

  it("哈希的写法不对，当作没有上传", async () => {
    const core = await landRound();
    const input = current(pageData(), {
      images: [homeImage, { path: "img/after.png", hash: "c" }],
    });
    const checked = succeed(checkPage(core.ctx.db, "app", input, deps));
    expect(brief(checked.block)).toEqual(["blob.present changes[0].after.img"]);
  });

  it("只查还在进行中的事：取消、做完、改成等待的不查，之前的页引用过的也不查", async () => {
    const core = await landRound();
    const data = pageData();
    data.changes[0]?.queue.splice(0);
    Reflect.deleteProperty(data.changes[0] ?? {}, "queue");
    const blocked = succeed(checkPage(core.ctx.db, "app", current(data), deps));
    expect(brief(blocked.block)).toEqual(["round.batch.covered Q2", "round.batch.covered Q3"]);

    move(core, "Q2", { to: "done", evidence: "提交后按钮下面写着已收到" });
    const pages: PageLookup = {
      waitingPages: () => [],
      coveredInRound: () => new Map([["Q3", 5]]),
    };
    const checked = succeed(checkPage(core.ctx.db, "app", current(data), { ...deps, pages }));
    expect(checked.block).toEqual([]);

    move(core, "Q1", { to: "waiting", dependsOn: "等构思定下首页的布局" });
    const cardless = { changes: [{ ...data.changes[0], queue: undefined }] };
    const left = succeed(checkPage(core.ctx.db, "app", current(cardless), { ...deps, pages }));
    expect(left.block).toEqual([]);
  });
});

describe("找这个阶段", () => {
  it("阶段的写法不对、没有这个阶段、这个阶段已经收尾，各报一种错", async () => {
    const core = await landRound();
    const at = (round: string) => current(pageData(), { run: { mode: "current", round } });
    expect(checkPage(core.ctx.db, "app", at("落地-1"), deps)).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
    expect(checkPage(core.ctx.db, "app", at("v1-落地-2"), deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", where: "第 1 版的落地阶段（第 2 次）" },
    });
    core.ctx.db.update(rounds).set({ status: "closed" }).run();
    expect(checkPage(core.ctx.db, "app", at("v1-落地-1"), deps)).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", where: "第 1 版的落地阶段" },
    });
    expect(checkPage(core.ctx.db, "nope", at("v1-落地-1"), deps)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("历史页面模式", () => {
  /** 构思的一页：场景名字里带编号，一张卡的来源没有写法，对照表的行名超过八个字。 */
  function thinkPage() {
    return {
      scenes: [
        {
          scene: "S1",
          name: "S1 看所有项目停在哪",
          who: "你，每天打开工作台的第一眼",
          steps: [{ do: "打开工作台首页", expect: "每个项目一行" }],
        },
      ],
      asks: [
        {
          title: "看板放在哪里",
          why: "看板在首页最下面。",
          sources: [{ name: "工作台首页", saw: "看板在最下面。" }],
          options: [
            {
              key: "a",
              title: "放在最上面",
              diffs: ["第一屏"],
              why: "好找。",
              cost: "挤掉列表。",
              when: "事多时。",
            },
            {
              key: "b",
              title: "放在右边",
              diffs: ["右栏"],
              why: "不挤。",
              cost: "窄屏看不全。",
              when: "屏宽时。",
            },
          ],
          rows: ["看板在首页的哪一个位置上"],
          shared: { text: "看板的内容不变。" },
        },
      ],
    };
  }

  const history = (stage: Stage, pageDate: string, data: unknown): PageCheckInput => ({
    data,
    command: "page check",
    run: { mode: "history", stage, pageDate },
  });

  it("按页面的日期跳过当天和更晚的规则，后端的规则整批跳过", async () => {
    const core = await landRound();
    const input = history("think", "2026-09-21", thinkPage());
    const checked = succeed(checkPage(core.ctx.db, "app", input, deps));
    expect(checked).toMatchObject({ mode: "history", pageDate: "2026-09-21", round: null });
    expect(brief(checked.block)).toEqual(["card.source.visual asks[0].sources[0]"]);
    expect(checked.skipped).toEqual(
      expect.arrayContaining(["scenes.name.number", "card.row.width", "round.batch.covered"]),
    );
    expect(checked.skipped).not.toContain("card.source.visual");

    const later = succeed(
      checkPage(core.ctx.db, "app", history("think", "2026-09-22", thinkPage()), deps),
    );
    expect(brief(later.block)).toEqual([
      "card.source.visual asks[0].sources[0]",
      "card.row.width asks[0].rows[0]",
    ]);
  });

  it("平时照常执行全部规则", async () => {
    const core = await landRound();
    core.ctx.db.update(rounds).set({ stage: "think" }).run();
    const input = current(thinkPage(), {
      command: "page check",
      run: { mode: "current", round: "v1-构思-1" },
    });
    const checked = succeed(checkPage(core.ctx.db, "app", input, deps));
    expect(brief(checked.block)).toEqual([
      "card.source.visual asks[0].sources[0]",
      "card.row.width asks[0].rows[0]",
      "scenes.name.number scenes[0].name",
      "round.batch.covered Q1",
      "round.batch.covered Q2",
      "round.batch.covered Q3",
    ]);
  });
});

describe("拦截和警告的记录", () => {
  const rows = (core: TestCore) =>
    core.ctx.db.select().from(ruleHits).orderBy(asc(ruleHits.id)).all();

  it("每条命中记一行，有拦截时照常记下，写明层、级别、命令和阶段", async () => {
    const core = await landRound();
    const data = pageData();
    const [card] = data.asks;
    if (card !== undefined) card.why = `${tooLong}${longish}`;
    const input = current(data, { command: "page check" });
    const report = succeed(checkPageAndRecord(core.ctx, "app", input, deps));
    expect(brief(report.block)).toEqual(["writing.sentence.tooLong asks[0].why"]);
    expect(report).toMatchObject({ stage: "land", round: "v1-落地-1", skipped: [] });
    const round = core.ctx.db.select({ id: rounds.id }).from(rounds).get()?.id;
    expect(rows(core)).toEqual([
      expect.objectContaining({
        projectId: "app",
        roundId: round,
        pageId: null,
        command: "page check",
        mode: "current",
        pageDate: null,
        layer: "writing",
        rule: "writing.sentence.tooLong",
        level: "block",
        where: "asks[0].why",
        message: report.block[0]?.message,
      }),
      expect.objectContaining({ layer: "writing", rule: "writing.sentence.long", level: "warn" }),
    ]);
  });

  it("数据定义的问题也记，层写数据定义", async () => {
    const core = await landRound();
    const input = current({ ...pageData(), system: "产品循环" }, { command: "page check" });
    succeed(checkPageAndRecord(core.ctx, "app", input, deps));
    expect(rows(core).map((row) => [row.layer, row.rule, row.level])).toEqual([
      ["definition", "formatChange.header", "block"],
    ]);
  });

  it("没有命中时不记，找不到阶段时什么都不写", async () => {
    const core = await landRound();
    succeed(checkPageAndRecord(core.ctx, "app", current(pageData()), deps));
    const missing = current(pageData(), { run: { mode: "current", round: "v1-落地-2" } });
    expect(checkPageAndRecord(core.ctx, "app", missing, deps)).toMatchObject({ ok: false });
    expect(rows(core)).toEqual([]);
  });

  it("平时要先做迁移检查的项目不能校验，历史页面模式照常校验并记下日期", async () => {
    const core = await landRound();
    core.ctx.db.update(projects).set({ skillVersion: null }).where(eq(projects.id, "app")).run();
    expect(checkPageAndRecord(core.ctx, "app", current(pageData()), deps)).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
    const data = pageData();
    const [card] = data.asks;
    if (card !== undefined) card.why = tooLong;
    const input: PageCheckInput = {
      data,
      command: "page check",
      run: { mode: "history", stage: "land", pageDate: "2026-09-25" },
    };
    const report = succeed(checkPageAndRecord(core.ctx, "app", input, deps));
    expect(report.round).toBeNull();
    expect(rows(core)).toEqual([
      expect.objectContaining({
        roundId: null,
        mode: "history",
        pageDate: "2026-09-25",
        rule: "writing.sentence.tooLong",
      }),
    ]);
  });

  it("给出信息的一方在自己的事务里记下，页面编号要是存下的页面", async () => {
    const core = await landRound();
    const data = pageData();
    data.changes[0]?.queue.pop();
    const checked = succeed(checkPage(core.ctx.db, "app", current(data), deps));
    // 写明存成的页面，见 present.test.ts。没有这一页时外键拒绝，整个事务撤回。
    const record = () =>
      writeTx(core.ctx, (w) => ({
        ok: true as const,
        value: recordRuleHits(w, checked, { projectId: "app", command: "page present", pageId: 9 }),
      }));
    expect(record).toThrow("FOREIGN KEY constraint failed");
    expect(rows(core)).toEqual([]);
  });
});

describe("ploop page example 打印的例子", () => {
  // 例子里的队列编号是 Q1：每个阶段放进一件事拿出来，例子的卡处理它，和 AI 照着改的起点一样。
  it.each(stage.keys)("%s 阶段的例子过得了 ploop page check，没有拦截也没有警告", async (key) => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    pushMainline(core, mainlineText());
    succeed(addQueueItem(core.ctx, "app", { content: "看板放在哪里", stage: key, proposer: "ai" }));
    succeed(startRound(core.ctx, "app", { stage: key }));
    if (key === "land") recordLandSteps(core);
    const input = current(pageExample(key), {
      command: "page check",
      run: { mode: "current", round: `v1-${stage.label(key)}-1` },
    });
    const checked = succeed(checkPage(core.ctx.db, "app", input, deps));
    expect(brief(checked.block)).toEqual([]);
    expect(brief(checked.warn)).toEqual([]);
  });
});
