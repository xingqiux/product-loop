import { createHash } from "node:crypto";
import {
  designSpecItem,
  errorBodySchema,
  mainlinePart,
  mainlineTemplate,
  parseMainline,
  type Result,
  textDiff,
} from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { mainlineRevisions } from "../store/schema/index.ts";
import {
  diffRevisions,
  getRevision,
  latestRevision,
  listRevisions,
  listScenes,
  mainlineStatus,
  type PushedRevision,
  type PushRevisionInput,
  projectWritingSpec,
  pushRevision,
} from "./mainline.ts";
import { addQueueItem } from "./queue.ts";
import { addProject, addRound, emptyCore, startAt, type TestCore } from "./testing.ts";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** 场景清单里的一个场景：标题、谁在什么时候用和一步。标题可以带编号，例如「S2 看队列」。 */
const scene = (title: string, step = "打开工作台 → 看到每个项目停在哪一轮。") => [
  `### ${title}`,
  "谁在什么时候用：你，每天打开工作台的第一眼。",
  `1. ${step}`,
  "",
];

const overview = scene("看所有项目停在哪");
const queueBoard = scene("看队列", "点队列 → 看到五列看板。");
const decisionsPage = scene("看决定", "点决定 → 看到决定的表格。");
const narrow = scene("在窄屏上看", "把窗口拉窄 → 左边一栏换成图标。");

/** 命令写回主线.md 以后的样子：标题带上编号。 */
const numbered = (id: string, block: readonly string[]) => [
  (block[0] ?? "").replace("### ", `### ${id} `),
  ...block.slice(1),
];

/** 写满十样的主线，场景清单里放给定的场景，设计规范十二样都写「无」和原因。tail 接在最后。 */
function mainline(sceneBlocks: readonly (readonly string[])[], tail: readonly string[] = []) {
  return [
    "# 主线",
    "",
    "## 一句话新闻稿",
    "给用 AI 写软件的人用的产品循环。",
    "",
    "## 给谁用",
    "用 AI 写软件的开发者。",
    "",
    "## 要完成的任务",
    "把项目收敛到能交付。",
    "",
    "## 场景清单",
    "",
    ...sceneBlocks.flat(),
    "## 不做什么和胃口",
    "不做手机端。",
    "",
    "## 交付线",
    "不询问 AI 就能点完。",
    "",
    "## 四个风险",
    "价值：省下逐屏检查的时间。",
    "",
    "## 常见问题与待定",
    "待定：无。",
    "",
    "## 事前验尸",
    "原因：页面太长。对策：一页只问当前阶段的事。",
    "",
    "## 设计规范",
    "",
    ...designSpecItem.labels.flatMap((name) => [`### ${name}`, "无，这是命令行产品。", ""]),
    ...tail,
  ].join("\n");
}

