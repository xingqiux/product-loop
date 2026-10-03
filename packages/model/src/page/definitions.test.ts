import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allCopy } from "../copy/index.ts";
import { queueStatus } from "../names.ts";
import * as page from "./index.ts";
import { pageIssueParams } from "./issue.ts";
import { definitionSamples } from "./page.samples.ts";

const copyKeys = new Set(allCopy().map((item) => item.key));

/** 问题的路径和 check 或 code，比较时只看这几样。 */
function summarize(issues: readonly z.core.$ZodIssue[]) {
  return issues.map((issue) => ({
    path: issue.path,
    code: issue.code,
    check: pageIssueParams(issue)?.check,
  }));
}

describe("每个定义都有样本", () => {
  it("page/ 导出的每个 schema 都有一份合格样本和至少一份不合格样本", () => {
    const sampled = new Map(definitionSamples.map((samples) => [samples.name, samples.schema]));
    const exported = Object.entries(page).filter(
      ([name, value]) => name.endsWith("Schema") && value instanceof z.ZodType,
    );
    expect(exported.length).toBeGreaterThan(30);
    for (const [name, schema] of exported) {
      expect(sampled.get(name), name).toBe(schema);
    }
  });

  it("样本的名字不重复", () => {
    const names = definitionSamples.map((samples) => samples.name);
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([]);
  });
});

describe.each(definitionSamples)("$name", ({ schema, good, bad }) => {
  it("合格的样本通过，编码回去和样本相同", () => {
    const result = schema.safeParse(good);
    expect(result.error?.issues).toBeUndefined();
    // 枚举解析以后是英文键，编码回去又是中文，别的字段原样进出。
    const encoded = schema.safeEncode(result.data);
    expect(encoded.error?.issues).toBeUndefined();
    expect(encoded.data).toEqual(good);
  });

  it.each(bad)("拒绝：$why", ({ value, path, check, code }) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    const issues = summarize(result.error?.issues ?? []);
    const expected = check === undefined ? { path, code } : { path, check };
    expect(issues).toContainEqual(expect.objectContaining(expected));
  });
});

describe("定义自己报的问题", () => {
  const custom = definitionSamples.flatMap(({ schema, bad }) =>
    bad.flatMap(({ value }) => schema.safeParse(value).error?.issues ?? []),
  );

  it("都带 check 和 hint，check 是文案表里的键", () => {
    const customIssues = custom.filter((issue) => issue.code === "custom");
    expect(customIssues.length).toBeGreaterThan(20);
    for (const issue of customIssues) {
      const params = pageIssueParams(issue);
      expect(params, issue.message).toBeDefined();
      expect(copyKeys.has(`${params?.check}.message`), params?.check).toBe(true);
      expect(copyKeys.has(`${params?.check}.hint`), params?.check).toBe(true);
    }
  });

  it("文字里没有残留的参数", () => {
    for (const issue of custom.filter((item) => item.code === "custom")) {
      expect(issue.message).not.toMatch(/[{}]/u);
      expect(pageIssueParams(issue)?.hint).not.toMatch(/[{}]/u);
    }
  });

  it("例子：一条来源同时写了截图和文件", () => {
    const result = page.sourceSchema.safeParse({
      name: "报告网页现在的样子",
      img: "img/a.png",
      file: "skill/SKILL.md",
      lines: "3-5",
    });
    const [issue] = result.error?.issues ?? [];
    expect(issue?.message).toBe("来源「报告网页现在的样子」同时写了 img 和 file。");
    expect(issue && pageIssueParams(issue)).toEqual({
      check: "page.source.twoForms",
      hint: "一条来源只用一种写法：界面写 img，文字写 file 和 lines，用户的原话写 quote 和 saw。",
    });
  });

  it("通用的问题没有附加信息", () => {
    const result = page.whereSchema.safeParse({ scene: "S3" });
    const [issue] = result.error?.issues ?? [];
    expect(issue?.code).toBe("invalid_type");
    expect(issue && pageIssueParams(issue)).toBeUndefined();
  });
});

