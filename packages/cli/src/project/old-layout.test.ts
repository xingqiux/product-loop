import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findOldLayouts } from "./old-layout.ts";
import { makeTree, projectJson, tempRoot } from "./testing.ts";

// 「08 版本与迁移」第六节的几个项目，各取旧文件的样子。

describe("项目缓存的旧布局", () => {
  it.each([
    [
      "旧的队列表格，没有 walk/ 和 land/（表单检查插件）",
      ["主线.md", "决定.md", "队列.md"],
      ["主线.md", "决定.md", "队列.md"],
    ],
    [
      "队列.json，另有 walk/ 和 land/（个人网站）",
      ["队列.json", "决定.md", "主线.md", "land/1/", "walk/2026-09-20/"],
      ["主线.md", "决定.md", "队列.json", "walk/", "land/"],
    ],
    [
      "另有 archive/，它不算旧布局的标志（Atlas 文档站）",
      ["队列.md", "决定.md", "主线.md", "archive/font-size-axes/", "land/1/", "walk/2026-09-21/"],
      ["主线.md", "决定.md", "队列.md", "walk/", "land/"],
    ],
    ["迁移做了一半，只有迁移检查写的 migrate/", ["migrate/队列迁移对照.md"], ["migrate/"]],
  ])("%s", async (_name, files, entries) => {
    const root = tempRoot();
    makeTree(
      root,
      files.map((file) => `.product-loop/${file}`),
    );
    expect(await findOldLayouts(root)).toEqual([
      { kind: "projectCache", dir: join(root, ".product-loop"), entries },
    ]);
  });

  it("有 project.json 时算迁移过了，留下的旧文件不算", async () => {
    const root = tempRoot();
    makeTree(root, [projectJson("."), ".product-loop/队列.md", ".product-loop/walk/"]);
    expect(await findOldLayouts(root)).toEqual([]);
  });

  it.each([
    ["空的 .product-loop/", [".product-loop/"]],
    ["只有新布局的 README.md 和 rounds/", [".product-loop/README.md", ".product-loop/rounds/"]],
    ["没有 .product-loop/", ["src/"]],
  ])("%s，不算旧布局", async (_name, files) => {
    const root = tempRoot();
    makeTree(root, files);
    expect(await findOldLayouts(root)).toEqual([]);
  });
});

describe("docs 下的旧布局", () => {
  it("只列产品循环的文件，项目自己的文档不列（Sketch Board 插件）", async () => {
    const root = tempRoot();
    makeTree(root, [
      "docs/队列.md",
      "docs/主线.md",
      "docs/决定.md",
      "docs/walk/2026-09-20/report-16.json",
      "docs/cases/",
      "docs/design-platform-compatibility.md",
    ]);
    expect(await findOldLayouts(root)).toEqual([
      {
        kind: "docs",
        dir: join(root, "docs"),
        entries: ["主线.md", "决定.md", "队列.md", "walk/"],
      },
    ]);
  });

  it("主线、决定和队列有一个就算", async () => {
    const root = tempRoot();
    makeTree(root, ["docs/决定.md", "docs/README.md", "docs/specs/"]);
    expect(await findOldLayouts(root)).toEqual([
      { kind: "docs", dir: join(root, "docs"), entries: ["决定.md"] },
    ]);
  });

  it("只有项目自己的文档时不算，walk/ 和 land/ 也可能是项目自己的", async () => {
    const root = tempRoot();
    makeTree(root, ["docs/README.md", "docs/walk/", "docs/land/", "docs/01-架构.md"]);
    expect(await findOldLayouts(root)).toEqual([]);
  });

  it("主线是符号链接时也算", async () => {
    const root = tempRoot();
    makeTree(root, ["elsewhere/主线.md", "docs/"]);
    symlinkSync(join(root, "elsewhere/主线.md"), join(root, "docs/主线.md"));
    expect(await findOldLayouts(root)).toEqual([
      { kind: "docs", dir: join(root, "docs"), entries: ["主线.md"] },
    ]);
  });
});

describe("旧文件夹", () => {
  it("主线、队列和每个阶段的记录直接放在文件夹里（skill 自己的产品文档）", async () => {
    const root = tempRoot();
    makeTree(root, ["队列.json", "决定.md", "主线.md", "land/", "walk/2026-09-20/"]);
    expect(await findOldLayouts(root)).toEqual([
      { kind: "folder", dir: root, entries: ["主线.md", "决定.md", "队列.json", "walk/", "land/"] },
    ]);
  });

  it.each([
    [
      "旧 skill 的模板文件夹：有主线、决定和队列，没有每个阶段的记录",
      ["主线.md", "决定.md", "队列.json", "report/"],
    ],
    ["只有主线", ["主线.md", "walk/"]],
    ["没有主线", ["决定.md", "队列.md", "walk/"]],
  ])("%s，不算", async (_name, files) => {
    const root = tempRoot();
    makeTree(root, files);
    expect(await findOldLayouts(root)).toEqual([]);
  });

  it("名字是 .product-loop 或 docs 的文件夹不算旧文件夹，由上一级按另外两种认", async () => {
    const root = tempRoot();
    const old = ["主线.md", "队列.md", "walk/"];
    makeTree(root, [...old.map((f) => `.product-loop/${f}`), ...old.map((f) => `docs/${f}`)]);
    expect(await findOldLayouts(join(root, ".product-loop"))).toEqual([]);
    expect(await findOldLayouts(join(root, "docs"))).toEqual([]);
  });
});

it("同一个目录下几种都有时全部列出：项目缓存、docs、旧文件夹", async () => {
  const root = tempRoot();
  makeTree(root, [".product-loop/队列.md", "docs/主线.md", "主线.md", "队列.json", "land/"]);
  expect((await findOldLayouts(root)).map((layout) => [layout.kind, layout.dir])).toEqual([
    ["projectCache", join(root, ".product-loop")],
    ["docs", join(root, "docs")],
    ["folder", root],
  ]);
});
