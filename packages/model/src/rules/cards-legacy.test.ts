import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { queueEntriesOf, sceneEntriesOf } from "../legacy/convert-page.samples.ts";
import { convertLegacyPage } from "../legacy/convert-page.ts";
import { checkPageData } from "../page/check-page.ts";
import { cardRuleList } from "./cards.ts";
import { optionRuleList } from "./options.ts";
import { allRules } from "./registry.ts";
import { runRules } from "./run.ts";
import { sourceRuleList } from "./sources.ts";

// 旧 skill 的一百一十四份反例样本转换以后，跑这一批规则。第 29 步逐份对照全部规则，这里先对照这一批：
// 旧脚本里搬到这一批的几行报过的样本，要由对应的新规则报出来，级别相同。别的样本这一批不报。
// 样本和转换的做法同 legacy/convert-samples.test.ts。转换以后通不过数据定义的，由定义报出来，规则不跑。
// 样本是反例测试，不是历史页面，所以按平时的方式执行，不按样本上的日期跳过规则。

/** 旧脚本报的一条：v1-final 的 build-report.py 的哪一行，拦截还是提醒。 */
type Message = { readonly rule: string; readonly level: string };

type Sample = {
  readonly id: string;
  readonly input: unknown;
  readonly files?: Readonly<Record<string, { readonly json?: unknown }>>;
  readonly messages: readonly Message[];
};

/**
 * 搬到这一批的旧检查：旧脚本的行号和对应的新规则。
 * 第 235 行是卡上没有来源。只写了一段 saw 的卡，转换成一条没有写法的来源，由 card.source.visual 报。
 * 一条来源都没有的，由数据定义报。
 */
const ported: ReadonlyMap<string, readonly string[]> = new Map([
  ["build-report.py:60", ["card.options.balance"]],
  ["build-report.py:235", ["card.source.visual"]],
  ["build-report.py:240", ["card.source.visual"]],
  ["build-report.py:247", ["card.only.one", "card.only.dropped"]],
  ["build-report.py:250", ["card.only.needed"]],
  ["build-report.py:260", ["card.row.width"]],
  ["build-report.py:265", ["card.shared.required"]],
  ["build-report.py:276", ["card.cell.length"]],
  ["build-report.py:278", ["card.option.why", "card.option.cost"]],
  ["build-report.py:281", ["card.option.when"]],
]);

const file = new URL("../../../../tools/legacy/out/samples.json", import.meta.url);
const samples = (JSON.parse(readFileSync(file, "utf8")) as { readonly samples: readonly Sample[] })
  .samples;
const mainline = new URL("../mainline/__fixtures__/skill-own.md", import.meta.url);
const scenes = sceneEntriesOf(readFileSync(mainline, "utf8"));
const queueFile = "队列.json";
const batch = [...sourceRuleList, ...cardRuleList, ...optionRuleList];

/** 一份样本转换以后，这一批报的拦截和警告，写成「编号 位置」。 */
type Checked = {
  readonly sample: Sample;
  readonly block: readonly string[];
  readonly warn: readonly string[];
};

const checked: Checked[] = samples.flatMap((sample) => {
  const context = { queue: queueEntriesOf(sample.files?.[queueFile]?.json), scenes };
  const converted = convertLegacyPage(sample.input, context);
  if (!converted.ok) return [];
  const { stage, page } = converted.value;
  const parsed = checkPageData(stage, page);
  if (!parsed.ok) return [];
  const run = runRules(batch, parsed.value, {}, { mode: "current", stage });
  const text = (issue: { readonly rule: string; readonly where?: string }) =>
    `${issue.rule} ${issue.where ?? ""}`;
  return [{ sample, block: run.block.map(text), warn: run.warn.map(text) }];
});

describe("旧 skill 的反例样本", () => {
  it("搬过来的几行对应的新规则都登记了", () => {
    const ids = new Set(allRules().map((rule) => rule.id));
    const mapped = [...ported.values()].flat();
    expect(mapped.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("旧脚本搬到这一批的几行报过的样本，对应的新规则都报了，级别相同", () => {
    const missed = checked.flatMap(({ sample, block, warn }) =>
      sample.messages.flatMap((message) => {
        const rules = ported.get(message.rule);
        if (rules === undefined) return [];
        const found = message.level === "block" ? block : warn;
        const hit = found.some((issue) => rules.some((id) => issue.startsWith(`${id} `)));
        return hit ? [] : [`${sample.id} ${message.rule}`];
      }),
    );
    expect(missed).toEqual([]);
  });

  it("这一批报出来的，逐条和旧脚本对得上，别的样本这一批不报", () => {
    const reported = checked.flatMap(({ sample, block, warn }) =>
      [...block, ...warn].map((issue) => `${sample.id} ${issue}`),
    );
    expect(reported).toEqual([
      "legacy-001 card.option.cost asks[0].options[0].cost",
      "legacy-002 card.option.cost findings[0].options[0].cost",
      "legacy-004 card.source.visual asks[0].sources[0]",
      "legacy-005 card.source.visual findings[0].sources[0]",
      "legacy-092 card.shared.required asks[0].shared",
      "legacy-093 card.cell.length asks[0].options[0].diffs[0]",
      // 旧脚本拦截在前，没有跑到措辞提醒。这一份的第一个选项确实比第二个长得多
      "legacy-093 card.options.balance asks[0].options",
      "legacy-100 card.row.width asks[0].rows[0]",
      "legacy-101 card.row.width asks[0].rows[0]",
      "legacy-107 card.option.when asks[0].options[1].when",
      "legacy-108 card.only.needed asks[0].only",
      "legacy-109 card.only.dropped asks[0].dropped",
      "legacy-110 card.options.balance asks[0].options",
    ]);
  });
});
