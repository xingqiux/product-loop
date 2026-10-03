import { z } from "zod";
import { type CopyEntry, renderCopy } from "./copy/define.ts";
import { parseCopy } from "./copy/errors.ts";
import { queueCopy, textFieldCopy } from "./copy/records.ts";
import { parseQueueId } from "./ids.ts";
import { proposer, type QueueStatus, queueStatus, stage } from "./names.ts";
import { err, ok, type Result } from "./result.ts";
import { parseRoundLabel } from "./round-label.ts";
import { stageWordOf } from "./round-name.ts";

// 队列事项、队列变动和状态图，见「03 数据模型」第二节「队列和决定」。
// 接口上的写法见「05 接口」第一节：枚举写中文，解析以后是英文键。
// 队列事项写 Q12，轮次写 v2-检查-1，时间带时区。
// 开头几种字段的写法，决定和回复行也用。decision.ts、reply.ts 从这里取，这个文件不引用它们。

// ── 共用的字段写法 ──

/** 「没有写…」。field 是字段的中文名，从文案表取。 */
function missingOf(field: CopyEntry): string {
  return renderCopy(textFieldCopy.missing, { field: renderCopy(field) });
}

/** 一个文字字段。没写或写成 null 时报 missing，写的不是文字时报「…要写成文字」。 */
export function textOf(field: CopyEntry, missing = missingOf(field)) {
  const notText = renderCopy(textFieldCopy.notText, { field: renderCopy(field) });
  return z.string({
    error: (issue) => (issue.input === undefined || issue.input === null ? missing : notText),
  });
}

/**
 * 一段要有字的文字：没写、写成 null 和只写了空白，都报 missing。
 * missing 默认是「没有写…」，决定的三项换成写明三项都要写的说法。
 */
export function nonBlankText(field: CopyEntry, missing = missingOf(field)) {
  return textOf(field, missing).regex(/\S/u, { error: missing });
}

/** 队列事项的编号，写成 Q12。写错时的报错和 parseQueueId 相同。 */
export const queueIdSchema = textOf(queueCopy.field.id).regex(/^Q[1-9]\d*$/u, {
  error: (issue) => {
    const text = String(issue.input);
    const parsed = parseQueueId(text);
    return renderCopy(parseCopy.queueId[parsed.ok ? "shape" : parsed.error].message, { text });
  },
});

/** 和 parseRoundLabel 收的写法相同：版本和次数从 1 数，不补 0，阶段名写中文。 */
const roundLabelPattern = new RegExp(`^v[1-9]\\d*-(?:${stage.labels.join("|")})-[1-9]\\d*$`, "u");

function roundLabelMessage(text: string): string {
  const parsed = parseRoundLabel(text);
  const error = parsed.ok ? "shape" : parsed.error;
  switch (error) {
    case "renamedStage":
      return renderCopy(parseCopy.roundLabel.renamedStage.message, {
        text,
        old: stageWordOf(text),
      });
    case "stage":
      return renderCopy(parseCopy.roundLabel.stage.message, { text });
    case "zero":
      return renderCopy(parseCopy.roundLabel.zero.message, { text });
    case "shape":
      return renderCopy(parseCopy.roundLabel.shape.message, { text });
  }
}

/** 阶段的标识，写成 v2-检查-1。写错时的报错和 parseRoundLabel 相同。 */
export const roundLabelSchema = textOf(queueCopy.field.round).regex(roundLabelPattern, {
  error: (issue) => roundLabelMessage(String(issue.input)),
});

/** 回复里的一行：哪一份回复的第几行。回复的编号是后端生成的全局整数（第一期约定第 4 条）。 */
export const replyLineRefSchema = z.strictObject({
  submission: z.int().min(1),
  line: z.int().min(1),
});
export type ReplyLineRef = z.infer<typeof replyLineRefSchema>;

const timestamp = z.iso.datetime({ offset: true });

// ── 队列事项 ──

const content = nonBlankText(queueCopy.field.content);
const dependsOn = nonBlankText(queueCopy.field.dependsOn);
const acceptance = nonBlankText(queueCopy.field.acceptance);
const subItems = z.array(nonBlankText(queueCopy.field.subItem));
const source = nonBlankText(queueCopy.field.source);
/** 备注：多行文字，写放不进内容的细节。只要有字，行数和长度不限。 */
const note = nonBlankText(queueCopy.field.itemNote);

