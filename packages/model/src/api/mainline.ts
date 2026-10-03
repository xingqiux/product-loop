import { z } from "zod";
import { defineEnum, type KeyOf } from "../enum.ts";
import { formatSceneId } from "../ids.ts";
import { designSpecItem, mainlinePart } from "../mainline/parts.ts";
import { mainlineSource } from "../names.ts";
import { sceneRefSchema } from "../page/fields.ts";
import { roundLabelSchema } from "../queue.ts";
import { mainlineStatusSchema } from "./projects.ts";

// 主线的接口：请求和响应的定义，路径见「05 接口」第四节。
// 主线缺哪几样用 projects.ts 的 mainlineStatusSchema，GET /projects/:pid/mainline/check 就返回它。
// 枚举在接口上写中文，场景编号写成 S14，响应由后端编码，见约定 0002 第 1 条。
// 解析时查出的问题不放进数据，接口层把它们写成响应外壳的 warnings，位置写主线.md 的行号。

const timestamp = z.iso.datetime({ offset: true });

/** 查询参数里写 true 或 false 的一项，别的写法都不收。 */
const flag = z.stringbool({ truthy: ["true"], falsy: ["false"] });

// ── 请求 ──

/**
 * 交一版：POST /projects/:pid/mainline/revisions，ploop mainline push 和每条命令开始时的同步用。
 * 基准版本号是 project.json 的 mainlineBase 记的那一版，还没交过主线时写 null。
 * 基准不是最新的一版时返回冲突，见「03 数据模型」第五节。
 * 全文是不是空的、基准是不是从 1 起的整数，由内核查，报错写明怎么改。
 * 来源一律是项目缓存，处理回复和迁移时由各自的用例交主线，不经这个接口。
 */
export const mainlinePushSchema = z.strictObject({
  /** 主线的全文，命令从项目缓存的主线.md 读出。 */
  text: z.string(),
  baseRevision: z.number().nullable(),
});

/**
 * GET /projects/:pid/mainline/diff 的查询参数：从第 from 版比到第 to 版。
 * 版本号写成数字，写得对不对由接口层查，报错写明怎么改。
 */
export const mainlineDiffQuerySchema = z.strictObject({ from: z.string(), to: z.string() });

/** GET /projects/:pid/mainline/scenes 的查询参数。includeRemoved 写 true 时连删掉的场景一起列。 */
export const sceneQuerySchema = z.strictObject({ includeRemoved: flag.optional() });

// ── 解析结果 ──

/** 一个标题：文字、所在的行，和这一节最后一行有字的行。行号从 1 数。 */
const headingSchema = z.strictObject({
  text: z.string(),
  line: z.int().min(1),
  endLine: z.int().min(1),
});

/** 十样里的一样：在不在，在的话标题在哪一行、管到哪一行。 */
const partEntrySchema = z.discriminatedUnion("present", [
  z.strictObject({ part: mainlinePart.codec, present: z.literal(false) }),
  z.strictObject({ part: mainlinePart.codec, present: z.literal(true), heading: headingSchema }),
]);

/** 场景编号：解析结果里存数字，接口上写成 S14。 */
const sceneNumber = z.codec(sceneRefSchema, z.int().min(1), {
  // 写法已由 sceneRefSchema 查过，去掉开头的 S 就是编号。
  decode: (text) => Number(text.slice(1)),
  encode: (n) => formatSceneId(n),
});

/** 场景清单里的一个场景，对应 model 的 MainlineScene。没写编号的场景没有 id。 */
const parsedSceneSchema = z.strictObject({
  id: sceneNumber.optional(),
  name: z.string(),
  /** 名字后面括号里的说明。 */
  note: z.string().optional(),
  /** 谁在什么时候用。 */
  who: z.string().optional(),
  steps: z
    .array(
      z.strictObject({
        step: z.int().min(1),
        do: z.string(),
        expect: z.string(),
        line: z.int().min(1),
      }),
    )
    .readonly(),
  line: z.int().min(1),
  endLine: z.int().min(1),
  /** 旧写法的场景。 */
  legacy: z.boolean(),
});

/**
 * 设计规范十二样里一样的写法，对应 model 的 DesignSpecEntry。
 * 写了「无」的是这个产品没有的一样，另带原因。只有标题和没有标题的，主线缺哪几样里都算缺。
 */
const designSpecStatus = defineEnum({
  written: "写了内容",
  none: "写了「无」",
  empty: "只有标题",
  missing: "没有标题",
});

function specStatus<S extends KeyOf<typeof designSpecStatus>>(key: S) {
  const label = designSpecStatus.label(key);
  return z.codec(z.literal(label), z.literal(key), { decode: () => key, encode: () => label });
}

const designSpecEntrySchema = z.discriminatedUnion("status", [
  z.strictObject({ item: designSpecItem.codec, status: specStatus("missing") }),
  z.strictObject({
    item: designSpecItem.codec,
    status: specStatus("written"),
    heading: headingSchema,
  }),
  z.strictObject({
    item: designSpecItem.codec,
    status: specStatus("empty"),
    heading: headingSchema,
  }),
  z.strictObject({
    item: designSpecItem.codec,
    status: specStatus("none"),
    heading: headingSchema,
    /** 「无」后面的原因。没写原因时是空的，解析时另报问题。 */
    reason: z.string(),
  }),
]);

