import { z } from "zod";
import { issueSchema } from "../envelope.ts";
import { pagePurpose, pageStatus, roundStatus, stage } from "../names.ts";
import { pageSectionsSchema } from "../page/sections.ts";
import { projectIdSchema } from "../project-cache.ts";
import { queueItemSchema } from "../queue.ts";
import { replyLineSchema } from "../reply.ts";
import { landStatusSchema } from "./land.ts";
import { useRunViewSchema } from "./use.ts";

// 页面的接口：请求和响应的定义，路径见「05 接口」第四节。
// 页面的编号是后端生成的全局整数（约定 0001 第 4 条）。这几个接口仍挂在 /projects/:pid 下面，
// 内核按项目找页面，别的项目的页面按找不到处理。
// 枚举在接口上写中文，请求经 codec 解码成英文键，响应由后端编码回中文，见约定 0002 第 1 条。
// 页面数据本身由内核按这一轮的阶段校验，所以请求里的 data 不在这里查。

const timestamp = z.iso.datetime({ offset: true });

// ── 请求 ──

/** 命令行交来的一张截图：页面数据里写的路径，和上传到附件库的哈希。截图要先上传。 */
const imageInputSchema = z.strictObject({ path: z.string(), hash: z.string() });

/**
 * 命令行读出的一段原文，见「05 接口」第四节「页面」表下的说明。
 * 来源写了 file 和 lines 时，命令行按它们读出原文，连同文件的哈希一起交来。
 */
const excerptInputSchema = z.strictObject({
  /** 文件路径，和来源里写的 file 相同。 */
  file: z.string(),
  /** 行号，和来源里写的 lines 相同，例如 12-20。 */
  lines: z.string(),
  /** 从起始行到结束行的原文，行与行之间用换行连接，末尾不带换行。 */
  text: z.string(),
  /** 摘录时文件的 SHA-256，写成六十四位小写十六进制。 */
  fileHash: z.string(),
});

const pageRequestShape = {
  /** 轮次的写法，例如 v2-检查-1。写得对不对由内核查。 */
  round: z.string(),
  /** 页面数据，AI 写的样子，由内核按这一轮的阶段校验。 */
  data: z.unknown(),
  /** 页面的用途。不写就是要用户点的。 */
  purpose: pagePurpose.codec.optional(),
  images: z.array(imageInputSchema).optional(),
};

/** 只校验、不给出：POST /projects/:pid/pages/check，ploop page check 用。 */
export const pageCheckRequestSchema = z.strictObject(pageRequestShape);

/** 给出信息：POST /projects/:pid/pages，ploop page present 用。 */
export const pagePresentRequestSchema = z.strictObject({
  ...pageRequestShape,
  excerpts: z.array(excerptInputSchema).optional(),
});

/** 撤回在等的一页：POST /projects/:pid/pages/:id/withdraw，ploop page withdraw 用。原因可以不写。 */
export const pageWithdrawRequestSchema = z.strictObject({ reason: z.string().optional() });

// ── 响应 ──

/** 一页的概要。 */
export const pageSummarySchema = z.strictObject({
  id: z.int().min(1),
  project: projectIdSchema,
  /** 轮次的写法，例如 v2-检查-1。 */
  round: z.string(),
  /** 这一轮的第几页。 */
  seq: z.int().min(1),
  purpose: pagePurpose.codec,
  status: pageStatus.codec,
  presentedAt: timestamp,
});

/**
 * 校验的结果：阶段、轮次，和全部拦截、警告。有拦截时照样是成功的响应，
 * 拦截在 block 里，由命令行决定退出码。
 */
export const pageCheckReportSchema = z.strictObject({
  stage: stage.codec,
  round: z.string().nullable(),
  block: z.array(issueSchema).readonly(),
  warn: z.array(issueSchema).readonly(),
  /** 跳过的规则的编号。 */
  skipped: z.array(z.string()).readonly(),
});

/**
 * 给出信息的结果。警告放进外壳的 warnings，下一步放进 next。
 * path 是工作台里这一轮的地址，不带主机和端口。轮次里的中文按 URL 的写法编码。
 */
export const presentedPageSchema = z.strictObject({
  page: pageSummarySchema,
  /** 给出以后这一轮的状态。 */
  roundStatus: roundStatus.codec,
  path: z.string().startsWith("/"),
  /** 建了索引的卡片有几张。 */
  cards: z.int().min(0),
});

/** 撤回的结果。下一步放进外壳的 next。 */
export const withdrawnPageSchema = z.strictObject({
  page: pageSummarySchema,
  /** 撤回以后这一轮的状态。 */
  roundStatus: roundStatus.codec,
});

// ── 填好的一页 ──

/** 看板上的一件事。停了七天还没轮到的，工作台显示得淡一些，见「06 工作台」第五节。 */
const boardItemSchema = queueItemSchema.safeExtend({ stale: z.boolean() });

/** 在等别的事的放在上面，其余按阶段分五列。 */
const liveBoardShape = {
  waiting: z.array(boardItemSchema).readonly(),
  columns: z
    .array(z.strictObject({ stage: stage.codec, items: z.array(boardItemSchema).readonly() }))
    .readonly(),
};

/** 现在的队列看板：GET /projects/:pid/queue/board，工作台的队列页用。 */
export const queueBoardSchema = z.strictObject(liveBoardShape);

