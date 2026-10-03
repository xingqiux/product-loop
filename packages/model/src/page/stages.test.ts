import { describe, expect, expectTypeOf, it } from "vitest";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { type Stage, stage } from "../names.ts";
import { checkPageData, type PageIssue } from "./check-page.ts";
import { stagePages, validPage, withValue } from "./page.samples.ts";
import { pageSection } from "./section-names.ts";
import {
  type PageEnvelope,
  pageEnvelopeSchema,
  pageFormatVersion,
  pageJsonSchema,
  pageSchemas,
  type StagePage,
  sectionAllowed,
  stageSections,
} from "./stages.ts";

/** 五个阶段，测试的名字写中文。 */
const stages = stage.keys.map((key) => [stage.label(key), key] as const);

/** 校验一份页面数据，只取问题。 */
function issuesOf(key: Stage, data: unknown): readonly PageIssue[] {
  const result = checkPageData(key, data);
  return result.ok ? [] : result.error;
}

describe("各阶段能写的区块", () => {
  it("列成数据：「06 工作台」第四节的区块表，加上参考和元素清单", () => {
    expect(stageSections).toEqual({
      think: ["align", "scenes", "spec", "asks", "refs"],
      use: ["asks"],
      check: ["asks", "findings", "screens"],
      land: ["asks", "changes"],
      improve: ["asks", "improvements"],
    });
  });

  it("每个阶段的区块按页面上的顺序排", () => {
    for (const key of stage.keys) {
      const sections: readonly string[] = stageSections[key];
      expect(sections).toEqual(pageSection.keys.filter((section) => sections.includes(section)));
    }
  });

  it("每个区块至少有一个阶段能写，疑问五个阶段都能写", () => {
    for (const section of pageSection.keys) {
      expect(
        stage.keys.some((key) => sectionAllowed(key, section)),
        section,
      ).toBe(true);
    }
    expect(stage.keys.filter((key) => sectionAllowed(key, "asks"))).toEqual(stage.keys);
  });

  it("落地页不再有提升卡，提升只在提升阶段（决定 137）", () => {
    expect(stage.keys.filter((key) => sectionAllowed(key, "improvements"))).toEqual(["improve"]);
  });

  it("有阶段不能写的区块各有报错，文案写明区块和它只在哪个阶段写", () => {
    const restricted = pageSection.keys.filter((section) =>
      stage.keys.some((key) => !sectionAllowed(key, section)),
    );
    expect(Object.keys(pageCopy.stage)).toEqual(restricted);
    for (const section of restricted) {
      const entry = pageCopy.stage[section as keyof typeof pageCopy.stage];
      const label = pageSection.label(section);
      expect(renderCopy(entry.message, { stage: "检查" })).toContain(`${label}（${section}）`);
      const allowedIn = stage.keys.filter((key) => sectionAllowed(key, section));
      const stages = allowedIn.map((key) => stage.label(key)).join("、");
      expect(renderCopy(entry.hint)).toContain(`${label}只在${stages}阶段写`);
    }
  });

  it("解析以后的类型只有这一阶段的区块", () => {
    expectTypeOf<keyof StagePage<"use">>().toEqualTypeOf<"asks">();
    expectTypeOf<keyof StagePage<"land">>().toEqualTypeOf<"asks" | "changes">();
    expectTypeOf<keyof StagePage<"think">>().toEqualTypeOf<
      "align" | "scenes" | "spec" | "asks" | "refs"
    >();
  });
});

/** 一个阶段的样本：合格的一份，加上几份各改一处的，写明预期的问题。 */
type StageCase = {
  readonly why: string;
  readonly value: unknown;
  readonly issue: PageIssue;
};

const land = "落地的记录由 ploop land 存进集中存储，工程证据由命令摆出，删掉这个字段。";
const roundFields = "阶段名、次数和日期由命令按这个阶段填，删掉这个字段。";
const header = "页头和阶段条由命令从状态算出，删掉这个字段。";

const unknownField = (path: readonly (string | number)[], field: string): PageIssue => ({
  path,
  check: "page.field.unknown",
  message: `字段 ${field} 不在定义里。`,
  hint: `删掉 ${field}。字段名可以对照 ploop page schema 的输出。`,
});

