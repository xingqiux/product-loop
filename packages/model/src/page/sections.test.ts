import { describe, expect, it } from "vitest";
import type { z } from "zod";
import * as model from "../index.ts";
import { cardIdFromTitle } from "./card-id.ts";
import { pageIssueParams } from "./issue.ts";
import { validPage, withValue } from "./page.samples.ts";
import { pageSection } from "./section-names.ts";
import {
  assignCardIds,
  type CardItem,
  cardSections,
  cardTitle,
  type PageSections,
  pageSectionShape,
  pageSectionsSchema,
} from "./sections.ts";

const parsed: PageSections = pageSectionsSchema.parse(validPage);

/** 页面里全部有编号的项，按生成编号的顺序。 */
function cardItems(sections: PageSections): CardItem[] {
  return (Object.keys(cardSections) as (keyof typeof cardSections)[]).flatMap(
    (section): readonly CardItem[] => sections[section] ?? [],
  );
}

function firstIssue(issues: readonly z.core.$ZodIssue[]): z.core.$ZodIssue {
  const [first] = issues;
  if (first === undefined) throw new Error("没有问题");
  return first;
}

/** 取样本里的一项，没有就说明样本改坏了。 */
function sampleItem<T>(item: T | undefined): T {
  if (item === undefined) throw new Error("样本里缺这一项");
  return item;
}

describe("区块", () => {
  it("每个区块都有定义，顺序和工作台上的区块相同", () => {
    expect(Object.keys(pageSectionShape)).toEqual(pageSection.keys);
  });

  it("有编号的区块是 AI 写的区块的一部分，参考和元素清单没有编号", () => {
    const keys = Object.keys(cardSections);
    expect(keys.every((key) => pageSection.isKey(key))).toBe(true);
    expect(keys).not.toContain("refs");
    expect(keys).not.toContain("screens");
  });

  it("前缀不重复，都合乎编号的写法", () => {
    const prefixes = Object.values(cardSections).map((section) => section.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const prefix of prefixes) expect(model.isCardId(prefix)).toBe(true);
  });

  it("九个区块都可以不写", () => {
    expect(pageSectionsSchema.safeParse({}).success).toBe(true);
  });

  it("从包的入口能取到页面的定义", () => {
    expect(model.pageSectionsSchema).toBe(pageSectionsSchema);
    expect(model.assignCardIds).toBe(assignCardIds);
  });
});

describe("卡片编号在本页唯一", () => {
  it("重复的每一处都报，写明先用在哪一项上", () => {
    const page = withValue(
      withValue(validPage, ["changes", 0, "id"], "queue-board"),
      ["align", 0, "id"],
      "queue-board",
    );
    const issues = pageSectionsSchema.safeParse(page).error?.issues ?? [];
    expect(issues.map((issue) => issue.path)).toEqual([
      ["asks", 0, "id"],
      ["changes", 0, "id"],
    ]);
    expect(issues.map((issue) => issue.message)).toEqual([
      "卡片编号「queue-board」已经用在「信息结构」上。",
      "卡片编号「queue-board」已经用在「信息结构」上。",
    ]);
    expect(pageIssueParams(firstIssue(issues))).toEqual({
      check: "page.cardId.duplicate",
      hint: "一页里的卡片编号不能重复。改掉后面的编号，或者删掉它，由命令按标题生成。",
    });
  });

  it("别处有类型错误时也查重复", () => {
    const page = withValue(
      withValue(validPage, ["changes", 0, "id"], "queue-board"),
      ["findings", 0, "title"],
      42,
    );
    const paths = (pageSectionsSchema.safeParse(page).error?.issues ?? []).map((i) => i.path);
    expect(paths).toContainEqual(["findings", 0, "title"]);
    expect(paths).toContainEqual(["changes", 0, "id"]);
  });

  it("数据不是对象时只报类型", () => {
    const issues = pageSectionsSchema.safeParse(["asks"]).error?.issues ?? [];
    expect(issues.map((issue) => issue.code)).toEqual(["invalid_type"]);
  });

  it("没写编号的两项标题相同，定义照样通过，编号由命令生成时错开", () => {
    const page = withValue(validPage, ["asks", 2], validPage.asks[1]);
    expect(pageSectionsSchema.safeParse(page).success).toBe(true);
  });
});