/** 状态要求写上的字段：等待写依赖，已完成写证据，已取消在状态说明里写原因。 */
const fieldsByStatus = [
  ["waiting", "dependsOn", queueCopy.item.waitingNeedsDependsOn],
  ["done", "evidence", queueCopy.item.doneNeedsEvidence],
  ["dropped", "statusNote", queueCopy.item.droppedNeedsNote],
] as const;

/**
 * 队列事项：还没做的一件事。保留旧队列的十格，外加编号和修改计数。
 * 字段的顺序和「03 数据模型」的表相同，没有的格不写，不写空字符串。
 */
export const queueItemSchema = z
  .strictObject({
    id: queueIdSchema,
    content,
    /** 要做它的阶段。 */
    stage: stage.codec,
    proposer: proposer.codec,
    /** 提出时的轮次。在两轮之间放进来的没有。 */
    proposedIn: roundLabelSchema.optional(),
    createdAt: timestamp,
    status: queueStatus.codec,
    statusNote: nonBlankText(queueCopy.field.statusNote).optional(),
    dependsOn: dependsOn.optional(),
    acceptance: acceptance.optional(),
    evidence: nonBlankText(queueCopy.field.evidence).optional(),
    subItems,
    /** 来源。重新要做一件已完成或已取消的事，在这里写明接的是哪一件。 */
    source: source.optional(),
    /** 备注：内容写不下的细节，多行文字。工作台的展示卡片写在内容下面。 */
    note: note.optional(),
    /** 来自哪一行回复。 */
    fromLine: replyLineRefSchema.optional(),
    /** 修改计数，改内容时放在 If-Match 里，对不上返回冲突。 */
    editCount: z.int().min(0),
  })
  .superRefine((item, ctx) => {
    for (const [status, field, message] of fieldsByStatus) {
      if (item.status === status && item[field] === undefined) {
        ctx.addIssue({ code: "custom", path: [field], message: renderCopy(message) });
      }
    }
  });
export type QueueItem = z.infer<typeof queueItemSchema>;

/** 放进一件事：`ploop queue add` 和处理回复时去处是队列的行。状态一律从待办开始。 */
export const queueItemCreateSchema = z.strictObject({
  content,
  stage: stage.codec,
  proposer: proposer.codec,
  dependsOn: dependsOn.optional(),
  acceptance: acceptance.optional(),
  subItems: subItems.optional(),
  source: source.optional(),
  note: note.optional(),
});
export type QueueItemCreate = z.infer<typeof queueItemCreateSchema>;

/**
 * 改一件事：`ploop queue edit`，见「05 接口」的 PATCH /queue/:qid。能改这九项，
 * 修改计数放在 If-Match 里。验收标准、来源和备注写 null 表示删掉，子项整份替换。
 * 阶段只改标注，不改状态。状态说明、证据和依赖只改文字，不改状态：状态说明和证据（或依赖）
 * 原来相同的，一起改。
 */
export const queueItemUpdateSchema = z
  .strictObject({
    content: content.optional(),
    stage: stage.codec.optional(),
    acceptance: acceptance.nullable().optional(),
    subItems: subItems.optional(),
    source: source.nullable().optional(),
    note: note.nullable().optional(),
    statusNote: nonBlankText(queueCopy.field.statusNote).optional(),
    evidence: nonBlankText(queueCopy.field.evidence).optional(),
    dependsOn: dependsOn.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    error: renderCopy(queueCopy.update.empty),
  });
export type QueueItemUpdate = z.infer<typeof queueItemUpdateSchema>;

// ── 状态图 ──

/**
 * 队列的状态图：从每个状态可以改到哪几个，顺序和「03 数据模型」的表相同。
 * 表里没有的变化一律拦截。已完成是终态。已取消回到待办另有条件，见 canTransition。
 * 每条边由什么引起，写在文案表的 queueCopy.cause 里。
 */
