import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { identity, makeTree, projectJson, type TreeItem, tempRoot } from "../project/testing.ts";
import { doctorChecks } from "./checks.ts";
import type { GitProbe, GitRepo, IgnoreRule } from "./git.ts";
import type { DoctorCheck, DoctorItem } from "./items.ts";
import { doctorCounts } from "./render.ts";
import { type DoctorScan, scanProject } from "./scan.ts";

// 迁移检查的扫描，按「08 版本与迁移」第四节的十二个检查项逐项测。
// 每个测试在临时目录里搭一个旧项目，git 换成假的。最后一组核对扫描前后目录树一个字节都没变。

type FakeGit = {
  readonly repo?: GitRepo;
  readonly rule?: IgnoreRule;
  readonly tracked?: readonly string[];
};

/** 假的 git：给定仓库、忽略规则和已提交的文件。不给仓库时哪里都不在仓库里。 */
function fakeGit({ repo, rule, tracked = [] }: FakeGit = {}): GitProbe {
  return {
    repoOf: async () => repo,
    ignoredBy: async () => rule,
    tracked: async () => [...tracked],
  };
}

const repo: GitRepo = { root: "/repo", worktree: false };

async function scan(root: string, from?: string, git: FakeGit = {}): Promise<DoctorScan> {
  return scanProject(root, {
    ...(from === undefined ? {} : { from }),
    git: fakeGit(git),
    currentVersion: "0.0.1",
  });
}

function checkIn(result: DoctorScan, item: DoctorItem): DoctorCheck {
  const found = doctorChecks(result).find((check) => check.item === item);
  if (found === undefined) throw new Error(`没有检查项 ${item}`);
  return found;
}

/** 一个检查项的全部行，便于按片段查。 */
function textOf(check: DoctorCheck): string {
  return [...check.found, ...check.fix, ...check.confirm].join("\n");
}

// ---- 旧文件的内容

const mainline = `# 主线

https://claude.ai/project/abc

## 4 场景清单

### 场景 1：看结果
1. 打开页面 → 看到结果
2. 点按钮 → 看到详情

## 5 不做什么和胃口

仓库性质：共用仓库
`;

const queueTable = `# 队列

| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
|---|---|---|---|---|
| 加搜索 | 构思 | 用户 | 2026-09-20 | 待办 |
| 修按钮 | 修复 | 我 | 2026-09-20 | 已进第 3 轮 |
| 看数据 | 使用 | 我 | 2026-09-21 | 已进第 4 轮 |
`;

const queueJson = JSON.stringify(
  JSON.parse(
    '{"版本":1,"事项":[' +
      '{"内容":"加搜索","阶段":"构思","提出":"用户","创建时间":"2026-09-20","状态":{"值":"待办"}},' +
      '{"内容":"修按钮","阶段":"落地","提出":"我","创建时间":"2026-09-20","状态":{"值":"已完成","说明":"第 3 轮"}}' +
      "]}",
  ),
);

const decisions = `# 决定

| # | 决定 | 原因 | 案例 | 日期 |
|---|---|---|---|---|
| 1 | 用 A | 因为快 | 第 1 轮 | 2026-09-20 |
| 2 | 用 B（已作废，被 3 推翻） | 因为稳 | 第 2 轮 | 2026-09-20 |
| 3 | 用 C | 因为省 | 第 3 轮 |  |

## 以后再说

| 请求 | 原因 | 日期 |
|---|---|---|
| 加导出 | 没人要 | 2026-09-21 |
`;

/** 一页旧页面数据。 */
const page = (fields: object) => JSON.stringify({ date: "2026-09-20", ...fields });

/** 一个旧 skill 的完整文件夹：主线、决定、队列、walk/ 和 land/。 */
function oldFiles(base: string): TreeItem[] {
  return [
    [`${base}/主线.md`, mainline],
    [`${base}/决定.md`, decisions],
    [`${base}/队列.md`, queueTable],
    [`${base}/walk/2026-09-20/think-1.json`, page({ stage: "构思", round: 1 })],
    [`${base}/walk/2026-09-20/think-1.html`, "<html></html>"],
    [
      `${base}/walk/2026-09-20/fix-1.json`,
      page({ stage: "修复", round: 1, before: { src: "report-img/a.png" } }),
    ],
    `${base}/walk/2026-09-20/report-img/a.png`,
    [`${base}/walk/2026-09-20/land-1.json`, page({ stage: "落地", round: 1 })],
    [`${base}/walk/2026-09-20/facts.json`, "{}"],
    `${base}/walk/probe.mjs`,
    [`${base}/land/1/计划.md`, "# 计划\n"],
    [`${base}/land/1/评审.json`, "[]"],
  ];
}

