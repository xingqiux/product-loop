import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ok } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { makeTree, type TreeItem, tempRoot } from "../project/testing.ts";
import { doctorChecks } from "./checks.ts";
import type { GitProbe } from "./git.ts";
import {
  applyMigrate,
  assignRoundFiles,
  type MigrateState,
  planRounds,
  prepareMigrate,
} from "./migrate.ts";
import type { MigratedPage, PageChecker } from "./migrate-pages.ts";
import { type DoctorScan, scanProject } from "./scan.ts";

// 迁移检查写迁移对照、读回来、按它列出要确认的地方，见第一期计划第 60 步。
// 旧项目搭在临时目录里，git 换成假的，历史页面模式的校验换成假的：数据里有 stats 的算拦截。

const git: GitProbe = {
  repoOf: async () => undefined,
  ignoredBy: async () => undefined,
  tracked: async () => [],
};

const check: PageChecker = async ({ data }) =>
  ok({
    block:
      typeof data === "object" && data !== null && "stats" in data
        ? [{ message: "页面数据里不能写 stats。", where: "stats" }]
        : [],
  });

const queueTable = `| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
|---|---|---|---|---|
| 加搜索 | 构思 | 用户 | 2026-09-20 | 待办 |
| 修按钮 | 修复 | 我 | 2026-09-20 | 已进第 3 轮 |
`;

const decisions = `| # | 决定 | 原因 | 案例 | 日期 |
|---|---|---|---|---|
| 1 | 用 A | 因为快 | 第 1 轮 | 2026-09-20 |
| 2 | 用 C | 因为省 | 第 3 轮 |  |
`;

const page = (fields: object) => JSON.stringify({ date: "2026-09-20", ...fields });

function project(): string {
  const root = tempRoot();
  const items: TreeItem[] = [
    [".product-loop/主线.md", "# 主线\n"],
    [".product-loop/决定.md", decisions],
    [".product-loop/队列.md", queueTable],
    [".product-loop/walk/2026-09-20/think-1.json", page({ stage: "构思", round: 1 })],
    [".product-loop/walk/2026-09-20/land-2.json", page({ stage: "修复", round: 2 })],
    [".product-loop/walk/2026-09-21/report-3.html", "<html></html>"],
    ".product-loop/walk/2026-09-20/report-img/a.png",
  ];
  makeTree(root, items);
  return root;
}

const scan = (root: string) => scanProject(root, { git, currentVersion: "0.0.1" });

async function prepare(root: string): Promise<{ scan: DoctorScan; state: MigrateState }> {
  const result = await scan(root);
  const state = await prepareMigrate(result, check);
  if (!state.ok || state.value === undefined) throw new Error("没有写迁移对照");
  return { scan: result, state: state.value };
}

async function confirmsOf(root: string) {
  const { scan: result, state } = await prepare(root);
  const checks = await applyMigrate(result, doctorChecks(result), state);
  return new Map(checks.map((item) => [item.item, item]));
}

/** 按编号改对照表里一行的几格，列按表头的列名找。 */
function setCells(file: string, id: string, values: readonly (readonly [string, string])[]): void {
  const cellsOf = (line: string) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
  const lines = readFileSync(file, "utf8").split("\n");
  const header = cellsOf(lines.find((line) => line.startsWith("| 编号")) ?? "");
  const edited = lines.map((line) => {
    const cells = cellsOf(line);
    if (cells[0] !== id) return line;
    for (const [column, value] of values) cells[header.indexOf(column)] = value;
    return `| ${cells.join(" | ")} |`;
  });
  writeFileSync(file, edited.join("\n"));
}

const migrate = (root: string, ...parts: string[]) =>
  join(root, ".product-loop", "migrate", ...parts);

