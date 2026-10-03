import { z } from "zod";
import { screenStatus, useStepResult } from "../names.ts";
import { useRunOutputSchema } from "../use-run.ts";

// 使用记录和屏的接口：请求和响应的定义，路径见「05 接口」第四节。
// 使用代码写的 use-run.json 由命令行按 useRunOutputSchema 读出，原样放进请求的 output，
// 截图先上传到附件库，请求里按路径写哈希，见「05 接口」第七节。
// 枚举在接口上写中文，见约定 0002 第 1 条。

const timestamp = z.iso.datetime({ offset: true });

/** 收一次运行：POST /projects/:pid/use-runs，ploop use run 和 ploop use ingest 用。 */
export const useRunRequestSchema = z.strictObject({
  output: useRunOutputSchema,
  /** 每张截图的路径和哈希。路径和 use-run.json 里写的相同。 */
  screenshots: z.array(z.strictObject({ path: z.string(), hash: z.string() })),
  /** ploop use run 运行的程序和参数。ploop use ingest 不写。 */
  command: z.array(z.string()).optional(),
  exitCode: z.int().optional(),
  /** 运行时的 HEAD，完整的提交号。 */
  commit: z.string().optional(),
  /** 覆盖表的全文，收进来作为快照。项目里没有覆盖表时不写。 */
  coverage: z.string().optional(),
  startedAt: timestamp.optional(),
  finishedAt: timestamp.optional(),
});

/** GET /projects/:pid/screens/changed 的查询参数：哪一版，要不要连没变的一起列。 */
export const screensQuerySchema = z.strictObject({
  version: z
    .string()
    .regex(/^[1-9]\d*$/u)
    .transform(Number)
    .optional(),
  all: z.enum(["true", "false"]).optional(),
});

const resultCountsSchema = z.strictObject({
  pass: z.int().min(0),
  broken: z.int().min(0),
  skipped: z.int().min(0),
  environment: z.int().min(0),
});

/** 一次运行，不带每一步。 */
export const useRunSummarySchema = z.strictObject({
  id: z.int().min(1),
  round: z.string(),
  command: z.array(z.string()).readonly().nullable(),
  startedAt: timestamp.nullable(),
  finishedAt: timestamp.nullable(),
  exitCode: z.int().nullable(),
  commit: z.string().nullable(),
  environment: z.string().nullable(),
  coverage: z.string().nullable(),
  createdAt: timestamp,
  /** 各种结果的步数。 */
  results: resultCountsSchema,
});

const stepViewSchema = z.strictObject({
  step: z.int().min(1),
  width: z.int().min(1).nullable(),
  do: z.string(),
  expect: z.string(),
  result: useStepResult.codec,
  shot: z.string().nullable(),
  facts: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
});

/** 一次运行和它的每一步，按场景分组。使用区块也是它。 */
export const useRunViewSchema = useRunSummarySchema.safeExtend({
  scenes: z
    .array(
      z.strictObject({
        scene: z.string(),
        name: z.string().nullable(),
        steps: z.array(stepViewSchema).readonly(),
      }),
    )
    .readonly(),
});

const screenKeySchema = z.strictObject({
  scene: z.string(),
  step: z.int().min(1),
  width: z.int().min(1),
});

/** 收一次运行的结果。警告和下一步在外壳里。 */
export const ingestedUseRunSchema = z.strictObject({
  run: useRunSummarySchema,
  newScreens: z.array(screenKeySchema).readonly(),
  changedScreens: z.array(screenKeySchema).readonly(),
  /** 使用阶段的运行：主线里有、这次没走到的步，每个场景一项。别的阶段的运行不对照，为空。 */
  unreached: z
    .array(z.strictObject({ scene: z.string(), steps: z.array(z.int().min(1)).readonly() }))
    .readonly(),
  /** 没有断点也没有缺口时使用阶段自动给出的一页，写它是这一轮的第几页。没给出时为空。 */
  page: z.int().min(1).nullable(),
});

/** 项目的屏，按场景分组。 */
export const screenListSchema = z.strictObject({
  version: z.int().min(1),
  scenes: z
    .array(
      z.strictObject({
        scene: z.string(),
        name: z.string().nullable(),
        screens: z
          .array(
            z.strictObject({
              step: z.int().min(1),
              width: z.int().min(1),
              status: screenStatus.codec,
              shot: z.string(),
              shotVersion: z.int().min(1),
              baseShot: z.string().nullable(),
              firstVersion: z.int().min(1),
              changedVersion: z.int().min(1).nullable(),
            }),
          )
          .readonly(),
      }),
    )
    .readonly(),
});
