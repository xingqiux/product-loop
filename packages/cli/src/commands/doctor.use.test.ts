import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTree } from "../project/testing.ts";
import { sandbox } from "./testing.ts";

// S21 把旧项目迁移过来，照第一期计划第 60 到 62 步的抄录。旧文件放在 docs/ 下，
// 主线、决定、队列已经提交进 git，docs/ 里另有项目自己的设计文档。全部在临时目录里做。
// 1. ploop doctor 写迁移对照，列出要确认的地方，--fix 这时不执行。
// 2. 像 AI 一样改好迁移对照，重跑 ploop doctor，不再列出要确认的地方。
// 3. ploop doctor --fix 归档、导入、核对、写 project.json 和忽略规则，清理旧文件，已提交的单独提交一次删除。

const mainline = [
  "# 主线",
  "",
  "https://claude.ai/project/abc",
  "",
  "## 4 场景清单",
  "",
  "### 场景 1：看结果",
  "1. 打开页面 → 看到结果",
  "",
].join("\n");

const decisions = `| # | 决定 | 原因 | 案例 | 日期 |
|---|---|---|---|---|
| 1 | 用 A | 因为快 | 第 1 轮 | 2026-09-20 |
| 2 | 用 C | 因为省 | 第 3 轮 |  |
`;

const queue = `| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
|---|---|---|---|---|
| 加搜索 | 构思 | 用户 | 2026-09-20 | 待办 |
| 修按钮 | 修复 | 我 | 2026-09-20 | 已进第 3 轮 |
`;

const page = (fields: object) => JSON.stringify({ date: "2026-09-20", ...fields });

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

/** 临时目录里的一个旧项目：旧文件在 docs/，主线、决定、队列和设计文档提交过。 */
function legacyProject() {
  const s = sandbox();
  Object.assign(s.env, {
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  });
  const root = s.at("proj/app");
  s.gitInit("proj/app");
  makeTree(root, [
    ["docs/主线.md", mainline],
    ["docs/决定.md", decisions],
    ["docs/队列.md", queue],
    ["docs/设计.md", "# 设计\n"],
    ["docs/walk/2026-09-20/think-1.json", page({ stage: "构思", round: 1 })],
    ["docs/walk/2026-09-20/land-2.json", page({ stage: "修复", round: 2 })],
    "docs/walk/2026-09-20/report-img/a.png",
    ["docs/walk/2026-09-21/report-3.html", "<html></html>"],
  ]);
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, env: s.env, encoding: "utf8" });
  git("add", "docs/主线.md", "docs/决定.md", "docs/队列.md", "docs/设计.md");
  git("commit", "-q", "-m", "init");
  return { s, root, git };
}

/** 像 AI 一样确认：改对照表、补日期、定快照的阶段，勾上别的要确认的地方。 */
function confirmAll(root: string): string {
  const migrate = join(root, ".product-loop", "migrate");
  setCells(join(migrate, "队列迁移对照.md"), "Q1", [["确认", "是"]]);
  setCells(join(migrate, "队列迁移对照.md"), "Q2", [
    ["新状态", "已完成"],
    ["完成证据", "提交 3f2a9c1"],
    ["确认", "是"],
  ]);
  setCells(join(migrate, "决定迁移对照.md"), "2", [
    ["日期", "2026-09-21"],
    ["确认", "是"],
  ]);
  const snapshot = join(migrate, "pages", "2026-09-21_report-3.json");
  writeFileSync(
    snapshot,
    readFileSync(snapshot, "utf8").replace('"阶段名": ""', '"阶段名": "检查"'),
  );
  const acks = join(migrate, "其他确认.md");
  if (existsSync(acks)) writeFileSync(acks, readFileSync(acks, "utf8").replaceAll("[ ]", "[x]"));
  return migrate;
}

