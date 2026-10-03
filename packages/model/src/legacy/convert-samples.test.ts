import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allCopy } from "../copy/index.ts";
import {
  lostTexts,
  notesText,
  problemsText,
  queueEntriesOf,
  sceneEntriesOf,
  verdictLabel,
} from "./convert-page.samples.ts";
import {
  convertLegacyPage,
  type LegacyConversion,
  type LegacyPageContext,
} from "./convert-page.ts";

// 旧 skill 的一百一十四份反例样本和它们共用的合格数据，由 tools/legacy/export_samples.py 导出，
// 见 tools/legacy/README.md 第一节。每一份都要能转换，转不了的要给出原因（第一期计划第 28 步）。
// 队列对照按每份样本旁边的 队列.json 编号。
// 样本的位置写的场景名是「回答疑问」，它是 skill 自己主线的第一个场景。所以场景对照取自那份主线。
// 每一份的转换结果存成表格。改动转换或定义时，看表格的差别就知道哪几份变了。

type SampleFile = { readonly json?: unknown; readonly text?: string };

type Sample = {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly files?: Readonly<Record<string, SampleFile>>;
  readonly actual: string;
};

type Doc = { readonly count: number; readonly base: unknown; readonly samples: readonly Sample[] };

const file = new URL("../../../../tools/legacy/out/samples.json", import.meta.url);
const doc = JSON.parse(readFileSync(file, "utf8")) as Doc;
const mainline = new URL("../mainline/__fixtures__/skill-own.md", import.meta.url);
const scenes = sceneEntriesOf(readFileSync(mainline, "utf8"));
const queueFile = "队列.json";

const contextOf = (sample?: Sample): LegacyPageContext => ({
  queue: queueEntriesOf(sample?.files?.[queueFile]?.json),
  scenes,
});

type Converted = { readonly sample: Sample; readonly conversion: LegacyConversion };

const converted: Converted[] = [];
const failed: string[] = [];
for (const sample of doc.samples) {
  const result = convertLegacyPage(sample.input, contextOf(sample));
  if (result.ok) converted.push({ sample, conversion: result.value });
  else failed.push(`${sample.id}：${result.error.message}`);
}

describe("旧 skill 的合格数据和反例样本", () => {
  it("合格数据转换以后没有要改的地方", () => {
    const result = convertLegacyPage(doc.base, contextOf());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stage).toBe("check");
    expect(result.value.problems).toEqual([]);
    expect(lostTexts(doc.base, result.value)).toEqual([]);
  });

  it("一百一十四份样本都能转换", () => {
    expect(doc.samples).toHaveLength(doc.count);
    expect(doc.count).toBe(114);
    expect(failed).toEqual([]);
  });

  it("旧页面上的字，要么还在新页面数据里，要么在备注里", () => {
    const lost = converted.flatMap(({ sample, conversion }) =>
      lostTexts(sample.input, conversion).map((text) => `${sample.id} ${text}`),
    );
    expect(lost).toEqual([]);
  });

  it("报出的问题都有文案", () => {
    const keys = new Set(allCopy().map((item) => item.key));
    const checks = new Set(
      converted.flatMap(({ conversion }) => conversion.problems.map((problem) => problem.check)),
    );
    for (const check of checks) expect(keys.has(`${check}.message`), check).toBe(true);
  });

  it("每一份的转换结果存成表格", async () => {
    const passed = converted.filter(({ conversion }) => conversion.problems.length === 0);
    const cell = (text: string) => text.replaceAll("|", "\\|");
    const lines = [
      "# 旧 skill 的反例样本转换以后",
      "",
      "由 convert-samples.test.ts 生成。",
      "「旧判定」是旧构建校验的判定，「转换以后」是转换以后还要改的地方。",
      "",
      `${doc.samples.length} 份样本都能转换，其中 ${passed.length} 份转换以后没有要改的地方。`,
      "",
      "| 编号 | 说明 | 旧判定 | 阶段 | 备注 | 转换以后 |",
      "| --- | --- | --- | --- | --- | --- |",
      ...converted
        .map(({ sample, conversion }) =>
          [
            sample.id,
            cell(sample.name),
            verdictLabel(sample.actual),
            conversion.stage,
            notesText(conversion),
            problemsText(conversion),
          ].join(" | "),
        )
        .map((row) => `| ${row} |`),
      "",
    ];
    await expect(lines.join("\n")).toMatchFileSnapshot("__snapshots__/legacy-samples.md");
  });
});