/** 页面数据里的枚举写中文，解析以后是英文键，见「05 接口」第一节。 */
describe("枚举在页面数据里写中文，代码里用英文键", () => {
  const ref = {
    name: "《写给大家看的设计书》",
    kind: "书",
    depth: "已读原文",
    relevance: "高",
    strength: "中",
    advice: "采用",
    body: "亲密、对齐、重复、对比四条原则。",
  };

  it("参考的五个属性解析成英文键", () => {
    expect(page.refSchema.parse(ref)).toMatchObject({
      kind: "book",
      depth: "fullText",
      relevance: "high",
      strength: "medium",
      advice: "adopt",
    });
  });

  it("图表的种类和调研的档位解析成英文键", () => {
    const diagram = { kind: "改前改后的结构", title: "区块的顺序", code: "flowchart LR\n A-->B" };
    expect(page.diagramSchema.parse(diagram).kind).toBe("beforeAfter");
    expect(page.researchSchema.parse({ tier: "不查", reason: "只是改措辞。" }).tier).toBe("none");
  });

  it("编码时换回中文，页面数据只收中文", () => {
    const parsed = page.refSchema.parse(ref);
    expect(page.refSchema.encode(parsed)).toEqual(ref);
    expect(page.refSchema.safeParse(parsed).success).toBe(false);
  });

  it("导出的 JSON Schema 列的是中文", () => {
    expect(z.toJSONSchema(page.researchSchema, { io: "input" })).toMatchObject({
      properties: { tier: { enum: ["不查", "快查", "深查"] } },
    });
  });
});

/**
 * 旧格式写英文的有五处，第 21 步改成中文。它们是证据的 type、设计规范的 kind、
 * 动效的 effect、表格一列的 as 和状态标签的 tone。每个取值都是中文进、英文键出，编码回去又是中文。
 */
describe("旧格式写英文的五处，也是中文进、英文键出", () => {
  const evidenceItems = {
    sizes: { type: "尺寸", values: [12] },
    swatches: { type: "色块", values: [{ name: "底", hex: "#fff" }] },
    type: { type: "字号", values: [{ size: 13 }] },
    spacing: { type: "间距", values: [8] },
    image: { type: "截图", img: "img/a.png" },
    live: { type: "真组件", from: "保存按钮", html: "<button>保存</button>", css: "button{}" },
  } satisfies Record<page.EvidenceType, unknown>;

  const specItems = {
    colors: { name: "配色", kind: "颜色", values: [{ name: "底", hex: "#fff" }] },
    type: { name: "字号", kind: "字号", values: [{ name: "正文", size: 13 }] },
    radius: { name: "圆角", kind: "圆角", values: [4] },
    spacing: { name: "间距", kind: "间距", values: [8] },
    motion: { name: "动效", kind: "动效", values: [{ name: "换屏", ms: 180 }] },
    table: { name: "状态", kind: "表格", columns: [{ name: "状态" }], rows: [["待办"]] },
    text: { name: "图标", kind: "文字", text: "线性图标。" },
  } satisfies Record<page.SpecKind, unknown>;

  /** 解析、读出英文键、编码回去。 */
  function roundTrip(schema: z.ZodType, value: unknown, read: (parsed: never) => unknown) {
    const parsed = schema.parse(value);
    expect(schema.encode(parsed)).toEqual(value);
    return read(parsed as never);
  }

  it.each(page.evidenceType.keys)("证据的 type：%s", (key) => {
    const item = evidenceItems[key];
    expect(item.type).toBe(page.evidenceType.label(key));
    expect(roundTrip(page.evidenceItemSchema, item, (e: { type: string }) => e.type)).toBe(key);
  });

  it.each(page.specKind.keys)("设计规范的 kind：%s", (key) => {
    const item = specItems[key];
    expect(item.kind).toBe(page.specKind.label(key));
    expect(roundTrip(page.specDraftSchema, item, (e: { kind: string }) => e.kind)).toBe(key);
  });

  it.each(page.motionEffect.keys)("动效的 effect：%s", (key) => {
    const item = {
      name: "动效",
      kind: "动效",
      values: [{ name: "换屏", ms: 180, effect: page.motionEffect.label(key) }],
    };
    type Motion = { values: { effect: string }[] };
    const read = (spec: Motion) => spec.values[0]?.effect;
    expect(roundTrip(page.specDraftSchema, item, read)).toBe(key);
  });

  it.each(page.columnStyle.keys)("表格一列的 as：%s", (key) => {
    const item = {
      name: "说法",
      kind: "表格",
      columns: [{ name: "这样写", as: page.columnStyle.label(key) }],
      rows: [["待办"]],
    };
    const read = (spec: { columns: { as: string }[] }) => spec.columns[0]?.as;
    expect(roundTrip(page.specDraftSchema, item, read)).toBe(key);
  });

  it.each(queueStatus.keys)("状态标签的 tone，取队列的状态：%s", (key) => {
    const label = queueStatus.label(key);
    const cell = { text: label, tone: label };
    const item = { name: "状态", kind: "表格", columns: [{ name: "样子" }], rows: [[cell]] };
    type Table = { rows: { tone: string }[][] };
    const read = (spec: Table) => spec.rows[0]?.[0]?.tone;
    expect(roundTrip(page.specDraftSchema, item, read)).toBe(key);
  });

  it("页面数据只收中文，旧格式的英文不收", () => {
    expect(page.evidenceItemSchema.safeParse({ type: "image", img: "img/a.png" }).success).toBe(
      false,
    );
    expect(page.specDraftSchema.safeParse({ ...specItems.text, kind: "text" }).success).toBe(false);
  });
});