describe("身份", () => {
  it("没有 project.json，也没有旧文件：只报告，是新项目", async () => {
    const root = tempRoot();
    const result = await scan(root);
    const check = checkIn(result, "identity");
    expect(check.status).toBe("info");
    expect(check.found).toEqual(["没有 project.json，也没有旧 skill 的文件。"]);
    expect(result.skillVersion).toEqual({ kind: "none" });
  });

  it("有旧文件、没有 project.json：--fix 登记项目，skill 版本停在旧 skill", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/主线.md", mainline]]);
    const result = await scan(root);
    expect(checkIn(result, "identity")).toMatchObject({
      status: "fix",
      found: ["没有 project.json。"],
      fix: ["在集中存储里登记项目，迁移完成时写 project.json。"],
    });
    expect(checkIn(result, "skillVersion")).toMatchObject({
      status: "fix",
      found: ["项目停在旧 skill，没有记版本号。"],
      fix: ["迁移完成后写入 0.0.1。"],
    });
  });

  it("project.json 合格：通过，写出项目编号", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson(".")]);
    const result = await scan(root);
    expect(checkIn(result, "identity")).toMatchObject({
      status: "ok",
      found: ["project.json 记着项目 app。"],
    });
    expect(checkIn(result, "skillVersion")).toMatchObject({
      status: "ok",
      found: ["project.json 记着 skill 0.0.1。"],
    });
  });

  it("project.json 写坏了：按登记重写，看不出 skill 版本", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson(".", "{")]);
    const result = await scan(root);
    const check = checkIn(result, "identity");
    expect(check.status).toBe("fix");
    expect(check.found.length).toBeGreaterThan(0);
    expect(check.fix).toEqual(["按集中存储里的登记重写 project.json。"]);
    expect(result.skillVersion).toEqual({ kind: "unreadable" });
  });
});