describe("写迁移对照", () => {
  it("写出队列、决定和每一页，旧文件一个字节都不改", async () => {
    const root = project();
    const before = readFileSync(join(root, ".product-loop/队列.md"), "utf8");
    const { state } = await prepare(root);
    expect(state.written).toEqual(["队列迁移对照.md", "决定迁移对照.md", "pages/ 下 3 份"]);
    expect(readdirSync(migrate(root, "pages")).sort()).toEqual([
      "2026-09-20_land-2.json",
      "2026-09-20_think-1.json",
      "2026-09-21_report-3.json",
    ]);
    expect(readFileSync(join(root, ".product-loop/队列.md"), "utf8")).toBe(before);
    const snapshot = JSON.parse(
      readFileSync(migrate(root, "pages", "2026-09-21_report-3.json"), "utf8"),
    );
    expect(Object.entries(snapshot)).toEqual([
      ["迁移前的文件名", "report-3"],
      ["文件", "2026-09-21/report-3.html"],
      ["归到的阶段", "2026-09-21/report-3"],
      ["阶段名", ""],
      ["日期", "2026-09-21"],
      ["快照", true],
    ]);
  });

  it("重跑不覆盖 AI 改过的文件", async () => {
    const root = project();
    await prepare(root);
    writeFileSync(migrate(root, "队列迁移对照.md"), "改过了\n");
    const { state } = await prepare(root);
    expect(state.written).toEqual([]);
    expect(readFileSync(migrate(root, "队列迁移对照.md"), "utf8")).toBe("改过了\n");
  });
});

describe("上次 --fix 没做完", () => {
  const identity = JSON.stringify({ schemaVersion: 1, projectId: "p", skillVersion: "0.0.1" });

  /** 旧文件放在 docs/ 里，project.json 已经写好。 */
  function docsProject(): string {
    const root = tempRoot();
    makeTree(root, [
      ["docs/主线.md", "# 主线\n"],
      ["docs/决定.md", decisions],
      ["docs/队列.md", queueTable],
      [".product-loop/project.json", identity],
    ]);
    return root;
  }

  it("project.json 写好了、migrate/ 还在时接着迁移", async () => {
    const root = docsProject();
    makeTree(root, [".product-loop/migrate/"]);
    const state = await prepareMigrate(await scan(root), check);
    expect(state.ok && state.value !== undefined).toBe(true);
  });

  it("migrate/ 已清理时不再迁移", async () => {
    const state = await prepareMigrate(await scan(docsProject()), check);
    expect(state.ok && state.value).toBeUndefined();
  });
});

