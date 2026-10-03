import { describe, expect, it } from "vitest";
import { allCopy } from "../copy/index.ts";
import type { Stage } from "../names.ts";
import { type FormatChange, formatChanges, renamedValue } from "../page/legacy-format.ts";
import { checkWriting } from "../writing/check.ts";
import { lostTexts } from "./convert-page.samples.ts";
import {
  convertLegacyPage,
  type LegacyConversion,
  type LegacyNote,
  type LegacyPageContext,
  legacyNoteText,
} from "./convert-page.ts";

// 旧页面数据转成新格式，见「08 版本与迁移」第五节。每一种改法各有用例。

const context: LegacyPageContext = {
  queue: [
    { text: "首页的卡片改成列表", id: "Q1" },
    { text: "首页的卡片改成列表加详情", id: "Q2" },
    { text: "设计规范补上状态这一样", id: "Q3" },
    { text: "设计规范补上状态", id: "Q3" },
    { text: "改名", id: "Q4" },
  ],
  scenes: [
    { name: "回答疑问", id: "S1" },
    { name: "答疑问", id: "S1" },
    { name: "验收更改", id: "S2" },
  ],
};

function convert(old: unknown, ctx: LegacyPageContext = context): LegacyConversion {
  const result = convertLegacyPage(old, ctx);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** 一份旧页面数据：页头四项加上给出的区块。 */
function oldPage(stage: string, sections: Readonly<Record<string, unknown>>) {
  return { system: "样本", stage, round: 3, date: "2026-09-20", ...sections };
}

/** 新旧格式都合格的一张疑问卡。 */
const ask = {
  title: "上次你自己做这件事是什么时候",
  why: "答案写进给谁用。",
  sources: [{ name: "用户昨天说的", saw: "「这个场景我没用过」", quote: true }],
};

/** 旧格式的一张发现卡：位置写场景名和序号。 */
const finding = {
  title: "每一块名字下面的说明没有必要",
  why: "控件自己能说明怎么操作。",
  sources: [{ name: "疑问块", saw: "名字下面有一句说明。", src: "report-img/b.png" }],
  where: { scenario: 1, step: 2, title: "回答疑问", stepText: "读第一条", scenarios: 9, steps: 5 },
};

const notesOf = (conversion: LegacyConversion, change: string) =>
  conversion.notes.filter((note) => note.change === change);

describe("转不了的给出原因", () => {
  it.each([
    ["页面数据不是对象", [], "legacyPage.page.notObject", "旧页面数据应写成一个对象，写的是数组。"],
    [
      "没写阶段",
      { system: "样本", asks: [ask] },
      "legacyPage.stage.missing",
      "旧页面数据没有写 stage，看不出它属于哪个阶段。",
    ],
    [
      "阶段不认识",
      oldPage("复盘", {}),
      "legacyPage.stage.unknown",
      "旧页面数据的 stage 写的是「复盘」，不是一个阶段。",
    ],
  ])("%s", (_why, old, check, message) => {
    const result = convertLegacyPage(old, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.check).toBe(check);
    expect(result.error.message).toBe(message);
    expect(result.error.hint).not.toBe("");
  });
});

describe("阶段、轮次和日期", () => {
  it.each([
    ["构思", "think"],
    ["使用", "use"],
    ["检查", "check"],
    ["落地", "land"],
    ["提升", "improve"],
    ["修复", "land"],
  ] satisfies [string, Stage][])("阶段「%s」转成 %s", (label, key) => {
    expect(convert(oldPage(label, { asks: [ask] })).stage).toBe(key);
  });

  it("轮次和日期由命令填，从页面数据里拿出来单独给出，不写备注", () => {
    const conversion = convert(oldPage("修复", { asks: [ask] }));
    expect(conversion).toMatchObject({ stage: "land", round: 3, date: "2026-09-20" });
    expect(conversion.page).toEqual({ asks: [ask] });
    expect(conversion.notes.map((note) => note.path)).toEqual([["system"]]);
  });

  it("轮次和日期的写法不对时不给出，原来的值写进备注", () => {
    const conversion = convert({ stage: "检查", round: "3", date: "9 月 20 日", asks: [ask] });
    expect(conversion.round).toBeUndefined();
    expect(conversion.date).toBeUndefined();
    expect(notesOf(conversion, "roundFields")).toEqual([
      { path: ["round"], change: "roundFields", old: "3" },
      { path: ["date"], change: "roundFields", old: "9 月 20 日" },
    ]);
  });
});

describe("页头、看板和命令填的区块删掉，原来的值写进备注", () => {
  it("每个字段一条备注，写明依据对照表的哪一条", () => {
    const dropped = {
      progress: [{ stage: "检查", summary: "逐屏查了四屏。", state: "current" }],
      current: [{ problem: "说明多余", fix: "删掉说明" }],
      queue: [{ stage: "落地", text: "一件留到落地阶段的事", from: "用户" }],
      usage: { scenes: [{ name: "看队列", state: "走通" }], gaps: ["导出"] },
      landDir: "land",
      land: { tidy: { skipped: true } },
      noLift: "看过了，没有要提升的。",
    };
    const conversion = convert(oldPage("检查", { ...dropped, asks: [ask] }));
    expect(conversion.page).toEqual({ asks: [ask] });
    expect(conversion.notes).toEqual([
      { path: ["system"], change: "header", old: "样本" },
      { path: ["progress"], change: "header", old: dropped.progress },
      { path: ["current"], change: "header", old: dropped.current },
      { path: ["queue"], change: "queueBoard", old: dropped.queue },
      { path: ["usage"], change: "usage", old: dropped.usage },
      { path: ["landDir"], change: "land", old: "land" },
      { path: ["land"], change: "land", old: dropped.land },
      { path: ["noLift"], change: "noLift", old: dropped.noLift },
    ]);
  });

  it("空的也按对照表里的那一条记", () => {
    const conversion = convert(oldPage("检查", { progress: [], current: [], asks: [ask] }));
    expect(conversion.notes.map((note) => [note.path[0], note.change])).toEqual([
      ["system", "header"],
      ["progress", "header"],
      ["current", "header"],
    ]);
  });
});

// ---- 对照表的每一条

/** 旧路径 asks[].options[].see 拆成 asks、[]、options、[]、see。 */
function splitPath(path: string): string[] {
  return path.split(".").flatMap((part) => {
    const [name = "", ...brackets] = part.split("[]");
    return [name, ...brackets.map(() => "[]")];
  });
}

/** 按旧路径造一份数据，数组都只放一项。 */
function build(parts: readonly string[], leaf: unknown): unknown {
  const [part, ...rest] = parts;
  if (part === undefined) return leaf;
  const inner = build(rest, leaf);
  return part === "[]" ? [inner] : { [part]: inner };
}

/** 按路径往下找，数组取第一项。 */
function dig(value: unknown, parts: readonly string[]): unknown {
  let node = value;
  for (const part of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node =
      part === "[]" ? (node as readonly unknown[])[0] : (node as Record<string, unknown>)[part];
  }
  return node;
}

/** 对照表里的一条旧写法，造数据时写什么值。 */
function oldValueFor(change: FormatChange, path: string): unknown {
  const [, written] = path.split("=");
  if (written !== undefined) return written === "false" ? false : written;
  if (change.values !== undefined) return Object.keys(change.values)[0];
  if (change.key === "evidenceArray") return { type: "image", src: "img/a.png" };
  if (change.key === "rethink") return [ask];
  if (change.key === "whereScene") return 3;
  return "旧的值";
}

const oldPaths = (formatChanges as readonly FormatChange[]).flatMap((change) =>
  change.old.filter((path) => path !== "stage").map((path) => [change.key, path, change] as const),
);

describe("对照表里的每一条旧写法，转换以后都不在旧的位置上", () => {
  it.each(oldPaths)("%s：%s", (_key, path, change) => {
    const [plain = ""] = path.split("=");
    const parts = splitPath(plain);
    const value = oldValueFor(change, path);
    // 提升只在提升阶段写，别的阶段会挪进疑问
    const stageLabel = plain.startsWith("improvements") ? "提升" : "检查";
    const old = { stage: stageLabel, ...(build(parts, value) as object) };
    const { page } = convert(old);
    const at = dig(page, parts);
    switch (change.kind) {
      case "renamed": {
        expect(at).toBeUndefined();
        const renamed = splitPath(change.now[change.old.indexOf(path)] ?? "");
        expect(dig(page, renamed)).toEqual(value);
        break;
      }
      case "renamedValue":
        expect(at).toBe(renamedValue(change, String(value)));
        break;
      case "reshaped":
        expect(at).toEqual([{ type: "截图", img: "img/a.png" }]);
        break;
      case "tightened":
        // 只有写成 false 的标记能删，别的由规则查，转换不动。
        if (path.endsWith("=false")) expect(at).toBeUndefined();
        else expect(at).toEqual(value);
        break;
      default:
        expect(at, "已废除和改由命令填的字段删掉").toBeUndefined();
    }
  });
});

// ---- 队列

describe("queueRow 按队列迁移对照换成编号", () => {
  const withRow = (queueRow: unknown) =>
    convert(oldPage("检查", { findings: [{ ...finding, queueRow }] }));

  it("内容完全相同的换成它的编号，写在 queueRow 原来的位置，原文写进备注", () => {
    const conversion = withRow("首页的卡片改成列表");
    const [card] = conversion.page.findings as Record<string, unknown>[];
    expect(Object.keys(card ?? {}).slice(-2)).toEqual(["where", "queue"]);
    expect(card?.queue).toEqual(["Q1"]);
    expect(notesOf(conversion, "queueRow")).toEqual([
      {
        path: ["findings", 0, "queueRow"],
        change: "queueRow",
        old: "首页的卡片改成列表",
        now: ["findings", 0, "queue", 0],
      },
    ]);
    expect(conversion.problems).toEqual([]);
  });

  it("没有完全相同的，按开头六个字以上匹配", () => {
    expect(withRow("首页的卡片改成列表加").page.findings).toMatchObject([{ queue: ["Q2"] }]);
  });

  it("按开头匹配到几件时报出来，列出对上的编号", () => {
    const conversion = withRow("首页的卡片改成");
    expect(conversion.page.findings).toEqual([expect.not.objectContaining({ queue: [] })]);
    expect(conversion.problems).toEqual([
      {
        path: ["findings", 0, "queue"],
        check: "legacyPage.queueRow.ambiguous",
        message: "queueRow「首页的卡片改成」同时对上了几件事：Q1、Q2。",
        hint: "在这一项的 queue 里只写它处理的那一件事的编号。",
      },
    ]);
  });

  it("不到六个字的只认完全相同的", () => {
    expect(withRow("改名").page.findings).toMatchObject([{ queue: ["Q4"] }]);
    const conversion = withRow("首页的卡");
    expect(conversion.problems.map((p) => p.check)).toEqual(["legacyPage.queueRow.unknown"]);
  });

  it("对不上的报出原文，原文写进备注，没有去处", () => {
    const conversion = withRow("队列里没有的一行字");
    expect(conversion.problems).toEqual([
      {
        path: ["findings", 0, "queue"],
        check: "legacyPage.queueRow.unknown",
        message: "queueRow「队列里没有的一行字」在队列迁移对照里对不上任何一件事。",
        hint: "在队列迁移对照里找到这件事，把它的编号写进这一项的 queue，例如 Q12。确实不在队列里的，不写。",
      },
    ]);
    expect(notesOf(conversion, "queueRow")).toEqual([
      { path: ["findings", 0, "queueRow"], change: "queueRow", old: "队列里没有的一行字" },
    ]);
  });

  it("写成数组的逐项换，同一件事的两种写法只留一个编号", () => {
    const conversion = withRow([
      "设计规范补上状态这一样",
      "设计规范补上状态",
      "首页的卡片改成列表",
    ]);
    expect(conversion.page.findings).toMatchObject([{ queue: ["Q3", "Q1"] }]);
    expect(notesOf(conversion, "queueRow").map((note) => note.now)).toEqual([
      ["findings", 0, "queue", 0],
      ["findings", 0, "queue", 0],
      ["findings", 0, "queue", 1],
    ]);
  });

  it("更改上的 queueRow 也换", () => {
    const change = {
      title: "选项多一格适用场景",
      problem: "看不出什么时候选它。",
      fix: "三格变四格。",
      after: { src: "img/after.png" },
      queueRow: "首页的卡片改成列表",
    };
    const { page, problems } = convert(oldPage("落地", { changes: [change] }));
    expect(page.changes).toEqual([
      {
        title: change.title,
        problem: change.problem,
        fix: change.fix,
        after: { img: "img/after.png" },
        queue: ["Q1"],
      },
    ]);
    expect(problems).toEqual([]);
  });

  it("写成数字的报出来，空的删掉", () => {
    const conversion = withRow([12, ""]);
    expect(conversion.problems.map((p) => [p.check, p.message])).toEqual([
      ["legacyPage.queueRow.shape", "queueRow 应写成文字或文字的数组，写的是数字。"],
    ]);
    expect(conversion.notes.filter((n) => n.path[2] === "queueRow")).toEqual([
      { path: ["findings", 0, "queueRow", 0], change: "queueRow", old: 12 },
      { path: ["findings", 0, "queueRow", 1], change: "emptyValues", old: "" },
    ]);
  });
});

// ---- 位置

describe("位置的场景名换成场景编号", () => {
  it("按场景名查到编号，场景名、这一步的文字、总数和步数删掉，写进备注", () => {
    const conversion = convert(oldPage("检查", { findings: [finding] }));
    const where = ["findings", 0, "where"];
    expect(conversion.page.findings).toMatchObject([{ where: { scene: "S1", step: 2 } }]);
    expect(conversion.notes).toEqual([
      { path: ["system"], change: "header", old: "样本" },
      { path: [...where, "scenario"], change: "whereScene", old: 1 },
      { path: [...where, "title"], change: "whereText", old: "回答疑问", now: [...where, "scene"] },
      { path: [...where, "stepText"], change: "whereText", old: "读第一条" },
      { path: [...where, "scenarios"], change: "whereTotals", old: 9 },
      { path: [...where, "steps"], change: "whereTotals", old: 5 },
    ]);
    expect(conversion.problems).toEqual([]);
  });

  it("同一个场景写过几种名字，对照里每种写一条；空白不算差别", () => {
    const old = oldPage("检查", {
      findings: [{ ...finding, where: { step: 1, title: " 答疑问" } }],
    });
    expect(convert(old).page.findings).toMatchObject([{ where: { scene: "S1", step: 1 } }]);
  });

  it("场景名对不上时报出名字；缺 scene 只报这一条，不再报缺字段", () => {
    const old = oldPage("检查", {
      findings: [{ ...finding, where: { step: 1, title: "看工程证据" } }],
    });
    expect(convert(old).problems).toEqual([
      {
        path: ["findings", 0, "where", "scene"],
        check: "legacyPage.where.sceneName",
        message: "场景「看工程证据」对不上主线里的场景。",
        hint: "在场景对照里补上这个名字对应的场景编号，或者在 where 的 scene 里直接写编号，例如 S3。",
      },
    ]);
  });

  it("只写了序号时按旧主线的序号查", () => {
    const old = oldPage("检查", { findings: [{ ...finding, where: { scenario: 2, step: 4 } }] });
    const numbered = { ...context, sceneNumbers: [{ number: 2, id: "S2" }] };
    const conversion = convert(old, numbered);
    expect(conversion.page.findings).toMatchObject([{ where: { scene: "S2", step: 4 } }]);
    expect(notesOf(conversion, "whereScene")).toEqual([
      {
        path: ["findings", 0, "where", "scenario"],
        change: "whereScene",
        old: 2,
        now: ["findings", 0, "where", "scene"],
      },
    ]);
  });

  it("只写了序号、序号又对不上时报出序号", () => {
    const old = oldPage("检查", { findings: [{ ...finding, where: { scenario: 4, step: 4 } }] });
    expect(convert(old).problems.map((p) => [p.check, p.message])).toEqual([
      ["legacyPage.where.sceneNumber", "where 只写了场景的序号 4，对不上主线里的场景。"],
    ]);
  });

  it("已经写了场景编号的照旧，名字删掉，不去查", () => {
    const where = { scene: "S2", step: 1, title: "回答疑问" };
    const conversion = convert(oldPage("检查", { findings: [{ ...finding, where }] }));
    expect(conversion.page.findings).toMatchObject([{ where: { scene: "S2", step: 1 } }]);
    expect(notesOf(conversion, "whereText")).toEqual([
      { path: ["findings", 0, "where", "title"], change: "whereText", old: "回答疑问" },
    ]);
  });
});

// ---- 证据、设计规范、场景清单

describe("证据", () => {
  it("写成一个对象的放进数组，种类换成中文，src 换成 img", () => {
    const evidence = { type: "image", src: "report-img/r9.jpg", caption: "看队列的第 7 步" };
    const { page } = convert(oldPage("检查", { asks: [{ ...ask, evidence }] }));
    expect(page.asks).toMatchObject([
      { evidence: [{ type: "截图", img: "report-img/r9.jpg", caption: "看队列的第 7 步" }] },
    ]);
  });

  it("excerpt 证据删掉，原文写进备注，后面的证据往前排", () => {
    const excerpt = { type: "excerpt", text: "一段摘录" };
    const sizes = { type: "sizes", unit: "px", values: [12, 16] };
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, evidence: [excerpt, sizes] }] }));
    expect(conversion.page.asks).toMatchObject([{ evidence: [{ ...sizes, type: "尺寸" }] }]);
    expect(notesOf(conversion, "excerptEvidence")).toEqual([
      { path: ["asks", 0, "evidence", 0], change: "excerptEvidence", old: excerpt },
    ]);
  });

  it("删完一项都不剩时，evidence 整个不写", () => {
    const evidence = { type: "excerpt", text: "一段摘录" };
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, evidence }] }));
    expect(conversion.page.asks).toEqual([ask]);
    expect(notesOf(conversion, "excerptEvidence").map((note) => note.path)).toEqual([
      ["asks", 0, "evidence"],
    ]);
  });
});

