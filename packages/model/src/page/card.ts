import { z } from "zod";
import { type CopyEntry, renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import { cardIdSchema } from "./card-id.ts";
import { evidenceSchema } from "./evidence.ts";
import {
  diagramsSchema,
  figureSchema,
  flagSchema,
  optionalText,
  queueRefsSchema,
  textSchema,
  whereSchema,
} from "./fields.ts";
import { reportIssue } from "./issue.ts";
import { type PageSection, pageSection } from "./section-names.ts";
import { sourcesSchema } from "./source.ts";

// 卡片：疑问、发现问题、提升三种，形状相同，差别只在几个字段，见旧格式的 README。
// 旧格式里的「回到构思」已删除，检查觉得定义不对时直接进队列标构思（决定 140）。
//
// 定义查字段在不在、类型和写法，也查几处对应关系：
// - 有选项就要有 rows，两个以上选项要有 shared。
// - 每个选项的 diffs 和 rows 一样多，选项的 key 不重复。
//
// 下面几条要看阶段、选项的位置，或者要讲道理，留给第 25 到 27 步的规则：
// - 理由、代价、适用场景什么时候必填。最后一个「不改」可以不写。
// - only 和 dropped。
// - 看法选的是不是真有的选项。
// - 行名的宽度和一格的长度。
// - 设计类的卡，调研分档的要求。

const optionKeyPattern = /^[a-z]$/u;

/** 线稿字段的说明：字段自己的一段，加上积木的类名清单。 */
function sketchText(own: CopyEntry): string {
  return `${renderCopy(own)}${renderCopy(pageFieldCopy.sketchPointer)}`;
}

/** 选项的 key：一个小写字母，依次写 a、b、c。回复里写成「疑问 1a」。 */
export const optionKeySchema = z
  .string()
  .superRefine((key, ctx) => {
    if (!optionKeyPattern.test(key)) {
      reportIssue(ctx, "page.card.keyShape", pageCopy.card.keyShape, { key });
    }
  })
  .meta({ pattern: optionKeyPattern.source });

/** 一个选项。共同的部分写在卡的 shared 里，选项只写差别，差别按 rows 一行对一行。 */
export const optionSchema = z
  .strictObject({
    key: optionKeySchema.describe(renderCopy(pageFieldCopy.option.key)),
    /** 一个名字，不超过 16 个字，不写成句子。 */
    title: textSchema.describe(renderCopy(pageFieldCopy.option.title)),
    /** 和卡上的 rows 一一对应，每格只写这个选项在这一处的做法。 */
    diffs: z.array(textSchema).min(1).describe(renderCopy(pageFieldCopy.option.diffs)),
    /** 理由。 */
    why: optionalText.describe(renderCopy(pageFieldCopy.option.why)),
    /** 代价：选它放弃了什么。 */
    cost: optionalText.describe(renderCopy(pageFieldCopy.option.cost)),
    /** 适用场景：什么情况下该选它。 */
    when: optionalText.describe(renderCopy(pageFieldCopy.option.when)),
    /** 低保真线稿的 HTML，或者一张草稿图的 img 标签。 */
    sketch: optionalText.describe(sketchText(pageFieldCopy.option.sketch)),
  })
  .meta({ id: "option" });

export type CardOption = z.output<typeof optionSchema>;

/** 我的看法：选哪个、因为什么。页面固定显示成「我的看法是 a / 因为……」两行。 */
export const stanceSchema = z
  .strictObject({
    pick: optionKeySchema.describe(renderCopy(pageFieldCopy.stance.pick)),
    because: textSchema.describe(renderCopy(pageFieldCopy.stance.because)),
  })
  .meta({ id: "stance" });

/** 想过、排除掉的方向。 */
export const droppedSchema = z
  .array(
    z.strictObject({
      name: textSchema.describe(renderCopy(pageFieldCopy.dropped.name)),
      because: textSchema.describe(renderCopy(pageFieldCopy.dropped.because)),
    }),
  )
  .min(1)
  .meta({ id: "dropped" });

/** 共同的部分：几个选项共同的内容只写一遍。 */
export const sharedSchema = z
  .strictObject({
    text: textSchema.describe(renderCopy(pageFieldCopy.shared.text)),
    diagrams: diagramsSchema.optional().describe(renderCopy(pageFieldCopy.shared.diagrams)),
  })
  .meta({ id: "shared" });

/** 调研分三档，见旧格式第十二版。页面数据里写中文，解析以后是英文键。 */
export const researchTier = defineEnum({ none: "不查", quick: "快查", deep: "深查" });
export type ResearchTier = KeyOf<typeof researchTier>;

/**
 * 调研：构思里带着外面看来的东西的疑问卡写明这一条是哪一档。不查要写 reason，
 * 深查要写 approved，也就是问句和计划是哪一轮批的。这两条和「什么时候必填」都由规则查。
 */
export const researchSchema = z.strictObject({
  tier: researchTier.codec.describe(renderCopy(pageFieldCopy.research.tier)),
  reason: optionalText.describe(renderCopy(pageFieldCopy.research.reason)),
  approved: optionalText.describe(renderCopy(pageFieldCopy.research.approved)),
});

/** 三种卡片所在的区块。报错时用区块名称呼一张卡，例如疑问「队列看板放在哪里」。 */
type CardBlock = Extract<PageSection, "asks" | "findings" | "improvements">;

/** 三种卡片共有的字段。 */
const cardShape = {
  /** 卡片编号，不写的由命令按标题生成。 */
  id: cardIdSchema.optional().describe(renderCopy(pageFieldCopy.card.id)),
  /** 这张卡处理的是哪几件队列事项，写编号。 */
  queue: queueRefsSchema.optional().describe(renderCopy(pageFieldCopy.card.queue)),
  title: textSchema.describe(renderCopy(pageFieldCopy.card.title)),
  /** 一个短语，这条属于哪一类，显示在标题旁边。 */
  tag: optionalText.describe(renderCopy(pageFieldCopy.card.tag)),
  /** 疑问卡是待决定的事，发现卡是哪里不舒服，提升卡是替用户解决什么。 */
  why: textSchema.describe(renderCopy(pageFieldCopy.card.why)),
  sources: sourcesSchema.describe(renderCopy(pageFieldCopy.card.sources)),
  /** 设计类的卡，只在构思阶段查外面的来源和草稿。 */
  design: flagSchema.describe(renderCopy(pageFieldCopy.card.design)),
  /** 选项。不写时这张卡只有备注框，用来追问。 */
  options: z.array(optionSchema).min(1).optional().describe(renderCopy(pageFieldCopy.card.options)),
  /** 选项之间有差别的地方，每处一个名称。 */
  rows: z.array(textSchema).min(1).optional().describe(renderCopy(pageFieldCopy.card.rows)),
  shared: sharedSchema.optional().describe(renderCopy(pageFieldCopy.card.shared)),
  /** 只有一个可行的方向：options 只放这一个，dropped 写排除掉的方向。 */
  only: flagSchema.describe(renderCopy(pageFieldCopy.card.only)),
  dropped: droppedSchema.optional().describe(renderCopy(pageFieldCopy.card.dropped)),
  stance: stanceSchema.optional().describe(renderCopy(pageFieldCopy.card.stance)),
  evidence: evidenceSchema.optional().describe(renderCopy(pageFieldCopy.card.evidence)),
  /** 一张图，直接显示在右边。 */
  image: figureSchema.optional().describe(renderCopy(pageFieldCopy.card.image)),
  /** 中保真线稿的 HTML，用 mk-* 积木写真文字。 */
  mock: optionalText.describe(sketchText(pageFieldCopy.card.mock)),
  /** 线稿下面的一句说明。 */
  mockCaption: optionalText.describe(renderCopy(pageFieldCopy.card.mockCaption)),
  /** 操作流程，画成一串带箭头的步骤。 */
  flow: z.array(textSchema).min(1).optional().describe(renderCopy(pageFieldCopy.card.flow)),
  diagrams: diagramsSchema.optional().describe(renderCopy(pageFieldCopy.card.diagrams)),
} as const;

type CardFields = {
  readonly title: string;
  readonly options?: readonly CardOption[] | undefined;
  readonly rows?: readonly string[] | undefined;
  readonly shared?: unknown;
  readonly mock?: string | undefined;
  readonly mockCaption?: string | undefined;
};

/** 三种卡片共同的对应关系。 */
function checkCard(section: CardBlock, card: CardFields, ctx: z.RefinementCtx<unknown>): void {
  const values = { section: pageSection.label(section), title: card.title };
  const options = card.options ?? [];
  if (options.length > 0 && card.rows === undefined) {
    reportIssue(ctx, "page.card.rowsMissing", pageCopy.card.rowsMissing, values, ["rows"]);
  }
  const keys = options.map((option) => option.key);
  options.forEach((option, i) => {
    const { key } = option;
    if (keys.indexOf(key) !== i) {
      reportIssue(ctx, "page.card.keyDuplicate", pageCopy.card.keyDuplicate, { key }, [
        "options",
        i,
        "key",
      ]);
    }
    const rows = card.rows?.length;
    if (rows !== undefined && option.diffs.length !== rows) {
      const counts = { key, diffs: option.diffs.length, rows };
      reportIssue(ctx, "page.card.diffsCount", pageCopy.card.diffsCount, counts, [
        "options",
        i,
        "diffs",
      ]);
    }
  });
  if (card.mockCaption !== undefined && card.mock === undefined) {
    reportIssue(ctx, "page.card.mockCaptionAlone", pageCopy.card.mockCaptionAlone, values, [
      "mockCaption",
    ]);
  }
}

/** 疑问：构思阶段用，别的阶段也可以问一件事。可以写位置，另有调研分档。 */
export const askCardSchema = z
  .strictObject({
    ...cardShape,
    where: whereSchema.optional().describe(renderCopy(pageFieldCopy.card.where)),
    research: researchSchema.optional().describe(renderCopy(pageFieldCopy.card.research)),
  })
  .superRefine((card, ctx) => checkCard("asks", card, ctx));

/** 发现问题：检查阶段用。位置必填，右边画出问题出现在哪个场景的哪一步。 */
export const findingCardSchema = z
  .strictObject({ ...cardShape, where: whereSchema.describe(renderCopy(pageFieldCopy.card.where)) })
  .superRefine((card, ctx) => checkCard("findings", card, ctx));

/** 提升：只在提升阶段用。位置必填，右边放线稿、效果图或操作流程。 */
export const improvementCardSchema = z
  .strictObject({ ...cardShape, where: whereSchema.describe(renderCopy(pageFieldCopy.card.where)) })
  .superRefine((card, ctx) => checkCard("improvements", card, ctx));

export type AskCard = z.output<typeof askCardSchema>;
export type FindingCard = z.output<typeof findingCardSchema>;
export type ImprovementCard = z.output<typeof improvementCardSchema>;
export type Card = AskCard | FindingCard | ImprovementCard;