/** 主线「写作规范」一节写的停用说法和例外，放进和修改队列事项时交给写作校验。 */
const writingSpecSchema = z.strictObject({
  banned: z.array(z.strictObject({ phrase: z.string(), replacement: z.string() })).readonly(),
  exceptions: z.array(z.string()).readonly(),
});

/** 一版主线的解析结果，对应 model 的 MainlineParse，只是不带查出的问题。 */
export const mainlineParseSchema = z.strictObject({
  /** 十样，按十样的顺序。 */
  parts: z.array(partEntrySchema).readonly(),
  /** 十样以外的二级标题。 */
  otherSections: z.array(headingSchema).readonly(),
  /** 场景清单这一节里的场景，按在主线里的先后。 */
  scenes: z.array(parsedSceneSchema).readonly(),
  /** 设计规范的十二样，按十二样的顺序。 */
  designSpec: z.array(designSpecEntrySchema).readonly(),
  /** 设计规范这一节里十二样以外的三级标题。 */
  otherSpecHeadings: z.array(headingSchema).readonly(),
  writingSpec: writingSpecSchema,
});

// ── 响应 ──

/** 历次版本里的一版，不带全文和解析结果。 */
export const mainlineRevisionSummarySchema = z.strictObject({
  revision: z.int().min(1),
  /** 全文的 SHA-256。命令把版本号和它记进 project.json 的 mainlineBase。 */
  hash: z.string().regex(/^[0-9a-f]{64}$/u),
  source: mainlineSource.codec,
  /** 在哪一轮改的。两轮之间交上来的为空。 */
  round: roundLabelSchema.nullable(),
  createdAt: timestamp,
});

/** 主线的历次版本，按版本号从小到大排：GET /projects/:pid/mainline/revisions。 */
export const mainlineRevisionListSchema = z.array(mainlineRevisionSummarySchema).readonly();

/** 一版主线的全文和解析结果：GET /projects/:pid/mainline/revisions/:rev。 */
export const mainlineRevisionSchema = z.strictObject({
  ...mainlineRevisionSummarySchema.shape,
  /** 全文，补好了场景编号。 */
  text: z.string(),
  parsed: mainlineParseSchema,
});

/** 最新的主线：GET /projects/:pid/mainline，ploop mainline show、pull 和工作台用。 */
export const mainlineSchema = z.strictObject({
  /** 最新的一版。还没交过主线时为空。 */
  latest: mainlineRevisionSchema.nullable(),
  /** 主线缺哪几样，和 GET /projects/:pid/mainline/check 的结果相同。 */
  status: mainlineStatusSchema,
});

/** 补上的一个场景编号。line 是场景标题所在的行，补编号前后相同。 */
const assignedSceneSchema = z.strictObject({
  id: sceneRefSchema,
  name: z.string(),
  line: z.int().min(1),
});

/** 交一版的结果。有补上的场景编号时，命令把全文写回主线.md。 */
export const mainlinePushedSchema = z.strictObject({
  /** 交上来以后最新的一版，全文补好了场景编号。全文和最新的一版相同时，就是原来的那一版。 */
  revision: mainlineRevisionSchema,
  /** 建了新的一版。全文和最新的一版相同时为 false。 */
  created: z.boolean(),
  /** 这次补上的场景编号，按场景在主线里的先后。 */
  assignedScenes: z.array(assignedSceneSchema).readonly(),
  /** 上一版里有、这一版里没有的场景编号，按编号排。 */
  removedScenes: z.array(sceneRefSchema).readonly(),
});

/**
 * 两版主线的逐行比较：GET /projects/:pid/mainline/diff。
 * 每一行的写法和页面里文字的改前改后相同，见 model 的 textDiff。
 * k 和每一段的种类是给工作台上色用的代号，和旧模板读的格式相同，所以不换成中文。
 */
export const mainlineDiffSchema = z.strictObject({
  from: z.int().min(1),
  to: z.int().min(1),
  rows: z
    .array(
      z.strictObject({
        k: z.enum(["same", "del", "ins", "mix", "gap"]),
        parts: z.array(z.tuple([z.enum(["same", "del", "ins"]), z.string()]).readonly()).readonly(),
      }),
    )
    .readonly(),
});

/**
 * 十样各是哪一版、哪一轮最近改的：GET /projects/:pid/mainline/parts，工作台主线页的目录用。
 * 按十样的顺序。一次都没写过的一样，版本号和轮次都为空；两轮之间改的，轮次为空。
 */
export const mainlinePartChangesSchema = z
  .array(
    z.strictObject({
      part: mainlinePart.codec,
      revision: z.int().min(1).nullable(),
      round: roundLabelSchema.nullable(),
    }),
  )
  .readonly();

/** 场景表里的一个场景：GET /projects/:pid/mainline/scenes 的每一项。 */
export const sceneViewSchema = z.strictObject({
  id: sceneRefSchema,
  name: z.string(),
  /** 谁在什么时候用。旧写法的场景没写时为空。 */
  who: z.string().nullable(),
  steps: z
    .array(z.strictObject({ step: z.int().min(1), do: z.string(), expect: z.string() }))
    .readonly(),
  /** 首次出现的主线版本号。 */
  firstRevision: z.int().min(1),
  /** 最近一次出现的主线版本号。 */
  latestRevision: z.int().min(1),
  /** 从哪一版起不在主线里。还在的为空。 */
  removedInRevision: z.int().min(1).nullable(),
});

/** 项目的场景，按编号排：GET /projects/:pid/mainline/scenes。默认只列最新的主线里还在的。 */
export const sceneListSchema = z.array(sceneViewSchema).readonly();