describe("设计规范和场景清单", () => {
  it("设计规范的几种取值换成中文，表格里空的一格留着", () => {
    const spec = [
      {
        name: "动效",
        kind: "motion",
        for: "换一屏",
        values: [{ name: "换一条", ms: 180, effect: "fade" }],
      },
      {
        name: "状态标签",
        kind: "table",
        for: "队列看板的小卡",
        columns: [{ name: "状态" }, { name: "标签", as: "strong" }],
        rows: [[{ text: "等待", tone: "wait" }, ""]],
      },
    ];
    const { page } = convert(oldPage("构思", { spec }));
    expect(page.spec).toEqual([
      {
        name: "动效",
        kind: "动效",
        for: "换一屏",
        values: [{ name: "换一条", ms: 180, effect: "淡入" }],
      },
      {
        name: "状态标签",
        kind: "表格",
        for: "队列看板的小卡",
        columns: [{ name: "状态" }, { name: "标签", as: "加粗" }],
        rows: [[{ text: "等待", tone: "等待" }, ""]],
      },
    ]);
  });

  it("场景的一步 see 改名为 expect、src 改名为 img；场景名查得到的补上场景编号", () => {
    const scenes = [
      {
        name: "验收更改",
        mark: "改过",
        steps: [{ do: "点更改", see: "改前改后", src: "img/s2.png" }],
      },
      { name: "看队列", steps: [{ do: "点队列", see: "五列看板" }] },
    ];
    const conversion = convert(oldPage("构思", { scenes }));
    expect(conversion.page.scenes).toEqual([
      {
        scene: "S2",
        name: "验收更改",
        mark: "改过",
        steps: [{ do: "点更改", expect: "改前改后", img: "img/s2.png" }],
      },
      { name: "看队列", steps: [{ do: "点队列", expect: "五列看板" }] },
    ]);
    expect(conversion.problems).toEqual([]);
  });
});