describe("位置", () => {
  it("旧文件在项目缓存里：通过，数出归档包收的文件，migrate/ 不收", async () => {
    const root = tempRoot();
    makeTree(root, [...oldFiles(".product-loop"), ".product-loop/migrate/队列迁移对照.md"]);
    const result = await scan(root);
    expect(result.location.source).toMatchObject({ kind: "projectCache", viaFrom: false });
    expect(result.location.files).not.toContain("migrate/队列迁移对照.md");
    expect(result.location.files).toHaveLength(12);
    expect(checkIn(result, "location")).toMatchObject({
      status: "ok",
      found: ["旧文件已经在项目缓存 .product-loop/ 里。", "归档包要收 12 个旧文件。"],
    });
  });

  it("docs 布局：列出项目自己的文档，已提交的旧文件清理时用 git 删除", async () => {
    const root = tempRoot();
    makeTree(root, [...oldFiles("docs"), "docs/architecture.md", "docs/cases/a.md"]);
    const result = await scan(root, undefined, { repo, tracked: ["主线.md", "决定.md"] });
    expect(result.location.ownDocs).toEqual(["architecture.md", "cases/"]);
    expect(result.location.files).not.toContain("architecture.md");
    expect(checkIn(result, "location")).toMatchObject({
      status: "fix",
      found: [
        "产品循环的旧文件在 docs/ 下：主线.md、决定.md、队列.md、walk/、land/。",
        "docs/ 里另有项目自己的文档：architecture.md、cases/。它们不动。",
        "归档包要收 12 个旧文件。",
        "docs/ 里已提交进 git 的旧文件：主线.md、决定.md。",
      ],
      fix: [
        "新的项目缓存建在 .product-loop/。docs/ 里产品循环的文件在清理时删除。",
        "清理时用 git 删除这几个文件，在那个仓库里单独提交一次。",
      ],
    });
  });

  it("--from 指明项目根以外的旧文件夹：旧文件夹在清理时整个删除", async () => {
    const root = tempRoot();
    const from = join(tempRoot(), "skill自己的产品文档");
    makeTree(from, oldFiles("."));
    // 上一次迁移检查写的 migrate/ 不算另一处旧文件
    makeTree(root, [".product-loop/migrate/队列迁移对照.md"]);
    const result = await scan(root, from);
    expect(result.from).toBe(from);
    expect(result.location.source).toMatchObject({ kind: "folder", dir: from, viaFrom: true });
    expect(result.location.others).toEqual([]);
    const check = checkIn(result, "location");
    expect(check.status).toBe("fix");
    expect(check.found[0]).toBe(`旧文件在项目根以外：${from}。`);
    expect(check.fix).toEqual([
      "新的项目缓存建在项目根的 .product-loop/，旧文件夹在清理时整个删除。",
    ]);
    expect(checkIn(result, "cache").found).toEqual([
      "迁移完成以后才查。",
      "migrate/ 里有上一次迁移检查写的内容。",
    ]);
  });

  it("--from 指的目录里没有旧文件：要确认", async () => {
    const root = tempRoot();
    const from = tempRoot();
    const result = await scan(root, from);
    expect(result.location.fromEmpty).toBe(true);
    expect(checkIn(result, "location")).toMatchObject({
      status: "confirm",
      confirm: [`--from 指的 ${from} 里没有旧 skill 的文件。`],
    });
  });

  it("项目根本身是旧文件夹：提示到项目根用 --from", async () => {
    const root = tempRoot();
    makeTree(root, oldFiles("."));
    const result = await scan(root);
    expect(result.location.source).toBeUndefined();
    expect(checkIn(result, "location")).toMatchObject({
      status: "confirm",
      found: ["项目根本身是旧 skill 的产品文档文件夹。"],
      confirm: [`到项目的根目录运行 ploop doctor --from ${root}。`],
    });
  });

  it("项目缓存和 docs 都有旧文件：以项目缓存为准，另一处要确认", async () => {
    const root = tempRoot();
    makeTree(root, [...oldFiles(".product-loop"), ["docs/主线.md", mainline]]);
    const result = await scan(root);
    expect(result.location.source?.kind).toBe("projectCache");
    expect(checkIn(result, "location")).toMatchObject({
      status: "confirm",
      confirm: ["两处都有旧文件，先确认哪一处属于这个项目。"],
    });
    expect(textOf(checkIn(result, "location"))).toContain("另有一处旧文件：docs，有 主线.md。");
  });

  it("旧文件里套着另一份旧文件夹：随这个项目归档，要单独迁移的先确认", async () => {
    const root = tempRoot();
    makeTree(root, [...oldFiles(".product-loop"), ...oldFiles(".product-loop/archive/axes")]);
    const result = await scan(root);
    expect(result.location.nested).toEqual(["archive/axes"]);
    const check = checkIn(result, "location");
    expect(check.status).toBe("confirm");
    expect(check.found).toContain("archive/axes 是另一份旧 skill 的产品文档。");
  });
});

describe("忽略规则", () => {
  it("不在 git 仓库里：通过", async () => {
    const root = tempRoot();
    const check = checkIn(await scan(root), "ignore");
    expect(check).toMatchObject({
      status: "ok",
      found: ["项目根不在 git 仓库里，不用写忽略规则。"],
    });
  });

  it("已被忽略：通过，写出是哪条规则", async () => {
    const root = tempRoot();
    const rule = { source: ".gitignore", pattern: ".product-loop/" };
    const check = checkIn(await scan(root, undefined, { repo, rule }), "ignore");
    expect(check).toMatchObject({
      status: "ok",
      found: [".product-loop/ 已被 .gitignore 里的 .product-loop/ 忽略。"],
    });
  });

  it("没被忽略，旧主线写着共用仓库：--fix 写进 .git/info/exclude", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/主线.md", mainline]]);
    const check = checkIn(await scan(root, undefined, { repo }), "ignore");
    expect(check).toMatchObject({
      status: "fix",
      found: [".product-loop/ 没被忽略。", "旧主线写着这是共用的仓库。"],
      fix: ["按共用的仓库写进 .git/info/exclude。"],
    });
  });

  it("没被忽略，看不出仓库类别：要问用户；附加工作目录另写一句", async () => {
    const root = tempRoot();
    const worktree = { root: "/repo", worktree: true };
    const check = checkIn(await scan(root, undefined, { repo: worktree }), "ignore");
    expect(check.status).toBe("confirm");
    expect(check.found).toEqual([".product-loop/ 没被忽略。", "项目根是仓库的附加工作目录。"]);
    expect(check.confirm[0]).toMatch(/^看不出仓库是自己的还是共用的/u);
  });
});