/** 取出成功的结果。失败时抛出，测试随之失败。 */
function unwrap<T>(result: Result<T, { readonly message: string }>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function oneProject(): Promise<TestCore> {
  const core = await emptyCore();
  addProject(core, "/work/app");
  return core;
}

/** 在项目 app 里交一版，来源默认是项目缓存。 */
const push = (
  core: TestCore,
  text: string,
  baseRevision: number | null,
  more: Partial<PushRevisionInput> = {},
) => pushRevision(core.ctx, "app", { text, baseRevision, source: "cache", ...more });

/** 交一版并取出结果。 */
const pushed = (
  core: TestCore,
  text: string,
  baseRevision: number | null,
  more: Partial<PushRevisionInput> = {},
): PushedRevision => unwrap(push(core, text, baseRevision, more));

/** 场景表里的全部场景：编号、名字、首次和最近一次出现的版本、从哪一版起不在。 */
const sceneRows = (core: TestCore) =>
  unwrap(listScenes(core.ctx.db, "app", { includeRemoved: true })).map((row) => [
    row.id,
    row.name,
    row.firstRevision,
    row.latestRevision,
    row.removedInRevision,
  ]);

const revisionCount = (core: TestCore) => core.ctx.db.select().from(mainlineRevisions).all().length;

/** 订阅者收到的主线的事件：种类、对象编号和改动内容。 */
const mainlineEvents = (core: TestCore) =>
  core.received
    .filter((event) => event.objectType === "mainlineRevision")
    .map((event) => [event.kind, event.objectId, event.detail]);

const lineOf = (text: string, line: string) => text.split("\n").indexOf(line) + 1;

describe("交一次主线修订", () => {
  it("第一次交主线不写基准，存成修订 1，没写编号的场景按先后从 S1 起补上", async () => {
    const core = await oneProject();
    const text = mainline([overview, queueBoard]);
    const result = pushed(core, text, null);
    const stored = mainline([numbered("S1", overview), numbered("S2", queueBoard)]);
    expect(result).toEqual({
      revision: {
        revision: 1,
        hash: sha256(stored),
        source: "cache",
        round: null,
        createdAt: startAt.toISOString(),
        text: stored,
        parsed: parseMainline(stored),
      },
      created: true,
      assignedScenes: [
        { id: "S1", name: "看所有项目停在哪", line: lineOf(text, "### 看所有项目停在哪") },
        { id: "S2", name: "看队列", line: lineOf(text, "### 看队列") },
      ],
      removedScenes: [],
    });
    expect(sceneRows(core)).toEqual([
      ["S1", "看所有项目停在哪", 1, 1, null],
      ["S2", "看队列", 1, 1, null],
    ]);
  });

  it("存下解析结果：十个部分、场景、设计规范和写作规范，和解析补好编号的全文相同", async () => {
    const core = await oneProject();
    const text = mainline(
      [overview],
      ["## 写作规范", "| 停用的说法 | 改成什么 |", "| --- | --- |", "| 工作流 | 流程 |"],
    );
    const { revision } = pushed(core, text, null);
    const row = core.ctx.db.select().from(mainlineRevisions).get();
    expect(row?.parsed).toEqual(parseMainline(revision.text));
    expect(row?.text).toBe(revision.text);
    expect(row?.maxSceneId).toBe(1);
    expect(revision.parsed.parts.every((entry) => entry.present)).toBe(true);
    expect(revision.parsed.scenes.map((s) => [s.id, s.name])).toEqual([[1, "看所有项目停在哪"]]);
    expect(revision.parsed.designSpec.map((entry) => entry.status)).toEqual(
      designSpecItem.keys.map(() => "none"),
    );
    expect(revision.parsed.writingSpec).toEqual({
      banned: [{ phrase: "工作流", replacement: "流程" }],
      exceptions: [],
    });
  });

  it("编号补上以后不变：场景挪了位置、改了名字和步骤，编号跟着场景走", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview, queueBoard]), null);
    // AI 在写回的主线.md 上改：S2 挪到前面并改名，再加一个没写编号的场景
    const renamed = scene("S2 看队列看板", "点队列 → 看到五列看板，等待的放在上面。");
    const second = pushed(core, mainline([renamed, numbered("S1", overview), decisionsPage]), 1);
    expect(second.assignedScenes.map((s) => [s.id, s.name])).toEqual([["S3", "看决定"]]);
    expect(second.revision.parsed.scenes.map((s) => s.id)).toEqual([2, 1, 3]);
    expect(second.revision.text).toBe(
      mainline([renamed, numbered("S1", overview), numbered("S3", decisionsPage)]),
    );
    expect(sceneRows(core)).toEqual([
      ["S1", "看所有项目停在哪", 1, 2, null],
      ["S2", "看队列看板", 1, 2, null],
      ["S3", "看决定", 2, 2, null],
    ]);
    const s2 = unwrap(listScenes(core.ctx.db, "app")).find((row) => row.id === "S2");
    expect(s2?.steps).toEqual([
      { step: 1, do: "点队列", expect: "看到五列看板，等待的放在上面。" },
    ]);
    // 补好编号的全文再交一次，什么都不变
    expect(pushed(core, second.revision.text, 2).created).toBe(false);
    expect(revisionCount(core)).toBe(2);
  });

  it("删掉的场景记下从哪次修订起不在，编号不再给新场景用，最大的编号删掉了也一样", async () => {
    const core = await oneProject();
    const s1 = numbered("S1", overview);
    pushed(core, mainline([overview, queueBoard]), null);
    expect(pushed(core, mainline([s1]), 1).removedScenes).toEqual(["S2"]);
    expect(pushed(core, mainline([s1, decisionsPage]), 2).assignedScenes[0]?.id).toBe("S3");
    expect(pushed(core, mainline([s1]), 3).removedScenes).toEqual(["S3"]);
    expect(pushed(core, mainline([s1, narrow]), 4).assignedScenes[0]?.id).toBe("S4");
    expect(sceneRows(core)).toEqual([
      ["S1", "看所有项目停在哪", 1, 5, null],
      ["S2", "看队列", 1, 1, 2],
      ["S3", "看决定", 3, 3, 4],
      ["S4", "在窄屏上看", 5, 5, null],
    ]);
  });

  it("删掉的场景又原样写回来时，编号照旧，清掉不见的修订", async () => {
    const core = await oneProject();
    const s1 = numbered("S1", overview);
    pushed(core, mainline([overview, queueBoard]), null);
    pushed(core, mainline([s1]), 1);
    const back = pushed(core, mainline([s1, numbered("S2", queueBoard)]), 2);
    expect(back.assignedScenes).toEqual([]);
    expect(back.removedScenes).toEqual([]);
    expect(sceneRows(core)).toEqual([
      ["S1", "看所有项目停在哪", 1, 3, null],
      ["S2", "看队列", 1, 3, null],
    ]);
  });

  it("AI 自己写了编号的照收，新场景从最大的编号往后数", async () => {
    const core = await oneProject();
    const result = pushed(core, mainline([numbered("S7", queueBoard), overview]), null);
    expect(result.assignedScenes.map((s) => s.id)).toEqual(["S8"]);
    expect(sceneRows(core)).toEqual([
      ["S7", "看队列", 1, 1, null],
      ["S8", "看所有项目停在哪", 1, 1, null],
    ]);
  });

  it("编号写错的场景不补编号，也不进场景表，问题记在解析结果里", async () => {
    const core = await oneProject();
    const result = pushed(core, mainline([numbered("S03", queueBoard), overview]), null);
    expect(result.assignedScenes.map((s) => s.id)).toEqual(["S1"]);
    expect(sceneRows(core)).toEqual([["S1", "看所有项目停在哪", 1, 1, null]]);
    expect(result.revision.parsed.problems).toContainEqual(
      expect.objectContaining({ kind: "sceneIdInvalid", text: "S03" }),
    );
  });

  it("同一个编号写了两次时，场景表按第一次出现的记", async () => {
    const core = await oneProject();
    const text = mainline([numbered("S1", queueBoard), numbered("S1", decisionsPage)]);
    const result = pushed(core, text, null);
    expect(sceneRows(core)).toEqual([["S1", "看队列", 1, 1, null]]);
    expect(result.revision.parsed.problems.map((problem) => problem.kind)).toContain(
      "sceneIdDuplicate",
    );
  });

  it("基准不是最新的修订时返回 CONFLICT，写明最新的是哪次修订，什么都不写", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview]), null);
    pushed(core, mainline([numbered("S1", overview)], ["## 覆盖表", "在 scripts/use/。"]), 1);
    const other = mainline([numbered("S1", overview)], ["## 覆盖表", "另一个会话的改动。"]);
    const result = push(core, other, 1);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "交上来的主线以修订 1 为基准，集中存储里最新的已经是修订 2。",
        hint: "先把修订 2 的内容合进这次的改动，再交一次。运行 ploop mainline show 可以看修订 2。",
        where: "baseRevision",
      },
    });
    expect(!result.ok && errorBodySchema.safeParse(result.error).success).toBe(true);
    expect(revisionCount(core)).toBe(2);
    expect(mainlineEvents(core)).toHaveLength(2);
  });

  it("没写基准却已经有主线，或者写了基准却还没有主线，都返回 CONFLICT", async () => {
    const core = await oneProject();
    expect(push(core, mainline([overview]), 3)).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "交上来的主线以修订 3 为基准，集中存储里还没有主线。",
        hint: "运行 ploop doctor，让项目缓存和集中存储重新对上。",
        where: "baseRevision",
      },
    });
    pushed(core, mainline([overview]), null);
    expect(push(core, mainline([queueBoard]), null)).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "交上来的主线没有写基准修订，集中存储里已经有修订 1。",
      },
    });
    expect(revisionCount(core)).toBe(1);
  });

  it("全文和最新的修订相同时什么都不写，返回最新的修订，不看基准", async () => {
    const core = await oneProject();
    const first = pushed(core, mainline([overview, queueBoard]), null);
    const same = {
      revision: first.revision,
      created: false,
      assignedScenes: [],
      removedScenes: [],
    };
    expect(pushed(core, first.revision.text, 1)).toEqual(same);
    // 另一个会话做了同样的修改，基准还是旧的，内容已经在集中存储里
    expect(pushed(core, first.revision.text, null)).toEqual(same);
    expect(revisionCount(core)).toBe(1);
    expect(mainlineEvents(core)).toHaveLength(1);
  });

  it("带着同一个请求编号重发时，返回第一次的结果，不再建一版", async () => {
    const core = await oneProject();
    const idempotency = { key: "request-1", operation: "POST /projects/app/mainline/revisions" };
    const ctx = { ...core.ctx, idempotency };
    const input = { text: mainline([overview]), baseRevision: null, source: "cache" as const };
    const first = pushRevision(ctx, "app", input);
    expect(first.ok).toBe(true);
    expect(pushRevision(ctx, "app", input)).toEqual(first);
    expect(revisionCount(core)).toBe(1);
  });

  it("没写阶段就记在开着的阶段上，写了就按写的找，找不到返回 NOT_FOUND", async () => {
    const core = await oneProject();
    const s1 = numbered("S1", overview);
    expect(pushed(core, mainline([overview]), null).revision.round).toBeNull();
    addRound(core, "app", { version: 1, stage: "think", seq: 1 });
    addRound(core, "app", { version: 1, stage: "think", seq: 2, status: "open" });
    expect(pushed(core, mainline([s1, queueBoard]), 1).revision.round).toBe("v1-构思-2");
    const earlier = { version: 1, stage: "think", seq: 1 } as const;
    expect(pushed(core, mainline([s1]), 2, { round: earlier }).revision.round).toBe("v1-构思-1");
    const missing = { version: 1, stage: "check", seq: 9 } as const;
    expect(push(core, mainline([s1, narrow]), 3, { round: missing })).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」没有第 1 版的检查阶段（第 9 次）。",
        hint: "运行 ploop version show，查看当前这一版有哪几个阶段。",
        where: "round",
      },
    });
    expect(revisionCount(core)).toBe(3);
  });

  it("来源存英文键。每收进一次修订记一条事件，写明来源、阶段、补上和不见的场景", async () => {
    const core = await oneProject();
    const first = pushed(core, mainline([overview, queueBoard]), null, { source: "migration" });
    addRound(core, "app", { version: 1, stage: "think", seq: 1, status: "open" });
    const text = mainline([numbered("S1", overview), decisionsPage]);
    const second = pushed(core, text, 1, { source: "reply" });
    expect([first.revision.source, second.revision.source]).toEqual(["migration", "reply"]);
    expect(
      core.ctx.db
        .select()
        .from(mainlineRevisions)
        .all()
        .map((row) => row.source),
    ).toEqual(["migration", "reply"]);
    expect(mainlineEvents(core)).toEqual([
      [
        "mainline.revised",
        "1",
        {
          source: "migration",
          hash: first.revision.hash,
          assignedScenes: ["S1", "S2"],
          removedScenes: [],
        },
      ],
      [
        "mainline.revised",
        "2",
        {
          source: "reply",
          round: "v1-构思-1",
          hash: second.revision.hash,
          assignedScenes: ["S3"],
          removedScenes: ["S2"],
        },
      ],
    ]);
  });

  it("全文是空的、基准修订写的不是从 1 起的整数时返回 BAD_REQUEST，一次报齐", async () => {
    const core = await oneProject();
    const result = push(core, " \n\t\n", 0);
    const issues = [
      {
        message: "交上来的主线是空的。",
        hint: "在项目缓存的主线.md 里写好主线，再重跑这条命令。",
        where: "text",
      },
      {
        message: "主线的基准修订要写从 1 起的整数，这里是 0。",
        hint: "写 project.json 里记的主线修订。还没交过主线时不写基准修订。",
        where: "baseRevision",
      },
    ];
    expect(result).toEqual({
      ok: false,
      error: { code: "BAD_REQUEST", ...issues[0], issues, total: 2 },
    });
    expect(push(core, mainline([overview]), 1.5)).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", where: "baseRevision" },
    });
    expect(revisionCount(core)).toBe(0);
  });

  it("要先做迁移检查的项目返回 NEEDS_DOCTOR，项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    const input = { text: mainline([overview]), baseRevision: null, source: "cache" as const };
    expect(pushRevision(core.ctx, "abei", input)).toMatchObject({
      ok: false,
      error: { code: "NEEDS_DOCTOR" },
    });
    expect(pushRevision(core.ctx, "ghost", input)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(revisionCount(core)).toBe(0);
  });
});

