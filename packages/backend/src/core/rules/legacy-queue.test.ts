import { readFileSync } from "node:fs";
import {
  convertLegacyPage,
  issuesOf,
  type PageSections,
  parseLegacyQueueTable,
  readLegacyQueueJson,
  stage,
} from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { addQueueItem } from "../queue.ts";
import { addProject, emptyCore } from "../testing.ts";
import { batchCovered } from "./batch.ts";

// 旧 skill 反例样本里 check_queue_source 报过的样本，在后端对照，见第一期计划第 29 步和第 44 步。
// 旧检查找队列文件、查每件事的格式、查本阶段的事有没有拿全，依赖当时的队列文件。
// 现在队列只在集中存储里，每件事由命令放进去，所以旧检查的每一行归到下面几处之一：
// - 本阶段还没拿的事（build-report.py:225）：拿出来改在开始一轮时，卡上没引用的由 round.batch.covered 拦截。
// - queueRow 对不上或对上几件（207、216、218）：旧页面转换时报成要改的地方。
//   不到六个字的 queueRow 旧检查只提醒，现在对不上就要改，因为新页面按编号引用。
// - 内容里用分号挤了几件事（queue.py:66）：放进队列时由 queue.content.semicolons 拦截，
//   两个分号在一句里，写作校验也拦截。
// - 队列文件的格式（queue.py:33、51、53、56 和 build-report.py:177）：旧文件只在迁移时读一次，
//   读法见 model 的 legacy/queue-table.ts。认不出的格记成要确认的地方，由 AI 确认，见第 60 步。
//   旧的表格格式不再拦截，迁移时转成队列。缺验收标准的一件照常导入，现在验收标准可以不写。
// - 找不到队列文件（build-report.py:579）：现在每个项目都有队列，不再有这种情况。

type Message = { readonly check: string; readonly rule: string; readonly level: string };
type SampleFile = { readonly json?: unknown; readonly text?: string };
type Sample = {
  readonly id: string;
  readonly input: unknown;
  readonly files?: Readonly<Record<string, SampleFile>>;
  readonly messages: readonly Message[];
};

const file = new URL("../../../../../tools/legacy/out/samples.json", import.meta.url);
const samples = (JSON.parse(readFileSync(file, "utf8")) as { readonly samples: readonly Sample[] })
  .samples;

const jsonFile = "队列.json";
const tableFile = "队列.md";

/**
 * 一份样本在现在的做法里落到哪里，写成一个编号或一句说明：
 * 先读队列文件，再把每件事放进队列，再转换页面，最后按开始一轮拿出的事跑 round.batch.covered。
 */
async function outcomeOf(sample: Sample): Promise<string> {
  const files = sample.files ?? {};
  const table = files[tableFile]?.text;
  if (table !== undefined) {
    const read = parseLegacyQueueTable(table);
    return read.problems.length === 0 && read.rows.length > 0 ? "迁移时转成队列" : "读不出";
  }
  const queue = files[jsonFile];
  if (queue === undefined) return "不再发生";
  if (queue.json === undefined) return "迁移时确认：不是 JSON";
  const read = readLegacyQueueJson(queue.json);
  // 进行中的事迁移时按待核对，由 AI 定为已完成或待办，不是格式的问题。
  const checks = read.rows.flatMap((row) =>
    row.checks.flatMap((check) => (check.kind === "verify" ? [] : [check.kind])),
  );
  if (checks.length > 0) return `迁移时确认：${[...new Set(checks)].join("、")}`;

  // 每件事按现在的做法放进队列，放不进的由队列的规矩拦截。
  const core = await emptyCore();
  addProject(core, "/work/app");
  for (const row of read.rows) {
    const put = addQueueItem(core.ctx, "app", {
      content: row.content,
      stage: row.stage ?? "check",
      proposer: row.proposer,
    });
    if (!put.ok)
      return issuesOf(put.error)
        .map((issue) => issue.rule ?? put.error.code)
        .join("、");
  }

  const entries = read.rows.map((row) => ({ id: row.id, text: row.content }));
  const converted = convertLegacyPage(sample.input, { queue: entries, scenes: [] });
  if (!converted.ok) return converted.error.check;
  const queueRow = converted.value.problems.find((p) => p.check.startsWith("legacyPage.queueRow"));
  if (queueRow !== undefined) return queueRow.check;

  // 开始一轮时拿出这个阶段待办和进行中的事。规则只读卡上的 queue，页面按转换以后的样子传。
  const label = stage.label(converted.value.stage);
  const batch = read.rows.filter(
    (row) => row.old.stage === label && ["待办", "进行中"].includes(row.old.status),
  );
  const page = converted.value.page as PageSections;
  const hits = batchCovered.check(
    { page, purpose: "ask" },
    { batch: batch.map((row) => ({ id: row.id, content: row.content })) },
  );
  return hits.length > 0 ? batchCovered.id : "不报";
}

/** 旧检查的每一行，现在落到哪里。 */
const expected: ReadonlyMap<string, string> = new Map([
  ["build-report.py:225", "round.batch.covered"],
  ["build-report.py:218", "legacyPage.queueRow.ambiguous"],
  ["build-report.py:216", "legacyPage.queueRow.unknown"],
  ["build-report.py:207", "legacyPage.queueRow.unknown"],
  ["build-report.py:579", "不再发生"],
  ["build-report.py:177", "迁移时转成队列"],
  ["queue.py:66", "writing.sentence.semicolons、queue.content.semicolons"],
  ["queue.py:33", "迁移时确认：不是 JSON"],
  ["queue.py:53", "迁移时确认：stageUnknown"],
  ["queue.py:56", "迁移时确认：statusUnknown"],
  ["queue.py:51", "不报"],
]);

const reported = samples.flatMap((sample) =>
  sample.messages
    .filter((message) => message.check === "check_queue_source")
    .map((message) => ({ sample, rule: message.rule })),
);

describe("check_queue_source 的反例样本", () => {
  it("旧检查报过的每一行都写明了现在落到哪里", () => {
    const rules = [...new Set(reported.map((item) => item.rule))].sort();
    expect(rules).toEqual([...expected.keys()].sort());
  });

  it.each(reported.map((item) => [item.sample.id, item.rule, item] as const))(
    "%s 旧检查报 %s",
    async (_id, rule, { sample }) => {
      expect(await outcomeOf(sample)).toBe(expected.get(rule));
    },
  );
});