// ---- 卡片的旧写法

describe("卡片的旧写法照旧模板的显示转换", () => {
  it("没有来源的卡，saw 转成一条名为「看到」的来源", () => {
    const old = { title: ask.title, why: ask.why, saw: "正文的写法规矩那一节。" };
    const conversion = convert(oldPage("检查", { asks: [old] }));
    expect(conversion.page.asks).toEqual([
      {
        title: ask.title,
        why: ask.why,
        sources: [{ name: "看到", saw: "正文的写法规矩那一节。" }],
      },
    ]);
    expect(notesOf(conversion, "sawSource")).toEqual([
      {
        path: ["asks", 0, "saw"],
        change: "sawSource",
        old: "正文的写法规矩那一节。",
        now: ["asks", 0, "sources", 0],
      },
    ]);
  });

  it("已经有来源的卡，saw 删掉，写进备注", () => {
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, saw: "旧的一段话。" }] }));
    expect(conversion.page.asks).toEqual([ask]);
    expect(notesOf(conversion, "cardSaw")).toEqual([
      { path: ["asks", 0, "saw"], change: "cardSaw", old: "旧的一段话。" },
    ]);
  });

  it("选项只写了 see 的卡，see 转成「结果」一行的差别，rows 放在选项前面", () => {
    const options = [
      { key: "a", title: "做法 a", see: "改完看到 a。", why: "理由 a。" },
      { key: "b", title: "不改", see: "" },
    ];
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, options }] }));
    const [card] = conversion.page.asks as Record<string, unknown>[];
    expect(Object.keys(card ?? {}).slice(-2)).toEqual(["rows", "options"]);
    expect(card).toMatchObject({
      rows: ["结果"],
      options: [
        { key: "a", title: "做法 a", diffs: ["改完看到 a。"], why: "理由 a。" },
        { key: "b", title: "不改" },
      ],
    });
    expect(notesOf(conversion, "seeDiffs")).toEqual([
      {
        path: ["asks", 0, "options", 0, "see"],
        change: "seeDiffs",
        old: "改完看到 a。",
        now: ["asks", 0, "options", 0, "diffs", 0],
      },
    ]);
    // 没写 see 的选项缺差别，两个选项的卡缺共同的部分，由定义报出来。
    expect(conversion.problems.map((p) => p.check)).toEqual(["page.field.missing"]);
  });

  it("已经写了 rows 的卡，选项里剩下的 see 删掉", () => {
    const options = [{ key: "a", title: "做法 a", diffs: ["改完看到 a。"], see: "旧的结果。" }];
    const card = { ...ask, rows: ["页面上的变化"], options, only: true };
    const conversion = convert(oldPage("检查", { asks: [card] }));
    expect(conversion.page.asks).toMatchObject([{ options: [{ diffs: ["改完看到 a。"] }] }]);
    expect(notesOf(conversion, "optionSee")).toEqual([
      { path: ["asks", 0, "options", 0, "see"], change: "optionSee", old: "旧的结果。" },
    ]);
  });

  it("来源的旧写法：label 换成 name，excerpt 换成 saw，src 换成 img，kind 删掉", () => {
    const sources = [
      { label: "第 1 轮看到那一行", kind: "shot", src: "report-img/r1.jpg" },
      { label: "第 3 轮第 7 条原文", kind: "file", excerpt: "规范只留 12、14、16。" },
      { name: "主线", label: "主线的任务", saw: "三件事。" },
    ];
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, sources }] }));
    expect(conversion.page.asks).toMatchObject([
      {
        sources: [
          { name: "第 1 轮看到那一行", img: "report-img/r1.jpg" },
          { name: "第 3 轮第 7 条原文", saw: "规范只留 12、14、16。" },
          { name: "主线", saw: "三件事。" },
        ],
      },
    ]);
    expect(notesOf(conversion, "sourceOldForm")).toEqual([
      { path: ["asks", 0, "sources", 0, "kind"], change: "sourceOldForm", old: "shot" },
      { path: ["asks", 0, "sources", 1, "kind"], change: "sourceOldForm", old: "file" },
      { path: ["asks", 0, "sources", 2, "label"], change: "sourceOldForm", old: "主线的任务" },
    ]);
  });

  it("早已不显示的 side、prior、impact 删掉，写进备注", () => {
    const hidden = {
      side: { note: "右边的说明。" },
      prior: [{ id: 41, text: "功能不在场景里先当覆盖缺口。" }],
      impact: [{ row: "工作台", scenarios: [4] }],
    };
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, ...hidden }] }));
    expect(conversion.page.asks).toEqual([ask]);
    expect(notesOf(conversion, "hiddenFields").map((note) => [note.path.at(-1), note.old])).toEqual(
      [
        ["side", hidden.side],
        ["prior", hidden.prior],
        ["impact", hidden.impact],
      ],
    );
  });

  it.each([
    ["站 a。\n七轮都是一个人加 AI。", { pick: "a", because: "七轮都是一个人加 AI。" }],
    ["我站 b。因为用户只关心完了没有。", { pick: "b", because: "用户只关心完了没有。" }],
    ["我的看法是 a，除非你用过。", { pick: "a", because: "除非你用过。" }],
    ["站 a。", { pick: "a" }],
    ["两种都行。", { because: "两种都行。" }],
  ])("看法写成一句话「%s」，按旧模板的读法拆开", (stance, parsed) => {
    const conversion = convert(oldPage("检查", { asks: [{ ...ask, stance }] }));
    expect(conversion.page.asks).toEqual([{ ...ask, stance: parsed }]);
    expect(notesOf(conversion, "stanceText")).toEqual([
      {
        path: ["asks", 0, "stance"],
        change: "stanceText",
        old: stance,
        now: ["asks", 0, "stance"],
      },
    ]);
  });

  it("只写 true 的标记写成 false 的删掉；空字符串、空数组和 null 删掉", () => {
    const card = {
      ...ask,
      tag: "",
      design: false,
      options: [],
      sources: [{ ...ask.sources[0], outside: false }],
      research: null,
    };
    const conversion = convert(oldPage("检查", { asks: [card], findings: [] }));
    expect(conversion.page).toEqual({ asks: [ask] });
    expect(conversion.notes.slice(1).map((note) => [note.path.join("."), note.change])).toEqual([
      ["asks.0.sources.0.outside", "trueFlags"],
      ["asks.0.tag", "emptyValues"],
      ["asks.0.design", "trueFlags"],
      ["asks.0.options", "emptyValues"],
      ["asks.0.research", "emptyValues"],
      ["findings", "emptyValues"],
    ]);
  });
});

