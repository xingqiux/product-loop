import type { z } from "zod";
import type { Stage } from "../names.ts";
import { alignTermSchema } from "./align.ts";
import {
  askCardSchema,
  droppedSchema,
  findingCardSchema,
  improvementCardSchema,
  optionKeySchema,
  optionSchema,
  researchSchema,
  sharedSchema,
  stanceSchema,
} from "./card.ts";
import { cardIdSchema } from "./card-id.ts";
import { changeCardSchema } from "./change.ts";
import { evidenceItemSchema, evidenceSchema } from "./evidence.ts";
import {
  diagramSchema,
  diagramsSchema,
  figureSchema,
  filePathSchema,
  flagSchema,
  hexColorSchema,
  imgPathSchema,
  lineRangeSchema,
  queueRefSchema,
  queueRefsSchema,
  sceneRefSchema,
  textSchema,
  whereSchema,
} from "./fields.ts";
import { refSchema } from "./ref.ts";
import { sceneDraftSchema, sceneStepSchema } from "./scene.ts";
import { elementSchema, screenEntrySchema } from "./screen.ts";
import { pageSectionsSchema } from "./sections.ts";
import { sourceSchema, sourcesSchema } from "./source.ts";
import { specDraftSchema } from "./spec.ts";
import { pageEnvelopeSchema } from "./stages.ts";

// 每个定义一份合格的样本，外加几份不合格的样本，照「07 校验」第六节样本的做法。
// 不合格的样本在合格的数据上改一处，写明改了什么、预期在哪个路径上报错。

/** 字段的路径，写法和 Zod 问题的 path 相同。 */
type SamplePath = readonly (string | number)[];

type BadSample = {
  /** 改了哪一处，写成测试的描述。 */
  readonly why: string;
  readonly value: unknown;
  /** 预期报错的路径。 */
  readonly path: SamplePath;
  /** 定义自己报的问题写 check，Zod 的通用问题写 code，两者写一个。 */
  readonly check?: string;
  readonly code?: z.core.$ZodIssue["code"];
};

type DefinitionSamples = {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly good: unknown;
  readonly bad: readonly [BadSample, ...BadSample[]];
};

/** JSON 数据的深拷贝，改样本时不动原来的。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** 按路径找到要改的那一层。路径不对时说明样本写错了，直接抛出。 */
function parentOf(
  root: unknown,
  path: SamplePath,
): [Record<string | number, unknown>, string | number] {
  const last = path.at(-1);
  if (last === undefined) throw new Error("样本的路径不能是空的");
  let node = root;
  for (const part of path.slice(0, -1)) {
    node = (node as Record<string | number, unknown>)[part];
    if (typeof node !== "object" || node === null) throw new Error(`样本里没有 ${path.join(".")}`);
  }
  return [node as Record<string | number, unknown>, last];
}

/** 把一处改成别的值，返回改过的拷贝。 */
export function withValue(base: unknown, path: SamplePath, value: unknown): unknown {
  const root = clone(base);
  const [parent, key] = parentOf(root, path);
  parent[key] = value;
  return root;
}

/** 删掉一处，返回改过的拷贝。 */
function without(base: unknown, path: SamplePath): unknown {
  const root = clone(base);
  const [parent, key] = parentOf(root, path);
  if (Array.isArray(parent) && typeof key === "number") parent.splice(key, 1);
  else delete parent[key];
  return root;
}

// ---- 合格的数据

const imgSource = {
  name: "报告网页现在的样子",
  saw: "每一块名字下面有一句说明。",
  img: "img/report-now.png",
};
const textSource = {
  name: "正文第九节",
  saw: "写法八条和决定表重复。",
  file: "skill/SKILL.md",
  lines: "120-134",
  mark: [122, 123],
};
const quoteSource = { name: "用户昨天说的", saw: "「这个场景我没用过」", quote: true };
const outsideSource = {
  name: "Linear 的队列页",
  saw: "筛选放在列表上方。",
  img: "img/linear-queue.png",
  outside: true,
};

const optionA = {
  key: "a",
  title: "每一页的最后",
  diffs: ["每一页的左边列表最下面一组。"],
  why: "用户每一页都能看到队列。",
  cost: "页面变长。",
  when: "用户每个阶段都想看队列。",
  sketch: '<div class="wf"><div class="wf-bar"></div></div>',
};
const optionB = {
  key: "b",
  title: "单独一页",
  diffs: ["项目页上的一个入口。"],
  why: "每个阶段的页面更短。",
  cost: "看队列要多点一下。",
  when: "用户只在开始阶段时看队列。",
};