describe("主线", () => {
  it("开头的链接、旧写法的场景和缺的几样都报出来，--fix 存两版", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/主线.md", mainline]]);
    const check = checkIn(await scan(root), "mainline");
    expect(check.status).toBe("fix");
    expect(check.found.slice(0, 3)).toEqual([
      "开头有 claude.ai 的固定链接，在第 3 行。",
      "场景清单有 1 个场景，1 个没有编号。",
      "其中 1 个是旧写法，补编号时改成新的写法。",
    ]);
    expect(check.found[3]).toBe("主线缺 8 个部分，只报告。");
    expect(check.fix[0]).toMatch(/^原文存为主线修订 1。去掉链接、补上场景编号以后存为修订 2/u);
  });

  it("有旧文件、没有主线：只报告", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/队列.md", queueTable]]);
    const check = checkIn(await scan(root), "mainline");
    expect(check).toMatchObject({ status: "info", found: ["没有主线.md，迁移以后从构思开始写。"] });
  });
});

describe("决定", () => {
  it("按形状数行；缺日期的要确认，以后再说没有案例的只报告", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/决定.md", decisions]]);
    const result = await scan(root);
    const check = checkIn(result, "decisions");
    expect(check.status).toBe("confirm");
    expect(check.found).toEqual([
      "决定.md 有 4 行：五列带编号 3 行、三列的以后再说 1 行。",
      "1 行写着已作废，状态记为已作废。",
      "1 行以后再说没有案例。旧表格本来没有这一列，导入时不补。",
    ]);
    expect(check.confirm).toHaveLength(1);
    expect(check.confirm[0]).toMatch(/^第 7 行：/u);
    expect(doctorCounts(result)).toMatchObject({ decisions: 4, decisionsToConfirm: 1 });
  });

  it("不是决定表的行不读，要确认去处", async () => {
    const root = tempRoot();
    const other = "\n## 等用户选\n\n| 方案 | 说明 |\n|---|---|\n| A | 快 |\n";
    makeTree(root, [[".product-loop/决定.md", decisions + other]]);
    const check = checkIn(await scan(root), "decisions");
    expect(check.confirm.at(-1)).toBe("没有读的行不导入，确认它们的去处，例如放进队列。");
  });
});

describe("队列", () => {
  it("旧的表格：建议的状态，逐行确认，同一种说法并成一行", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/队列.md", queueTable]]);
    const result = await scan(root);
    expect(checkIn(result, "queue")).toMatchObject({
      status: "confirm",
      found: ["旧的队列表格有 3 件，建议待办 1 件、待核对 2 件。"],
      fix: ["按确认过的队列迁移对照导入，编号从 Q1 到 Q3。"],
      confirm: [
        "旧表格的每一行写进队列迁移对照，逐行确认。",
        "Q2、Q3：写着「已进第几轮」，查提交记录以后定为已完成或待办。",
      ],
    });
    expect(doctorCounts(result)).toMatchObject({ queue: 3, queueToConfirm: 2 });
  });

  it("旧的表格里一件也没有：句子写完整，不留「建议。」（F36）", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/队列.md", "| 编号 | 事项 | 状态 |\n|---|---|---|\n"]]);
    const check = checkIn(await scan(root), "queue");
    for (const line of check.found) expect(line).not.toMatch(/建议。|：。/u);
  });

  it("队列.json 是空的数组：说里面没有事项", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/队列.json", "[]"]]);
    const check = checkIn(await scan(root), "queue");
    expect(check.found).toContain("队列.json里没有事项。");
  });

  it("队列.json 以它为准，只补编号；另有的队列.md 只进归档", async () => {
    const root = tempRoot();
    makeTree(root, [
      [".product-loop/队列.json", queueJson],
      [".product-loop/队列.md", queueTable],
    ]);
    const check = checkIn(await scan(root), "queue");
    expect(check).toMatchObject({
      status: "fix",
      found: [
        "队列.json 有 2 件，建议待办 1 件、已完成 1 件。",
        "另有旧的队列.md，以队列.json 为准，队列.md 只进归档。",
      ],
      fix: ["十格照收，只补编号，从 Q1 到 Q2。"],
      confirm: [],
    });
  });

  it("队列.json 不是合法的 JSON：写出行和列，要确认", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/队列.json", '{\n  "版本": 1,\n  "事项": [\n}']]);
    const check = checkIn(await scan(root), "queue");
    expect(check.status).toBe("confirm");
    expect(check.confirm[0]).toMatch(/^队列\.json 不是合法的 JSON，在第 4 行第 \d+ 列。$/u);
  });
});