// ---- 回到构思

describe("回到构思转成标着「回到构思」的疑问卡（第一期约定第 8 条）", () => {
  const rethink = {
    title: "设计规范「悬停一律灰底加深边」这一句",
    tag: "设计规范 交互",
    why: "代码里有三种悬停。",
    saw: "设计规范的交互一行。",
    where: { scenario: 2, step: 1, title: "验收更改", stepText: "点更改" },
    queueRow: "设计规范补上状态这一样",
  };

  it("接在疑问后面，标签换成「回到构思」，里面的字段按疑问卡转换", () => {
    const conversion = convert(oldPage("修复", { asks: [ask], rethink: [rethink] }));
    expect(conversion.stage).toBe("land");
    expect(conversion.page).toEqual({
      asks: [
        ask,
        {
          title: rethink.title,
          tag: "回到构思",
          why: rethink.why,
          sources: [{ name: "看到", saw: rethink.saw }],
          where: { scene: "S2", step: 1 },
          queue: ["Q3"],
        },
      ],
    });
    expect(conversion.problems).toEqual([]);
  });

  it("备注写明挪到了哪里，原来的标签删掉；里面字段的备注写着新旧两个位置", () => {
    const conversion = convert(oldPage("修复", { asks: [ask], rethink: [rethink] }));
    expect(notesOf(conversion, "rethinkAsk")).toEqual([
      { path: ["rethink", 0], change: "rethinkAsk", old: rethink, now: ["asks", 1] },
      { path: ["rethink", 0, "tag"], change: "rethinkAsk", old: "设计规范 交互" },
    ]);
    expect(notesOf(conversion, "whereText")[0]).toEqual({
      path: ["rethink", 0, "where", "title"],
      change: "whereText",
      old: "验收更改",
      now: ["asks", 1, "where", "scene"],
    });
  });

  it("没有疑问时成为第一张疑问卡；没写标签的，标签放在标题后面", () => {
    const { tag: _tag, ...untagged } = rethink;
    const { page } = convert(oldPage("修复", { asks: [], rethink: [untagged] }));
    const [card] = page.asks as Record<string, unknown>[];
    expect(Object.keys(card ?? {}).slice(0, 2)).toEqual(["title", "tag"]);
    expect(card?.tag).toBe("回到构思");
  });

  it("疑问写坏了接不上时，回到构思整个写进备注", () => {
    const conversion = convert(oldPage("修复", { asks: { title: "一条" }, rethink: [rethink] }));
    expect(notesOf(conversion, "rethink")).toEqual([
      { path: ["rethink"], change: "rethink", old: [rethink] },
    ]);
  });
});