/**
 * 这些要求按阶段、按选项的位置或者按页面的日期才成立，由第 25 到 27 步的规则查。
 * 定义让它们通过，规则才有机会报出带道理的「怎么改」，历史页面模式也才能按日期跳过。
 */
describe("留给规则的要求，定义照样通过", () => {
  const card = {
    title: "队列看板放在哪里",
    why: "放在哪里。",
    sources: [{ name: "报告网页现在的样子", img: "img/a.png" }],
  };

  it.each([
    ["来源一种写法都没有（card.source.visual）", page.sourceSchema, { name: "只写了名字" }],
    [
      "选项没写理由、代价和适用场景",
      page.askCardSchema,
      { ...card, rows: ["放法"], options: [{ key: "a", title: "每一页", diffs: ["左边"] }] },
    ],
    [
      "只有一个选项却没写 only",
      page.askCardSchema,
      { ...card, rows: ["放法"], options: [{ key: "a", title: "每一页", diffs: ["左边"] }] },
    ],
    ["写了 only 却没写 dropped", page.askCardSchema, { ...card, only: true }],
    [
      "看法选了不存在的选项",
      page.askCardSchema,
      { ...card, stance: { pick: "c", because: "理由。" } },
    ],
    ["深查没写 approved", page.researchSchema, { tier: "深查" }],
    [
      "设计类的卡没有外面的来源",
      page.findingCardSchema,
      { ...card, design: true, where: { scene: "S1", step: 1 } },
    ],
    ["设计规范没写 for", page.specDraftSchema, { name: "图标", kind: "文字", text: "线性图标。" }],
    [
      "元素清单没写 where",
      page.screenEntrySchema,
      { name: "页头", elements: [{ what: "系统名", answers: "这是哪个产品" }] },
    ],
  ] as const)("%s", (_name, schema, value) => {
    expect(schema.safeParse(value).error?.issues).toBeUndefined();
  });
});

describe("一次报出全部问题", () => {
  it("一张卡上几处不对，各报各的", () => {
    const result = page.askCardSchema.safeParse({
      id: "Bad Id",
      queue: ["Q1", "Q1"],
      title: "队列看板放在哪里",
      why: "放在哪里。",
      sources: [{ name: "用户说的", quote: true }],
      options: [
        { key: "a", title: "每一页", diffs: ["左边列表"] },
        { key: "a", title: "单独一页", diffs: ["项目页"] },
      ],
    });
    const checks = (result.error?.issues ?? []).map((issue) => pageIssueParams(issue)?.check);
    expect(checks).toEqual(
      expect.arrayContaining([
        "page.cardId.shape",
        "page.queueRef.duplicate",
        "page.source.quoteWithoutSaw",
        "page.card.rowsMissing",
        "page.card.keyDuplicate",
      ]),
    );
  });

  it("一张卡的类型不对时，别的卡照常查", () => {
    const result = page.pageSectionsSchema.safeParse({
      asks: [
        { title: 3, why: "放在哪里。", sources: [{ name: "用户说的", saw: "原话", quote: true }] },
        {
          title: "第二张",
          why: "待决定的事。",
          sources: [{ name: "截图", img: "img/a.png" }],
          options: [{ key: "a", title: "做法", diffs: ["差别"] }],
        },
      ],
    });
    const found = summarize(result.error?.issues ?? []);
    expect(found).toContainEqual(expect.objectContaining({ path: ["asks", 0, "title"] }));
    expect(found).toContainEqual(
      expect.objectContaining({ path: ["asks", 1, "rows"], check: "page.card.rowsMissing" }),
    );
  });
});
