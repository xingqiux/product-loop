import { createHash } from "node:crypto";
import { designSpecItem, mainlinePart, textDiff } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { addRound, startAt } from "../../core/testing.ts";
import { mainlineRevisions } from "../../store/schema/index.ts";
import { dataOf, errorOf, type TestApp, testApp } from "../testing.ts";

// 主线的接口，见「05 接口」第四节。每个接口至少一成一败，见「10 工程规范与流程」第五节。
// 业务规则的细节在内核的测试里。这里只看请求和响应：中文进出、场景编号的写法和冲突。
// 另看解析时查出的问题写成外壳的警告。

const at = startAt.toISOString();
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/** 场景清单里的一个场景：标题、谁在什么时候用和一步。 */
const scene = (title: string, step = "打开工作台 → 看到每个项目停在哪一轮。") => [
  `### ${title}`,
  "谁在什么时候用：你，每天打开工作台的第一眼。",
  `1. ${step}`,
  "",
];

const overview = scene("看所有项目停在哪");
const queueBoard = scene("看队列", "点队列 → 看到五列看板。");

/** 命令写回主线.md 以后的样子：标题带上编号。 */
const numbered = (id: string, block: readonly string[]) => [
  (block[0] ?? "").replace("### ", `### ${id} `),
  ...block.slice(1),
];

/** 写满十样的主线，场景清单里放给定的场景，设计规范十二样都写「无」和原因。 */
function mainline(sceneBlocks: readonly (readonly string[])[]) {
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
  ].join("\n");
}

/** 第一版交上去以后，补好编号的全文。 */
const firstFilled = mainline([numbered("S1", overview), numbered("S2", queueBoard)]);

const lineOf = (text: string, line: string) => text.split("\n").indexOf(line) + 1;

/** 登记项目 app，返回测试的应用。 */
async function registered(): Promise<TestApp> {
  const t = await testApp();
  await t.request("POST", "/api/v1/projects", { body: { root: "/work/app", repoKind: "自己的" } });
  return t;
}

/** 在项目 app 里交一版。 */
function push(t: TestApp, text: string, baseRevision: number | null, headers = {}) {
  return t.request("POST", "/api/v1/projects/app/mainline/revisions", {
    body: { text, baseRevision },
    headers,
  });
}

/** 登记项目 app，交上第一版：场景 S1、S2，由后端补上编号。 */
async function firstRevision(): Promise<TestApp> {
  const t = await registered();
  dataOf(await push(t, mainline([overview, queueBoard]), null));
  return t;
}

type Revision = { revision: number; text: string; parsed: Record<string, unknown> };
type Pushed = {
  revision: Revision;
  created: boolean;
  assignedScenes: unknown[];
  removedScenes: string[];
};