const diagram = { kind: "流程图", title: "队列的写入路径", code: "flowchart LR\n A-->B" };

const askCard = {
  id: "queue-board",
  queue: ["Q12"],
  title: "队列看板放在哪里",
  tag: "队列",
  why: "看板放在每一页的最后，还是单独一页。",
  sources: [imgSource, textSource, quoteSource],
  shared: { text: "两种放法都保留五列看板。", diagrams: [diagram] },
  rows: ["放在哪里"],
  options: [optionA, optionB],
  stance: { pick: "a", because: "用户每一页都要看到队列。" },
  where: { scene: "S9", step: 1 },
  research: { tier: "快查" },
};

const findingCard = {
  title: "每一块名字下面的说明没有必要",
  why: "控件自己能说明怎么操作。",
  sources: [imgSource],
  where: { scene: "S3", step: 2 },
  evidence: [{ type: "截图", img: "img/ask-block.png", caption: "疑问这一块" }],
  shared: { text: "块的名字不变。" },
  rows: ["说明"],
  options: [
    {
      key: "a",
      title: "全部删掉",
      diffs: ["每一块只有名字。"],
      why: "说明是多余的。",
      cost: "无。",
      when: "说明都没人读。",
    },
    { key: "b", title: "不改", diffs: ["说明照旧。"] },
  ],
};

const improvementCard = {
  title: "队列看板加一个筛选",
  why: "事多的时候找不到当前阶段的事。",
  sources: [outsideSource],
  where: { scene: "S9", step: 2 },
  mock: '<div class="mk-top"><span class="mk-tab on">待办</span></div>',
  mockCaption: "选 a 的样子",
  flow: ["点筛选", "只剩当前阶段", "点一张小卡"],
  only: true,
  dropped: [{ name: "按提出者筛选", because: "用户没有按提出者找过事。" }],
  rows: ["筛选"],
  options: [
    {
      key: "a",
      title: "按阶段筛选",
      diffs: ["看板上方一排阶段。"],
      why: "阶段是找事的第一个条件。",
      cost: "多一排按钮。",
    },
  ],
  design: true,
};

const imageChange = {
  id: "option-when",
  queue: ["Q15"],
  title: "选项多一格适用场景",
  problem: "选项只有理由和代价，看不出什么时候选它。",
  fix: "三格变四格。",
  before: { img: "img/when-before.png", caption: "改前的选项" },
  after: { img: "img/when-after.png", caption: "改后的选项" },
  more: [{ img: "img/when-gate.png", caption: "没写适用场景时拦截" }],
};

const textChange = {
  title: "正文的写法改成四句",
  problem: "正文写的是三句。",
  fix: "正文写成四句。",
  textName: "正文第八节",
  textBefore: "每个选项写三句。",
  textAfter: "每个选项写四句。",
};

const screenEntry = {
  name: "报告网页：疑问块",
  where: { scene: "S3", step: 1 },
  elements: [
    { what: "块标题「疑问」", answers: "这一块是什么" },
    { what: "选项小卡", answers: "我可以选哪个" },
  ],
};

const sceneDraft = {
  id: "look-at-queue",
  scene: "S9",
  name: "看队列",
  who: "你，想知道还有哪些事没做时",
  mark: "改过",
  steps: [
    { do: "在项目页点队列", expect: "五列看板", img: "img/s9-1.png" },
    { do: "点一张小卡", expect: "展示卡片列出十格" },
  ],
};

const tableSpec = {
  name: "状态标签",
  kind: "表格",
  for: "队列看板的小卡",
  columns: [{ name: "状态" }, { name: "标签", as: "加粗" }, { name: "颜色", as: "色块" }],
  rows: [
    [{ text: "待办", tone: "待办" }, "待办", "#eef1f4"],
    [{ text: "等待", tone: "等待" }, "等待", "#fff4e5"],
  ],
};

const alignTerm = {
  name: "信息结构",
  usedIn: ["队列看板放在哪里"],
  meaning: "一页的内容分成哪几层，每一层管什么。",
  example: "报告网页分四层：页、区块、卡、格。",
  diagram: { kind: "目录树", title: "报告网页的四层", code: "页\n└ 区块\n  └ 卡" },
};

