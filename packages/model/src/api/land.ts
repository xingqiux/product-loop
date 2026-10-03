import { z } from "zod";
import { commandRunSchema } from "../command-run.ts";
import { issueSchema } from "../envelope.ts";
import { landPlanSection } from "../land-plan.ts";
import { landChangeState, landStepState, reviewLevel } from "../names.ts";

// 落地五步的接口：请求和响应的定义，路径见「05 接口」第四节，按约定 0001 第 4 条挂在
// /projects/:pid/rounds/:rid/land 下面。命令见「04 命令行」第十一节。
// 后端不跑命令，也不碰 git。检查命令由命令行在项目的根目录里跑完，把运行记录交来。
// 枚举在接口上写中文，见约定 0002 第 1 条。计划七节的正文按节的英文键放，键是字段名。

const timestamp = z.iso.datetime({ offset: true });

// ── 请求 ──

/** 命令行交来的一次运行。项目、轮次和用途由路径定，不在这里写。 */
export const landRunInputSchema = commandRunSchema.omit({
  project: true,
  round: true,
  purpose: true,
});

/** 交计划：PUT /projects/:pid/rounds/:rid/land/plan，ploop land plan 用。 */
export const landPlanRequestSchema = z.strictObject({ text: z.string() });

/** 记重构：POST …/land/tidy。跳过写 skip，做了重构写检查命令的那次运行。 */
export const landTidyRequestSchema = z.union([
  z.strictObject({ skip: z.literal(true) }),
  z.strictObject({ run: landRunInputSchema }),
]);

/** 记改之前失败的一次：POST …/land/changes/:name/red。 */
export const landRedRequestSchema = z.strictObject({ run: landRunInputSchema });

/** 这一批改到的一个文件：git diff --numstat 的一行。二进制文件的行数记 0。 */
const changedFileSchema = z.strictObject({
  root: z.string(),
  path: z.string(),
  added: z.int().min(0),
  deleted: z.int().min(0),
});

/** 记改之后通过的一次：POST …/land/changes/:name/green。 */
export const landGreenRequestSchema = z.strictObject({
  run: landRunInputSchema,
  /** 失败时的提交以后到通过时的提交为止的提交，通过时的提交在内。 */
  commitsAfterRed: z.array(z.string()),
  /** 这几个提交的说明末尾写的队列编号，写成 Q12。 */
  queue: z.array(z.string()).optional(),
  /** 这一批改到的文件，从这一轮开始时的提交算起。写了时，全部通过而且在界线以内，评审自动跳过。 */
  changed: z.array(changedFileSchema).optional(),
});

const reviewOpinionSchema = z.strictObject({
  file: z.string(),
  line: z.int().min(1),
  level: reviewLevel.codec,
  text: z.string(),
  disposition: z.string().optional(),
});

/**
 * 记评审：POST …/land/review。写评审意见，或者写跳过的理由。
 * changed 是这一批改到的文件，从这一轮开始时的提交算起。跳过时必写。
 */
export const landReviewRequestSchema = z.union([
  z.strictObject({
    opinions: z.array(reviewOpinionSchema),
    changed: z.array(changedFileSchema).optional(),
  }),
  z.strictObject({ skip: z.string(), changed: z.array(changedFileSchema) }),
]);

// ── 响应 ──

const runViewSchema = z.strictObject({
  command: z.array(z.string()).readonly(),
  cwd: z.string(),
  exitCode: z.int(),
  outputTail: z.string(),
  commit: z.string().nullable(),
  startedAt: timestamp,
  durationMs: z.int().min(0),
  cliVersion: z.string(),
  recordedAt: timestamp,
});

const planViewSchema = z.strictObject({
  text: z.string(),
  sections: z.record(landPlanSection.keySchema, z.string()),
  tidy: z.union([
    z.strictObject({ wanted: z.literal(true) }),
    z.strictObject({ wanted: z.literal(false), reason: z.string() }),
  ]),
  verdicts: z.array(z.array(z.string()).readonly()).readonly(),
  changes: z
    .array(
      z.strictObject({
        name: z.string(),
        text: z.string(),
        queue: z.array(z.string()).readonly(),
      }),
    )
    .readonly(),
  plannedAt: timestamp,
});

const tidyViewSchema = z.strictObject({
  state: landStepState.codec,
  reason: z.string().nullable(),
  run: runViewSchema.nullable(),
});

const changeViewSchema = z.strictObject({
  name: z.string(),
  queue: z.array(z.string()).readonly(),
  planned: z.boolean(),
  state: landChangeState.codec,
  red: runViewSchema.nullable(),
  green: runViewSchema.nullable(),
  commit: z.string().nullable(),
  commitsAfterRed: z.array(z.string()).readonly().nullable(),
});

const reviewDiffSchema = z.strictObject({
  lines: z.int().min(0),
  files: z.int().min(0),
  dependencyFiles: z.array(z.string()).readonly(),
  dataFormatFiles: z.array(z.string()).readonly(),
  maxLines: z.int().min(0),
  maxFiles: z.int().min(0),
  within: z.boolean(),
});

const reviewViewSchema = z.strictObject({
  state: landStepState.codec,
  opinions: z.array(reviewOpinionSchema).readonly().nullable(),
  reason: z.string().nullable(),
  diff: reviewDiffSchema.nullable(),
  reviewedAt: timestamp.nullable(),
});

/**
 * 落地五步的状态：GET …/land，ploop land status 用。验收页的工程证据也是它。
 * 下一步由接口层放进响应外壳的 next，这里不重复。
 */
export const landStatusSchema = z.strictObject({
  round: z.string(),
  plan: planViewSchema.nullable(),
  tidy: tidyViewSchema,
  changes: z.array(changeViewSchema).readonly(),
  review: reviewViewSchema,
  /** 这一批里没有任何一件功能改动对应的事，写成 Q12。 */
  uncoveredQueue: z.array(z.string()).readonly(),
  complete: z.boolean(),
  /** 缺的地方，按五步的先后排。 */
  missing: z.array(issueSchema).readonly(),
});

/** 交计划的结果。警告和下一步在外壳里。 */
export const landPlanRecordedSchema = z.strictObject({
  round: z.string(),
  plan: planViewSchema,
  replaced: z.boolean(),
});

/** 记重构的结果。 */
export const landTidyRecordedSchema = z.strictObject({ round: z.string(), tidy: tidyViewSchema });

/** 记失败或通过的结果：这一件功能改动现在的样子。 */
export const landChangeRecordedSchema = z.strictObject({
  round: z.string(),
  change: changeViewSchema,
  /** 记通过以后评审自动跳过了：这一批改动的规模。没有自动跳过时为空。 */
  reviewSkipped: reviewDiffSchema.nullable(),
});

/** 记评审的结果。 */
export const landReviewRecordedSchema = z.strictObject({
  round: z.string(),
  review: reviewViewSchema,
});
