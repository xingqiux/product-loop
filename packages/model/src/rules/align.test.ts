import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkPageData } from "../page/check-page.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { alignNameUniqueSamples, alignUsedInMatchedSamples } from "./align.samples.ts";
import { alignNameUnique, alignRuleList, alignUsedInMatched } from "./align.ts";
import { runRules, whereText } from "./run.ts";

// 先对齐两条规则在总测试以外的情况。预期都在 v1-final 的 build-report.py 上跑过，和旧脚本的判断相同。

/** 看不见的几个字写成码位。直接写在字符串里，格式化以后就看不出是什么字。 */
const bom = String.fromCodePoint(0xfeff);
const wideSpace = String.fromCodePoint(0x3000);

type AlignTerm = NonNullable<PageSections["align"]>[number];

const quote = { name: "用户昨天说的", saw: "「这个词我没看懂」", quote: true } as const;

function ask(title: string) {
  return { title, why: "待决定的事。", sources: [quote] };
}

function term(name: string, ...usedIn: [string, ...string[]]): AlignTerm {
  return { name, usedIn, meaning: "一句话的意思。", example: "这个项目里的一件真事。" };
}

/** 命中写成「位置 参数」，便于比较。 */
function hitsOf(rule: typeof alignUsedInMatched | typeof alignNameUnique, page: PageSections) {
  return rule
    .check(page, {})
    .map((hit) => `${whereText(hit.where ?? "")} ${Object.values(hit.params).join(" ")}`);
}

describe("样本都是合格的页面数据", () => {
  const samples = [alignUsedInMatchedSamples, alignNameUniqueSamples].flatMap(({ base, hits }) => [
    ["基础数据", base.subject] as const,
    ...hits.map((sample) => [sample.why, sample.subject] as const),
  ]);
  it.each(samples)("%s 能通过构思阶段的数据定义，写回去再读出来不变", (_why, subject) => {
    const written = z.encode(pageSectionsSchema, subject);
    expect(pageSectionsSchema.parse(written)).toEqual(subject);
    expect(checkPageData("think", written).ok).toBe(true);
  });
});

describe("usedIn 对得上本页疑问卡的标题", () => {
  it("只认疑问卡，发现卡的标题不算", () => {
    const page: PageSections = {
      align: [term("后端", "队列看板放在哪里")],
      findings: [{ ...ask("队列看板放在哪里"), where: { scene: "S9", step: 1 } }],
    };
    expect(hitsOf(alignUsedInMatched, page)).toEqual(["align[0].usedIn[0] 后端 队列看板放在哪里"]);
  });

  it("报错里的名称去掉两头的空白，写错的标题照原样写", () => {
    const page: PageSections = {
      align: [term(`${wideSpace}后端 `, " 一条疑问")],
      asks: [ask("一条疑问")],
    };
    expect(hitsOf(alignUsedInMatched, page)).toEqual(["align[0].usedIn[0] 后端  一条疑问"]);
  });

  it("没有先对齐时不命中", () => {
    expect(hitsOf(alignUsedInMatched, { asks: [ask("一条疑问")] })).toEqual([]);
    expect(hitsOf(alignUsedInMatched, {})).toEqual([]);
  });
});

describe("名称不重复", () => {
  it("按 Python 的 strip() 去掉两头的空白再比：0x1f 和全角空格去掉，字节顺序标记不去掉", () => {
    const page: PageSections = {
      align: ["后端", "\u001f后端", `${wideSpace}后端`, `${bom}后端`].map((name) =>
        term(name, "一条疑问"),
      ),
      asks: [ask("一条疑问")],
    };
    expect(hitsOf(alignNameUnique, page)).toEqual(["align[1].name 后端", "align[2].name 后端"]);
  });

  it("大小写不同的名称不算重复", () => {
    const page: PageSections = {
      align: [term("Web", "一条疑问"), term("web", "一条疑问")],
      asks: [ask("一条疑问")],
    };
    expect(hitsOf(alignNameUnique, page)).toEqual([]);
  });
});