describe("阶段名", () => {
  it("页面数据和队列里写着修复的都数出来，--fix 换成落地", async () => {
    const root = tempRoot();
    makeTree(root, oldFiles(".product-loop"));
    const check = checkIn(await scan(root), "stageName");
    expect(check).toMatchObject({
      status: "fix",
      found: ["1 页的页面数据写着修复：fix-1。", "1 件队列事项的阶段名写着修复。"],
      fix: ["导入时换成落地，迁移前的文件名原样保留。"],
    });
  });

  it("没有写着修复的地方：通过", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/主线.md", mainline]]);
    expect(checkIn(await scan(root), "stageName")).toMatchObject({
      status: "ok",
      found: ["没有写着修复的地方。"],
    });
  });
});

describe("旧页面", () => {
  it("walk/ 在却一页也没有：说没有页面数据，不留「归成 0 个阶段：」（F36）", async () => {
    const root = tempRoot();
    makeTree(root, [".product-loop/walk/"]);
    const check = checkIn(await scan(root), "pages");
    expect(check.found).toContain("walk/ 下没有页面数据。");
    for (const line of check.found) expect(line).not.toContain("：。");
  });

  it("数出页数、阶段数、能直接导入的、截图和别的文件", async () => {
    const root = tempRoot();
    makeTree(root, oldFiles(".product-loop"));
    const result = await scan(root);
    const check = checkIn(result, "pages");
    expect(check.found).toEqual([
      "walk/ 下有 3 页页面数据，归成 3 个阶段：构思 1 个、落地 2 个。",
      "转换以后 2 页可以直接导入，1 页还有要改的地方。",
      "截图 1 张，页面引用了 1 张。",
      "事实文件和别的数据 1 份，例如 2026-09-20/facts.json。",
      "另有 1 个文件只进归档，例如 probe.mjs。",
    ]);
    expect(check.confirm).toEqual(["1 页转换以后还有要改的地方：2026-09-20/fix-1 要改 1 个地方。"]);
    expect(doctorCounts(result)).toMatchObject({
      pages: 3,
      convertible: 2,
      withProblems: 1,
      unconvertible: 0,
      rounds: 3,
      images: 1,
    });
  });

  it("转不了的、不是 JSON 的、截图找不到的、只有网页的都要确认", async () => {
    const root = tempRoot();
    const walk = ".product-loop/walk/2026-09-21";
    makeTree(root, [
      [`${walk}/think-2.json`, page({ round: 2 })],
      [`${walk}/think-3.json`, "{"],
      [`${walk}/use-1.json`, page({ stage: "使用", round: 1, shot: { src: "img/gone.png" } })],
      [`${walk}/report.html`, "<html></html>"],
      [`${walk}/think-4-v2.html`, '<script id="report-data">{}</script>'],
    ]);
    const result = await scan(root);
    const check = checkIn(result, "pages");
    expect(check.status).toBe("confirm");
    expect(check.found).toContain(
      "2 页只有网页：2026-09-21/report.html、2026-09-21/think-4-v2.html。",
    );
    expect(check.found).toContain(
      "其中 2026-09-21/think-4-v2.html 的网页里嵌着页面数据，仍按快照存。",
    );
    expect(check.confirm).toEqual([
      "2026-09-21/report.html 只有网页，看不出阶段名，确认它们各是哪个阶段名。",
      "1 页转换以后还有要改的地方：2026-09-21/use-1 要改 1 个地方。",
      "2026-09-21/think-2.json 转不了：旧页面数据没有写 stage，看不出它属于哪个阶段。",
      "2026-09-21/think-3.json 不是合法的 JSON，在第 1 行第 2 列。",
      "1 张引用的截图找不到：2026-09-21/img/gone.png。",
    ]);
    expect(doctorCounts(result)).toMatchObject({ unconvertible: 2, htmlOnly: 2 });
  });

  it("数据里的日期和文件夹对不上：迁移前的文件名带上文件夹", async () => {
    const root = tempRoot();
    makeTree(root, [
      [".product-loop/walk/2026-09-22/fix-2.json", page({ stage: "修复", round: 2 })],
    ]);
    const result = await scan(root);
    expect(result.pages.pages[0]?.legacyId).toBe("2026-09-22/fix-2");
    expect(checkIn(result, "stageName").found[0]).toBe(
      "1 页的页面数据写着修复：2026-09-22/fix-2。",
    );
  });

  it("同一个阶段的几页阶段名不一样：确认这个阶段的阶段名", async () => {
    const root = tempRoot();
    const walk = ".product-loop/walk/2026-09-20";
    makeTree(root, [
      [`${walk}/land-5-plan.json`, page({ stage: "构思", round: 5 })],
      [`${walk}/land-5.json`, page({ stage: "落地", round: 5 })],
    ]);
    const check = checkIn(await scan(root), "pages");
    expect(check.confirm).toContain(
      "2026-09-20/land-5 里几页的阶段名不一样，确认这个阶段的阶段名。",
    );
  });
});