// ---- 转换以后的校验

describe("转换以后按这一阶段的定义校验，问题和转换时的问题放在一起", () => {
  it("不在对照表里的字段原样留下，由定义报出来", () => {
    const options = [{ key: "a", title: "做法 a", diffs: ["一格。"], mock: "<div>线稿</div>" }];
    const card = {
      ...ask,
      rows: ["变化"],
      options,
      only: true,
      dropped: [{ name: "b", because: "c" }],
    };
    const conversion = convert(oldPage("提升", { asks: [card] }));
    expect(conversion.page.asks).toMatchObject([{ options: [{ mock: "<div>线稿</div>" }] }]);
    expect(conversion.problems.map((p) => [p.check, p.path.join(".")])).toEqual([
      ["page.field.unknown", "asks.0.options.0.mock"],
    ]);
  });

  it("这一阶段不能写的发现问题和提升挪进疑问，标签写原来区块的名字", () => {
    const improvement = { ...finding, title: "队列看板加一个筛选", tag: "看板" };
    const conversion = convert(
      oldPage("落地", { asks: [ask], findings: [finding], improvements: [improvement] }),
    );
    expect(conversion.page.findings).toBeUndefined();
    expect(conversion.page.improvements).toBeUndefined();
    expect(conversion.page.asks).toMatchObject([
      { title: ask.title },
      { title: finding.title, tag: "发现问题", where: { scene: "S1", step: 2 } },
      { title: "队列看板加一个筛选", tag: "提升" },
    ]);
    expect(notesOf(conversion, "sectionAsk").map((note) => note.path)).toEqual([
      ["findings", 0],
      ["improvements", 0],
      ["improvements", 0, "tag"],
    ]);
    expect(conversion.problems).toEqual([]);
  });

  it("这一阶段能写的发现问题照旧留着", () => {
    const conversion = convert(oldPage("检查", { findings: [finding] }));
    expect(conversion.page.findings).toMatchObject([{ where: { scene: "S1", step: 2 } }]);
    expect(conversion.page.asks).toBeUndefined();
  });

  it("每条问题的 check 都是文案表里一条报错的键", () => {
    const keys = new Set(allCopy().map((item) => item.key));
    const old = oldPage("检查", {
      findings: [{ ...finding, where: { scenario: 7, step: 1 }, queueRow: "首页的卡片改成" }],
      changes: [{ title: "首页改成列表" }],
    });
    const { problems } = convert(old);
    expect(problems.length).toBeGreaterThanOrEqual(3);
    for (const { check } of problems) expect(keys.has(`${check}.message`), check).toBe(true);
  });
});

