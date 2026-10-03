import { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { parseCopy } from "../copy/errors.ts";
import { pageCopy } from "../copy/page.ts";
import { pageFieldCopy } from "../copy/page-fields.ts";
import { defineEnum, type EnumDef, type KeyOf } from "../enum.ts";
import { parseQueueId, parseSceneId } from "../ids.ts";
import { err, ok, type Result } from "../result.ts";
import { reportIssue } from "./issue.ts";

// 各区块共用的字段。定义都是严格的：多出不认识的字段就拒绝，见「07 校验」第二节。
// 可以不写的字段，不写就删掉。不写空字符串，也不写空数组，没写和写了空的只有一种样子。
//
// 几处共用的部分带着 id，按阶段导出 JSON Schema 时各写一次，放在 $defs 里，用到的地方写引用。

/** 要写内容的文字至少有一个不是空白的字。报错时按这个写法认出「文字是空的」。 */
export const textPattern = /\S/u;

/** 要写内容的文字。 */
export const textSchema = z.string().regex(textPattern);

/** 可以不写的一段文字。 */
export const optionalText = textSchema.optional();

/** 标记只写 true，不是就删掉这个字段，例如 quote、outside、only、design。 */
export const flagSchema = z.literal(true).optional();

/**
 * 枚举里的一个取值：页面数据里写中文标签，解析以后是英文键，见「05 接口」第一节。
 * 用作区分几种写法的字段，例如证据的 type、设计规范的 kind。
 */
export function enumLiteral<
  K extends string,
  L extends string,
  T extends Readonly<Record<K, L>>,
  Key extends K,
>(def: EnumDef<K, L, T>, key: Key): z.ZodCodec<z.ZodLiteral<T[Key]>, z.ZodLiteral<Key>> {
  const label = def.label(key);
  return z.codec(z.literal(label), z.literal(key), {
    decode: () => key,
    encode: () => label,
  });
}

// ---- 引用：队列事项和场景都写编号，编号由 ids.ts 解析，见「03 数据模型」第二节

/** 引用一件队列事项，写成 Q12。 */
export const queueRefSchema = z
  .string()
  .superRefine((text, ctx) => {
    const id = parseQueueId(text);
    if (!id.ok)
      reportIssue(ctx, `parse.queueId.${id.error}`, parseCopy.queueId[id.error], { text });
  })
  .meta({ pattern: "^Q[1-9][0-9]*$" });

/** 卡片上的 queue：这张卡处理的是哪几件队列事项。每个编号只写一次。 */
export const queueRefsSchema = z
  .array(queueRefSchema)
  .min(1)
  .superRefine((ids, ctx) => {
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) {
        reportIssue(ctx, "page.queueRef.duplicate", pageCopy.queueRef.duplicate, { id }, [i]);
      }
    });
  })
  .meta({ id: "queueRefs" });

/** 引用主线里的一个场景，写成 S3。 */
export const sceneRefSchema = z
  .string()
  .superRefine((text, ctx) => {
    const id = parseSceneId(text);
    if (!id.ok)
      reportIssue(ctx, `parse.sceneId.${id.error}`, parseCopy.sceneId[id.error], { text });
  })
  .meta({ pattern: "^S[1-9][0-9]*$" });

/**
 * 位置：主线里哪个场景的第几步。AI 只写两个编号，见「03 数据模型」第二节。
 * 场景名和这一步的文字由后端从主线填，场景的总数和步数也由后端算。
 */
export const whereSchema = z
  .strictObject({
    scene: sceneRefSchema.describe(renderCopy(pageFieldCopy.where.scene)),
    step: z.int().positive().describe(renderCopy(pageFieldCopy.where.step)),
  })
  .meta({ id: "where" });

// ---- 路径：图片和文字来源都写相对路径，由命令行在项目里找到文件