describe("落地记录", () => {
  it("第一期落地记录只进归档包，对不上页面的只报告", async () => {
    const root = tempRoot();
    const changes = JSON.stringify({ a: { red: {} }, b: { green: {} } });
    makeTree(root, [
      ...oldFiles(".product-loop"),
      [".product-loop/land/2/改行为.json", changes],
      ".product-loop/land/2/对照.html",
    ]);
    const result = await scan(root);
    expect(result.land.records.map((record) => [record.name, record.pages])).toEqual([
      ["1", ["land-1"]],
      ["2", []],
    ]);
    const check = checkIn(result, "landRecords");
    expect(check.status).toBe("fix");
    expect(check.found).toContain("land/2：「a」只有失败，没有通过。");
    expect(check.found).toContain("land/2：「b」没有先失败的记录。");
    expect(check.found).toContain("land/2 另有 对照.html，随记录进归档。");
    expect(check.found).toContain("land/2 没有对应的页面。");
    expect(check.fix).toEqual(["原样进归档包。第一期不导入成落地记录，第二期再补。"]);
    expect(check.confirm).toEqual([]);
  });
});

describe("使用代码", () => {
  it("有 scripts/use/ 和覆盖表：只报告", async () => {
    const root = tempRoot();
    makeTree(root, ["scripts/use/run.mjs", "scripts/use/覆盖表.md"]);
    expect(checkIn(await scan(root), "useCode")).toMatchObject({
      status: "info",
      found: ["使用代码在 scripts/use/，有 2 个文件。", "覆盖表在 scripts/use/覆盖表.md。"],
    });
  });

  it("共用的仓库把使用代码放在 .product-loop/use-code/：也认（决定 107）", async () => {
    const root = tempRoot();
    makeTree(root, [".product-loop/use-code/run.mjs", ".product-loop/use-code/覆盖表.md"]);
    expect(checkIn(await scan(root), "useCode")).toMatchObject({
      status: "info",
      found: [
        "使用代码在 .product-loop/use-code/，有 2 个文件。",
        "覆盖表在 .product-loop/use-code/覆盖表.md。",
      ],
    });
  });

  it("没有使用代码：也只报告", async () => {
    const root = tempRoot();
    expect(checkIn(await scan(root), "useCode")).toMatchObject({
      status: "info",
      found: ["没有找到使用代码。"],
    });
  });
});