describe("主线的读取", () => {
  it("还没交过主线时，最新的修订为空，历次修订和场景都是空的", async () => {
    const core = await oneProject();
    expect(latestRevision(core.ctx.db, "app")).toEqual({ ok: true, value: null });
    expect(listRevisions(core.ctx.db, "app")).toEqual({ ok: true, value: [] });
    expect(listScenes(core.ctx.db, "app", { includeRemoved: true })).toEqual({
      ok: true,
      value: [],
    });
  });

  it("最新的修订带全文和解析结果，按修订号也能取到每次修订", async () => {
    const core = await oneProject();
    const first = pushed(core, mainline([overview]), null);
    const second = pushed(core, mainline([numbered("S1", overview), queueBoard]), 1);
    expect(latestRevision(core.ctx.db, "app")).toEqual({ ok: true, value: second.revision });
    expect(getRevision(core.ctx.db, "app", 1)).toEqual({ ok: true, value: first.revision });
    expect(getRevision(core.ctx.db, "app", 3)).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」的主线没有修订 3。",
        hint: "运行 ploop mainline history，查看主线的历次修订。",
        where: "3",
      },
    });
  });

  it("历次修订按修订号排，不带全文，写明哈希、来源、阶段和时间", async () => {
    const core = await oneProject();
    const first = pushed(core, mainline([overview]), null);
    addRound(core, "app", { version: 1, stage: "think", seq: 1, status: "open" });
    const later = new Date(startAt.getTime() + 60 * 60 * 1000);
    core.setNow(later);
    const text = mainline([numbered("S1", overview), queueBoard]);
    const second = pushed(core, text, 1, { source: "reply" });
    expect(listRevisions(core.ctx.db, "app")).toEqual({
      ok: true,
      value: [
        {
          revision: 1,
          hash: first.revision.hash,
          source: "cache",
          round: null,
          createdAt: startAt.toISOString(),
        },
        {
          revision: 2,
          hash: second.revision.hash,
          source: "reply",
          round: "v1-构思-1",
          createdAt: later.toISOString(),
        },
      ],
    });
  });

  it("任意两次修订逐行比较，结果和文字的逐行对比相同，也可以倒过来比", async () => {
    const core = await oneProject();
    const first = pushed(core, mainline([overview]), null).revision.text;
    const second = pushed(core, mainline([numbered("S1", overview), queueBoard]), 1).revision.text;
    const forward = unwrap(diffRevisions(core.ctx.db, "app", 1, 2));
    expect(forward).toEqual({ from: 1, to: 2, rows: textDiff(first, second) });
    expect(forward.rows).toContainEqual({ k: "ins", parts: [["ins", "### S2 看队列"]] });
    expect(unwrap(diffRevisions(core.ctx.db, "app", 2, 1))).toEqual({
      from: 2,
      to: 1,
      rows: textDiff(second, first),
    });
    expect(unwrap(diffRevisions(core.ctx.db, "app", 2, 2)).rows).toEqual([{ k: "gap", parts: [] }]);
  });

  it("比较时找不到的修订一次报齐", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview]), null);
    const result = diffRevisions(core.ctx.db, "app", 5, 7);
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」的主线没有修订 5。",
        total: 2,
        issues: [{ where: "5" }, { where: "7" }],
      },
    });
    expect(diffRevisions(core.ctx.db, "app", 1, 9)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "项目「app」的主线没有修订 9。", where: "9" },
    });
  });

  it("场景默认只列还在的；连删掉的一起列时，写明从哪次修订起不在", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview, queueBoard]), null);
    pushed(core, mainline([numbered("S1", overview)]), 1);
    const s1 = {
      id: "S1",
      name: "看所有项目停在哪",
      who: "你，每天打开工作台的第一眼。",
      steps: [{ step: 1, do: "打开工作台", expect: "看到每个项目停在哪一轮。" }],
      firstRevision: 1,
      latestRevision: 2,
      removedInRevision: null,
    };
    expect(listScenes(core.ctx.db, "app")).toEqual({ ok: true, value: [s1] });
    expect(unwrap(listScenes(core.ctx.db, "app", { includeRemoved: true }))).toEqual([
      s1,
      {
        id: "S2",
        name: "看队列",
        who: "你，每天打开工作台的第一眼。",
        steps: [{ step: 1, do: "点队列", expect: "看到五列看板。" }],
        firstRevision: 1,
        latestRevision: 1,
        removedInRevision: 2,
      },
    ]);
  });

  it("项目不存在时，各个读取都返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    const { db } = core.ctx;
    for (const result of [
      latestRevision(db, "ghost"),
      listRevisions(db, "ghost"),
      getRevision(db, "ghost", 1),
      diffRevisions(db, "ghost", 1, 2),
      listScenes(db, "ghost"),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
  });
});

