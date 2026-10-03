import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { queueCopy, replyCopy } from "./copy/records.ts";
import { decisionCreateSchema } from "./decision.ts";
import { defineEnum, type KeyOf } from "./enum.ts";
import {
  type Destination,
  destination,
  type ReplyLineKind,
  replyLineKind,
  stage,
} from "./names.ts";
import { pageSection } from "./page/section-names.ts";
import { nonBlankText, queueIdSchema, queueItemCreateSchema, roundLabelSchema } from "./queue.ts";

// 回复的一行和它的去处，见「03 数据模型」第二节「页面和回复」。
// 去处有五种，各自指向不同的东西：
// - 主线：改后的主线版本，和改的是哪一样。
// - 决定：决定的编号。
// - 队列：队列事项的编号。
// - 当场做：轮次，以及完成证据。
// - 不处理：原因，必填。
// 处理回复的输入写成 [{line, to, …}]，每种去处带自己的字段（第一期约定第 10 条）。
// `ploop reply handle --file` 读这个格式，逐行写的参数是它的简写。

const timestamp = z.iso.datetime({ offset: true });

/** 附件的哈希：SHA-256，写成六十四位小写十六进制，见「05 接口」第七节。 */
const blobHash = z.string().regex(/^[0-9a-f]{64}$/u);

/**
 * 去处的字面量：接口上写中文，解码以后是英文键，见「05 接口」第一节。
 * 写成函数，去处的键拼错时类型检查报错。
 */
const to = <D extends Destination>(key: D) => {
  const label = destination.label(key);
  return z.codec(z.literal(label), z.literal(key), { decode: () => key, encode: () => label });
};

/** 去处不是五种之一时的报错。别的错照常报。 */
const destinationError = {
  error: (issue: { readonly code?: string }) =>
    issue.code === "invalid_union"
      ? renderCopy(replyCopy.unknownDestination, { labels: destination.labels.join("、") })
      : undefined,
};

const part = nonBlankText(replyCopy.field.part);
const evidence = nonBlankText(queueCopy.field.evidence);
const reason = nonBlankText(replyCopy.field.reason);

/** 一行处理以后的去处，和它指向的东西。 */
export const replyDestinationSchema = z.discriminatedUnion(
  "to",
  [
    z.strictObject({ to: to("mainline"), revision: z.int().min(1), part }),
    z.strictObject({ to: to("decision"), id: z.int().min(1) }),
    z.strictObject({ to: to("queue"), id: queueIdSchema }),
    z.strictObject({ to: to("doneHere"), round: roundLabelSchema, evidence }),
    z.strictObject({ to: to("noAction"), reason }),
  ],
  destinationError,
);
export type ReplyDestination = z.infer<typeof replyDestinationSchema>;

/**
 * 回复的一行来自哪个区块。页面数据里有卡的区块之外，另有后端摆出的两块：
 * 看板上的队列，和这个阶段开始时取消的事。见 legacy/reply-text.ts 的 LegacyReplySection。
 * 数据库里存英文键，接口上写中文，见约定 0002 第 1 条。
 */
export const replySection = defineEnum({
  align: pageSection.label("align"),
  scenes: pageSection.label("scenes"),
  spec: pageSection.label("spec"),
  asks: pageSection.label("asks"),
  findings: pageSection.label("findings"),
  improvements: pageSection.label("improvements"),
  changes: pageSection.label("changes"),
  queue: "队列看板",
  droppedAtStart: "取消的事",
});
export type ReplySection = KeyOf<typeof replySection>;

/** 要写备注的几种行：只写了备注的，和想法。 */
const kindsNeedingNote: readonly ReplyLineKind[] = ["noteOnly", "idea"];

/**
 * 回复的一行：回复按行拆开以后，一行一件事。取消队列事项和认可更改由后端在收到回复时处理，
 * 其余的，包括想法框里的话，由 AI 用 `ploop reply handle` 逐行处理。处理以后才有 handled。
 */
