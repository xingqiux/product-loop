import { createHash } from "node:crypto";
import {
  errorBodySchema,
  parseRoundLabel,
  renderCopy,
  type useRunOutputSchema,
} from "@product-loop/model";
import { and, count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { useRunsCopy } from "../../copy/use.ts";
import {
  blobRefs,
  cards,
  pages,
  rounds,
  screens,
  useRuns,
  useSteps,
} from "../../store/schema/index.ts";
import {
  type Canvas,
  copyCanvas,
  encodePng,
  fill,
  productScreen,
} from "../../store/screen-testing.ts";
import { addProject } from "../testing.ts";
import { type IngestedUseRun, ingestUseRun, type UseRunInput, useRules } from "./ingest.ts";
import { latestUseRun } from "./runs.ts";
import { changedScreens, listScreens } from "./screens.ts";
import { openUseRound, succeed, type UseTestCore, upload, useCore, useRunFile } from "./testing.ts";

type RunFile = z.input<typeof useRunOutputSchema>;

/** 一屏像产品界面的截图，窄一些，测试跑得快。 */
const plain = () => productScreen(700, 450);

/** 输入框里多了几个光标，每个一乘十八个像素，差别很小。 */
function carets(image: Canvas, n: number): Canvas {
  const out = copyCanvas(image);
  for (let i = 0; i < n; i += 1) fill(out, 600 + i * 6, 140, 1, 18, [20, 20, 20]);
  return out;
}

/** 多了一个按钮。 */
function withButton(image: Canvas): Canvas {
  const out = copyCanvas(image);
  fill(out, 420, 380, 96, 36, [30, 30, 30]);
  return out;
}

/** 一步：场景、步号、宽度和截图，结果默认是通过。 */
type Shot = {
  readonly scene: string;
  readonly step: number;
  readonly width?: number;
  readonly path?: string;
  readonly result?: "通过" | "断了" | "没走" | "环境";
};

/** 按 use-run.json 的写法写一次运行，同一个场景的步骤排在一起。 */
function runFile(shots: readonly Shot[]): RunFile {
  const scenes: { scene: string; steps: RunFile["scenes"][number]["steps"][number][] }[] = [];
  for (const shot of shots) {
    const result = shot.result ?? "通过";
    const step = {
      step: shot.step,
      ...(shot.width === undefined ? {} : { width: shot.width }),
      do: "点队列",
      expect: "看到五列看板",
      result,
      ...(shot.path === undefined ? {} : { screenshot: shot.path }),
      ...(result === "通过" ? {} : { error: "看板没有出来" }),
    };
    const last = scenes.at(-1);
    if (last?.scene === shot.scene) last.steps.push(step);
    else scenes.push({ scene: shot.scene, steps: [step] });
  }
  return { schemaVersion: 1, scenes };
}

/** 上传截图，再收进一次运行。images 写每张截图的路径和图。 */
async function ingest(
  t: UseTestCore,
  shots: readonly Shot[],
  images: readonly (readonly [string, Canvas])[],
  more: Partial<UseRunInput> = {},
) {
  const screenshots = [];
  for (const [path, image] of images) screenshots.push({ path, hash: await upload(t, image) });
  const output = useRunFile(runFile(shots));
  return ingestUseRun(t.ctx, t.blobsDir, "app", { output, screenshots, ...more });
}

/** S1 两步、S2 一步，都在宽度 700 下截图，都通过。 */
const threeScreens: readonly Shot[] = [
  { scene: "S1", step: 1, width: 700, path: "shots/a.png" },
  { scene: "S1", step: 2, width: 700, path: "shots/b.png" },
  { scene: "S2", step: 1, width: 700, path: "shots/c.png" },
];

const keys = (list: IngestedUseRun["newScreens"]) =>
  list.map((key) => `${key.scene}-${key.step}-${key.width}`);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function rowCount(t: UseTestCore, table: typeof useRuns | typeof useSteps | typeof screens) {
  return t.ctx.db.select({ n: count() }).from(table).get()?.n ?? 0;
}

describe("收进一次运行", () => {
  it("记下运行和每一步，截图记附件引用，挂在开着的阶段上，发出 useRun.ingested", async () => {
    const t = await useCore();
    const shots: Shot[] = [
      { scene: "S1", step: 1, width: 700, path: "shots/a.png" },
      { scene: "S1", step: 2, width: 700, path: "shots/b.png", result: "断了" },
      { scene: "S2", step: 1 },
    ];
    const images = [
      ["shots/a.png", plain()],
      ["shots/b.png", withButton(plain())],
    ] as const;
    const result = succeed(
      await ingest(t, shots, images, {
        command: ["node", "scripts/use/all.mjs"],
        exitCode: 1,
        commit: "0123456789abcdef0123456789abcdef01234567",
        coverage: "| 页面 | 场景 |",
      }),
    );
    expect(result.run).toMatchObject({
      round: "v1-使用-1",
      command: ["node", "scripts/use/all.mjs"],
      exitCode: 1,
      results: { pass: 2, broken: 1, skipped: 0, environment: 0 },
    });
    // 断了的步骤的截图不更新屏，所以新出现的只有 S1 第 1 步。
    expect(keys(result.newScreens)).toEqual(["S1-1-700"]);
    expect(result.changedScreens).toEqual([]);
    expect(result.warnings).toEqual([]);
    // 有断点：下一步是把用过的命令原样再跑一遍，不留占位符。
    expect(result.next).toEqual(["ploop use run -- node scripts/use/all.mjs"]);

    expect([rowCount(t, useRuns), rowCount(t, useSteps), rowCount(t, screens)]).toEqual([1, 3, 1]);
    const refs = t.ctx.db.select().from(blobRefs).all();
    expect(refs.map((ref) => `${ref.referrerKind}/${ref.purpose}`).sort()).toEqual([
      "screen/shot",
      "useStep/shot",
      "useStep/shot",
    ]);
    const event = t.received.at(-1);
    expect(event).toMatchObject({ kind: "useRun.ingested", objectType: "useRun" });
    expect(event?.detail).toMatchObject({
      round: "v1-使用-1",
      newScreens: [{ scene: "S1", step: 1, width: 700 }],
    });

    const latest = succeed(latestUseRun(t.ctx.db, "app"));
    expect(latest?.scenes.map((scene) => [scene.scene, scene.name, scene.steps.length])).toEqual([
      ["S1", "看队列", 2],
      ["S2", "在窄屏上看", 1],
    ]);
    expect(latest?.scenes[0]?.steps[1]).toMatchObject({
      result: "broken",
      error: "看板没有出来",
      shot: sha256(encodePng(withButton(plain()))),
    });
    expect(latest?.scenes[1]?.steps[0]).toMatchObject({ width: null, shot: null });
  });

  it("没有断点、主线的每一步都走到、覆盖表没有缺口时，自动给出一页，下一步往下走；use run 量到的时间代替文件里写的", async () => {
    const t = await useCore();
    const file = {
      ...runFile([
        { scene: "S1", step: 1 },
        { scene: "S1", step: 2 },
        { scene: "S2", step: 1 },
      ]),
      startedAt: "2026-09-28T10:00:00+08:00",
    };
    const result = succeed(
      ingestUseRun(t.ctx, t.blobsDir, "app", {
        output: useRunFile(file),
        screenshots: [],
        finishedAt: "2026-09-28T02:05:00Z",
        coverage: "| 东西 | 场景 |\n| --- | --- |\n| 队列看板 | S2 |",
      }),
    );
    expect(result.page).toBe(1);
    expect(result.unreached).toEqual([]);
    // 主线里只有场景，设计规范没补齐，进检查前先看主线。
    expect(result.next).toEqual(["ploop mainline check"]);
    expect(result.run).toMatchObject({
      startedAt: "2026-09-28T02:00:00.000Z",
      finishedAt: "2026-09-28T02:05:00.000Z",
      command: null,
      exitCode: null,
    });
  });

  it("使用阶段的运行没走到主线里的步：列出没走到的步，不给出页，下一步是重新运行", async () => {
    const t = await useCore();
    const output = useRunFile(runFile([{ scene: "S2", step: 1 }]));
    const result = succeed(
      ingestUseRun(t.ctx, t.blobsDir, "app", {
        output,
        screenshots: [],
        command: ["node", "scripts/use/run.mjs"],
        coverage: "| 东西 | 场景 |\n| --- | --- |\n| 队列看板 | S2 |",
      }),
    );
    expect(result.unreached).toEqual([{ scene: "S1", steps: [1, 2] }]);
    expect(result.page).toBeNull();
    expect(result.next).toEqual(["ploop use run -- node scripts/use/run.mjs"]);
    expect(t.ctx.db.select({ n: count() }).from(pages).get()?.n).toBe(0);
  });

  it("没有断点也没有缺口：自动给出的一页只看不等回复，没有卡片，记 page.presented；每次这样的运行各给一页", async () => {
    const t = await useCore();
    const all = [
      { scene: "S1", step: 1 },
      { scene: "S1", step: 2 },
      { scene: "S2", step: 1 },
    ];
    const coverage = "| 东西 | 场景 |\n| --- | --- |\n| 队列看板 | S1 |";
    const run = () =>
      succeed(
        ingestUseRun(t.ctx, t.blobsDir, "app", {
          output: useRunFile(runFile(all)),
          screenshots: [],
          coverage,
        }),
      );
    expect(run().page).toBe(1);
    expect(run().page).toBe(2);
    const rows = t.ctx.db.select().from(pages).all();
    expect(rows.map((row) => [row.seq, row.purpose, row.status])).toEqual([
      [1, "view", "presented"],
      [2, "view", "presented"],
    ]);
    expect(t.ctx.db.select({ n: count() }).from(cards).get()?.n).toBe(0);
    const shown = t.received.filter((event) => event.kind === "page.presented");
    expect(shown.map((event) => event.detail)).toMatchObject([
      { round: "v1-使用-1", seq: 1, purpose: "view", auto: true },
      { round: "v1-使用-1", seq: 2, purpose: "view", auto: true },
    ]);
    // 这一轮的状态不变：只看的页不等回复。
    expect(t.ctx.db.select({ status: rounds.status }).from(rounds).get()?.status).toBe("open");
  });

  it("不是使用阶段的运行不对照主线的步，也不给出页", async () => {
    const t = await useCore();
    t.ctx.db.update(rounds).set({ stage: "land" }).run();
    const output = useRunFile(runFile([{ scene: "S2", step: 1 }]));
    const result = succeed(
      ingestUseRun(t.ctx, t.blobsDir, "app", {
        output,
        screenshots: [],
        coverage: "| 东西 | 场景 |",
      }),
    );
    expect(result.unreached).toEqual([]);
    expect(result.page).toBeNull();
    expect(t.ctx.db.select({ n: count() }).from(pages).get()?.n).toBe(0);
  });

  it("收下的运行没有命令、又不能离开使用阶段时，下一步为空，不编一条要人自己填的命令", async () => {
    const t = await useCore();
    const output = useRunFile(runFile([{ scene: "S2", step: 1 }]));
    const result = succeed(ingestUseRun(t.ctx, t.blobsDir, "app", { output, screenshots: [] }));
    expect(result.next).toEqual([]);
  });

  it("截图还没上传的一次报齐，规矩是 use.shots.present，什么都不写", async () => {
    const t = await useCore();
    const output = useRunFile(runFile(threeScreens));
    const hashOf = (image: Canvas) => sha256(encodePng(image));
    const uploaded = await upload(t, plain());
    const result = ingestUseRun(t.ctx, t.blobsDir, "app", {
      output,
      screenshots: [
        { path: "shots/a.png", hash: uploaded },
        { path: "shots/b.png", hash: hashOf(withButton(plain())) },
        { path: "shots/c.png", hash: hashOf(carets(plain(), 1)) },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(errorBodySchema.safeParse(result.error).success).toBe(true);
    expect(result.error).toMatchObject({ code: "RULE_BLOCKED", total: 2 });
    expect(result.error.issues?.map((issue) => [issue.rule, issue.where])).toEqual([
      [useRules.shotsPresent, "scenes[0].steps[1].screenshot"],
      [useRules.shotsPresent, "scenes[1].steps[0].screenshot"],
    ]);
    expect(result.error.message).toContain("shots/b.png");
    expect([rowCount(t, useRuns), rowCount(t, useSteps), rowCount(t, screens)]).toEqual([0, 0, 0]);
    expect(t.received.some((event) => event.kind === "useRun.ingested")).toBe(false);
  });

  it("截图没交哈希、哈希写错、同一个路径交了两个哈希，一次报齐 BAD_REQUEST", async () => {
    const t = await useCore();
    const good = await upload(t, plain());
    const result = ingestUseRun(t.ctx, t.blobsDir, "app", {
      output: useRunFile(runFile(threeScreens)),
      screenshots: [
        { path: "shots/a.png", hash: good },
        { path: "shots/a.png", hash: "f".repeat(64) },
        { path: "shots/b.png", hash: "HEAD" },
      ],
    });
    expect(result.ok || result.error.issues?.map((issue) => issue.where)).toEqual([
      "screenshots[shots/a.png]",
      "screenshots[shots/b.png]",
      "scenes[1].steps[0].screenshot",
    ]);
    expect(result.ok || result.error.code).toBe("BAD_REQUEST");
  });

  it("通过的截图不是 PNG 或读不出来，别的步骤的截图不是 PNG，一次报齐 BAD_REQUEST", async () => {
    const t = await useCore();
    const png = encodePng(plain());
    const broken = png.subarray(0, png.length - 40);
    const gif = new TextEncoder().encode("GIF89a 不是 PNG");
    const shots: Shot[] = [
      { scene: "S1", step: 1, width: 700, path: "a.png" },
      { scene: "S1", step: 2, width: 700, path: "b.png" },
      { scene: "S2", step: 1, width: 700, path: "c.png", result: "环境" },
    ];
    const screenshots = [
      { path: "a.png", hash: await upload(t, gif) },
      { path: "b.png", hash: await upload(t, broken) },
      { path: "c.png", hash: await upload(t, gif) },
    ];
    const output = useRunFile(runFile(shots));
    const result = ingestUseRun(t.ctx, t.blobsDir, "app", { output, screenshots });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("BAD_REQUEST");
    expect(result.error.issues?.map((issue) => issue.message)).toEqual([
      renderCopy(useRunsCopy.shot.notPng.message, { path: "a.png" }),
      renderCopy(useRunsCopy.shot.corrupt.message, { path: "b.png" }),
      renderCopy(useRunsCopy.shot.notPng.message, { path: "c.png" }),
    ]);
    expect(rowCount(t, useRuns)).toBe(0);
  });

  it("场景编号或步号不在最新的主线里，照样收下并警告，同一步的几个宽度只报一次", async () => {
    const t = await useCore();
    const shots: Shot[] = [
      { scene: "S1", step: 7, width: 700 },
      { scene: "S1", step: 7, width: 400 },
      { scene: "S9", step: 1 },
    ];
    const result = succeed(await ingest(t, shots, []));
    expect(result.warnings.map((issue) => [issue.rule, issue.message, issue.where])).toEqual([
      [
        useRules.sceneKnown,
        renderCopy(useRunsCopy.scene.unknownStep.message, { scene: "S1", step: 7 }),
        "scenes[0].steps[0].step",
      ],
      [
        useRules.sceneKnown,
        renderCopy(useRunsCopy.scene.unknown.message, { scene: "S9" }),
        "scenes[1].scene",
      ],
    ]);
    const latest = succeed(latestUseRun(t.ctx.db, "app"));
    expect(latest?.scenes.map((scene) => [scene.scene, scene.name])).toEqual([
      ["S1", "看队列"],
      ["S9", null],
    ]);
  });

  it("没有开着的阶段时返回 CONFLICT", async () => {
    const t = await useCore();
    t.ctx.db.update(rounds).set({ status: "closed" }).run();
    const result = await ingest(t, [{ scene: "S2", step: 1 }], []);
    expect(result.ok || result.error.code).toBe("CONFLICT");
    expect(result.ok || result.error.hint).toBe(renderCopy(useRunsCopy.noRound.hint));
  });

  it("项目要先做迁移检查时返回 NEEDS_DOCTOR", async () => {
    const t = await useCore();
    addProject(t, "/work/old", { legacySource: "docs/" });
    const output = useRunFile(runFile([{ scene: "S2", step: 1 }]));
    const result = ingestUseRun(t.ctx, t.blobsDir, "old", { output, screenshots: [] });
    expect(result.ok || result.error.code).toBe("NEEDS_DOCTOR");
  });

  it("最近一次运行可以只看某个阶段，没有这个阶段时报 NOT_FOUND，还没有运行时为空", async () => {
    const t = await useCore();
    expect(succeed(latestUseRun(t.ctx.db, "app"))).toBeNull();
    succeed(await ingest(t, [{ scene: "S2", step: 1 }], []));
    openUseRound(t, 1);
    const label = (text: string) => {
      const parsed = parseRoundLabel(text);
      if (!parsed.ok) throw new Error(text);
      return parsed.value;
    };
    expect(succeed(latestUseRun(t.ctx.db, "app", { round: label("v1-使用-1") }))?.round).toBe(
      "v1-使用-1",
    );
    expect(succeed(latestUseRun(t.ctx.db, "app", { round: label("v1-使用-2") }))).toBeNull();
    const missing = latestUseRun(t.ctx.db, "app", { round: label("v3-使用-1") });
    expect(missing.ok || missing.error.code).toBe("NOT_FOUND");
  });
});

describe("屏", () => {
  it("第一次截到记为新出现，首次出现的版本是这一版；同一版再跑一次同样的图，不算新出现也不算变过", async () => {
    const t = await useCore();
    const images = [
      ["shots/a.png", plain()],
      ["shots/b.png", withButton(plain())],
      ["shots/c.png", productScreen(700, 450, 3)],
    ] as const;
    const first = succeed(await ingest(t, threeScreens, images));
    expect(keys(first.newScreens)).toEqual(["S1-1-700", "S1-2-700", "S2-1-700"]);
    const again = succeed(await ingest(t, threeScreens, images));
    expect([again.newScreens, again.changedScreens]).toEqual([[], []]);
    const rows = t.ctx.db.select().from(screens).all();
    expect(
      rows.map((row) => [row.firstVersion, row.shotVersion, row.baseShot, row.changedVersion]),
    ).toEqual([
      [1, 1, null, null],
      [1, 1, null, null],
      [1, 1, null, null],
    ]);
  });

  it("下一版只差几个像素的不算变过，多了一个按钮的算变过，也记下上一版的截图", async () => {
    const t = await useCore();
    const v1 = [
      ["shots/a.png", plain()],
      ["shots/b.png", plain()],
      ["shots/c.png", productScreen(700, 450, 3)],
    ] as const;
    succeed(await ingest(t, threeScreens, v1));
    openUseRound(t, 2);
    const v2 = [
      ["shots/a.png", carets(plain(), 2)],
      ["shots/b.png", withButton(plain())],
      ["shots/c.png", productScreen(700, 450, 3)],
    ] as const;
    const result = succeed(await ingest(t, threeScreens, v2));
    expect(result.newScreens).toEqual([]);
    expect(keys(result.changedScreens)).toEqual(["S1-2-700"]);
    const row = t.ctx.db.select().from(screens).where(eq(screens.step, 2)).get();
    expect(row).toMatchObject({
      firstVersion: 1,
      shotVersion: 2,
      changedVersion: 2,
      baseShot: sha256(encodePng(plain())),
      shot: sha256(encodePng(withButton(plain()))),
    });
    const refs = t.ctx.db
      .select()
      .from(blobRefs)
      .where(and(eq(blobRefs.referrerKind, "screen"), eq(blobRefs.referrerId, String(row?.id))))
      .all();
    expect(refs.map((ref) => ref.purpose).sort()).toEqual(["base", "shot"]);
  });

  it("同一版里的每次运行都和上一版的截图比，小差别攒多了也算变过", async () => {
    const t = await useCore();
    const shot: Shot[] = [{ scene: "S1", step: 1, width: 700, path: "a.png" }];
    succeed(await ingest(t, shot, [["a.png", plain()]]));
    openUseRound(t, 2);
    // 五个光标约九十个像素，和上一版比不算变过。
    const five = succeed(await ingest(t, shot, [["a.png", carets(plain(), 5)]]));
    expect(five.changedScreens).toEqual([]);
    // 十个光标和刚才那次只差五个，和上一版比却差了十个，约一百八十个像素。
    const ten = succeed(await ingest(t, shot, [["a.png", carets(plain(), 10)]]));
    expect(keys(ten.changedScreens)).toEqual(["S1-1-700"]);
  });

  it("这一版记为变过以后一直算变过，后来改回原样也不撤销", async () => {
    const t = await useCore();
    const shot: Shot[] = [{ scene: "S1", step: 1, width: 700, path: "a.png" }];
    succeed(await ingest(t, shot, [["a.png", plain()]]));
    openUseRound(t, 2);
    succeed(await ingest(t, shot, [["a.png", withButton(plain())]]));
    const back = succeed(await ingest(t, shot, [["a.png", plain()]]));
    expect(back.changedScreens).toEqual([]);
    const list = succeed(changedScreens(t.ctx.db, "app"));
    expect(list.scenes.flatMap((scene) => scene.screens.map((s) => s.status))).toEqual(["changed"]);
  });

  it("断了和环境出错的步骤的截图不更新屏", async () => {
    const t = await useCore();
    const pass: Shot[] = [{ scene: "S1", step: 1, width: 700, path: "a.png" }];
    succeed(await ingest(t, pass, [["a.png", plain()]]));
    openUseRound(t, 2);
    for (const result of ["断了", "环境"] as const) {
      const shots: Shot[] = [{ scene: "S1", step: 1, width: 700, path: "a.png", result }];
      const ingested = succeed(await ingest(t, shots, [["a.png", withButton(plain())]]));
      expect([ingested.newScreens, ingested.changedScreens]).toEqual([[], []]);
    }
    const row = t.ctx.db.select().from(screens).get();
    expect(row).toMatchObject({ shotVersion: 1, changedVersion: null });
  });

  it("这一版新出现和变过的屏按场景分组，带场景名；按版本查时各算各的", async () => {
    const t = await useCore();
    const v1 = [
      ["shots/a.png", plain()],
      ["shots/b.png", plain()],
      ["shots/c.png", productScreen(700, 450, 3)],
    ] as const;
    succeed(await ingest(t, threeScreens, v1));
    openUseRound(t, 2);
    const shots: Shot[] = [
      ...threeScreens,
      { scene: "S2", step: 1, width: 400, path: "shots/d.png" },
    ];
    const v2 = [
      ["shots/a.png", plain()],
      ["shots/b.png", withButton(plain())],
      ["shots/c.png", productScreen(700, 450, 3)],
      ["shots/d.png", productScreen(400, 450, 3)],
    ] as const;
    succeed(await ingest(t, shots, v2));

    const brief = (list: ReturnType<typeof changedScreens>) =>
      succeed(list).scenes.map((scene) => [
        scene.scene,
        scene.name,
        scene.screens.map((s) => `${s.step}@${s.width} ${s.status}`),
      ]);
    expect(brief(changedScreens(t.ctx.db, "app"))).toEqual([
      ["S1", "看队列", ["2@700 changed"]],
      ["S2", "在窄屏上看", ["1@400 new"]],
    ]);
    expect(succeed(changedScreens(t.ctx.db, "app")).version).toBe(2);
    expect(brief(changedScreens(t.ctx.db, "app", 1))).toEqual([
      ["S1", "看队列", ["1@700 new", "2@700 new"]],
      ["S2", "在窄屏上看", ["1@700 new"]],
    ]);
    expect(brief(listScreens(t.ctx.db, "app"))).toEqual([
      ["S1", "看队列", ["1@700 same", "2@700 changed"]],
      ["S2", "在窄屏上看", ["1@400 new", "1@700 same"]],
    ]);
    const missing = changedScreens(t.ctx.db, "nobody");
    expect(missing.ok || missing.error.code).toBe("NOT_FOUND");
  });

  it("这一版还没截到的屏，列出全部时写明截图是哪一版的", async () => {
    const t = await useCore();
    succeed(await ingest(t, threeScreens.slice(0, 1), [["shots/a.png", plain()]]));
    openUseRound(t, 2);
    const all = succeed(listScreens(t.ctx.db, "app"));
    expect(all.scenes[0]?.screens[0]).toMatchObject({ status: "same", shotVersion: 1 });
  });
});