/** 相对路径：不以斜杠或 ~ 开头，不是网址，用正斜杠分隔，没有空的一段，首尾没有空白。 */
export function isRelativePath(text: string): boolean {
  if (text === "" || text.trim() !== text) return false;
  if (text.startsWith("/") || text.startsWith("~") || text.includes("\\")) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(text)) return false;
  return text.split("/").every((part) => part !== "");
}

const imageExtension = /\.(?:png|jpe?g|webp|gif)$/iu;

/**
 * 截图的路径，相对页面数据所在的工作区，例如 img/before.png。给出信息时，
 * 命令行按路径找到图，上传到附件库，见「05 接口」第七节。
 */
export const imgPathSchema = z.string().superRefine((path, ctx) => {
  if (!isRelativePath(path) || !imageExtension.test(path)) {
    reportIssue(ctx, "page.path.img", pageCopy.path.img, { path });
  }
});

/** 文字来源的文件，相对项目的根目录，例如 skill/SKILL.md。原文由命令摘录。 */
export const filePathSchema = z.string().superRefine((path, ctx) => {
  if (!isRelativePath(path)) reportIssue(ctx, "page.path.file", pageCopy.path.file, { path });
});

/** 一张图和图下的一行说明。 */
export const figureSchema = z
  .strictObject({
    img: imgPathSchema.describe(renderCopy(pageFieldCopy.figure.img)),
    caption: optionalText.describe(renderCopy(pageFieldCopy.figure.caption)),
  })
  .meta({ id: "figure" });

// ---- 行号：文字来源摘哪几行，见第一期约定第 8 条

/** 从第几行到第几行，都从 1 数，包含两头。 */
export type LineRange = { readonly start: number; readonly end: number };

const lineRangePattern = /^(?<start>[1-9]\d*)(?:-(?<end>[1-9]\d*))?$/u;

/** 解析 `12-20` 或 `12`。前一个大于后一个、写了 0、带空格，都算写法不对。 */
export function parseLineRange(text: string): Result<LineRange, "shape"> {
  const groups = lineRangePattern.exec(text)?.groups;
  if (!groups) return err("shape");
  const start = Number(groups.start);
  const end = groups.end === undefined ? start : Number(groups.end);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end) {
    return err("shape");
  }
  return ok({ start, end });
}

export const lineRangeSchema = z
  .string()
  .superRefine((lines, ctx) => {
    if (!parseLineRange(lines).ok)
      reportIssue(ctx, "page.lines.shape", pageCopy.lines.shape, { lines });
  })
  .meta({ pattern: "^[1-9][0-9]*(-[1-9][0-9]*)?$" });

// ---- 色值

const hexPattern = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u;

/** 色值写成 # 加 3、4、6 或 8 位十六进制数。 */
export const hexColorSchema = z
  .string()
  .superRefine((hex, ctx) => {
    if (!hexPattern.test(hex)) reportIssue(ctx, "page.color.hex", pageCopy.color.hex, { hex });
  })
  .meta({ pattern: hexPattern.source });

// ---- 图表，见旧格式第十二版

/** 图表的种类，取主线「内容配什么形式」那张表里的九种。页面数据里写中文，解析以后是英文键。 */
export const diagramKind = defineEnum({
  flowchart: "流程图",
  sequence: "时序图",
  state: "状态图",
  architecture: "架构图",
  mindmap: "思维导图",
  quadrant: "象限图",
  timeline: "时间线",
  beforeAfter: "改前改后的结构",
  tree: "目录树",
});
export type DiagramKind = KeyOf<typeof diagramKind>;

/** 一张图表：种类、标题和图表库的文字定义。目录树直接写文字。 */
export const diagramSchema = z
  .strictObject({
    kind: diagramKind.codec.describe(renderCopy(pageFieldCopy.diagram.kind)),
    title: textSchema.describe(renderCopy(pageFieldCopy.diagram.title)),
    code: textSchema.describe(renderCopy(pageFieldCopy.diagram.code)),
  })
  .meta({ id: "diagram" });

export const diagramsSchema = z.array(diagramSchema).min(1);