describe("按迁移对照列出要确认的地方", () => {
  it("旧表格每一行要确认；缺日期的决定、看不出阶段的快照都列出", async () => {
    const root = project();
    const checks = await confirmsOf(root);
    expect(checks.get("queue")?.confirm).toEqual([
      "Q1、Q2 还没确认，核对以后在确认一格写「是」。",
      "Q2：写着「已进第几轮」，查提交记录以后定为已完成或待办。",
    ]);
    expect(checks.get("decisions")?.confirm).toEqual([
      "第 2 条决定还没确认，核对以后在确认一格写「是」。",
      "第 2 条：没有日期，迁移时缺日期。",
    ]);
    expect(checks.get("pages")?.confirm).toEqual([
      "pages/2026-09-21_report-3.json 缺了「阶段名」，或者写法不对。",
    ]);
  });

  it("AI 改好对照以后不再列出，三项的结论变成要迁移", async () => {
    const root = project();
    await prepare(root);
    const queueFile = migrate(root, "队列迁移对照.md");
    setCells(queueFile, "Q1", [["确认", "是"]]);
    setCells(queueFile, "Q2", [
      ["新状态", "已完成"],
      ["完成证据", "提交 3f2a9c1"],
      ["确认", "是"],
    ]);
    const decisionsFile = migrate(root, "决定迁移对照.md");
    setCells(decisionsFile, "2", [
      ["日期", "2026-09-21"],
      ["确认", "是"],
    ]);
    const snapshot = migrate(root, "pages", "2026-09-21_report-3.json");
    writeFileSync(
      snapshot,
      readFileSync(snapshot, "utf8").replace('"阶段名": ""', '"阶段名": "检查"'),
    );
    const checks = await confirmsOf(root);
    expect(checks.get("queue")?.confirm).toEqual([]);
    expect(checks.get("decisions")?.confirm).toEqual([]);
    expect(checks.get("pages")?.confirm).toEqual([]);
    expect(checks.get("pages")?.status).toBe("fix");
  });

  it("早先写的对照文件用旧键（旧编号、轮、阶段），读的时候也认", async () => {
    const root = project();
    await prepare(root);
    const snapshot = migrate(root, "pages", "2026-09-21_report-3.json");
    const doc = new Map(Object.entries(JSON.parse(readFileSync(snapshot, "utf8"))));
    writeFileSync(
      snapshot,
      JSON.stringify(
        Object.fromEntries([
          ["旧编号", doc.get("迁移前的文件名")],
          ["文件", doc.get("文件")],
          ["轮", doc.get("归到的阶段")],
          ["阶段", "检查"],
          ["日期", doc.get("日期")],
          ["快照", true],
        ]),
      ),
    );
    const checks = await confirmsOf(root);
    expect(checks.get("pages")?.confirm).toEqual([]);
  });

  it("页面仍被拦截时写同名的报错文件，改好以后删掉", async () => {
    const root = project();
    await prepare(root);
    const file = migrate(root, "pages", "2026-09-20_think-1.json");
    const doc = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...doc, ...Object.fromEntries([["页面数据", { stats: [] }]]) }),
    );
    const checks = await confirmsOf(root);
    expect(checks.get("pages")?.confirm).toContain(
      "pages/2026-09-20_think-1.json 仍被拦截 1 处，报错写在 pages/2026-09-20_think-1.报错.md。",
    );
    expect(readFileSync(migrate(root, "pages", "2026-09-20_think-1.报错.md"), "utf8")).toContain(
      "- stats：页面数据里不能写 stats。",
    );
    writeFileSync(file, JSON.stringify(doc));
    await confirmsOf(root);
    expect(readdirSync(migrate(root, "pages"))).not.toContain("2026-09-20_think-1.报错.md");
  });

  it("别的检查项要确认的地方写进其他确认.md，勾上以后不再列出", async () => {
    const root = project();
    makeTree(root, [["docs/主线.md", "# 主线\n"]]);
    const first = await confirmsOf(root);
    const location = first.get("location")?.confirm ?? [];
    expect(location.length).toBeGreaterThan(0);
    const acks = migrate(root, "其他确认.md");
    writeFileSync(acks, readFileSync(acks, "utf8").replaceAll("- [ ]", "- [x]"));
    const second = await confirmsOf(root);
    expect(second.get("location")?.confirm).toEqual([]);
  });
});

describe("导入的阶段", () => {
  const at = (
    round: string,
    date: string,
    stage: MigratedPage["stage"] = "think",
  ): MigratedPage => ({
    legacyId: round.split("/").at(-1) ?? round,
    file: `${round}.json`,
    folder: round.split("/")[0] ?? "",
    round,
    stage,
    date,
  });

  it("按日期、同一天按旧轮号排；迁移前的文件名去掉文件夹，重名时保留", () => {
    const rounds = planRounds([
      at("2026-09-21/think-1", "2026-09-21"),
      at("2026-09-20/think-10", "2026-09-20"),
      at("2026-09-20/think-9", "2026-09-20"),
      at("2026-09-22/think-1", "2026-09-22"),
    ]);
    expect(rounds.map((round) => round.legacyId)).toEqual([
      "think-9",
      "think-10",
      "2026-09-21/think-1",
      "2026-09-22/think-1",
    ]);
  });

  it("截图挂在引用它的阶段，文件夹里别的挂在这个文件夹最后一个阶段，没有阶段的挂在之前最近的一个阶段", () => {
    const rounds = planRounds([
      at("2026-09-20/think-1", "2026-09-20"),
      at("2026-09-22/think-2", "2026-09-22"),
    ]);
    const files = assignRoundFiles(
      rounds,
      ["2026-09-20/a.png", "2026-09-21/b.png", "2026-09-22/c.png", "probe.png"],
      new Map([["2026-09-22/c.png", "2026-09-22/think-2"]]),
    );
    expect(Object.fromEntries(files)).toEqual({
      "2026-09-20/think-1": ["2026-09-20/a.png", "2026-09-21/b.png"],
      "2026-09-22/think-2": ["2026-09-22/c.png", "probe.png"],
    });
  });
});