describe("POST /projects/:pid/mainline/revisions", () => {
  it("第一次交主线不写基准：存成修订 1，补上场景编号，返回补好编号的全文", async () => {
    const t = await registered();
    const res = await push(t, mainline([overview, queueBoard]), null);
    expect(res.status).toBe(201);
    const data = dataOf(res) as Pushed;
    expect(data.created).toBe(true);
    expect(data.assignedScenes).toEqual([
      { id: "S1", name: "看所有项目停在哪", line: lineOf(firstFilled, "### S1 看所有项目停在哪") },
      { id: "S2", name: "看队列", line: lineOf(firstFilled, "### S2 看队列") },
    ]);
    expect(data.removedScenes).toEqual([]);
    expect(data.revision).toMatchObject({
      revision: 1,
      hash: sha256(firstFilled),
      source: "项目缓存",
      round: null,
      createdAt: at,
      text: firstFilled,
    });
    expect(res.body.ok && res.body.warnings).toEqual([]);
  });

  it("基准不是最新的修订，返回 409 CONFLICT，写明最新的是哪次修订，什么都不写", async () => {
    const t = await firstRevision();
    dataOf(await push(t, mainline([numbered("S1", overview)]), 1));
    const res = await push(t, mainline([numbered("S2", queueBoard)]), 1);
    expect(res.status).toBe(409);
    expect(errorOf(res)).toEqual({
      code: "CONFLICT",
      message: "交上来的主线以修订 1 为基准，集中存储里最新的已经是修订 2。",
      hint: "先把修订 2 的内容合进这次的改动，再交一次。运行 ploop mainline show 可以看修订 2。",
      where: "baseRevision",
    });
    expect(t.core.ctx.db.select().from(mainlineRevisions).all()).toHaveLength(2);
  });

  it("全文和最新的修订相同，返回 200，不建新的修订", async () => {
    const t = await firstRevision();
    const res = await push(t, firstFilled, null);
    expect(res.status).toBe(200);
    const data = dataOf(res) as Pushed;
    expect([data.created, data.revision.revision, data.assignedScenes]).toEqual([false, 1, []]);
    expect(t.core.ctx.db.select().from(mainlineRevisions).all()).toHaveLength(1);
  });

  it("解析时查出的问题写成警告，位置写主线.md 的行号", async () => {
    const t = await registered();
    const noWho = ["### 看队列", "1. 点队列 → 看到五列看板。", ""];
    const res = await push(t, mainline([noWho]), null);
    expect(res.status).toBe(201);
    const text = (dataOf(res) as Pushed).revision.text;
    expect(res.body.ok && res.body.warnings).toEqual([
      {
        message: "场景「S1 看队列」没有写谁在什么时候用。",
        hint: "标题下一行写「谁在什么时候用：」加内容。",
        where: `主线.md 第 ${lineOf(text, "### S1 看队列")} 行`,
      },
    ]);
  });

  it("全文是空的，返回 BAD_REQUEST", async () => {
    const t = await registered();
    const res = await push(t, " \n", null);
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({ message: "交上来的主线是空的。", where: "text" });
  });

  it("来源不从请求里取，写了返回 BAD_REQUEST", async () => {
    const t = await registered();
    const res = await t.request("POST", "/api/v1/projects/app/mainline/revisions", {
      body: { text: mainline([overview]), baseRevision: null, source: "迁移" },
    });
    expect(res.status).toBe(400);
    expect(errorOf(res).message).toBe("不认识的字段：source。");
  });

  it("带着同一个请求编号重发，返回第一次的结果，不再建一次修订", async () => {
    const t = await firstRevision();
    const headers = { "Idempotency-Key": "e4b8c1a7-2d9f-4a3e-b6c0-7f1d5e2a9c83" };
    const text = mainline([numbered("S1", overview)]);
    const first = await push(t, text, 1, headers);
    const again = await push(t, text, 1, headers);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(t.core.ctx.db.select().from(mainlineRevisions).all()).toHaveLength(2);
  });
});

