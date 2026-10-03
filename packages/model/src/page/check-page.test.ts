import { describe, expect, it } from "vitest";
import { allCopy } from "../copy/index.ts";
import type { Stage } from "../names.ts";
import { checkWriting } from "../writing/check.ts";
import { checkPageData, type PageIssue } from "./check-page.ts";
import { fieldLabel, pageErrorMap } from "./messages.ts";
import { definitionSamples, stagePages, withValue } from "./page.samples.ts";
import { pageSchemas } from "./stages.ts";

// 页面数据的问题写成中文，见「04 命令行」第六节。每条写明在哪里、什么不对、怎么改和查的是哪一项。

/** 校验一份页面数据，只取问题。 */
function issuesOf(key: Stage, data: unknown): readonly PageIssue[] {
  const result = checkPageData(key, data);
  return result.ok ? [] : result.error;
}

const finding = ["findings", 0] as const;
const evidence = [...finding, "evidence", 0] as const;
const table = ["spec", 1] as const;
const step = ["scenes", 0, "steps", 0] as const;

const allEvidenceTypes = "尺寸、色块、字号、间距、截图、真组件";

/** 一种问题：在哪个阶段的样本上改一处，预期报出的那一条。 */
type Case = readonly [why: string, key: Stage, value: unknown, issue: PageIssue];

const genericCases: readonly Case[] = [
  [
    "缺字段",
    "check",
    withValue(stagePages.check, [...finding, "title"], undefined),
    {
      path: [...finding, "title"],
      check: "page.field.missing",
      message: "缺少字段 title。",
      hint: "补上 title，值写成文字。",
    },
  ],
  [
    "类型不对",
    "check",
    withValue(stagePages.check, [...finding, "stance"], "我的看法是 a"),
    {
      path: [...finding, "stance"],
      check: "page.field.type",
      message: "stance 应写成对象，写的是文字。",
      hint: "把 stance 改成对象。",
    },
  ],
  [
    "整数写成小数",
    "check",
    withValue(stagePages.check, [...finding, "where", "step"], 1.5),
    {
      path: [...finding, "where", "step"],
      check: "page.field.type",
      message: "step 应写成整数，写的是小数。",
      hint: "把 step 改成整数。",
    },
  ],
  [
    "文字是空的",
    "check",
    withValue(stagePages.check, [...finding, "why"], " "),
    {
      path: [...finding, "why"],
      check: "page.field.empty",
      message: "why 是空的。",
      hint: "写上内容。可以不写的字段，没有内容就删掉。",
    },
  ],
  [
    "区块是空数组",
    "check",
    withValue(stagePages.check, ["findings"], []),
    {
      path: ["findings"],
      check: "page.field.emptyArray",
      message: "findings 是空数组。",
      hint: "至少写一项。可以不写的字段，没有内容就删掉。",
    },
  ],
  [
    "数太小",
    "check",
    withValue(stagePages.check, [...finding, "where", "step"], 0),
    {
      path: [...finding, "where", "step"],
      check: "page.field.tooSmall",
      message: "step 写的是 0，应大于 0。",
      hint: "改成大于 0 的数。",
    },
  ],
  [
    "取值不在范围里",
    "think",
    withValue(stagePages.think, [...table, "columns", 1, "as"], "粗体"),
    {
      path: [...table, "columns", 1, "as"],
      check: "page.field.value",
      message: "as 的取值「粗体」不在可选的范围里。",
      hint: "改成以下之一：加粗、色块、正例、反例、旧叫法。",
    },
  ],
  [
    "标记写成 false",
    "check",
    withValue(stagePages.check, [...finding, "sources", 0, "quote"], false),
    {
      path: [...finding, "sources", 0, "quote"],
      check: "page.field.trueOnly",
      message: "quote 写成了 false。",
      hint: "quote 只写 true。不是 true 时，删掉这个字段。",
    },
  ],
  [
    "证据的种类不在范围里",
    "check",
    withValue(stagePages.check, [...evidence, "type"], "饼图"),
    {
      path: [...evidence, "type"],
      check: "page.field.value",
      message: "type 的取值「饼图」不在可选的范围里。",
      hint: `改成以下之一：${allEvidenceTypes}。`,
    },
  ],
  [
    "证据没写种类",
    "check",
    withValue(stagePages.check, evidence, { img: "img/a.png" }),
    {
      path: [...evidence, "type"],
      check: "page.field.missing",
      message: "缺少字段 type。",
      hint: `补上 type，值写成以下之一：${allEvidenceTypes}。`,
    },
  ],
  [
    "表格的一格写成对象时，报对象那种写法里不对的字段",
    "think",
    withValue(stagePages.think, [...table, "rows", 0, 0], { text: "待办", tone: "红" }),
    {
      path: [...table, "rows", 0, 0, "tone"],
      check: "page.field.value",
      message: "tone 的取值「红」不在可选的范围里。",
      hint: "改成以下之一：待办、进行中、等待、已完成、已取消。",
    },
  ],
  [
    "两种写法挑不出一种时，报整个不合",
    "check",
    withValue(stagePages.check, evidence, {
      type: "真组件",
      from: "新建设计第 1 步",
      html: "<button>保存</button>",
      css: "button{padding:4px}",
      toggles: [{ label: "选中", selector: "button" }],
    }),
    {
      path: [...evidence, "toggles", 0],
      check: "page.field.union",
      message: "toggles[0] 不合任何一种写法。",
      hint: "按其中一种写法改。各种写法见 ploop page schema 的输出。",
    },
  ],
  [
    "页面数据不是对象",
    "use",
    [],
    {
      path: [],
      check: "page.field.root",
      message: "页面数据应写成一个对象，写的是数组。",
      hint: "页面数据写成一个 JSON 对象，每个区块是其中的一个字段。",
    },
  ],
  [
    "定义自己报的问题原样保留",
    "check",
    withValue(stagePages.check, [...finding, "id"], "Bad Id"),
    {
      path: [...finding, "id"],
      check: "page.cardId.shape",
      message: "卡片编号「Bad Id」的写法不对。",
      hint: "编号用小写英文字母、数字和短横，以字母开头，例如 spec-twelve。",
    },
  ],
];

