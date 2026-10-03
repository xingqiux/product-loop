import { z } from "zod";
import { decisionSchema } from "../decision.ts";
import { replyLineKind, roundStatus, submissionSource } from "../names.ts";
import { queueIdSchema, queueItemSchema, roundLabelSchema } from "../queue.ts";
import { replyLineSchema, replySection } from "../reply.ts";

// 回复的接口：提交、等回复、每一行和去处，路径见「05 接口」第四节和第六节。
// 枚举在接口上写中文，见约定 0002 第 1 条。处理各行的请求体就是 replyHandleInputSchema。

const timestamp = z.iso.datetime({ offset: true });
/** 附件的完整哈希，见「05 接口」第七节。 */
const blobHash = z.string();

/** 工作台交来的一行。行号按交来的顺序从 1 编。 */
const replyLineInputSchema = z.strictObject({
  section: replySection.codec.optional(),
  card: z.string().optional(),
  kind: replyLineKind.codec,
  option: z.string().optional(),
  note: z.string().optional(),
  /** 取消的是哪一件队列事项，写成 Q12。 */
  queue: queueIdSchema.optional(),
  images: z.array(blobHash).optional(),
});

/**
 * 提交回复：POST /pages/:id/submission。工作台交各行，旧模板交复制出的文字。
 * 文字和各行只交一样，两样都交或都不交时后端返回 BAD_REQUEST。来源不写就是工作台。
 */
export const submissionRequestSchema = z.strictObject({
  source: submissionSource.codec.optional(),
  text: z.string().optional(),
  lines: z.array(replyLineInputSchema).optional(),
  /** 回复里的图的完整哈希。旧格式的文字只写前几位，后端按它补全。 */
  images: z.array(blobHash).optional(),
});

/** 收下对话里贴回的文字：POST /pages/:id/submission/text，ploop reply ingest 用。 */
export const submissionTextSchema = z.strictObject({
  text: z.string(),
  images: z.array(blobHash).optional(),
});

/** 一份回复和它的每一行。 */
export const submissionViewSchema = z.strictObject({
  id: z.int().min(1),
  project: z.string(),
  page: z.int().min(1),
  /** 这一页在所在阶段里的第几页。对用户写页时用它，全局的页面编号只在机器读的输出里用。 */
  pageSeq: z.int().min(1),
  round: roundLabelSchema,
  source: submissionSource.codec,
  submittedAt: timestamp,
  /** 在等的命令第一次取走回复的时间。还没取走时为空。 */
  takenAt: timestamp.nullable(),
  /** 旧格式的回复文字。工作台交来的各行没有。 */
  text: z.string().nullable(),
  lines: z.array(replyLineSchema).readonly(),
});

/** 提交以后：回复，和这一轮的状态。 */
export const submittedReplySchema = z.strictObject({
  submission: submissionViewSchema,
  roundStatus: roundStatus.codec,
});

/** GET /pages/:id/submission 的查询参数：最多挂起几秒，零到五十。不写就不等。 */
export const submissionWaitQuerySchema = z.strictObject({
  wait: z
    .string()
    .regex(/^(?:[0-9]|[1-4][0-9]|50)$/u)
    .transform(Number)
    .optional(),
});

/** 等回复的两种结果。接口上写中文，代码里用英文键。 */
export const replyWaitStatus = { submitted: "已提交", waiting: "等待中" } as const;

const statusOf = <K extends keyof typeof replyWaitStatus>(key: K) =>
  z.codec(z.literal(replyWaitStatus[key]), z.literal(key), {
    decode: () => key,
    encode: () => replyWaitStatus[key],
  });

/** 等回复的结果：有了回复就带上它，到时还没有写 {status: "等待中"}，见「05 接口」第六节。 */
export const submissionWaitSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: statusOf("submitted"), submission: submissionViewSchema }),
  z.strictObject({ status: statusOf("waiting") }),
]);

/** 一份回复的每一行：GET /submissions/:sid/lines。 */
export const replyLinesSchema = z.array(replyLineSchema).readonly();

/** 处理以后：这次处理的各行、当场建出的东西，和还没处理的行号。 */
export const handledLinesSchema = z.strictObject({
  submission: z.int().min(1),
  round: roundLabelSchema,
  lines: z.array(replyLineSchema).readonly(),
  decisions: z.array(decisionSchema).readonly(),
  queued: z.array(queueItemSchema).readonly(),
  restored: z.array(queueItemSchema).readonly(),
  /** 改标了阶段的事：选中已有的一件，要做它的阶段变了，编号不变。 */
  restaged: z.array(queueItemSchema).readonly(),
  remaining: z.array(z.int().min(1)).readonly(),
});