describe("主线缺哪几样", () => {
  it("还没交过主线时十个部分和十二个部分都缺", async () => {
    const core = await oneProject();
    expect(mainlineStatus(core.ctx.db, "app")).toEqual({
      revision: null,
      missingParts: mainlinePart.keys,
      missingDesignSpec: designSpecItem.keys,
    });
  });

  it("写满十个部分、十二个部分都写了「无」和原因时，什么都不缺", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview]), null);
    expect(mainlineStatus(core.ctx.db, "app")).toEqual({
      revision: 1,
      missingParts: [],
      missingDesignSpec: [],
    });
  });

  it("没写标题的、标题下面是空的都算缺，按十个部分和十二个部分的顺序列出", async () => {
    const core = await oneProject();
    const text = [
      "## 事前验尸",
      "原因：页面太长。",
      "",
      "## 交付线",
      "",
      "## 一句话新闻稿",
      "给用 AI 写软件的人用的产品循环。",
      "",
      "## 设计规范",
      "",
      "### 状态",
      "",
      "### 配色（用在：状态标签）",
      "蓝色表示能点。",
      "",
      "### 动效",
      "无",
      "",
    ].join("\n");
    pushed(core, text, null);
    expect(mainlineStatus(core.ctx.db, "app")).toEqual({
      revision: 1,
      missingParts: ["audience", "jobs", "scenes", "nonGoals", "deliveryLine", "risks", "faq"],
      // 「无」没写原因由解析结果另报，不算缺
      missingDesignSpec: designSpecItem.keys.filter(
        (item) => item !== "color" && item !== "motion",
      ),
    });
  });

  it("ploop init 写的模板：只有标题，十个部分和十二个部分都算缺", async () => {
    const core = await oneProject();
    pushed(core, mainlineTemplate(), null);
    expect(mainlineStatus(core.ctx.db, "app")).toEqual({
      revision: 1,
      missingParts: mainlinePart.keys,
      missingDesignSpec: designSpecItem.keys,
    });
  });

  it("取最新的修订：补上缺的几个部分以后不再列出", async () => {
    const core = await oneProject();
    const partial = pushed(core, "## 一句话新闻稿\n给用 AI 写软件的人用的产品循环。\n", null);
    expect(mainlineStatus(core.ctx.db, "app").missingParts).toHaveLength(9);
    pushed(core, mainline([overview]), partial.revision.revision);
    expect(mainlineStatus(core.ctx.db, "app")).toEqual({
      revision: 2,
      missingParts: [],
      missingDesignSpec: [],
    });
  });
});