const ref = {
  name: "《写给大家看的设计书》",
  kind: "书",
  depth: "已读原文",
  relevance: "高",
  strength: "中",
  advice: "采用",
  body: "版面的四条原则：对齐、对比、重复、亲密性。",
  where: "选项卡的版式",
};

/** 各个区块都有的一份合格的页面数据，编号有写的，也有不写的。 */
export const validPage = {
  align: [alignTerm],
  scenes: [sceneDraft, { name: "看主线", steps: [{ do: "点主线", expect: "主线全文" }] }],
  spec: [
    { name: "配色", kind: "颜色", for: "整个工作台", values: [{ name: "底", hex: "#fff" }] },
    tableSpec,
  ],
  asks: [
    askCard,
    { title: "上次你自己做这件事是什么时候", why: "答案写进给谁用。", sources: [quoteSource] },
  ],
  findings: [findingCard],
  improvements: [improvementCard],
  changes: [imageChange, textChange],
  refs: [ref],
  screens: [screenEntry],
};

const followUp = validPage.asks[1];

/** 各阶段一份合格的页面数据，取 validPage 里这一阶段能写的区块。 */
export const stagePages = {
  think: {
    align: validPage.align,
    scenes: validPage.scenes,
    spec: validPage.spec,
    asks: validPage.asks,
    refs: validPage.refs,
  },
  use: { asks: [followUp] },
  check: { asks: validPage.asks, findings: validPage.findings, screens: validPage.screens },
  land: { asks: [followUp], changes: validPage.changes },
  improve: { asks: [followUp], improvements: validPage.improvements },
} satisfies Record<Stage, Readonly<Record<string, unknown>>>;

// ---- 各个定义的样本