export const queueTransitions: Readonly<Record<QueueStatus, readonly QueueStatus[]>> = {
  todo: ["doing", "waiting", "dropped"],
  doing: ["done", "waiting", "todo", "dropped"],
  waiting: ["todo", "dropped"],
  done: [],
  dropped: ["todo"],
};

export type QueueTransition = { readonly from: QueueStatus; readonly to: QueueStatus };

/** 已取消回到待办时要看的几件事。别的变化不看它们。 */
export type QueueTransitionContext = {
  /** 这件事是在当前这一轮开始时取消的。 */
  readonly droppedAtRoundStart?: boolean;
  /** 用户在这一轮的回复里点名要捞回它。 */
  readonly namedInReply?: boolean;
  /** 明确要求改回待办：`ploop queue reopen`。已取消的事不必是开始时取消、也不必点名。 */
  readonly reopened?: boolean;
};

/**
 * - terminal：已完成是终态，改不到任何状态。
 * - notInGraph：状态图里没有这条边，包括改成原来的状态。
 * - notDroppedAtRoundStart：要捞回的事不是这一轮开始时取消的。
 * - notNamedInReply：要捞回的事，用户没有在这一轮的回复里点名。
 */
export type QueueTransitionError =
  | "terminal"
  | "notInGraph"
  | "notDroppedAtRoundStart"
  | "notNamedInReply";

/**
 * 查一次状态变化合不合状态图。已取消回到待办有两种情况：一是明确要求改回待办
 * （`ploop queue reopen`），二是处理回复时，开始一轮时取消的事，用户在这一轮的回复里点名捞回。
 * 改回以后编号不变。已完成的事不能改回，要重新做的放进一件新的。
 */
export function canTransition(
  from: QueueStatus,
  to: QueueStatus,
  context: QueueTransitionContext = {},
): Result<QueueTransition, QueueTransitionError> {
  const allowed = queueTransitions[from];
  if (allowed.length === 0) return err("terminal");
  if (!allowed.includes(to)) return err("notInGraph");
  if (from === "dropped" && context.reopened !== true) {
    if (context.droppedAtRoundStart !== true) return err("notDroppedAtRoundStart");
    if (context.namedInReply !== true) return err("notNamedInReply");
  }
  return ok({ from, to });
}

// ── 队列变动 ──

/** 一次状态变化的各个字段。写入时的校验和读出时的校验共用。 */
const queueEventFields = z.strictObject({
  item: queueIdSchema,
  at: timestamp,
  from: queueStatus.codec.optional(),
  to: queueStatus.codec,
  note: nonBlankText(queueCopy.field.note).optional(),
  /** 在哪一轮。两轮之间的变化没有。 */
  round: roundLabelSchema.optional(),
  /** 执行者：命令行、工作台或后端，例如 cli/2.0.0。 */
  actor: nonBlankText(queueCopy.field.actor),
});

/**
 * 队列变动：一件事的一次状态变化，「05 接口」的 GET /queue/:qid 连同事项一起返回。
 * 放进队列的那一次没有 from，状态是待办。其余每一次都要是状态图里的一条边。
 * 这是写入时的校验。读出时用 queueEventReadSchema：迁移来的事项，第一条变动可以不是待办。
 */
export const queueEventSchema = queueEventFields.superRefine((event, ctx) => {
  if (event.from === undefined) {
    if (event.to !== "todo") {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: renderCopy(queueCopy.event.createdNotTodo),
      });
    }
  } else if (!queueTransitions[event.from].includes(event.to)) {
    const labels = { from: queueStatus.label(event.from), to: queueStatus.label(event.to) };
    ctx.addIssue({
      code: "custom",
      path: ["to"],
      message: renderCopy(queueCopy.event.notInGraph, labels),
    });
  }
});

/**
 * 读出来的队列变动，只查字段的写法，不再查状态图：状态图是写入时的规矩。
 * 早先迁移进来的事项，第一条变动没有 from，状态是迁移时的状态（已完成、等待……），
 * 按写入的规矩读会报内部出错，这样的数据本来就合法，所以读出时放行。
 */
export const queueEventReadSchema = queueEventFields;
export type QueueEvent = z.infer<typeof queueEventSchema>;
