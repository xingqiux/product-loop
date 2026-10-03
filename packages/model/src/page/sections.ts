import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { alignTermSchema } from "./align.ts";
import { askCardSchema, findingCardSchema, improvementCardSchema } from "./card.ts";
import { cardIdFromTitle } from "./card-id.ts";
import { changeCardSchema } from "./change.ts";
import { reportIssue } from "./issue.ts";
import { refSchema } from "./ref.ts";
import { sceneDraftSchema } from "./scene.ts";
import { screenEntrySchema } from "./screen.ts";
import { type PageSection, pageSection } from "./section-names.ts";
import { specDraftSchema } from "./spec.ts";

// 页面数据里 AI 写的各个区块，见「07 校验」第二节。
// 哪个阶段能写哪几个区块，见 stages.ts。这里的 pageSectionsSchema 不分阶段，九个区块都收，
// 给不看阶段的地方用，例如按标题生成编号。校验一页的页面数据，用 stages.ts 里按阶段的定义。

/** 每个区块是一个数组，至少一项。没有内容的区块不写这个字段。 */
export const pageSectionShape = {
  align: z.array(alignTermSchema).min(1),
  scenes: z.array(sceneDraftSchema).min(1),
  spec: z.array(specDraftSchema).min(1),
  asks: z.array(askCardSchema).min(1),
  findings: z.array(findingCardSchema).min(1),
  improvements: z.array(improvementCardSchema).min(1),
  changes: z.array(changeCardSchema).min(1),
  refs: z.array(refSchema).min(1),
  screens: z.array(screenEntrySchema).min(1),
} satisfies Record<PageSection, z.ZodType>;

/**
 * 有卡片编号的区块：用户要在上面点选项、同意、保留或写备注的，草稿和回复按编号记。
 * prefix 是按标题生成编号时的前缀。顺序就是页面上的顺序，也是生成编号时的顺序。
 * 参考和元素清单没有编号：参考只给人看，元素清单不在页面上显示。
 */
export const cardSections = {
  align: { prefix: "align" },
  scenes: { prefix: "scene" },
  spec: { prefix: "spec" },
  asks: { prefix: "ask" },
  findings: { prefix: "finding" },
  improvements: { prefix: "improvement" },
  changes: { prefix: "change" },
} as const satisfies Partial<Record<PageSection, { readonly prefix: string }>>;

export type CardSection = keyof typeof cardSections;

const cardSectionKeys = Object.keys(cardSections) as CardSection[];

/** 一页上有几张卡：先对齐、场景、设计规范、疑问、发现、提升和更改各项相加。参考和元素清单不是卡。 */
export function countCards(sections: PageSections): number {
  return cardSectionKeys.reduce((sum, section) => sum + (sections[section]?.length ?? 0), 0);
}

/** 页面数据里这几个区块的定义，每个区块都可以不写。 */
export type SectionsShape<K extends PageSection> = {
  readonly [S in K]: z.ZodOptional<(typeof pageSectionShape)[S]>;
};

/**
 * 只收给出的几个区块的页面数据：严格的对象，每个区块都可以不写，另查卡片编号在本页唯一。
 * 区块按给出的顺序排，导出 JSON Schema 时每个区块带着它在工作台上的名字。
 */
export function sectionsSchema<const K extends PageSection>(sections: readonly K[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const section of sections) {
    const description = renderCopy(pageFieldCopy.section[section]);
    shape[section] = pageSectionShape[section].optional().meta({ description });
  }
  return (
    z
      .strictObject(shape as SectionsShape<K>)
      // 别处有错时也查，一次报出全部问题。所以这里读的数据可能不合定义，逐项先看类型。
      .superRefine((value, ctx) => checkCardIds(value as Readonly<Record<string, unknown>>, ctx), {
        when: (payload) => isRecord(payload.value),
      })
  );
}

/** 九个区块都收、都可以不写的页面数据，不分阶段。 */
export const pageSectionsSchema = sectionsSchema(pageSection.keys);

export type PageSections = z.output<typeof pageSectionsSchema>;

/** 有编号的一项：卡片、更改，以及场景、规范和先对齐的每一项。 */
export type CardItem = NonNullable<PageSections[CardSection]>[number];

/** 一项的标题：卡片和更改写 title，场景、规范和先对齐写 name。 */
export function cardTitle(item: CardItem): string {
  return "title" in item ? item.title : item.name;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 写了的编号在本页唯一：从第二次出现起，每一处都报，并写明先用在哪一项上。 */
function checkCardIds(sections: Readonly<Record<string, unknown>>, ctx: z.RefinementCtx<unknown>) {
  const seen = new Map<string, string>();
  for (const section of cardSectionKeys) {
    const items = sections[section];
    if (!Array.isArray(items)) continue;
    items.forEach((item: unknown, i) => {
      if (!isRecord(item) || typeof item.id !== "string") return;
      const { id } = item;
      const first = seen.get(id);
      if (first !== undefined) {
        const values = { id, first };
        reportIssue(ctx, "page.cardId.duplicate", pageCopy.cardId.duplicate, values, [
          section,
          i,
          "id",
        ]);
        return;
      }
      const title = typeof item.title === "string" ? item.title : item.name;
      seen.set(id, typeof title === "string" ? title : `${section}[${i}]`);
    });
  }
}

type WithId<T> = T extends unknown ? T & { readonly id: string } : never;

/** 编号都已填好的页面数据。 */
export type WithCardIds<P extends PageSections> = {
  [K in keyof P]: K extends CardSection
    ? P[K] extends infer V
      ? V extends readonly (infer I)[]
        ? WithId<I>[]
        : V
      : never
    : P[K];
};

/**
 * 给没写编号的项按标题生成编号，写了的原样保留。页面数据要先通过定义，写了的编号已经唯一。
 *
 * 做法：先记下写了的全部编号。再按 cardSections 的顺序、每个区块里从前往后，
 * 用 cardIdFromTitle 算出编号。已经用过的，依次在后面加 -2、-3，直到没用过为止。
 * 结果只取决于页面数据本身，同一份数据在任何时候、任何机器上算出的编号都相同。
 */
export function assignCardIds<P extends PageSections>(sections: P): WithCardIds<P> {
  const used = new Set<string>();
  for (const section of cardSectionKeys) {
    for (const item of sections[section] ?? []) if (item.id !== undefined) used.add(item.id);
  }
  const result: Record<string, unknown> = { ...sections };
  for (const section of cardSectionKeys) {
    const items: readonly CardItem[] | undefined = sections[section];
    if (items === undefined) continue;
    const { prefix } = cardSections[section];
    result[section] = items.map((item) => {
      if (item.id !== undefined) return item;
      const base = cardIdFromTitle(prefix, cardTitle(item));
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      return { ...item, id };
    });
  }
  return result as WithCardIds<P>;
}