describe("转换本身", () => {
  const old = oldPage("修复", {
    asks: [{ ...ask, stance: "站 a。" }],
    findings: [{ ...finding, queueRow: ["首页的卡片改成列表"] }],
    rethink: [{ ...ask, title: "回到构思的一张" }],
  });

  it("不改动传入的数据", () => {
    const before = JSON.stringify(old);
    convert(old);
    expect(JSON.stringify(old)).toBe(before);
  });

  it("同样的输入得到同样的结果", () => {
    expect(convert(old)).toEqual(convert(old));
  });

  it("旧页面上的字，要么还在新页面数据里，要么在备注里", () => {
    expect(lostTexts(old, convert(old))).toEqual([]);
  });
});

describe("备注写成一句话，列给 AI 核对", () => {
  it.each([
    [
      "删掉的写明删掉了哪里",
      { path: ["findings", 0, "where", "stepText"], change: "whereText", old: "读第一条" },
      "转换时删掉了 findings[0].where.stepText。场景名和这一步的文字由命令从主线填，删掉 title 和 stepText。",
    ],
    [
      "挪动的写明挪到了哪里",
      { path: ["rethink", 0], change: "rethinkAsk", old: {}, now: ["asks", 2] },
      "rethink[0] 转换以后在 asks[2]。回到构思的卡转成疑问卡，标签写「回到构思」，原来的标签不留。",
    ],
  ] satisfies [string, LegacyNote, string][])("%s，再写上依据", (_why, note, text) => {
    expect(legacyNoteText(note)).toBe(text);
  });

  it("每一种依据写成的句子都通过写作校验", () => {
    const changes = [
      ...formatChanges.map((change) => change.key),
      "stanceText",
      "rethinkAsk",
      "sawSource",
      "seeDiffs",
    ] as const;
    const blocked = changes.flatMap((change) => {
      const removed: LegacyNote = { path: ["asks", 0, "saw"], change, old: "" };
      const moved: LegacyNote = { ...removed, now: ["asks", 1] };
      return [removed, moved]
        .map(legacyNoteText)
        .flatMap((text) => checkWriting(text).block.map((x) => `${text}：${x.message}`));
    });
    expect(blocked).toEqual([]);
  });
});
