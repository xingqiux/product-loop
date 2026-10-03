import { z } from "zod";
import { pagePurpose, pageStatus, type RoundItemResult, roundItemResult, stage } from "../names.ts";
import { queueItemSchema } from "../queue.ts";
import { mainlineStatusSchema, roundViewSchema } from "./projects.ts";
import { submissionViewSchema } from "./replies.ts";
import { screenListSchema } from "./use.ts";
import { versionChangeSchema } from "./versions.ts";

// 轮次的接口：请求和响应的定义，路径见「05 接口」第四节，按约定 0001 第 4 条挂在 /projects/:pid 下面。
// 开始一轮、看一轮、收尾。枚举在接口上写中文，请求经 codec 解码成英文键，见约定 0002 第 1 条。
// 编号、提交号、说明只查类型，写得对不对由内核查，报错写明怎么改。
// 路径里的轮次写轮次的写法或迁移前的旧编号，旧编号里的斜杠要编码成 %2F。

const timestamp = z.iso.datetime({ offset: true });

/** 落地轮开始时一个根目录的提交，这一批改动从它算起，见约定 0001 第 12 条。 */
const baseCommitSchema = z.strictObject({
  /** 登记过的根目录。 */
  root: z.string(),
  /** git rev-parse HEAD 打印的完整提交号。 */
  commit: z.string(),
});

// ── 请求 ──

/**
 * 开始一轮：POST /projects/:pid/rounds，ploop round start 用。
 * take 只有落地轮能写，baseCommits 只有落地轮交，别的阶段写了由内核返回 BAD_REQUEST。
 */
export const roundStartSchema = z.strictObject({
  stage: stage.codec,
  /** 落地轮这一批的编号，写成 Q12。不写就拿出这个阶段全部待办的事。 */
  take: z.array(z.string()).optional(),
  /** 这一轮不做、改成等待的事，各自写明依赖。 */
  defer: z.array(z.strictObject({ id: z.string(), dependsOn: z.string() })).optional(),
  /** 落地轮开始时，命令行取到的各个根目录的 HEAD。只交是 git 仓库的根目录。 */
  baseCommits: z.array(baseCommitSchema).optional(),
  /** 检查轮列出全部的屏，不只列这一版新出现和变过的。ploop round start 检查 --all-screens。 */
  allScreens: z.boolean().optional(),
});

/** 收尾时能写的结果：做完或退回。写成函数，结果的键拼错时类型检查报错。 */
function toResult<R extends Exclude<RoundItemResult, "droppedAtStart">>(key: R) {
  const label = roundItemResult.label(key);
  return z.codec(z.literal(label), z.literal(key), { decode: () => key, encode: () => label });
}

/**
 * 收尾：POST /projects/:pid/rounds/:rid/close，ploop round close 用。
 * 还在进行中的事逐件写明结果。开始时取消的事用 ploop queue drop 取消，不在这里写。
 * 做完的写完成证据，退回的写原因，退回时可以写退回到哪个阶段。
 */
export const roundCloseSchema = z.strictObject({
  results: z
    .array(
      z.strictObject({
        id: z.string(),
        result: z.union([toResult("done"), toResult("returned")]),
        note: z.string().optional(),
        stage: stage.codec.optional(),
      }),
    )
    .optional(),
  /** 收尾说明：一句话写这一轮做了什么。 */
  summary: z.string().optional(),
  /**
   * 放弃这个阶段：写明原因。拿出的事退回待办，不要求给用户看过页。
   * 给用户看过更改的页以后不能放弃。不和 results、summary 一起写。
   */
  abort: z.string().optional(),
  /**
   * 落地轮收尾时，命令行查到的各个根目录里没提交的文件，相对根目录。
   * 每个是 git 仓库的根目录一项，没有改动的写空列表。别的阶段不写。
   */
  worktree: z.array(z.strictObject({ root: z.string(), files: z.array(z.string()) })).optional(),
});

