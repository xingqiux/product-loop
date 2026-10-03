import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPageData } from "../page/check-page.ts";
import {
  lostTexts,
  notesText,
  problemsText,
  queueEntriesOf,
  sceneEntriesOf,
} from "./convert-page.samples.ts";
import {
  convertLegacyPage,
  type LegacyConversion,
  type LegacyPageContext,
} from "./convert-page.ts";

// 真实的历史页面，从 skill 自己的 walk/ 下挑了八页，复制进 __fixtures__/pages，测试不依赖仓库以外的文件。
// 复制以后按 Biome 的写法排版，内容没有改。挑的时候照顾到每个阶段、写「修复」的页和几种还要改的地方。
// - skill-own：skill 自己的产品文档，八页。queue.json 是同一个目录下的 队列.json，
//   队列对照按它的先后编号。场景对照取自 skill 自己的主线，就是 mainline/__fixtures__/skill-own.md。

const fixture = (path: string) =>
  readFileSync(new URL(`./__fixtures__/pages/${path}`, import.meta.url), "utf8");

const skillOwn: LegacyPageContext = {
  queue: queueEntriesOf(JSON.parse(fixture("skill-own/queue.json"))),
  scenes: sceneEntriesOf(
    readFileSync(new URL("../mainline/__fixtures__/skill-own.md", import.meta.url), "utf8"),
  ),
};

const contexts: ReadonlyMap<string, LegacyPageContext> = new Map([["skill-own", skillOwn]]);

const pages = [
  // 构思：卡片的旧写法最多，一处位置的场景名对不上。
  "skill-own/2026-09-19/think-2.json",
  // 文件名是旧的 report，阶段写「修复」。
  "skill-own/2026-09-19/report-2.json",
  // 检查：有逐屏检查和队列看板。
  "skill-own/2026-09-20/check-2.json",
  // 修复：转换以后没有要改的地方。
  "skill-own/2026-09-20/fix-2.json",
  // 落地：queueRow 按开头匹配，还写了提升。
  "skill-own/2026-09-20/land-17.json",
  // 构思：queueRow 和队列里的内容完全相同，转换以后没有要改的地方。
  "skill-own/2026-09-20/think-27.json",
  // 使用：有使用阶段的结果。
  "skill-own/2026-09-20/use-1.json",
  // 提升：位置写了场景名，还写了更改。
  "skill-own/2026-09-20/improve-1.json",
];

type Page = {
  readonly path: string;
  readonly old: unknown;
  readonly conversion: LegacyConversion;
  /** 不转换、直接按这一阶段的定义校验，报了几处问题。 */
  readonly before: number;
};

function load(path: string): Page {
  const [project = ""] = path.split("/");
  const context = contexts.get(project);
  if (context === undefined) throw new Error(`没有 ${project} 的对照`);
  const old: unknown = JSON.parse(fixture(path));
  const result = convertLegacyPage(old, context);
  if (!result.ok) throw new Error(`${path}：${result.error.message}`);
  const conversion = result.value;
  const checked = checkPageData(conversion.stage, old);
  return { path, old, conversion, before: checked.ok ? 0 : checked.error.length };
}

const loaded = pages.map(load);
const byPath = new Map(loaded.map((page) => [page.path, page]));
const cardsOf = (path: string, section: string) =>
  (byPath.get(path)?.conversion.page[section] ?? []) as readonly Record<string, unknown>[];

describe("真实的历史页面", () => {
  it("八页都能转换，旧页面上的字都有去处", () => {
    expect(loaded).toHaveLength(8);
    const lost = loaded.flatMap(({ path, old, conversion }) =>
      lostTexts(old, conversion).map((text) => `${path} ${text}`),
    );
    expect(lost).toEqual([]);
  });

  it("转换以前一页都不通过，转换以后六页通过", () => {
    expect(loaded.filter((page) => page.before === 0)).toEqual([]);
    const passed = loaded.filter(({ conversion }) => conversion.problems.length === 0);
    expect(passed.map((page) => page.path)).toEqual([
      "skill-own/2026-09-19/report-2.json",
      "skill-own/2026-09-20/check-2.json",
      "skill-own/2026-09-20/fix-2.json",
      "skill-own/2026-09-20/land-17.json",
      "skill-own/2026-09-20/think-27.json",
      "skill-own/2026-09-20/use-1.json",
    ]);
  });

  it("写「修复」的页转成落地", () => {
    const stages = loaded.map(({ path, conversion }) => [path.split("/").at(-1), conversion.stage]);
    expect(stages).toEqual([
      ["think-2.json", "think"],
      ["report-2.json", "land"],
      ["check-2.json", "check"],
      ["fix-2.json", "land"],
      ["land-17.json", "land"],
      ["think-27.json", "think"],
      ["use-1.json", "use"],
      ["improve-1.json", "improve"],
    ]);
  });

  it("queueRow 按 skill 自己的队列换成编号：完全相同的，以及按开头匹配的", () => {
    const land = cardsOf("skill-own/2026-09-20/land-17.json", "changes");
    expect(land.map((card) => card.queue)).toEqual([["Q65"], ["Q65"], ["Q65"], ["Q65"]]);
    const think = cardsOf("skill-own/2026-09-20/think-27.json", "asks");
    expect(think.flatMap((card) => card.queue ?? [])).toEqual(["Q76", "Q77", "Q80", "Q81"]);
  });

  it("每一页的转换结果存成表格", async () => {
    const passed = loaded.filter(({ conversion }) => conversion.problems.length === 0);
    const lines = [
      "# 历史页面转换以后",
      "",
      "由 convert-history.test.ts 生成。",
      "「转换以前」是不转换、直接按这一阶段的定义校验报的问题数。「转换以后」是转换以后还要改的地方。",
      "",
      `${loaded.length} 页都能转换。转换以前没有一页通过，转换以后 ${passed.length} 页通过。`,
      "",
      "| 页面 | 阶段 | 转换以前 | 备注 | 转换以后 |",
      "| --- | --- | --- | --- | --- |",
      ...loaded.map(({ path, conversion, before }) =>
        [
          `| ${path}`,
          conversion.stage,
          `${before} 处`,
          notesText(conversion),
          `${problemsText(conversion)} |`,
        ].join(" | "),
      ),
      "",
    ];
    await expect(lines.join("\n")).toMatchFileSnapshot("__snapshots__/legacy-history.md");
  });
});
