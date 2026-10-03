import { join } from "node:path";
import { cliEnvelopeSchema, ok } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { render } from "../output.ts";
import { makeTree, projectJson, tempRoot } from "../project/testing.ts";
import type { GitProbe } from "./git.ts";
import { renderDoctorReport } from "./render.ts";
import { scanProject } from "./scan.ts";

// 迁移检查报告的文字和机读结果，见「04 命令行」第五节：第一行写结果，逐项写发现、--fix 和确认，最后写下一步。

const noGit: GitProbe = {
  repoOf: async () => undefined,
  ignoredBy: async () => undefined,
  tracked: async () => [],
};

const queueTable = `| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
|---|---|---|---|---|
| 加搜索 | 构思 | 用户 | 2026-09-20 | 待办 |
| 修按钮 | 落地 | 我 | 2026-09-20 | 已进第 3 轮 |
`;

const decisions = `| 决定 | 原因 | 案例 | 日期 |
|---|---|---|---|
| 用 A | 因为快 | 第 1 轮 | 2026-09-20 |
`;

async function reportOf(root: string, from?: string, verbose = false) {
  const scan = await scanProject(root, {
    ...(from === undefined ? {} : { from }),
    git: noGit,
    currentVersion: "0.0.1",
  });
  return renderDoctorReport(scan, { verbose });
}

describe("迁移检查报告", () => {
  it("旧的项目缓存：逐项写出结论，下一步先确认再 --fix", async () => {
    const root = tempRoot();
    makeTree(root, [
      [".product-loop/主线.md", "# 主线\n\n## 4 场景清单\n"],
      [".product-loop/决定.md", decisions],
      [".product-loop/队列.md", queueTable],
    ]);
    const report = await reportOf(root);
    const { stdout, stderr } = render(ok(report), false);
    expect(stderr).toBe("");
    expect(stdout.replaceAll(root, "<root>")).toMatchInlineSnapshot(`
      "迁移检查完成：<root>
      旧文件的位置：<root>/.product-loop（项目缓存）
      1 个检查项要 AI 确认，4 个由 --fix 迁移。

      身份：要迁移
        发现：没有 project.json。
        --fix：在集中存储里登记项目，迁移完成时写 project.json。

      位置：通过
        发现：旧文件已经在项目缓存 .product-loop/ 里。
        发现：归档包要收 3 个旧文件。

      忽略规则：通过
        发现：项目根不在 git 仓库里，不用写忽略规则。

      主线：要迁移
        发现：主线缺 9 个部分，只报告。
        发现：第 3 行：场景清单里没有认出任何场景。
        --fix：原文存为主线修订 1，写成项目缓存里的主线.md。

      决定：要迁移
        发现：决定.md 有 1 行：四列不带编号 1 行。
        --fix：按列数和表头识别每一行，导入集中存储，重新生成决定.md。

      队列：要确认
        发现：旧的队列表格有 2 件，建议待办 1 件、待核对 1 件。
        --fix：按确认过的队列迁移对照导入，编号从 Q1 到 Q2。
        确认：旧表格的每一行写进队列迁移对照，逐行确认。
        确认：Q2：写着「已进第几轮」，查提交记录以后定为已完成或待办。

      阶段名：通过
        发现：没有写着修复的地方。

      旧页面：通过
        发现：没有 walk/。

      落地记录：通过
        发现：没有 land/。

      使用代码：只报告
        发现：没有找到使用代码。

      skill 版本：要迁移
        发现：项目停在旧 skill，没有记版本号。
        --fix：迁移完成后写入 0.0.1。

      缓存：通过
        发现：迁移完成以后才查。

      下一步：
        1. 逐项核对「确认」开头的行，改好以后重跑 ploop doctor
        2. ploop doctor --fix
      "
    `);
  });

  it("--json：检查项和结论写中文，另给数目", async () => {
    const root = tempRoot();
    const from = join(tempRoot(), "旧文件夹");
    makeTree(from, [
      ["主线.md", "# 主线\n"],
      ["队列.md", queueTable],
      ["walk/2026-09-20/think-1.json", JSON.stringify({ stage: "构思", date: "2026-09-20" })],
    ]);
    const report = await reportOf(root, from);
    expect(report.kind).toBe("doctor.report");
    const envelope = cliEnvelopeSchema.parse(JSON.parse(render(ok(report), true).stdout));
    expect(envelope).toMatchObject({ ok: true, kind: "doctor.report" });
    expect(report.data).toMatchObject({
      root,
      from,
      source: { layout: "旧文件夹", dir: from, entries: ["主线.md", "队列.md", "walk/"] },
      counts: { pages: 1, convertible: 1, queue: 2, queueToConfirm: 1, decisions: 0 },
    });
    expect(report.data.checks.map((check) => [check.item, check.status])).toEqual([
      ["身份", "要迁移"],
      ["位置", "要迁移"],
      ["忽略规则", "通过"],
      ["主线", "要迁移"],
      ["决定", "通过"],
      ["队列", "要确认"],
      ["阶段名", "通过"],
      ["旧页面", "要迁移"],
      ["落地记录", "通过"],
      ["使用代码", "只报告"],
      ["skill 版本", "要迁移"],
      ["缓存", "通过"],
    ]);
  });

  it("没有旧文件的新项目：提示开工，或者用 --from 指明旧文件", async () => {
    const report = await reportOf(tempRoot());
    expect(report.lines.slice(1, 2)).toEqual(["这里没有产品循环的文件。"]);
    expect(report.next).toEqual([
      "在项目根目录运行 ploop init 开工",
      "旧文件在项目根以外时，运行 ploop doctor --from <目录>",
    ]);
  });

  it("迁移过、缓存一致：文字只写一行「没有要迁移的地方」，--json 里检查项都在", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson(".")]);
    const report = await reportOf(root);
    expect(report.lines).toEqual(["没有要迁移的地方。"]);
    expect(report.next).toEqual(["ploop status"]);
    expect(report.data.checks.length).toBe(12);
  });

  it("写 verbose 时健康的项目也把每个检查项列出来", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson(".")]);
    const report = await reportOf(root, undefined, true);
    expect(report.lines[0]).toBe(`迁移检查完成：${root}`);
    expect(report.lines[1]).toBe("没有要迁移的地方。");
    expect(report.lines.some((line) => line.startsWith("身份："))).toBe(true);
  });

  it("没有要迁移的地方，但有只报告的：文字仍只写一行，只报告的项在 --json 里，写 verbose 才列出", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson("."), "scripts/use/run.mjs"]);
    const report = await reportOf(root);
    expect(report.lines).toEqual(["没有要迁移的地方。"]);
    const useCode = report.data.checks.find((check) => check.item === "使用代码");
    expect(useCode).toMatchObject({ status: "只报告" });
    const verbose = await reportOf(root, undefined, true);
    expect(verbose.lines).toContain("使用代码：只报告");
    expect(verbose.lines).toContain("  发现：使用代码在 scripts/use/，有 1 个文件。");
  });

  it("只有要迁移的：下一步只写 --fix", async () => {
    const root = tempRoot();
    makeTree(root, [[".product-loop/决定.md", decisions]]);
    const report = await reportOf(root);
    expect(report.lines[2]).toBe("没有要确认的地方，3 个检查项由 --fix 迁移。");
    expect(report.next).toEqual(["ploop doctor --fix"]);
  });
});