// ── 响应 ──

/**
 * 开始了的一轮。内核给的下一步和警告由接口层放进响应外壳的 next 和 warnings，这里不重复。
 * 检查轮另列出这一版新出现和变过的屏，按场景分组，写了 allScreens 时列出全部。
 */
export const startedRoundSchema = z.strictObject({
  round: roundViewSchema,
  /** 这次开始进入了新的一版时，结束的一版和新开始的一版。没换版时为空。 */
  versionChange: versionChangeSchema.nullable(),
  /** 开始以前替它收尾的上一轮。没有时为空。 */
  autoClosed: roundViewSchema.nullable(),
  /** 拿进这一轮的事，按编号排。 */
  taken: z.array(queueItemSchema).readonly(),
  /** 改成等待的事，按请求里的先后。 */
  deferred: z.array(queueItemSchema).readonly(),
  /** 这个阶段原来就在等待的事，这次没有拿出来。改回待办用 ploop queue reopen。 */
  waiting: z.array(queueItemSchema).readonly(),
  /** 落地轮开始时各个根目录的提交。别的阶段和没交提交的落地轮为空。 */
  baseCommits: z.array(baseCommitSchema).readonly().nullable(),
  /** 主线缺哪几样。 */
  mainline: mainlineStatusSchema,
  /** 检查轮要看的屏，按场景分组。别的阶段为空。 */
  screens: screenListSchema.nullable(),
});

/** 拿出的一件事在这一轮的样子：队列事项现在的样子，和它的结果。 */
const roundItemViewSchema = z.strictObject({
  item: queueItemSchema,
  /** 这一轮收尾时记下的结果。还没收尾时为空。 */
  result: roundItemResult.codec.nullable(),
  /** 退回到哪个阶段。只有写了阶段的退回有。 */
  returnedTo: stage.codec.nullable(),
  /** 做完的证据、退回的原因或开始时取消的原因。没有时为空。 */
  note: z.string().nullable(),
});

/** 收尾的结果。内核给的下一步由接口层放进响应外壳的 next。 */
export const closedRoundSchema = z.strictObject({
  round: roundViewSchema,
  summary: z.string().nullable(),
  /** 拿出的每件事，按编号排，都有结果。 */
  items: z.array(roundItemViewSchema.extend({ result: roundItemResult.codec })).readonly(),
});

/** 一轮里给出过的一页。页面的编号是后端生成的全局整数（约定 0001 第 4 条）。 */
const roundPageSchema = z.strictObject({
  id: z.int().min(1),
  /** 这一轮的第几页，从 1 数，撤回的页也占一个序号。 */
  seq: z.int().min(1),
  purpose: pagePurpose.codec,
  status: pageStatus.codec,
  presentedAt: timestamp,
  withdrawnAt: timestamp.nullable(),
});

/**
 * 一轮的详情：GET /projects/:pid/rounds/:rid，ploop round show 用。
 * replies 是这一轮每一页收到的回复，各行带着去处，接手的会话看这里就知道用户答了什么、放去了哪里。
 */
export const roundDetailSchema = z.strictObject({
  round: roundViewSchema,
  /** 开这一轮的会话。取不到会话、迁移进来的轮次为空。 */
  openedBySession: z.string().nullable(),
  /** 开这一轮的客户端，例如 cli/2.0.0。迁移进来的轮次为空。 */
  openedByClient: z.string().nullable(),
  baseCommits: z.array(baseCommitSchema).readonly().nullable(),
  /** 收尾说明。没收尾或没写时为空。 */
  summary: z.string().nullable(),
  /** 拿出的每件事，按编号排。 */
  items: z.array(roundItemViewSchema).readonly(),
  /** 给出过的页，按页序号排。 */
  pages: z.array(roundPageSchema).readonly(),
  /** 收到的回复，按页序号排，每一行带着去处。没有回复时为空。 */
  replies: z.array(submissionViewSchema).readonly(),
});