describe("按标题生成编号", () => {
  const filled = assignCardIds(parsed);

  it("写了的编号原样保留", () => {
    expect(filled.asks?.[0]?.id).toBe("queue-board");
    expect(filled.scenes?.[0]?.id).toBe("look-at-queue");
    expect(filled.changes?.[0]?.id).toBe("option-when");
  });

  it("没写的按区块的前缀和标题生成", () => {
    expect(filled.asks?.[1]?.id).toBe(cardIdFromTitle("ask", "上次你自己做这件事是什么时候"));
    expect(filled.scenes?.[1]?.id).toBe(cardIdFromTitle("scene", "看主线"));
    expect(filled.spec?.[1]?.id).toBe(cardIdFromTitle("spec", "状态标签"));
    expect(filled.align?.[0]?.id).toBe(cardIdFromTitle("align", "信息结构"));
    expect(filled.findings?.[0]?.id).toBe(
      cardIdFromTitle("finding", "每一块名字下面的说明没有必要"),
    );
    expect(filled.improvements?.[0]?.id).toBe(cardIdFromTitle("improvement", "队列看板加一个筛选"));
    expect(filled.changes?.[1]?.id).toBe(cardIdFromTitle("change", "正文的写法改成四句"));
  });

  it("每一项都有编号，互不重复，结果仍然合乎定义", () => {
    const ids = cardItems(filled).map((item) => item.id);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // 结果里的枚举是英文键，编码回页面数据的写法再查。
    const encoded = pageSectionsSchema.safeEncode(filled);
    expect(encoded.error?.issues).toBeUndefined();
    expect(pageSectionsSchema.safeParse(encoded.data).data).toEqual(filled);
  });

  it("只加编号，别的不变，原来的数据也不改", () => {
    const before = JSON.stringify(parsed);
    assignCardIds(parsed);
    expect(JSON.stringify(parsed)).toBe(before);
    for (const section of Object.keys(cardSections) as (keyof typeof cardSections)[]) {
      const original = parsed[section] ?? [];
      (filled[section] ?? []).forEach((item, i) => {
        expect(item).toEqual({ ...original[i], id: item.id });
      });
    }
  });

  it("同一份数据算多少次都得到同样的编号", () => {
    const again = assignCardIds(pageSectionsSchema.parse(JSON.parse(JSON.stringify(validPage))));
    expect(again).toEqual(filled);
  });

  it("同一个区块里标题相同的，后面的加 -2、-3", () => {
    const card = sampleItem(parsed.asks?.[1]);
    const result = assignCardIds({ asks: [card, card, card] });
    const base = cardIdFromTitle("ask", card.title);
    expect(result.asks?.map((item) => item.id)).toEqual([base, `${base}-2`, `${base}-3`]);
  });

  it("生成的编号撞上写了的编号时，让给写了的", () => {
    const card = sampleItem(parsed.asks?.[1]);
    const base = cardIdFromTitle("ask", card.title);
    const change = sampleItem(parsed.changes?.[0]);
    const result = assignCardIds({ asks: [card], changes: [{ ...change, id: base }] });
    expect(result.asks?.[0]?.id).toBe(`${base}-2`);
    expect(result.changes?.[0]?.id).toBe(base);
  });

  it("不同区块的同名项，前缀不同，编号不同", () => {
    const result = assignCardIds({
      align: [{ name: "看队列", usedIn: ["看队列"], meaning: "意思。", example: "例子。" }],
      scenes: [{ name: "看队列", steps: [{ do: "点队列", expect: "看板" }] }],
    });
    expect(result.align?.[0]?.id).toBe(cardIdFromTitle("align", "看队列"));
    expect(result.scenes?.[0]?.id).toBe(cardIdFromTitle("scene", "看队列"));
  });

  it("没有编号的区块原样保留", () => {
    expect(filled.refs).toEqual(parsed.refs);
    expect(filled.screens).toEqual(parsed.screens);
  });
});

describe("一项的标题", () => {
  it("卡片和更改取 title，场景、规范和先对齐取 name", () => {
    expect(cardItems(parsed).map(cardTitle)).toEqual([
      "信息结构",
      "看队列",
      "看主线",
      "配色",
      "状态标签",
      "队列看板放在哪里",
      "上次你自己做这件事是什么时候",
      "每一块名字下面的说明没有必要",
      "队列看板加一个筛选",
      "选项多一格适用场景",
      "正文的写法改成四句",
    ]);
  });
});
