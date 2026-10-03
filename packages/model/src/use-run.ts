import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { useCopy } from "./copy/use.ts";
import { type UseStepResult, useStepResult } from "./names.ts";

// 使用代码的输出格式，见「04 命令行」第十一节和「09 skill 与软件」第四节。
// ploop use run 给使用代码一个输出目录，由环境变量 PLOOP_USE_OUT 指定。使用代码把结果写成
// 这个目录里的 use-run.json，截图也放在这个目录里。命令行读这份文件、上传截图，再把结果交给后端。
// 字段名用英文。结果在文件里写中文标签，解析以后是英文键，见「05 接口」第一节。
// 场景的名字不写，只写场景编号：名字只有主线这一个来源。

/** 输出目录的环境变量。 */
export const useOutEnv = "PLOOP_USE_OUT";

/** 输出目录里结果文件的名字。 */
export const useRunFile = "use-run.json";

/** 输出格式的版本。格式变了才加一。 */
export const useRunSchemaVersion = 1;

/**
 * 一个场景的一步，在一个宽度下的结果。要看排版的步骤在几个宽度各写一项，
 * 场景编号、步号和宽度确定一屏。命令行的场景没有宽度和截图。
 */
export type UseStepOutput = {
  readonly step: number;
  /** 截图时窗口的宽度，单位是像素。写了截图就要写宽度。 */
  readonly width?: number;
  readonly do: string;
  readonly expect: string;
  /** 文件里写中文标签：通过、断了、没走、环境。 */
  readonly result: UseStepResult;
  /** 截图的路径，相对输出目录。只收 PNG。 */
  readonly screenshot?: string;
  /** 量到的事实，只给 AI 看。 */
  readonly facts?: Readonly<Record<string, unknown>>;
  /** 没有通过时的原因。通过的步骤不写，其余的必须写。 */
  readonly error?: string;
};

export type UseRunScene = {
  /** 场景编号，例如 S14。 */
  readonly scene: string;
  readonly steps: readonly UseStepOutput[];
};

export type UseRunOutput = {
  readonly schemaVersion: typeof useRunSchemaVersion;
  /** use run 以命令行量到的时间为准，ingest 时取这里写的。 */
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly environment?: string;
  /** 这次运行走到的场景，每个场景一项。 */
  readonly scenes: readonly UseRunScene[];
};

/**
 * 要对照几个字段才能查出的问题。
 * - errorMissing：没有通过的步骤没写原因。
 * - errorOnPass：通过的步骤写了原因。
 * - widthMissing：写了截图，没写宽度。
 * - duplicateStep、duplicateStepAtWidth：同一场景的同一步在同一个宽度下写了不止一项。
 * - duplicateScene：同一个场景写了不止一项。
 */
export type UseRunCheckKind =
  | "errorMissing"
  | "errorOnPass"
  | "widthMissing"
  | "duplicateStep"
  | "duplicateStepAtWidth"
  | "duplicateScene";

/** 场景编号，和 ids.ts 的 S 编号写法相同。 */
const scenePattern = /^S[1-9][0-9]*$/u;

/** 截图的路径：相对输出目录，用正斜杠分隔，不含「.」和「..」这两种段，以 .png 结尾。 */
const screenshotPattern = /^(?:(?!\.{1,2}\/)[^/\\]+\/)*[^/\\]+\.png$/u;

const time = z.iso.datetime({ offset: true });
const { schema: field } = useCopy;

/** 一步的定义。保持为普通的对象定义，后端收使用记录时可以把截图的路径换成哈希。 */
export const useStepOutputSchema = z.strictObject({
  step: z.int().min(1).describe(renderCopy(field.step)),
  width: z.int().min(1).optional().describe(renderCopy(field.width)),
  do: z.string().min(1).describe(renderCopy(field.do)),
  expect: z.string().min(1).describe(renderCopy(field.expect)),
  result: useStepResult.codec.describe(renderCopy(field.result)),
  screenshot: z.string().regex(screenshotPattern).optional().describe(renderCopy(field.screenshot)),
  facts: z.record(z.string(), z.unknown()).optional().describe(renderCopy(field.facts)),
  error: z.string().min(1).optional().describe(renderCopy(field.error)),
}) satisfies z.ZodType<UseStepOutput>;

export const useRunSceneSchema = z.strictObject({
  scene: z.string().regex(scenePattern).describe(renderCopy(field.scene)),
  steps: z.array(useStepOutputSchema).min(1).describe(renderCopy(field.steps)),
}) satisfies z.ZodType<UseRunScene>;

/**
 * use-run.json 的定义。严格：多出不认识的字段就拒绝。
 * 格式本身查不出的问题由 checkUseRun 查，每一处都报出来。
 */
export const useRunOutputSchema = z
  .strictObject({
    schemaVersion: z.literal(useRunSchemaVersion).describe(renderCopy(field.schemaVersion)),
    startedAt: time.optional().describe(renderCopy(field.startedAt)),
    finishedAt: time.optional().describe(renderCopy(field.finishedAt)),
    environment: z.string().min(1).optional().describe(renderCopy(field.environment)),
    scenes: z.array(useRunSceneSchema).describe(renderCopy(field.scenes)),
  })
  .superRefine(checkUseRun)
  .meta({
    title: renderCopy(field.title),
    description: renderCopy(field.run),
  }) satisfies z.ZodType<UseRunOutput>;

/** 使用代码输出格式的 JSON Schema，GET /schema/use-run 和 ploop use schema 给出的就是它。 */
export function useRunJsonSchema(): z.core.JSONSchema.BaseSchema {
  return z.toJSONSchema(useRunOutputSchema, {
    io: "input",
    // 时间字段自带一条四百多字的正则，读的人只需要知道是 ISO 8601 的时间，format 已经写了。
    override: ({ jsonSchema }) => {
      if (jsonSchema.format === "date-time") delete jsonSchema.pattern;
    },
  });
}

function checkUseRun(output: UseRunOutput, ctx: z.RefinementCtx): void {
  const { check } = useCopy;
  const scenes = new Set<string>();
  for (const [i, { scene, steps }] of output.scenes.entries()) {
    if (scenes.has(scene)) {
      const message = renderCopy(check.duplicateScene, { scene });
      ctx.addIssue({ code: "custom", path: ["scenes", i, "scene"], message });
    }
    scenes.add(scene);
    const seen = new Set<string>();
    for (const [j, step] of steps.entries()) {
      const path = ["scenes", i, "steps", j];
      const passed = step.result === "pass";
      if (passed && step.error !== undefined) {
        const message = renderCopy(check.errorOnPass);
        ctx.addIssue({ code: "custom", path: [...path, "error"], message });
      }
      if (!passed && step.error === undefined) {
        const message = renderCopy(check.errorMissing, {
          result: useStepResult.label(step.result),
        });
        ctx.addIssue({ code: "custom", path: [...path, "error"], message });
      }
      if (step.screenshot !== undefined && step.width === undefined) {
        const message = renderCopy(check.widthMissing);
        ctx.addIssue({ code: "custom", path: [...path, "width"], message });
      }
      const at = `${step.step}@${step.width ?? ""}`;
      if (seen.has(at)) {
        const message =
          step.width === undefined
            ? renderCopy(check.duplicateStep, { scene, step: step.step })
            : renderCopy(check.duplicateStepAtWidth, { scene, step: step.step, width: step.width });
        ctx.addIssue({ code: "custom", path, message });
      }
      seen.add(at);
    }
  }
}