/** 逐行对比里一段字的种类。它是给工作台上色用的记号，和旧脚本的输出相同，所以不换成中文。 */
const diffPartKind = z.enum(["same", "del", "ins"]);

const diffRowSchema = z.strictObject({
  k: z.enum([...diffPartKind.options, "mix", "gap"]),
  parts: z.array(z.tuple([diffPartKind, z.string()]).readonly()).readonly(),
});

/** 给出信息时由后端填好、和页面一起存下的部分，见 backend 的 core/pages/fill.ts。 */
const pageFillSchema = z.strictObject({
  /** 页头：系统名、轮次、日期。迁移进来的轮次另写旧编号。 */
  header: z.strictObject({
    system: z.string(),
    round: z.string(),
    legacyId: z.string().nullable(),
    stage: stage.codec,
    /** 给出的那一天，本地日期。 */
    date: z.iso.date(),
  }),
  /** 页头下面的窄带：五个阶段。当前是哪个阶段、什么状态，页头已经写了。 */
  strip: z.strictObject({
    stages: z
      .array(
        z.strictObject({
          stage: stage.codec,
          rounds: z
            .array(z.strictObject({ label: z.string(), status: roundStatus.codec }))
            .readonly(),
          queue: z.int().min(0),
        }),
      )
      .readonly(),
  }),
  /** 队列看板：在等别的事的放在上面，其余按阶段分五列。 */
  queue: z.strictObject({
    ...liveBoardShape,
    doneThisRound: z
      .array(
        z.strictObject({ id: z.string(), content: z.string(), evidence: z.string().nullable() }),
      )
      .readonly(),
  }),
  /** 页面里写到的位置：场景名和这一步的文字，由后端从主线填。 */
  where: z.strictObject({
    scenes: z
      .array(z.strictObject({ id: z.string(), name: z.string(), steps: z.int().min(0) }))
      .readonly(),
    places: z
      .array(
        z.strictObject({
          scene: z.string(),
          step: z.int(),
          name: z.string().nullable(),
          do: z.string().nullable(),
          expect: z.string().nullable(),
        }),
      )
      .readonly(),
  }),
  /** 这一轮开始时取消的事。 */
  droppedAtStart: z
    .array(z.strictObject({ id: z.string(), content: z.string(), reason: z.string() }))
    .readonly(),
  /** 文字更改的逐行对比，按卡片编号对回更改。 */
  textDiffs: z
    .array(z.strictObject({ card: z.string(), rows: z.array(diffRowSchema).readonly() }))
    .readonly(),
  /**
   * 上一轮的回复去了哪里：这个项目最近提交的一份回复，每一行和它的去处，见「06 工作台」第四节。
   * 还没有回复时为空。行里的区块、种类和去处写中文。
   */
  previousReplies: z
    .strictObject({
      submission: z.int().min(1),
      page: z.int().min(1),
      /** 回复的那一页所在的轮次，例如 v1-构思-3。 */
      round: z.string(),
      submittedAt: timestamp,
      lines: z.array(replyLineSchema).readonly(),
    })
    .nullable(),
  /** 使用区块：这一轮最近一次运行，由后端生成。使用轮以外和还没有运行时为空。 */
  use: useRunViewSchema.nullable(),
  /** 验收页的工程证据：落地五步的记录。落地轮以外为空。 */
  landEvidence: landStatusSchema.nullable(),
});

/** 一条原文摘录，按来源在页面数据里的位置对回来源。 */
const excerptViewSchema = z.strictObject({
  /** 来源在页面数据里的位置，例如 asks[0].sources[1]。 */
  where: z.string(),
  file: z.string(),
  lines: z.string(),
  start: z.int().min(1),
  end: z.int().min(1),
  mark: z.array(z.int()).readonly().nullable(),
  text: z.string(),
  fileHash: z.string(),
});

/**
 * 填好的一页：GET /projects/:pid/pages/:id，工作台里每一轮的页面用。
 * 页面数据带着填好的卡片编号，外加后端填的部分、原文摘录和截图的哈希。
 * 撤回的页写撤回的时间、原因和代替它的那一页。
 */
export const filledPageSchema = z.strictObject({
  id: z.int().min(1),
  project: projectIdSchema,
  round: z.string(),
  seq: z.int().min(1),
  stage: stage.codec,
  purpose: pagePurpose.codec,
  status: pageStatus.codec,
  formatVersion: z.int().min(1),
  presentedAt: timestamp,
  withdrawal: z
    .strictObject({
      at: timestamp,
      reason: z.string().nullable(),
      replacedBy: z.int().min(1).nullable(),
    })
    .nullable(),
  sections: pageSectionsSchema,
  /** 截图的路径和哈希。工作台按哈希从附件的接口取图。 */
  images: z.array(z.strictObject({ path: z.string(), hash: z.string() })).readonly(),
  excerpts: z.array(excerptViewSchema).readonly(),
  fill: pageFillSchema,
  /** 迁移进来的只有网页的一页：旧页面快照的哈希，工作台原样显示它，只能看。别的页为空。 */
  snapshot: z.string().nullable(),
  /** 这一页的回复。工作台据此显示「等 AI 取走」和「AI 已收到」。还没提交的为空。 */
  submission: z
    .strictObject({ id: z.int().min(1), submittedAt: timestamp, takenAt: timestamp.nullable() })
    .nullable(),
});