export const definitionSamples: readonly DefinitionSamples[] = [
  {
    name: "textSchema",
    schema: textSchema,
    good: "待决定的事。",
    bad: [
      { why: "空字符串", value: "", path: [], code: "invalid_format" },
      { why: "只有空白", value: " \n ", path: [], code: "invalid_format" },
    ],
  },
  {
    name: "flagSchema",
    schema: flagSchema,
    good: true,
    bad: [{ why: "写成 false", value: false, path: [], code: "invalid_value" }],
  },
  {
    name: "cardIdSchema",
    schema: cardIdSchema,
    good: "spec-twelve",
    bad: [
      { why: "有大写字母和下划线", value: "Spec_12", path: [], check: "page.cardId.shape" },
      { why: "以数字开头", value: "12-spec", path: [], check: "page.cardId.shape" },
      { why: "短横连着写", value: "spec--twelve", path: [], check: "page.cardId.shape" },
      { why: "以短横结尾", value: "spec-", path: [], check: "page.cardId.shape" },
      { why: "有中文", value: "规范-十二", path: [], check: "page.cardId.shape" },
      {
        why: "超过四十八个字符",
        value: `a${"b".repeat(48)}`,
        path: [],
        check: "page.cardId.shape",
      },
    ],
  },
  {
    name: "queueRefSchema",
    schema: queueRefSchema,
    good: "Q12",
    bad: [
      { why: "小写的 q", value: "q12", path: [], check: "parse.queueId.shape" },
      { why: "写了 0", value: "Q0", path: [], check: "parse.queueId.zero" },
      { why: "写成数字", value: 12, path: [], code: "invalid_type" },
    ],
  },
  {
    name: "queueRefsSchema",
    schema: queueRefsSchema,
    good: ["Q12", "Q15"],
    bad: [
      { why: "空数组", value: [], path: [], code: "too_small" },
      {
        why: "同一个编号写了两次",
        value: ["Q12", "Q12"],
        path: [1],
        check: "page.queueRef.duplicate",
      },
      { why: "有一个写错了", value: ["Q12", "Q012"], path: [1], check: "parse.queueId.shape" },
    ],
  },
  {
    name: "sceneRefSchema",
    schema: sceneRefSchema,
    good: "S14",
    bad: [
      { why: "小写的 s", value: "s14", path: [], check: "parse.sceneId.shape" },
      { why: "写了 0", value: "S0", path: [], check: "parse.sceneId.zero" },
      { why: "写成旧格式的序号", value: 14, path: [], code: "invalid_type" },
    ],
  },
  {
    name: "whereSchema",
    schema: whereSchema,
    good: { scene: "S3", step: 2 },
    bad: [
      { why: "缺步号", value: { scene: "S3" }, path: ["step"], code: "invalid_type" },
      { why: "步号是 0", value: { scene: "S3", step: 0 }, path: ["step"], code: "too_small" },
      {
        why: "步号是小数",
        value: { scene: "S3", step: 1.5 },
        path: ["step"],
        code: "invalid_type",
      },
      {
        why: "写了旧格式的场景名",
        value: { scene: "S3", step: 2, title: "回答疑问" },
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "写了旧格式的序号",
        value: { scenario: 3, step: 2 },
        path: ["scene"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "imgPathSchema",
    schema: imgPathSchema,
    good: "img/before.png",
    bad: [
      { why: "文件网址", value: "file:///Users/me/a.png", path: [], check: "page.path.img" },
      { why: "绝对路径", value: "/Users/me/a.png", path: [], check: "page.path.img" },
      { why: "不是图片", value: "img/sketch.html", path: [], check: "page.path.img" },
      { why: "反斜杠", value: "img\\a.png", path: [], check: "page.path.img" },
      { why: "首尾有空白", value: " img/a.png", path: [], check: "page.path.img" },
    ],
  },
  {
    name: "filePathSchema",
    schema: filePathSchema,
    good: "skill/SKILL.md",
    bad: [
      { why: "绝对路径", value: "/Users/me/主线.md", path: [], check: "page.path.file" },
      { why: "家目录开头", value: "~/notes/主线.md", path: [], check: "page.path.file" },
      { why: "网址", value: "https://example.com/a.md", path: [], check: "page.path.file" },
      { why: "有空的一段", value: "skill//SKILL.md", path: [], check: "page.path.file" },
    ],
  },
  {
    name: "figureSchema",
    schema: figureSchema,
    good: { img: "img/after.png", caption: "改后的选项" },
    bad: [
      {
        why: "写成旧格式的 src",
        value: { src: "img/after.png" },
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "图注是空的",
        value: { img: "img/after.png", caption: "" },
        path: ["caption"],
        code: "invalid_format",
      },
    ],
  },
  {
    name: "lineRangeSchema",
    schema: lineRangeSchema,
    good: "12-20",
    bad: [
      { why: "前一个大于后一个", value: "20-12", path: [], check: "page.lines.shape" },
      { why: "从 0 起", value: "0-3", path: [], check: "page.lines.shape" },
      { why: "带空格", value: "12 - 20", path: [], check: "page.lines.shape" },
      { why: "写成数组", value: [12, 20], path: [], code: "invalid_type" },
    ],
  },
  {
    name: "hexColorSchema",
    schema: hexColorSchema,
    good: "#1f6feb",
    bad: [
      { why: "五位", value: "#12345", path: [], check: "page.color.hex" },
      { why: "没有井号", value: "1f6feb", path: [], check: "page.color.hex" },
      { why: "写成颜色函数", value: "oklch(1 0 0)", path: [], check: "page.color.hex" },
    ],
  },
  {
    name: "diagramSchema",
    schema: diagramSchema,
    good: diagram,
    bad: [
      {
        why: "种类不在表里",
        value: withValue(diagram, ["kind"], "饼图"),
        path: ["kind"],
        code: "invalid_value",
      },
      {
        why: "种类写成英文键",
        value: withValue(diagram, ["kind"], "flowchart"),
        path: ["kind"],
        code: "invalid_value",
      },
      { why: "缺标题", value: without(diagram, ["title"]), path: ["title"], code: "invalid_type" },
    ],
  },
  {
    name: "diagramsSchema",
    schema: diagramsSchema,
    good: [diagram, { kind: "架构图", title: "三个包", code: "flowchart LR\n A-- 调用 -->B" }],
    bad: [{ why: "空数组", value: [], path: [], code: "too_small" }],
  },
  {
    name: "sourceSchema",
    schema: sourceSchema,
    good: imgSource,
    bad: [
      { why: "缺名字", value: without(imgSource, ["name"]), path: ["name"], code: "invalid_type" },
      {
        why: "同时写了 img 和 file",
        value: { ...textSource, img: "img/a.png" },
        path: [],
        check: "page.source.twoForms",
      },
      {
        why: "原话又配了图",
        value: { ...quoteSource, img: "img/a.png" },
        path: [],
        check: "page.source.twoForms",
      },
      {
        why: "文字的来源缺 lines",
        value: without(textSource, ["lines"]),
        path: ["lines"],
        check: "page.source.textIncomplete",
      },
      {
        why: "写了 lines 却没有 file",
        value: without(textSource, ["file"]),
        path: ["file"],
        check: "page.source.textIncomplete",
      },
      {
        why: "mark 超出 lines",
        value: withValue(textSource, ["mark", 1], 150),
        path: ["mark", 1],
        check: "page.lines.markOutside",
      },
      {
        why: "mark 有重复的行号",
        value: withValue(textSource, ["mark"], [122, 122]),
        path: ["mark", 1],
        check: "page.lines.markDuplicate",
      },
      {
        why: "原话没有写出来",
        value: without(quoteSource, ["saw"]),
        path: ["saw"],
        check: "page.source.quoteWithoutSaw",
      },
      {
        why: "文字的来源标了 outside",
        value: { ...textSource, outside: true },
        path: ["outside"],
        check: "page.source.outsideNotImage",
      },
      {
        why: "写成旧格式第三版的 label 和 excerpt",
        value: { label: "转来的原话", kind: "file", excerpt: "一段原文" },
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "quote 写成 false",
        value: { ...imgSource, quote: false },
        path: ["quote"],
        code: "invalid_value",
      },
    ],
  },
  {
    name: "sourcesSchema",
    schema: sourcesSchema,
    good: [imgSource, textSource, quoteSource, outsideSource],
    bad: [{ why: "一条来源都没有", value: [], path: [], code: "too_small" }],
  },
  {
    name: "evidenceItemSchema",
    schema: evidenceItemSchema,
    good: { type: "尺寸", unit: "px", values: [11, 12, 16], keep: [12, 16] },
    bad: [
      {
        why: "旧格式的 excerpt 证据",
        value: { type: "excerpt", text: "一段原文" },
        path: ["type"],
        code: "invalid_union",
      },
      {
        why: "种类写成旧格式的英文",
        value: { type: "sizes", values: [12, 16] },
        path: ["type"],
        code: "invalid_union",
      },
      {
        why: "没写种类",
        value: { values: [12, 16] },
        path: ["type"],
        code: "invalid_union",
      },
      {
        why: "尺寸是空的",
        value: { type: "尺寸", values: [] },
        path: ["values"],
        code: "too_small",
      },
      {
        why: "截图写成旧格式的 src",
        value: { type: "截图", src: "img/a.png" },
        path: ["img"],
        code: "invalid_type",
      },
      {
        why: "色块的色值写错",
        value: { type: "色块", values: [{ name: "底", hex: "#12" }] },
        path: ["values", 0, "hex"],
        check: "page.color.hex",
      },
      {
        why: "真组件缺样式",
        value: { type: "真组件", from: "新建设计第 1 步", html: "<button>保存</button>" },
        path: ["css"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "evidenceSchema",
    schema: evidenceSchema,
    good: [
      { type: "色块", values: [{ name: "底", hex: "#eef1f4" }] },
      { type: "字号", values: [{ size: 13, weight: 600, sample: "队列看板" }] },
      { type: "间距", values: [4, 8, 12], keep: [4, 8] },
      { type: "截图", img: "img/a.png", caption: "疑问这一块" },
      {
        type: "真组件",
        from: "新建设计第 1 步的类型卡",
        html: '<button class="chip">5 页</button>',
        css: ".chip{padding:4px 10px}",
        toggles: [
          { label: "选中", selector: ".chip", class: "is-on" },
          { label: "禁用", selector: ".chip", attr: "disabled", on: "true" },
        ],
        height: 170,
        bg: "#ffffff",
      },
    ],
    bad: [
      {
        why: "写成一个对象，没有放进数组",
        value: { type: "截图", img: "img/a.png" },
        path: [],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "optionKeySchema",
    schema: optionKeySchema,
    good: "b",
    bad: [
      { why: "两个字母", value: "ab", path: [], check: "page.card.keyShape" },
      { why: "写成回复里的「同意」", value: "同意", path: [], check: "page.card.keyShape" },
    ],
  },
  {
    name: "optionSchema",
    schema: optionSchema,
    good: optionA,
    bad: [
      {
        why: "key 是大写",
        value: withValue(optionA, ["key"], "A"),
        path: ["key"],
        check: "page.card.keyShape",
      },
      {
        why: "没有 diffs",
        value: without(optionA, ["diffs"]),
        path: ["diffs"],
        code: "invalid_type",
      },
      {
        why: "差别有一格是空的",
        value: withValue(optionA, ["diffs", 0], " "),
        path: ["diffs", 0],
        code: "invalid_format",
      },
      {
        why: "还在用旧的 see",
        value: withValue(optionA, ["see"], "改完看到什么"),
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "线稿是空字符串",
        value: withValue(optionA, ["sketch"], ""),
        path: ["sketch"],
        code: "invalid_format",
      },
    ],
  },
  {
    name: "stanceSchema",
    schema: stanceSchema,
    good: { pick: "a", because: "用户每一页都要看到队列。" },
    bad: [
      {
        why: "写成一句话",
        value: "我的看法是 a，因为用户每一页都要看到队列。",
        path: [],
        code: "invalid_type",
      },
      { why: "缺理由", value: { pick: "a" }, path: ["because"], code: "invalid_type" },
    ],
  },
  {
    name: "droppedSchema",
    schema: droppedSchema,
    good: [{ name: "按提出者筛选", because: "用户没有按提出者找过事。" }],
    bad: [
      {
        why: "缺排除的理由",
        value: [{ name: "按提出者筛选" }],
        path: [0, "because"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "sharedSchema",
    schema: sharedSchema,
    good: { text: "两种放法都保留五列看板。", diagrams: [diagram] },
    bad: [
      {
        why: "图表是空数组",
        value: { text: "共同的部分。", diagrams: [] },
        path: ["diagrams"],
        code: "too_small",
      },
    ],
  },
  {
    name: "researchSchema",
    schema: researchSchema,
    good: { tier: "深查", approved: "v1-构思-23" },
    bad: [
      { why: "写成一个词", value: "快查", path: [], code: "invalid_type" },
      { why: "档位不在三档里", value: { tier: "细查" }, path: ["tier"], code: "invalid_value" },
      { why: "档位写成英文键", value: { tier: "quick" }, path: ["tier"], code: "invalid_value" },
    ],
  },
  {
    name: "askCardSchema",
    schema: askCardSchema,
    good: askCard,
    bad: [
      {
        why: "有选项却没有 rows",
        value: without(askCard, ["rows"]),
        path: ["rows"],
        check: "page.card.rowsMissing",
      },
      {
        why: "diffs 比 rows 少一格",
        value: withValue(askCard, ["rows"], ["放在哪里", "怎么进入"]),
        path: ["options", 0, "diffs"],
        check: "page.card.diffsCount",
      },
      {
        why: "两个选项的 key 相同",
        value: withValue(askCard, ["options", 1, "key"], "a"),
        path: ["options", 1, "key"],
        check: "page.card.keyDuplicate",
      },
      {
        why: "没有来源",
        value: without(askCard, ["sources"]),
        path: ["sources"],
        code: "invalid_type",
      },
      {
        why: "卡片编号写法不对",
        value: withValue(askCard, ["id"], "Queue Board"),
        path: ["id"],
        check: "page.cardId.shape",
      },
      {
        why: "引用队列写成旧的 queueRow",
        value: withValue(askCard, ["queueRow"], "选项卡升级"),
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "选项是空数组",
        value: withValue(without(without(askCard, ["rows"]), ["shared"]), ["options"], []),
        path: ["options"],
        code: "too_small",
      },
      {
        why: "看法写成一句话",
        value: withValue(askCard, ["stance"], "站 a。"),
        path: ["stance"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "findingCardSchema",
    schema: findingCardSchema,
    good: findingCard,
    bad: [
      {
        why: "没有位置",
        value: without(findingCard, ["where"]),
        path: ["where"],
        code: "invalid_type",
      },
      {
        why: "发现卡写了调研分档",
        value: withValue(findingCard, ["research"], { tier: "快查" }),
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "evidence 写成一个对象",
        value: withValue(findingCard, ["evidence"], { type: "截图", img: "img/a.png" }),
        path: ["evidence"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "improvementCardSchema",
    schema: improvementCardSchema,
    good: improvementCard,
    bad: [
      {
        why: "只有线稿的说明，没有线稿",
        value: without(improvementCard, ["mock"]),
        path: ["mockCaption"],
        check: "page.card.mockCaptionAlone",
      },
      {
        why: "操作流程是空数组",
        value: withValue(improvementCard, ["flow"], []),
        path: ["flow"],
        code: "too_small",
      },
      {
        why: "only 写成 false",
        value: withValue(improvementCard, ["only"], false),
        path: ["only"],
        code: "invalid_value",
      },
    ],
  },
  {
    name: "changeCardSchema",
    schema: changeCardSchema,
    good: imageChange,
    bad: [
      {
        why: "既没有截图也没有文字",
        value: without(without(without(imageChange, ["before"]), ["after"]), ["more"]),
        path: [],
        check: "page.change.noForm",
      },
      {
        why: "截图和文字都写了",
        value: { ...imageChange, textBefore: "改前。", textAfter: "改后。" },
        path: [],
        check: "page.change.twoForms",
      },
      {
        why: "只有改前的图",
        value: without(imageChange, ["after"]),
        path: ["after"],
        check: "page.change.incomplete",
      },
      {
        why: "文字只有改前",
        value: without(textChange, ["textAfter"]),
        path: ["textAfter"],
        check: "page.change.incomplete",
      },
      {
        why: "图写成旧格式的 src",
        value: withValue(imageChange, ["after"], { src: "img/when-after.png" }),
        path: ["after"],
        code: "unrecognized_keys",
      },
      {
        why: "缺之前哪里不对",
        value: without(imageChange, ["problem"]),
        path: ["problem"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "elementSchema",
    schema: elementSchema,
    good: { what: "选项小卡", answers: "我可以选哪个" },
    bad: [
      {
        why: "缺它回答的问题",
        value: { what: "选项小卡" },
        path: ["answers"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "screenEntrySchema",
    schema: screenEntrySchema,
    good: screenEntry,
    bad: [
      {
        why: "位置写成场景的名字",
        value: withValue(screenEntry, ["where", "scene"], "逐条点选项并提交"),
        path: ["where", "scene"],
        check: "parse.sceneId.shape",
      },
      {
        why: "清单是空的",
        value: withValue(screenEntry, ["elements"], []),
        path: ["elements"],
        code: "too_small",
      },
    ],
  },
  {
    name: "sceneStepSchema",
    schema: sceneStepSchema,
    good: { do: "在项目页点队列", expect: "五列看板", img: "img/s9-1.png" },
    bad: [
      {
        why: "截图写成旧格式的 src",
        value: { do: "点队列", expect: "看板", src: "img/s9-1.png" },
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "该看到什么写成旧格式的 see",
        value: { do: "点队列", see: "看板" },
        path: [],
        code: "unrecognized_keys",
      },
    ],
  },
  {
    name: "sceneDraftSchema",
    schema: sceneDraftSchema,
    good: sceneDraft,
    bad: [
      {
        why: "场景编号写成名字的一部分",
        value: withValue(sceneDraft, ["scene"], "S9 看队列"),
        path: ["scene"],
        check: "parse.sceneId.shape",
      },
      {
        why: "没有步骤",
        value: withValue(sceneDraft, ["steps"], []),
        path: ["steps"],
        code: "too_small",
      },
    ],
  },
  {
    name: "specDraftSchema",
    schema: specDraftSchema,
    good: tableSpec,
    bad: [
      {
        why: "用在哪里写成空字符串",
        value: withValue(tableSpec, ["for"], ""),
        path: ["for"],
        code: "invalid_format",
      },
      {
        why: "一行的格数和列数不同",
        value: withValue(tableSpec, ["rows", 1], ["等待", "#fff4e5"]),
        path: ["rows", 1],
        check: "page.spec.rowCells",
      },
      {
        why: "种类不在七种里",
        value: withValue(tableSpec, ["kind"], "grid"),
        path: ["kind"],
        code: "invalid_union",
      },
      {
        why: "状态标签的色调不对",
        value: withValue(tableSpec, ["rows", 0, 0], { text: "待办", tone: "red" }),
        path: ["rows", 0, 0],
        code: "invalid_union",
      },
      {
        why: "状态标签的色调写成旧格式的英文",
        value: withValue(tableSpec, ["rows", 0, 0], { text: "待办", tone: "todo" }),
        path: ["rows", 0, 0],
        code: "invalid_union",
      },
      {
        why: "种类写成旧格式的英文",
        value: withValue(tableSpec, ["kind"], "table"),
        path: ["kind"],
        code: "invalid_union",
      },
      {
        why: "一列的画法写成旧格式的英文",
        value: withValue(tableSpec, ["columns", 1, "as"], "strong"),
        path: ["columns", 1, "as"],
        code: "invalid_value",
      },
      {
        why: "配色的色值写错",
        value: {
          name: "配色",
          kind: "颜色",
          for: "工作台",
          values: [{ name: "底", hex: "white" }],
        },
        path: ["values", 0, "hex"],
        check: "page.color.hex",
      },
      {
        why: "动效的效果不在三种里",
        value: {
          name: "动效",
          kind: "动效",
          for: "换一屏",
          values: [{ name: "换屏", ms: 180, effect: "旋转" }],
        },
        path: ["values", 0, "effect"],
        code: "invalid_value",
      },
      {
        why: "动效的效果写成旧格式的英文",
        value: {
          name: "动效",
          kind: "动效",
          for: "换一屏",
          values: [{ name: "换屏", ms: 180, effect: "move" }],
        },
        path: ["values", 0, "effect"],
        code: "invalid_value",
      },
      {
        why: "文字规范是空的",
        value: { name: "图标", kind: "文字", for: "左边一栏", text: "" },
        path: ["text"],
        code: "invalid_format",
      },
    ],
  },
  {
    name: "alignTermSchema",
    schema: alignTermSchema,
    good: alignTerm,
    bad: [
      {
        why: "缺例子",
        value: without(alignTerm, ["example"]),
        path: ["example"],
        code: "invalid_type",
      },
      {
        why: "没写用在哪张卡",
        value: withValue(alignTerm, ["usedIn"], []),
        path: ["usedIn"],
        code: "too_small",
      },
    ],
  },
  {
    name: "refSchema",
    schema: refSchema,
    good: ref,
    bad: [
      {
        why: "建议不在四种里",
        value: withValue(ref, ["advice"], "推荐"),
        path: ["advice"],
        code: "invalid_value",
      },
      {
        why: "类型写成英文键",
        value: withValue(ref, ["kind"], "book"),
        path: ["kind"],
        code: "invalid_value",
      },
      { why: "缺正文", value: without(ref, ["body"]), path: ["body"], code: "invalid_type" },
    ],
  },
  {
    name: "pageEnvelopeSchema",
    schema: pageEnvelopeSchema,
    good: { formatVersion: 2, stage: "检查", sections: stagePages.check },
    bad: [
      {
        why: "格式版本是旧格式的 1",
        value: { formatVersion: 1, stage: "检查", sections: stagePages.check },
        path: ["formatVersion"],
        code: "invalid_value",
      },
      {
        why: "阶段写成英文键",
        value: { formatVersion: 2, stage: "check", sections: stagePages.check },
        path: ["stage"],
        code: "invalid_union",
      },
      {
        why: "区块不是这一阶段能写的",
        value: { formatVersion: 2, stage: "使用", sections: stagePages.check },
        path: ["sections"],
        code: "unrecognized_keys",
      },
      {
        why: "没有区块这一项",
        value: { formatVersion: 2, stage: "使用" },
        path: ["sections"],
        code: "invalid_type",
      },
    ],
  },
  {
    name: "pageSectionsSchema",
    schema: pageSectionsSchema,
    good: validPage,
    bad: [
      {
        why: "两张卡用了同一个编号",
        value: withValue(validPage, ["changes", 0, "id"], "queue-board"),
        path: ["changes", 0, "id"],
        check: "page.cardId.duplicate",
      },
      {
        why: "区块是空数组",
        value: withValue(validPage, ["findings"], []),
        path: ["findings"],
        code: "too_small",
      },
      {
        why: "写了回到构思",
        value: withValue(validPage, ["rethink"], []),
        path: [],
        code: "unrecognized_keys",
      },
      {
        why: "写了系统名",
        value: withValue(validPage, ["system"], "产品循环"),
        path: [],
        code: "unrecognized_keys",
      },
    ],
  },
];