describe("项目的写作规范", () => {
  const writingSection = [
    "## 写作规范",
    "",
    "| 停用的说法 | 改成什么 |",
    "| --- | --- |",
    "| 工作流 | 流程 |",
    "",
    "例外：",
    "- 史蒂夫·乔布斯",
  ];

  it("还没交过主线，或者最新的修订里没有写作规范一节时，是空的", async () => {
    const core = await oneProject();
    const empty = { banned: [], exceptions: [] };
    expect(projectWritingSpec(core.ctx.db, "app")).toEqual(empty);
    pushed(core, mainline([overview], writingSection), null);
    pushed(core, mainline([numbered("S1", overview)]), 1);
    expect(projectWritingSpec(core.ctx.db, "app")).toEqual(empty);
  });

  it("取最新的修订主线里写的停用说法和例外", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview], writingSection), null);
    expect(projectWritingSpec(core.ctx.db, "app")).toEqual({
      banned: [{ phrase: "工作流", replacement: "流程" }],
      exceptions: ["史蒂夫·乔布斯"],
    });
  });

  it("交给队列的写作校验以后，项目停用的说法在放进队列时拦截", async () => {
    const core = await oneProject();
    pushed(core, mainline([overview], writingSection), null);
    const input = { content: "理清发布的工作流", stage: "think", proposer: "ai" } as const;
    const project = projectWritingSpec(core.ctx.db, "app");
    expect(addQueueItem(core.ctx, "app", input, { project })).toMatchObject({
      ok: false,
      error: { code: "RULE_BLOCKED", rule: "writing.term.banned", where: "内容" },
    });
    expect(addQueueItem(core.ctx, "app", input).ok).toBe(true);
  });
});