describe("两条规则一起执行", () => {
  it("每一处各报一条拦截，报错按文案表填好", () => {
    const page: PageSections = {
      align: [term("端口文件", "不存在的一张卡"), term("端口文件", "一条疑问")],
      asks: [ask("一条疑问")],
    };
    const run = runRules(alignRuleList, page, {});
    expect(run.warn).toEqual([]);
    expect(run.block).toEqual([
      {
        rule: "align.usedIn.matched",
        message:
          "先对齐的术语「端口文件」，usedIn 写的「不存在的一张卡」不是本页任何一张疑问卡的标题。",
        hint: "usedIn 只写本页疑问卡的标题，照卡上的 title 原样写。",
        where: "align[0].usedIn[0]",
      },
      {
        rule: "align.name.unique",
        message: "先对齐里前面已经有一项叫「端口文件」。",
        hint: "一个术语只对齐一次。把重复的两项合成一项，usedIn 合在一起。",
        where: "align[1].name",
      },
    ]);
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

/** 旧页面数据里的先对齐原样搬进新格式的一页。疑问卡只留标题，别的字段换成最简单的合格写法。 */
function alignPage(input: Readonly<Record<string, unknown>>) {
  const asks = (Array.isArray(input.asks) ? input.asks : []).map((raw: unknown) => ({
    ...ask(""),
    title: fields(raw).title,
  }));
  return {
    ...(input.align === undefined ? {} : { align: input.align }),
    ...(asks.length === 0 ? {} : { asks }),
  };
}

/** 旧脚本在 check_align 的这几行拦下的样本，新的一边由哪一层拦下。 */
const legacyLines: Readonly<Record<string, "definition" | "usedIn" | "name">> = {
  "build-report.py:529": "definition",
  "build-report.py:533": "definition",
  "build-report.py:535": "name",
  "build-report.py:539": "definition",
  "build-report.py:542": "definition",
  "build-report.py:545": "usedIn",
};

/** 旧脚本拦下这份样本的那一条，和新的一边该由哪一层拦下。没有在这几行拦下时是 undefined。 */
function stoppedAt(sample: LegacySample) {
  for (const message of sample.messages) {
    const layer = legacyLines[message.rule];
    if (layer !== undefined) return { layer, text: message.text };
  }
  return undefined;
}

/** 新的一边怎么判：能不能通过数据定义，和两条规则各自的全部命中。 */
function judge(sample: LegacySample) {
  const parsed = pageSectionsSchema.safeParse(alignPage(sample.input));
  if (!parsed.success) return { passes: false, usedIn: [], name: [] };
  return {
    passes: true,
    usedIn: alignUsedInMatched.check(parsed.data, {}),
    name: alignNameUnique.check(parsed.data, {}),
  };
}

describe("旧反例样本", () => {
  const legacyName = /align 里「(?<name>.*)」出现了两次/su;
  const legacyTitle = /的 usedIn 写的「(?<title>.*)」不是本页任何一张疑问卡的标题/su;

  it.each(legacy.map((sample) => [sample.id, sample] as const))("%s", (_id, sample) => {
    const stopped = stoppedAt(sample);
    const { passes, usedIn, name } = judge(sample);
    expect(passes, "四项齐全和写成列表由数据定义拦截").toBe(stopped?.layer !== "definition");
    if (stopped?.layer === "name") {
      expect(name[0]?.params.name).toBe(legacyName.exec(stopped.text)?.groups?.name);
    } else {
      expect(name).toEqual([]);
    }
    if (stopped?.layer === "usedIn") {
      expect(usedIn[0]?.params.title).toBe(legacyTitle.exec(stopped.text)?.groups?.title);
    } else {
      expect(usedIn).toEqual([]);
    }
  });

  it("旧脚本在先对齐的检查上拦下的样本，新的数据定义和规则都拦下了", () => {
    const stopped = legacy.filter((sample) => stoppedAt(sample) !== undefined);
    const ids = (pick: (judged: ReturnType<typeof judge>) => boolean) =>
      stopped.filter((sample) => pick(judge(sample))).map((sample) => sample.id);
    expect(ids((judged) => !judged.passes)).toEqual(["legacy-085", "legacy-099"]);
    expect(ids((judged) => judged.usedIn.length > 0)).toEqual(["legacy-086"]);
    expect(ids((judged) => judged.name.length > 0)).toEqual(["legacy-087"]);
    expect(stopped.map((sample) => sample.id)).toEqual([
      "legacy-085",
      "legacy-086",
      "legacy-087",
      "legacy-099",
    ]);
  });
});