/** 旧格式的写法：按新旧格式的对照表报改成什么。 */
const formatCases: readonly Case[] = [
  [
    "证据的种类写成旧格式的英文",
    "check",
    withValue(stagePages.check, [...evidence, "type"], "image"),
    {
      path: [...evidence, "type"],
      check: "formatChange.evidenceType",
      message: "type 的取值「image」是旧格式的写法。",
      hint: "改成「截图」。",
    },
  ],
  [
    "旧格式的 excerpt 证据",
    "check",
    withValue(stagePages.check, evidence, { type: "excerpt", text: "一段原文" }),
    {
      path: [...evidence, "type"],
      check: "formatChange.excerptEvidence",
      message: "type 的取值「excerpt」已废除。",
      hint: "excerpt 证据已删除。原文写成文字的来源，也就是 file 和 lines。",
    },
  ],
  [
    "设计规范的种类写成旧格式的英文",
    "think",
    withValue(stagePages.think, [...table, "kind"], "table"),
    {
      path: [...table, "kind"],
      check: "formatChange.specKind",
      message: "kind 的取值「table」是旧格式的写法。",
      hint: "改成「表格」。",
    },
  ],
  [
    "动效的效果写成旧格式的英文",
    "think",
    withValue(stagePages.think, ["spec", 2], {
      name: "动效",
      kind: "动效",
      for: "换一屏",
      values: [{ name: "换一条", ms: 180, effect: "fade" }],
    }),
    {
      path: ["spec", 2, "values", 0, "effect"],
      check: "formatChange.motionEffect",
      message: "effect 的取值「fade」是旧格式的写法。",
      hint: "改成「淡入」。",
    },
  ],
  [
    "表格一列的画法写成旧格式的英文",
    "think",
    withValue(stagePages.think, [...table, "columns", 1, "as"], "strong"),
    {
      path: [...table, "columns", 1, "as"],
      check: "formatChange.columnStyle",
      message: "as 的取值「strong」是旧格式的写法。",
      hint: "改成「加粗」。",
    },
  ],
  [
    "状态标签的色调写成旧格式的英文",
    "think",
    withValue(stagePages.think, [...table, "rows", 1, 0], { text: "等待", tone: "wait" }),
    {
      path: [...table, "rows", 1, 0, "tone"],
      check: "formatChange.cellTone",
      message: "tone 的取值「wait」是旧格式的写法。",
      hint: "改成「等待」。",
    },
  ],
  [
    "evidence 写成一个对象",
    "check",
    withValue(stagePages.check, [...finding, "evidence"], { type: "截图", img: "img/a.png" }),
    {
      path: [...finding, "evidence"],
      check: "formatChange.evidenceArray",
      message: "evidence 应写成数组，写的是对象。",
      hint: "evidence 只写成数组，只有一项证据也放进数组。",
    },
  ],
  [
    "来源的图片路径写成旧格式的 src",
    "check",
    withValue(stagePages.check, [...finding, "sources", 0], {
      name: "报告网页现在的样子",
      src: "img/report-now.png",
    }),
    {
      path: [...finding, "sources", 0, "src"],
      check: "formatChange.sourceImg",
      message: "src 是旧格式的字段名，已改名。",
      hint: "来源的 src 改名为 img，值是项目缓存里截图的相对路径。",
    },
  ],
  [
    "场景的一步还写着旧的 see",
    "think",
    withValue(stagePages.think, [...step, "see"], "五列看板"),
    {
      path: [...step, "see"],
      check: "formatChange.stepExpect",
      message: "see 是旧格式的字段名，已改名。",
      hint: "场景每一步的 see 改名为 expect，写这一步该看到什么。",
    },
  ],
  [
    "选项还写着旧的 see",
    "check",
    withValue(stagePages.check, [...finding, "options", 0, "see"], "改完只剩名字"),
    {
      path: [...finding, "options", 0, "see"],
      check: "formatChange.optionSee",
      message: "see 是旧格式的字段，已废除。",
      hint: "选项的 see 改成卡上的 rows 和每个选项的 diffs，共同的部分写进 shared。",
    },
  ],
];

