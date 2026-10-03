import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { diagramEdgeRelationSamples } from "./diagram.samples.ts";
import { diagramEdgeRelation, pageDiagrams, unlabelledEdges } from "./diagram.ts";
import { whereText } from "./run.ts";

// 规则 diagram.edge.relation 在总测试以外的情况。
// 逐条线的预期都在 v1-final 的 build-report.py 上跑过，和旧脚本的判断相同。

/** 看不见的几个字写成码位。直接写在字符串里，格式化以后就看不出是什么字。 */
const bom = String.fromCodePoint(0xfeff);
const lineSeparator = String.fromCodePoint(0x2028);
const wideSpace = String.fromCodePoint(0x3000);

type Diagram = NonNullable<NonNullable<PageSections["asks"]>[number]["diagrams"]>[number];

const quote = { name: "用户昨天说的", saw: "「这条线是什么意思」", quote: true } as const;

function architecture(title: string, code: string): Diagram {
  return { kind: "architecture", title, code };
}

/** 一张疑问卡上放几张图表的一页。 */
function askWith(...diagrams: Diagram[]): PageSections {
  return {
    asks: [{ title: "后端没开时命令行怎么办", why: "待决定的事。", sources: [quote], diagrams }],
  };
}

/** 命中写成「位置 第几行 第几条」，便于比较。 */
function hitsOf(page: PageSections): string[] {
  return diagramEdgeRelation
    .check(page, {})
    .map((hit) => `${whereText(hit.where ?? "")} ${hit.params.row} ${hit.params.order}`);
}