const stageCases: Readonly<Record<Stage, readonly StageCase[]>> = {
  think: [
    {
      why: "不能写的区块：发现问题",
      value: withValue(stagePages.think, ["findings"], validPage.findings),
      issue: {
        path: ["findings"],
        check: "page.stage.findings",
        message: "构思阶段的页面不能有发现问题（findings）。",
        hint: "发现问题只在检查阶段写。别的阶段看到的问题，用 ploop queue add 放进队列。",
      },
    },
    {
      why: "不认识的字段",
      value: withValue(stagePages.think, ["summary"], "这一轮定了三件事。"),
      issue: unknownField(["summary"], "summary"),
    },
    {
      why: "命令填的字段：阶段的次数",
      value: withValue(stagePages.think, ["round"], 3),
      issue: {
        path: ["round"],
        check: "formatChange.roundFields",
        message: "round 由命令填，页面数据里不写。",
        hint: roundFields,
      },
    },
    {
      why: "已废除的字段：回到构思",
      value: withValue(stagePages.think, ["rethink"], []),
      issue: {
        path: ["rethink"],
        check: "formatChange.rethink",
        message: "rethink 是旧格式的字段，已废除。",
        hint: "回到构思这一区块已删除。觉得主线的定义不对时，用 ploop queue add 放进队列，阶段写构思。",
      },
    },
  ],
  use: [
    {
      why: "不能写的区块：更改",
      value: withValue(stagePages.use, ["changes"], validPage.changes),
      issue: {
        path: ["changes"],
        check: "page.stage.changes",
        message: "使用阶段的页面不能有更改（changes）。",
        hint: "更改只在落地阶段写，交给用户验收。别的阶段要做的改动，用 ploop queue add 放进队列。",
      },
    },
    {
      why: "不认识的字段，写在卡片上",
      value: withValue(stagePages.use, ["asks", 0, "answer"], "上周。"),
      issue: unknownField(["asks", 0, "answer"], "answer"),
    },
    {
      why: "命令填的字段：使用区块",
      value: withValue(stagePages.use, ["usage"], { scenes: [], gaps: [] }),
      issue: {
        path: ["usage"],
        check: "formatChange.usage",
        message: "usage 由命令填，页面数据里不写。",
        hint: "使用区块由命令从使用代码最近一次的运行生成，删掉这个字段。",
      },
    },
    {
      why: "已废除的字段：当前",
      value: withValue(stagePages.use, ["current"], [{ problem: "断点", fix: "修好" }]),
      issue: {
        path: ["current"],
        check: "formatChange.header",
        message: "current 是旧格式的字段，已废除。",
        hint: header,
      },
    },
  ],
  check: [
    {
      why: "不能写的区块：设计规范",
      value: withValue(stagePages.check, ["spec"], validPage.spec),
      issue: {
        path: ["spec"],
        check: "page.stage.spec",
        message: "检查阶段的页面不能有设计规范（spec）。",
        hint: "设计规范只在构思阶段写，删掉 spec。",
      },
    },
    {
      why: "不认识的字段，写在元素清单的一行上",
      value: withValue(stagePages.check, ["screens", 0, "elements", 0, "note"], "多余"),
      issue: unknownField(["screens", 0, "elements", 0, "note"], "note"),
    },
    {
      why: "命令填的字段：位置里场景的总数",
      value: withValue(stagePages.check, ["findings", 0, "where", "scenarios"], 12),
      issue: {
        path: ["findings", 0, "where", "scenarios"],
        check: "formatChange.whereTotals",
        message: "scenarios 由命令填，页面数据里不写。",
        hint: "场景的总数和步数由命令从主线算，删掉 scenarios 和 steps。",
      },
    },
    {
      why: "已废除的字段：位置里的场景名",
      value: withValue(stagePages.check, ["findings", 0, "where", "title"], "回答疑问"),
      issue: {
        path: ["findings", 0, "where", "title"],
        check: "formatChange.whereText",
        message: "title 是旧格式的字段，已废除。",
        hint: "场景名和这一步的文字由命令从主线填，删掉 title 和 stepText。",
      },
    },
  ],
  land: [
    {
      why: "不能写的区块：提升",
      value: withValue(stagePages.land, ["improvements"], validPage.improvements),
      issue: {
        path: ["improvements"],
        check: "page.stage.improvements",
        message: "落地阶段的页面不能有提升（improvements）。",
        hint: "提升只在提升阶段写。别的阶段想到的提升，用 ploop queue add 放进队列。",
      },
    },
    {
      why: "不认识的字段，写在更改上",
      value: withValue(stagePages.land, ["changes", 0, "commit"], "abc1234"),
      issue: unknownField(["changes", 0, "commit"], "commit"),
    },
    {
      why: "命令填的字段：日期",
      value: withValue(stagePages.land, ["date"], "2026-09-28"),
      issue: {
        path: ["date"],
        check: "formatChange.roundFields",
        message: "date 由命令填，页面数据里不写。",
        hint: roundFields,
      },
    },
    {
      why: "已废除的字段：落地记录的文件夹",
      value: withValue(stagePages.land, ["landDir"], "land/17"),
      issue: {
        path: ["landDir"],
        check: "formatChange.land",
        message: "landDir 是旧格式的字段，已废除。",
        hint: land,
      },
    },
    {
      why: "已废除的字段：更改上的 queueRow",
      value: withValue(stagePages.land, ["changes", 0, "queueRow"], "选项卡升级"),
      issue: {
        path: ["changes", 0, "queueRow"],
        check: "formatChange.queueRow",
        message: "queueRow 是旧格式的字段，已废除。",
        hint: 'queueRow 改成 queue，写队列事项的编号，例如 ["Q12"]。不再按内容的开头几个字匹配。',
      },
    },
  ],
  improve: [
    {
      why: "不能写的区块：参考",
      value: withValue(stagePages.improve, ["refs"], validPage.refs),
      issue: {
        path: ["refs"],
        check: "page.stage.refs",
        message: "提升阶段的页面不能有参考（refs）。",
        hint: "参考只在构思阶段写。别的阶段引用外面的产品，截图写进卡片的来源并标 outside。",
      },
    },
    {
      why: "不认识的字段",
      value: withValue(stagePages.improve, ["priority"], "高"),
      issue: unknownField(["priority"], "priority"),
    },
    {
      why: "命令填的字段：阶段",
      value: withValue(stagePages.improve, ["stage"], "提升"),
      issue: {
        path: ["stage"],
        check: "formatChange.roundFields",
        message: "stage 由命令填，页面数据里不写。",
        hint: roundFields,
      },
    },
    {
      why: "已废除的字段：卡片上的 saw",
      value: withValue(stagePages.improve, ["improvements", 0, "saw"], "看了队列看板。"),
      issue: {
        path: ["improvements", 0, "saw"],
        check: "formatChange.cardSaw",
        message: "saw 是旧格式的字段，已废除。",
        hint: "卡片上的 saw 改写进 sources，一条来源写一样东西。",
      },
    },
  ],
};