describe("Zod 的通用问题写成中文，带着怎么改", () => {
  it.each(genericCases)("%s", (_why, key, value, issue) => {
    expect(issuesOf(key, value)).toEqual([issue]);
  });
});

describe("旧格式的字段和取值，报对照表里的改成什么", () => {
  it.each(formatCases)("%s", (_why, key, value, issue) => {
    expect(issuesOf(key, value)).toEqual([issue]);
  });

  it("旧格式的整张卡，每一处旧写法各报各的", () => {
    const old = withValue(
      withValue(stagePages.check, [...finding, "queueRow"], "选项卡升级"),
      [...finding, "where"],
      { scenario: 3, step: 2, title: "回答疑问", stepText: "点选项" },
    );
    expect(issuesOf("check", old).map((issue) => [issue.path.at(-1), issue.check])).toEqual([
      ["scene", "page.field.missing"],
      ["scenario", "formatChange.whereScene"],
      ["title", "formatChange.whereText"],
      ["stepText", "formatChange.whereText"],
      ["queueRow", "formatChange.queueRow"],
    ]);
  });

  it("旧格式的一步只写了 see，缺 expect 和改名各报一条", () => {
    const old = withValue(stagePages.think, step, { do: "在项目页点队列", see: "五列看板" });
    expect(issuesOf("think", old)).toEqual([
      {
        path: [...step, "expect"],
        check: "page.field.missing",
        message: "缺少字段 expect。",
        hint: "补上 expect，值写成文字。",
      },
      {
        path: [...step, "see"],
        check: "formatChange.stepExpect",
        message: "see 是旧格式的字段名，已改名。",
        hint: "场景每一步的 see 改名为 expect，写这一步该看到什么。",
      },
    ]);
  });
});

describe("每一条问题都写全", () => {
  const issues = [...genericCases, ...formatCases].flatMap(([, key, value]) =>
    issuesOf(key, value),
  );
  const copyKeys = new Set(allCopy().map((item) => item.key));

  it("查的是哪一项：文案表里一条报错的键，或者对照表里的一条", () => {
    for (const { check } of issues) {
      const known = copyKeys.has(`${check}.message`) || copyKeys.has(`${check}.note`);
      expect(known, check).toBe(true);
    }
  });

  it("什么不对和怎么改都是中文，没有残留的参数", () => {
    for (const { message, hint } of issues) {
      for (const text of [message, hint]) {
        expect(text).toMatch(/\p{Script=Han}/u);
        expect(text).not.toMatch(/[{}]/u);
      }
    }
  });

  it("填进真实的字段名和取值以后，照样通过写作校验", () => {
    const blocked = issues.flatMap(({ message, hint }) =>
      [message, hint].flatMap((text) =>
        checkWriting(text).block.map((x) => `${text}：${x.message}`),
      ),
    );
    expect(blocked).toEqual([]);
  });
});

describe("直接用 Zod 解析时，传入报错函数也得到中文", () => {
  it("每个定义的不合格样本，报的都是中文", () => {
    for (const { name, schema, bad } of definitionSamples) {
      for (const { why, value } of bad) {
        const issues = schema.safeParse(value, { error: pageErrorMap }).error?.issues ?? [];
        expect(issues.length, `${name}：${why}`).toBeGreaterThan(0);
        for (const issue of issues)
          expect(issue.message, `${name}：${why}`).toMatch(/\p{Script=Han}/u);
      }
    }
  });

  it("不认识的字段合成一句", () => {
    const value = withValue(withValue(stagePages.use, ["summary"], "一"), ["notes"], "二");
    const [issue] = pageSchemas.use.safeParse(value, { error: pageErrorMap }).error?.issues ?? [];
    expect(issue?.message).toBe("字段 summary、notes 不在定义里。");
  });

  it("不传报错函数时，Zod 照旧用英文", () => {
    const [issue] = pageSchemas.use.safeParse([]).error?.issues ?? [];
    expect(issue?.message).not.toMatch(/\p{Script=Han}/u);
  });
});

describe("报错里怎么称呼字段", () => {
  it.each([
    [["findings", 0, "title"], "title"],
    [["findings", 0], "findings[0]"],
    [["spec", 1, "rows", 0, 1], "rows[0][1]"],
    [[], ""],
  ] as const)("%j 称为 %j", (path, label) => {
    expect(fieldLabel(path)).toBe(label);
  });
});