describe("GET /projects/:pid/mainline", () => {
  it("还没交过主线：最新的修订为空，十个部分和十二个部分都缺", async () => {
    const t = await registered();
    const res = await t.request("GET", "/api/v1/projects/app/mainline");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      data: {
        latest: null,
        status: {
          revision: null,
          missingParts: mainlinePart.labels,
          missingDesignSpec: designSpecItem.labels,
        },
      },
      warnings: [],
      next: [],
    });
  });

  it("最新的修订：全文和解析结果，枚举写中文，场景编号写成 S1", async () => {
    const t = await firstRevision();
    const res = await t.request("GET", "/api/v1/projects/app/mainline");
    expect(res.status).toBe(200);
    const data = dataOf(res) as { latest: Revision; status: object };
    expect(data.status).toEqual({ revision: 1, missingParts: [], missingDesignSpec: [] });
    expect(data.latest).toMatchObject({ revision: 1, source: "项目缓存", text: firstFilled });
    const { parsed } = data.latest;
    expect(Object.keys(parsed)).not.toContain("problems");
    expect((parsed.parts as unknown[])[0]).toEqual({
      part: "一句话新闻稿",
      present: true,
      heading: { text: "一句话新闻稿", line: 3, endLine: 4 },
    });
    const sceneLine = lineOf(firstFilled, "### S1 看所有项目停在哪");
    expect((parsed.scenes as unknown[])[0]).toEqual({
      id: "S1",
      name: "看所有项目停在哪",
      who: "你，每天打开工作台的第一眼。",
      steps: [
        { step: 1, do: "打开工作台", expect: "看到每个项目停在哪一轮。", line: sceneLine + 2 },
      ],
      line: sceneLine,
      endLine: sceneLine + 2,
      legacy: false,
    });
    const specLine = lineOf(firstFilled, "### 配色");
    expect((parsed.designSpec as unknown[])[1]).toEqual({
      item: "配色",
      status: "写了「无」",
      heading: { text: "配色", line: specLine, endLine: specLine + 1 },
      reason: "这是命令行产品。",
    });
    expect(parsed.writingSpec).toEqual({ banned: [], exceptions: [] });
    expect(res.body.ok && res.body.warnings).toEqual([]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/mainline");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/mainline/revisions", () => {
  it("历次修订按修订号排，不带全文，写明来源和在哪个阶段改的", async () => {
    const t = await firstRevision();
    addRound(t.core, "app", { version: 1, stage: "think", seq: 1, status: "open" });
    const second = mainline([numbered("S1", overview)]);
    dataOf(await push(t, second, 1));
    const res = await t.request("GET", "/api/v1/projects/app/mainline/revisions");
    expect(res.status).toBe(200);
    const summary = { source: "项目缓存", createdAt: at };
    expect(dataOf(res)).toEqual([
      { revision: 1, hash: sha256(firstFilled), round: null, ...summary },
      { revision: 2, hash: sha256(second), round: "v1-构思-1", ...summary },
    ]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/revisions");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/mainline/revisions/:rev", () => {
  it("按修订号取一次修订：全文和解析结果", async () => {
    const t = await firstRevision();
    dataOf(await push(t, mainline([numbered("S1", overview)]), 1));
    const res = await t.request("GET", "/api/v1/projects/app/mainline/revisions/1");
    expect(res.status).toBe(200);
    const data = dataOf(res) as Revision;
    expect([data.revision, data.text]).toEqual([1, firstFilled]);
    expect((data.parsed.scenes as { id: string }[]).map((s) => s.id)).toEqual(["S1", "S2"]);
  });

  it("修订号写错返回 BAD_REQUEST，没有这次修订返回 NOT_FOUND", async () => {
    const t = await firstRevision();
    const bad = await t.request("GET", "/api/v1/projects/app/mainline/revisions/v1");
    expect(bad.status).toBe(400);
    expect(errorOf(bad)).toEqual({
      code: "BAD_REQUEST",
      message: "主线的修订要写从 1 起的整数，这里是「v1」。",
      hint: "运行 ploop mainline history，查看主线的历次修订。",
      where: "v1",
    });
    const missing = await t.request("GET", "/api/v1/projects/app/mainline/revisions/5");
    expect(missing.status).toBe(404);
    expect(errorOf(missing).message).toBe("项目「app」的主线没有修订 5。");
  });
});

describe("GET /projects/:pid/mainline/diff", () => {
  it("任意两次修订逐行比较，结果和文字的逐行对比相同", async () => {
    const t = await firstRevision();
    const second = mainline([numbered("S1", overview)]);
    dataOf(await push(t, second, 1));
    const res = await t.request("GET", "/api/v1/projects/app/mainline/diff?from=1&to=2");
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({ from: 1, to: 2, rows: textDiff(firstFilled, second) });
  });

  it("修订号写错，两个一次报齐，位置写查询参数的名字", async () => {
    const t = await firstRevision();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/diff?from=0&to=第二版");
    expect(res.status).toBe(400);
    const error = errorOf(res);
    expect(error.issues?.map((issue) => [issue.message, issue.where])).toEqual([
      ["主线的修订要写从 1 起的整数，这里是「0」。", "from"],
      ["主线的修订要写从 1 起的整数，这里是「第二版」。", "to"],
    ]);
  });

  it("少写了一个修订号，返回 BAD_REQUEST", async () => {
    const t = await firstRevision();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/diff?from=1");
    expect(res.status).toBe(400);
    expect(errorOf(res)).toMatchObject({ message: "没有写 to。", where: "to" });
  });

  it("没有这次修订，返回 NOT_FOUND", async () => {
    const t = await firstRevision();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/diff?from=1&to=3");
    expect(res.status).toBe(404);
    expect(errorOf(res).message).toBe("项目「app」的主线没有修订 3。");
  });
});

describe("GET /projects/:pid/mainline/parts", () => {
  it("十个部分各记最近改它的修订；只改了场景清单时，别的几个部分还是修订 1", async () => {
    const t = await firstRevision();
    dataOf(await push(t, mainline([numbered("S1", overview)]), 1));
    const res = await t.request("GET", "/api/v1/projects/app/mainline/parts");
    expect(res.status).toBe(200);
    const parts = dataOf(res) as { part: string; revision: number | null; round: string | null }[];
    expect(parts).toHaveLength(10);
    expect(parts.filter((entry) => entry.revision === 2).map((entry) => entry.part)).toEqual([
      "场景清单",
    ]);
    expect(parts.filter((entry) => entry.revision === 1)).toHaveLength(9);
    expect(parts.every((entry) => entry.round === null)).toBe(true);
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/nope/mainline/parts");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/mainline/scenes", () => {
  it("默认只列还在的；includeRemoved=true 时连删掉的一起列，写明从哪次修订起不在", async () => {
    const t = await firstRevision();
    dataOf(await push(t, mainline([numbered("S1", overview)]), 1));
    const current = await t.request("GET", "/api/v1/projects/app/mainline/scenes");
    expect(current.status).toBe(200);
    expect(dataOf(current)).toEqual([
      {
        id: "S1",
        name: "看所有项目停在哪",
        who: "你，每天打开工作台的第一眼。",
        steps: [{ step: 1, do: "打开工作台", expect: "看到每个项目停在哪一轮。" }],
        firstRevision: 1,
        latestRevision: 2,
        removedInRevision: null,
      },
    ]);
    const all = await t.request("GET", "/api/v1/projects/app/mainline/scenes?includeRemoved=true");
    const rows = dataOf(all) as { id: string; removedInRevision: number | null }[];
    expect(rows.map((row) => [row.id, row.removedInRevision])).toEqual([
      ["S1", null],
      ["S2", 2],
    ]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/scenes");
    expect(res.status).toBe(404);
  });
});

describe("GET /projects/:pid/mainline/check", () => {
  it("缺哪几样写中文，场景写法的问题写成警告", async () => {
    const t = await registered();
    const text = [
      "# 主线",
      "",
      "## 一句话新闻稿",
      "给用 AI 写软件的人用的产品循环。",
      "",
      "## 场景清单",
      "",
      "### 看队列",
      "1. 点队列 → 看到五列看板。",
      "",
    ].join("\n");
    dataOf(await push(t, text, null));
    const res = await t.request("GET", "/api/v1/projects/app/mainline/check");
    expect(res.status).toBe(200);
    expect(dataOf(res)).toEqual({
      revision: 1,
      missingParts: mainlinePart.labels.filter((l) => l !== "一句话新闻稿" && l !== "场景清单"),
      missingDesignSpec: designSpecItem.labels,
    });
    expect(res.body.ok && res.body.warnings).toEqual([
      expect.objectContaining({
        message: "场景「S1 看队列」没有写谁在什么时候用。",
        where: "主线.md 第 8 行",
      }),
    ]);
  });

  it("没有这个项目，返回 NOT_FOUND", async () => {
    const t = await testApp();
    const res = await t.request("GET", "/api/v1/projects/app/mainline/check");
    expect(res.status).toBe(404);
  });
});