describe.each(stages)("%s阶段的页面数据", (_label, key) => {
  it("合格的样本通过，编码回去和样本相同", () => {
    const result = pageSchemas[key].safeParse(stagePages[key]);
    expect(result.error?.issues).toBeUndefined();
    expect(pageSchemas[key].encode(result.data as never)).toEqual(stagePages[key]);
    expect(checkPageData(key, stagePages[key]).ok).toBe(true);
  });

  it("一个区块都不写也通过", () => {
    expect(checkPageData(key, {})).toEqual({ ok: true, value: {} });
  });

  it("每一处不认识的字段都报，报在它自己的路径上", () => {
    const value = withValue(withValue(stagePages[key], ["summary"], "一"), ["notes"], "二");
    expect(issuesOf(key, value).map((issue) => issue.path)).toEqual([["summary"], ["notes"]]);
  });

  it.each(stageCases[key])("拒绝：$why，报出改成什么", ({ value, issue }) => {
    expect(issuesOf(key, value)).toEqual([issue]);
  });

  it("别的阶段能写的区块，这一阶段写了都报，写明只在哪个阶段写", () => {
    const others = pageSection.keys.filter((section) => !sectionAllowed(key, section));
    const page = Object.fromEntries(others.map((section) => [section, validPage[section]]));
    const issues = issuesOf(key, page);
    expect(issues.map((issue) => issue.path)).toEqual(others.map((section) => [section]));
    expect(issues.map((issue) => issue.check)).toEqual(others.map((s) => `page.stage.${s}`));
    for (const issue of issues) expect(issue.message).toContain(`${stage.label(key)}阶段`);
  });
});