export const replyLineSchema = z
  .strictObject({
    /** 哪一份回复，写后端生成的全局编号。 */
    submission: z.int().min(1),
    /** 行号，从 1 数。 */
    line: z.int().min(1),
    /** 这一行来自页面的哪个区块、哪张卡。想法框里的行没有。 */
    section: replySection.codec.optional(),
    card: nonBlankText(replyCopy.field.card).optional(),
    /**
     * 这张卡的标题。后端读出这一行时从页面里取，存的时候没有它。
     * 卡片的编号是后端按标题生成的，用户和 AI 都读不出是哪一张，命令行的每一行写标题。
     */
    cardTitle: z.string().min(1).optional(),
    kind: replyLineKind.codec,
    /** 选的选项。种类是选了选项时必填。 */
    option: nonBlankText(replyCopy.field.option).optional(),
    /** 取消的是哪一件队列事项。种类是取消队列事项时必填。 */
    queue: queueIdSchema.optional(),
    note: nonBlankText(replyCopy.field.note).optional(),
    /** 这一行带的图，写附件的哈希。 */
    images: z.array(blobHash),
    /** 处理这一行之前，AI 已经读过它带的图。 */
    imagesRead: z.boolean(),
    handled: z
      .strictObject({
        destination: replyDestinationSchema,
        at: timestamp,
        /** 执行者，例如 cli/2.0.0。后端自动处理的行写后端。 */
        by: nonBlankText(queueCopy.field.actor),
      })
      .optional(),
  })
  .superRefine((replyLine, ctx) => {
    if (replyLine.kind === "option" && replyLine.option === undefined) {
      const message = renderCopy(replyCopy.line.optionMissing);
      ctx.addIssue({ code: "custom", path: ["option"], message });
    }
    if (replyLine.kind === "queueDrop" && replyLine.queue === undefined) {
      const message = renderCopy(replyCopy.line.queueMissing);
      ctx.addIssue({ code: "custom", path: ["queue"], message });
    }
    if (kindsNeedingNote.includes(replyLine.kind) && replyLine.note === undefined) {
      const kind = replyLineKind.label(replyLine.kind);
      const message = renderCopy(replyCopy.line.noteMissing, { kind });
      ctx.addIssue({ code: "custom", path: ["note"], message });
    }
  });
export type ReplyLine = z.infer<typeof replyLineSchema>;

// ── 处理回复的输入 ──

// 每种去处都有这两项。line 是处理的第几行，必填。
// imagesRead 可以不写。这一行带图时写 true，表示已经读过图。命令行的 --read-images 给每一行写上它。
const lineNumber = z.int().min(1);
const imagesRead = z.boolean().optional();

/**
 * 去处是队列的一行，两种写法只写一种：
 * - id：指已有的一件。它是这一轮开始时取消的，用户又在回复里点名，就捞回待办，编号不变。
 *   再写 stage，就把要做它的阶段改成 stage：一个想法从提出到做完始终是同一件事，编号不变。
 * - item：放进一件新的，字段和 `ploop queue add` 相同，阶段写在 item 里。
 */
const queueEntrySchema = z
  .strictObject({
    line: lineNumber,
    to: to("queue"),
    id: queueIdSchema.optional(),
    stage: stage.codec.optional(),
    item: queueItemCreateSchema.optional(),
    imagesRead,
  })
  .superRefine((entry, ctx) => {
    if (entry.id === undefined && entry.item === undefined) {
      const message = renderCopy(replyCopy.handle.queueTargetMissing);
      ctx.addIssue({ code: "custom", path: [], message });
    } else if (entry.id !== undefined && entry.item !== undefined) {
      const message = renderCopy(replyCopy.handle.queueTargetBoth);
      ctx.addIssue({ code: "custom", path: ["item"], message });
    } else if (entry.stage !== undefined && entry.item !== undefined) {
      const message = renderCopy(replyCopy.handle.queueStageWithItem);
      ctx.addIssue({ code: "custom", path: ["stage"], message });
    }
  });

/**
 * 处理一行：`[{line, to, …}]` 里的一项。去处是决定或队列时，后端当场建出决定或队列事项。
 * 去处是主线时，主线要已经有了新版本。版本不写就指最新的一版。
 * 当场做的轮次由后端填，这里只写完成证据。
 */
export const replyHandleEntrySchema = z.discriminatedUnion(
  "to",
  [
    z.strictObject({
      line: lineNumber,
      to: to("mainline"),
      part,
      revision: z.int().min(1).optional(),
      imagesRead,
    }),
    z.strictObject({
      line: lineNumber,
      to: to("decision"),
      ...decisionCreateSchema.shape,
      imagesRead,
    }),
    queueEntrySchema,
    z.strictObject({ line: lineNumber, to: to("doneHere"), evidence, imagesRead }),
    z.strictObject({ line: lineNumber, to: to("noAction"), reason, imagesRead }),
  ],
  destinationError,
);
export type ReplyHandleEntry = z.infer<typeof replyHandleEntrySchema>;

/** 处理回复的输入：一到多行，同一行只能出现一次。 */
export const replyHandleInputSchema = z
  .array(replyHandleEntrySchema)
  .min(1, { error: renderCopy(replyCopy.handle.empty) })
  .superRefine((entries, ctx) => {
    const seen = new Map<number, number>();
    entries.forEach((entry, i) => {
      const count = (seen.get(entry.line) ?? 0) + 1;
      seen.set(entry.line, count);
      if (count === 2) {
        const total = entries.filter((other) => other.line === entry.line).length;
        const message = renderCopy(replyCopy.handle.duplicateLine, {
          line: entry.line,
          count: total,
        });
        ctx.addIssue({ code: "custom", path: [i, "line"], message });
      }
    });
  });
export type ReplyHandleInput = z.infer<typeof replyHandleInputSchema>;