describe("样本都是合格的页面数据", () => {
  const { base, hits } = diagramEdgeRelationSamples;
  const samples = [
    ["基础数据", base.subject] as const,
    ...hits.map((sample) => [sample.why, sample.subject] as const),
  ];
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("逐条线判断有没有写明关系", () => {
  it.each([
    ["关系写在线的中间", "A-- 调用 -->B", []],
    ["关系写在线的后面", "A -->|调用| B", []],
    ["没写关系", "A --> B", [1]],
    ["一行两条线，第二条没写", "A-- 调用 -->B --> C", [2]],
    ["一行几条线都没写，每条都报", "A-->B-->C-->D", [1, 2, 3]],
    ["一行两条线都写了", "A -- 调用 --> B -- 读 --> C", []],
    ["关系紧挨着短横", "A --调用--> B", []],
    ["关系里有短横", "A -- 读-写 --> B", []],
    ["三条短横起头，关系写在中间", "A --- 调用 --> B", []],
    ["三条短横的箭头", "A -- 调用 ---> B", []],
    ["关系写在中间，后面又跟着竖线", "A -- 调用 -->|读| B", []],
    ["粗线写了关系", "A == 独占 ==> B", []],
    ["粗线没写关系", "A ==> B", [1]],
    ["虚线没写关系", "A -.-> B", [1]],
    ["虚线的关系写在后面", "A -.->|拉起| B", []],
    ["两头都有箭头", "A <--> B", [1]],
    ["竖线中间是空的", "A -->|| B", [1]],
    ["注释里的线也查", "%% A --> B", [1]],
    ["关系只写了全角空格", `A --${wideSpace}--> B`, [1]],
  ])("%s：%s", (_why, line, orders) => {
    expect(unlabelledEdges(line)).toEqual(orders);
  });

  it.each([
    ["虚线的关系写在中间，旧脚本认不出这种线", "A -. 拉起 .-> B"],
    ["没有箭头的线", "A --- B"],
    ["箭头朝左", "A <-- B"],
    ["圆头的线", "A --o B"],
    ["竖线中间只有一个空格，旧脚本算写了关系", "A -->| | B"],
  ])("旧脚本照样放过的写法：%s", (_why, line) => {
    expect(unlabelledEdges(line)).toEqual([]);
  });

  it("关系里有 > 时，旧脚本认不出前面的关系，照样报", () => {
    expect(unlabelledEdges("A -- a>b --> B")).toEqual([1]);
  });

  it("空白按 Python 算：0x1f 是空白，字节顺序标记不是", () => {
    expect(unlabelledEdges("A --\u001f--> B")).toEqual([1]);
    expect(unlabelledEdges(`A --${bom}--> B`)).toEqual([]);
  });
});

describe("查哪些图表", () => {
  it("只查架构图，别的种类的线不写关系也放过", () => {
    const kinds = ["flowchart", "sequence", "state", "timeline", "beforeAfter"] as const;
    const page = askWith(
      ...kinds.map((kind) => ({ kind, title: `一张${kind}`, code: "flowchart LR\n A-->B" })),
    );
    expect(hitsOf(page)).toEqual([]);
  });

  it("先对齐、疑问、发现问题、提升上的架构图都查，共同的部分里的也查", () => {
    const bare = (title: string) => architecture(title, "flowchart LR\n  A --> B");
    const page: PageSections = {
      align: [
        {
          name: "后端",
          usedIn: ["后端没开时命令行怎么办"],
          meaning: "本机常驻的一个进程。",
          example: "ploop status 连上后端。",
          diagram: bare("先对齐的图"),
        },
      ],
      asks: [
        {
          title: "后端没开时命令行怎么办",
          why: "待决定的事。",
          sources: [quote],
          diagrams: [bare("疑问卡的图")],
          shared: { text: "共同的部分。", diagrams: [bare("疑问卡共同的部分里的图")] },
        },
      ],
      findings: [
        {
          title: "队列看板的线没写关系",
          why: "看不出谁调用谁。",
          sources: [quote],
          where: { scene: "S3", step: 2 },
          diagrams: [bare("发现卡的图")],
        },
      ],
      improvements: [
        {
          title: "给看板加一张结构图",
          why: "新来的人看得懂。",
          sources: [quote],
          where: { scene: "S9", step: 1 },
          shared: { text: "共同的部分。", diagrams: [bare("提升卡共同的部分里的图")] },
        },
      ],
    };
    expect(pageDiagrams(page).map((placed) => placed.diagram.title)).toEqual([
      "先对齐的图",
      "疑问卡的图",
      "疑问卡共同的部分里的图",
      "发现卡的图",
      "提升卡共同的部分里的图",
    ]);
    expect(hitsOf(page)).toEqual([
      "align[0].diagram.code 2 1",
      "asks[0].diagrams[0].code 2 1",
      "asks[0].shared.diagrams[0].code 2 1",
      "findings[0].diagrams[0].code 2 1",
      "improvements[0].shared.diagrams[0].code 2 1",
    ]);
  });

  it("没有图表的页面不命中", () => {
    expect(hitsOf({})).toEqual([]);
    expect(
      hitsOf({ asks: [{ title: "一条疑问", why: "待决定的事。", sources: [quote] }] }),
    ).toEqual([]);
  });
});

describe("第几行和报错里的这一行", () => {
  it("按 Python 的 splitlines() 断行：回车换行算一处，行分隔符和 0x85 也断行", () => {
    const code = `flowchart LR\r\n  A --> B${lineSeparator}  C --> D\u0085  E --> F\n`;
    expect(hitsOf(askWith(architecture("断行", code)))).toEqual([
      "asks[0].diagrams[0].code 2 1",
      "asks[0].diagrams[0].code 3 1",
      "asks[0].diagrams[0].code 4 1",
    ]);
  });

  it("报错里的这一行按 Python 的 strip() 去掉两头的空白，0x1f 也去掉", () => {
    const code = `flowchart LR\n${wideSpace} cli --> backend\u001f`;
    const [hit] = diagramEdgeRelation.check(askWith(architecture("空白", code)), {});
    expect(hit?.params).toEqual({ title: "空白", row: 2, order: 1, text: "cli --> backend" });
  });
});

type LegacySample = {
  readonly id: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly messages: readonly { readonly rule: string; readonly text: string }[];
};

const legacyFile = new URL("../../../../tools/legacy/out/samples.json", import.meta.url);
const legacy = (JSON.parse(readFileSync(legacyFile, "utf8")) as { samples: LegacySample[] })
  .samples;

function fields(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {};
}

/** 数据里写了种类和文字定义的对象，也就是图表，有几张。 */
function countDiagrams(value: unknown): number {
  if (Array.isArray(value)) return value.reduce<number>((n, x) => n + countDiagrams(x), 0);
  if (typeof value !== "object" || value === null) return 0;
  const own = "kind" in value && "code" in value ? 1 : 0;
  return Object.values(value).reduce<number>((n, x) => n + countDiagrams(x), own);
}

/** 旧页面数据里疑问卡上的图表搬进新格式的一页，卡上别的字段换成最简单的合格写法。 */
function diagramsPage(input: Readonly<Record<string, unknown>>) {
  const asks = (Array.isArray(input.asks) ? input.asks : []).map((raw: unknown) => {
    const card = fields(raw);
    const shared = fields(card.shared);
    return {
      title: card.title,
      why: "待决定的事。",
      sources: [quote],
      ...(card.diagrams === undefined ? {} : { diagrams: card.diagrams }),
      ...(shared.diagrams === undefined
        ? {}
        : { shared: { text: shared.text, diagrams: shared.diagrams } }),
    };
  });
  return asks.length === 0 ? {} : { asks };
}

/** 旧脚本在图表检查的这几行拦下的样本，新的一边由哪一层拦下。 */
const legacyLines: Readonly<Record<string, "definition" | "rule">> = {
  "build-report.py:489": "definition",
  "build-report.py:491": "definition",
  "build-report.py:500": "rule",
};

/** 旧脚本拦下这份样本的那一条，和新的一边该由哪一层拦下。没有在这几行拦下时是 undefined。 */
function stoppedAt(sample: LegacySample) {
  for (const message of sample.messages) {
    const layer = legacyLines[message.rule];
    if (layer !== undefined) return { layer, text: message.text };
  }
  return undefined;
}

/** 新的一边怎么判：能不能通过数据定义，和规则的全部命中。 */
function judge(sample: LegacySample) {
  const parsed = pageSectionsSchema.safeParse(diagramsPage(sample.input));
  if (!parsed.success) return { passes: false, hits: [] };
  return { passes: true, hits: diagramEdgeRelation.check(parsed.data, {}) };
}

describe("旧反例样本", () => {
  const edgeLine = /没有写明关系：(?<line>.*)。每条线写明是什么关系/su;

  it.each(legacy.map((sample) => [sample.id, sample] as const))("%s", (_id, sample) => {
    expect(countDiagrams(diagramsPage(sample.input)), "图表都在疑问卡上").toBe(
      countDiagrams(sample.input),
    );
    const stopped = stoppedAt(sample);
    const { passes, hits } = judge(sample);
    expect(passes, "种类和标题由数据定义拦截").toBe(stopped?.layer !== "definition");
    if (stopped?.layer === "rule") {
      expect(hits[0]?.params.text).toBe(edgeLine.exec(stopped.text)?.groups?.line);
    } else {
      expect(hits).toEqual([]);
    }
  });

  it("旧脚本在图表检查上拦下的样本，新的数据定义和规则都拦下了", () => {
    const stopped = legacy.filter((sample) => stoppedAt(sample) !== undefined);
    const byDefinition = stopped.filter((sample) => !judge(sample).passes);
    const byRule = stopped.filter((sample) => judge(sample).hits.length > 0);
    expect(byDefinition.map((sample) => sample.id)).toEqual(["legacy-080", "legacy-081"]);
    expect(byRule.map((sample) => sample.id)).toEqual(["legacy-082", "legacy-097"]);
    expect(byDefinition.length + byRule.length).toBe(stopped.length);
  });
});