/** 给 AI 看的定义按阶段导出，见「07 校验」第二节。 */
describe.each(stages)("%s阶段的 JSON Schema", (label, key) => {
  type Json = {
    readonly title?: string;
    readonly description?: string;
    readonly additionalProperties?: boolean;
    readonly properties: Readonly<Record<string, { readonly description?: string }>>;
    readonly $defs?: Readonly<Record<string, unknown>>;
  };
  const json = pageJsonSchema(key) as Json;
  const text = JSON.stringify(json);

  it("只列这一阶段能写的区块，每个区块的说明以工作台上的名字开头，不认识的字段不收", () => {
    expect(Object.keys(json.properties)).toEqual(stageSections[key]);
    for (const section of stageSections[key]) {
      expect(json.properties[section]?.description).toMatch(
        new RegExp(`^${pageSection.label(section)}：.+。$`, "u"),
      );
    }
    expect(json.additionalProperties).toBe(false);
  });

  it("标题写阶段，说明只写能写的区块，不写格式版本", () => {
    expect(json.title).toBe(`${label}阶段的页面数据`);
    expect(json.description).toContain(`${label}阶段的区块`);
    expect(json.description).not.toContain("版");
    const sections = stageSections[key].map((section) => pageSection.label(section)).join("、");
    expect(json.description).toContain(sections);
  });

  it("共用的部分放在 $defs 里，各写一次", () => {
    expect(Object.keys(json.$defs ?? {})).toEqual(
      expect.arrayContaining(["cardId", "queueRefs", "source", "option", "evidence"]),
    );
    expect(text).toContain('"$ref":"#/$defs/source"');
  });

  it("枚举列中文，不列英文键", () => {
    expect(text).toContain('"const":"截图"');
    expect(text).toContain('"enum":["不查","快查","深查"]');
    for (const key of ['"const":"image"', '"const":"sizes"', '"quick"', '"flowchart"']) {
      expect(text).not.toContain(key);
    }
  });

  it("每个字段都有说明，只有区分种类的 type 和 kind 例外", () => {
    const missing: string[] = [];
    const walk = (node: unknown, path: string): void => {
      if (Array.isArray(node)) {
        for (const [i, child] of node.entries()) walk(child, `${path}[${i}]`);
        return;
      }
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      const properties = record.properties as Record<string, Record<string, unknown>> | undefined;
      for (const [name, property] of Object.entries(properties ?? {})) {
        const described = typeof property.description === "string" || property.const !== undefined;
        if (!described && name !== "type" && name !== "kind") missing.push(`${path}.${name}`);
      }
      for (const [name, child] of Object.entries(record)) walk(child, `${path}.${name}`);
    };
    walk(json, key);
    expect(missing).toEqual([]);
  });

  it("导出的样子", () => {
    expect(json).toMatchSnapshot();
  });
});

describe("构思阶段的定义写明设计规范和参考的中文取值", () => {
  const text = JSON.stringify(pageJsonSchema("think"));

  it("设计规范的种类、动效、表格的列和状态标签都写中文", () => {
    for (const value of ['"const":"表格"', '"const":"颜色"', "移动", "旧叫法", "已取消"]) {
      expect(text).toContain(value);
    }
    expect(text).toContain('"enum":["书","文章","规范","产品","开源项目","研究"]');
  });

  it("编号、引用和行号带着写法", () => {
    expect(text).toContain('"pattern":"^Q[1-9][0-9]*$"');
    expect(text).toContain('"pattern":"^S[1-9][0-9]*$"');
    expect(text).toContain('"pattern":"^[1-9][0-9]*(-[1-9][0-9]*)?$"');
    expect(text).toContain('"pattern":"^[a-z]$"');
  });
});

describe("页面数据的外壳", () => {
  it("格式版本是 2，旧 skill 的格式算第 1 版", () => {
    expect(pageFormatVersion).toBe(2);
  });

  it.each(stages)("%s：阶段写中文，解析以后是英文键，区块按这个阶段查", (label, key) => {
    const envelope = { formatVersion: pageFormatVersion, stage: label, sections: stagePages[key] };
    const parsed: PageEnvelope = pageEnvelopeSchema.parse(envelope);
    expect(parsed.stage).toBe(key);
    expect(parsed.sections).toEqual(pageSchemas[key].parse(stagePages[key]));
    expect(pageEnvelopeSchema.encode(parsed)).toEqual(envelope);
  });

  it("区块不是这一阶段能写的就拒绝", () => {
    const envelope = { formatVersion: 2, stage: "落地", sections: stagePages.improve };
    const issues = pageEnvelopeSchema.safeParse(envelope).error?.issues ?? [];
    expect(issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["unrecognized_keys", ["sections"]],
    ]);
  });
});