describe("S21 把旧项目迁移过来", { timeout: 120_000 }, () => {
  it("迁移检查、确认、--fix：导入集中存储，清掉旧文件，项目自己的文档不动", () => {
    const { s, root, git } = legacyProject();

    // 1. 迁移检查：写迁移对照，列出要确认的地方
    const first = s.ploop("proj/app", "doctor");
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(
      "写好了迁移对照：队列迁移对照.md、决定迁移对照.md、pages/ 下 3 份",
    );
    expect(first.stdout).toContain("确认：看不出仓库是自己的还是共用的，要问用户。");
    expect(first.stdout).toContain("确认：Q1、Q2 还没确认，核对以后在确认一格写「是」。");
    expect(first.stdout).toContain("确认：第 2 条：没有日期，迁移时缺日期。");
    const early = s.ploop("proj/app", "doctor", "--fix", "--repo", "自己的");
    expect(early.code).toBe(3);
    expect(early.stderr).toContain("--fix 没有执行");
    expect(readdirSync(join(s.store, "archives"))).toEqual([]);

    // 2. 像 AI 一样确认
    const migrate = confirmAll(root);
    const again = s.ploop("proj/app", "doctor", "--repo", "自己的");
    expect(again.code).toBe(0);
    expect(again.stdout).not.toContain("确认：");
    expect(again.stdout).toContain("没有要确认的地方");

    // 3. 执行迁移
    const fixed = s.ploop("proj/app", "doctor", "--fix", "--repo", "自己的");
    expect(fixed.stderr).toBe("");
    expect(fixed.code).toBe(0);
    expect(fixed.stdout).toContain("迁移完成：项目 app");
    expect(fixed.stdout).toContain(
      "导入并核对：3 个阶段、3 页、2 条决定\n还有 2 件队列事项、1 张截图",
    );
    expect(fixed.stdout).toContain("第 1 版结束，第 2 版开始。");
    expect(fixed.stdout).toContain("已提交进 git 的 3 个旧文件用 git 删了，单独提交了一次。");
    expect(readdirSync(join(s.store, "archives"))).toHaveLength(1);

    // 旧文件清掉了，项目自己的文档还在
    expect(readdirSync(join(root, "docs"))).toEqual(["设计.md"]);
    expect(existsSync(migrate)).toBe(false);
    const cache = join(root, ".product-loop");
    expect(JSON.parse(readFileSync(join(cache, "project.json"), "utf8"))).toMatchObject({
      projectId: "app",
      skillVersion: "0.0.1",
    });
    const cleaned = readFileSync(join(cache, "主线.md"), "utf8");
    expect(cleaned).not.toContain("claude.ai");
    expect(cleaned).toContain("S1");
    expect(readFileSync(join(cache, "决定.md"), "utf8")).toContain("用 C");
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".product-loop/\n");

    // 删除单独提交了一次，只含这三个文件
    const last = git("-c", "core.quotepath=false", "show", "--name-status", "--format=%s", "HEAD")
      .trim()
      .split("\n");
    expect(last[0]).toBe("chore: 产品循环的旧文件搬到集中存储");
    expect(last.filter((line) => line.startsWith("D\t")).sort()).toEqual([
      "D\tdocs/主线.md",
      "D\tdocs/决定.md",
      "D\tdocs/队列.md",
    ]);

    // 迁移以后能用：状态里是第 2 版，旧的阶段在第 1 版
    const status = s.ploop("proj/app");
    expect(status.code).toBe(0);
    expect(status.stdout).toContain("第 2 版");
    const rerun = s.ploop("proj/app", "doctor", "--fix");
    expect(rerun.code).toBe(0);
    expect(rerun.stdout).not.toContain("确认：");
  });

  it("导入不通过时停下，不清理；改好迁移对照后重跑，从导入接着做", () => {
    const { s, root } = legacyProject();
    expect(s.ploop("proj/app", "doctor", "--repo", "自己的").code).toBe(0);
    const migrate = confirmAll(root);
    setCells(join(migrate, "决定迁移对照.md"), "1", [
      ["状态", "已作废"],
      ["被哪一条推翻", "9"],
      ["作废原因", "改了主意"],
    ]);
    const failed = s.ploop("proj/app", "doctor", "--fix", "--repo", "自己的");
    expect(failed.code).not.toBe(0);
    expect(failed.stderr).toContain("9");
    // 归档了，但没有清理
    expect(readdirSync(join(s.store, "archives"))).toHaveLength(1);
    expect(existsSync(join(root, "docs", "主线.md"))).toBe(true);
    expect(existsSync(migrate)).toBe(true);
    expect(existsSync(join(root, ".product-loop", "project.json"))).toBe(false);

    setCells(join(migrate, "决定迁移对照.md"), "1", [
      ["状态", "有效"],
      ["被哪一条推翻", ""],
      ["作废原因", ""],
    ]);
    const fixed = s.ploop("proj/app", "doctor", "--fix", "--repo", "自己的");
    expect(fixed.stderr).toBe("");
    expect(fixed.code).toBe(0);
    // 从导入接着做，没有再归档一次
    expect(fixed.stdout).not.toContain("归档：");
    expect(fixed.stdout).toContain("导入并核对：3 个阶段");
    expect(readdirSync(join(s.store, "archives"))).toHaveLength(1);
    expect(existsSync(join(root, "docs", "主线.md"))).toBe(false);
  });
});