describe("skill 版本", () => {
  it("project.json 记的版本比这一版旧：--fix 写入这一版", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson(".", JSON.stringify({ ...identity, skillVersion: "0.0.1" }))]);
    // 现在的版本第一段是 0，比它旧的只能拿假定的 1.0.0 来测。
    const result = await scanProject(root, { git: fakeGit({}), currentVersion: "1.0.0" });
    expect(checkIn(result, "skillVersion")).toMatchObject({
      status: "fix",
      found: ["project.json 记着 skill 0.0.1，比这一版的 1.0.0 旧。"],
    });
  });
});

describe("缓存", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");
  const withBase = (text: string) =>
    projectJson(
      ".",
      JSON.stringify({ ...identity, mainlineBase: { revision: 2, hash: sha(text) } }),
    );

  it("主线和基准一致：通过，列出工作区和运行", async () => {
    const root = tempRoot();
    makeTree(root, [
      withBase(mainline),
      [".product-loop/主线.md", mainline],
      ".product-loop/rounds/v2-检查-1/",
      ".product-loop/use/run-1/",
    ]);
    expect(checkIn(await scan(root), "cache")).toMatchObject({
      status: "ok",
      found: [
        "主线.md 和基准版本一致。",
        "rounds/ 下有 1 个阶段的工作区。",
        "use/ 下有 1 份运行的输出。",
      ],
    });
  });

  it("主线改过：下一条命令交给后端；有远端的一份要确认", async () => {
    const root = tempRoot();
    makeTree(root, [
      withBase("旧的一版"),
      [".product-loop/主线.md", mainline],
      [".product-loop/主线.远端.md", mainline],
    ]);
    expect(checkIn(await scan(root), "cache")).toMatchObject({
      status: "confirm",
      found: ["主线.md 改过，还没有交给后端。"],
      fix: ["下一条命令开始时，按「03 数据模型」第五节交给后端。"],
      confirm: ["有主线.远端.md，上次同步的冲突还没合并。合并进主线.md 以后删掉它。"],
    });
  });

  it("没有基准、没有主线：分别报告", async () => {
    const noBase = tempRoot();
    makeTree(noBase, [projectJson("."), [".product-loop/主线.md", mainline]]);
    expect(checkIn(await scan(noBase), "cache").found).toEqual([
      "project.json 没有主线的基准版本，主线还没交过。",
    ]);
    const missing = tempRoot();
    makeTree(missing, [projectJson(".")]);
    expect(checkIn(await scan(missing), "cache").found).toEqual(["项目缓存里没有主线.md。"]);
  });
});

describe("只读", () => {
  /** 目录树里每个文件的路径和内容的哈希，目录也记下。 */
  function treeHash(dir: string): string {
    const hash = createHash("sha256");
    const walk = (at: string, prefix: string) => {
      for (const name of readdirSync(at).sort()) {
        const full = join(at, name);
        const path = `${prefix}${name}`;
        if (statSync(full).isDirectory()) {
          hash.update(`d ${path}\n`);
          walk(full, `${path}/`);
        } else {
          hash.update(`f ${path}\n`).update(readFileSync(full));
        }
      }
    };
    walk(dir, "");
    return hash.digest("hex");
  }

  it("两种布局和 --from 扫描前后，目录树一个字节都没变", async () => {
    const base = tempRoot();
    const cacheRoot = join(base, "cache");
    const docsRoot = join(base, "docs-project");
    const folderRoot = join(base, "folder-project");
    const from = join(base, "旧文件夹");
    makeTree(cacheRoot, [...oldFiles(".product-loop"), ".product-loop/migrate/队列迁移对照.md"]);
    makeTree(docsRoot, [...oldFiles("docs"), "docs/architecture.md", "scripts/use/run.mjs"]);
    makeTree(folderRoot, ["README.md"]);
    makeTree(from, oldFiles("."));
    const before = treeHash(base);
    await scan(cacheRoot);
    await scan(docsRoot, undefined, { repo, tracked: ["主线.md"] });
    await scan(folderRoot, from);
    await scan(from);
    expect(treeHash(base)).toBe(before);
  });
});
