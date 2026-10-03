import { z } from "zod";
import { defineEnum } from "../enum.ts";
import { designSpecItem, mainlinePart } from "../mainline/parts.ts";
import { pagePurpose, repoKind, roundStatus, stage, versionStatus } from "../names.ts";
import { projectIdSchema } from "../project-cache.ts";
import { roundLabelSchema } from "../queue.ts";

// 项目和状态的接口：请求和响应的定义，路径见「05 接口」第四节。
// 一版和一轮的样子也在这里，状态要用。版本的接口见 versions.ts，轮次的接口见 rounds.ts。
// 枚举在接口上写中文，见「05 接口」第一节，这一条是用户定的。
// 请求经 codec 解码成英文键，响应由后端用 z.encode 把英文键编码回中文。
// 所以 z.input 是接口上的写法，z.output 是代码里的写法。
// 路径、名称和原因只查类型，写得对不对由内核查，报错写明怎么改。

const timestamp = z.iso.datetime({ offset: true });

// ── 请求 ──

/** 登记一个项目：POST /projects，ploop init 用。编号由后端生成，第 1 版同时建好。 */
export const projectRegisterSchema = z.strictObject({
  /** 项目根目录，命令行交来的绝对路径。 */
  root: z.string(),
  /** 页头上的系统名。不写时用根目录的名字。 */
  name: z.string().optional(),
  repoKind: repoKind.codec,
  /** 命令行把忽略规则写在了哪个文件。 */
  ignoreFile: z.string().optional(),
  /** 迁移前的旧数据在哪里。体检登记旧项目时写，写了就要等迁移完成才能改数据。 */
  legacySource: z.string().optional(),
});

/** 改项目：PATCH /projects/:pid，ploop init 重跑时用。没写的不改。 */
export const projectUpdateSchema = z.strictObject({
  name: z.string().optional(),
  repoKind: repoKind.codec.optional(),
  /** 写 null 表示不再记忽略规则的位置。 */
  ignoreFile: z.string().nullable().optional(),
  /** 加上的根目录，例如 git 的另一个工作目录。 */
  addRoots: z.array(z.string()).optional(),
  /** 删掉的根目录。项目至少要留一个。 */
  removeRoots: z.array(z.string()).optional(),
});

/**
 * GET /projects 的查询参数。写了 path 就按路径找项目，只认登记过的根目录。
 * 不写时列出所有项目的状态，ploop status --all 和所有项目的看板用。
 */
export const projectQuerySchema = z.strictObject({ path: z.string().optional() });

// ── 响应 ──

/** 一个项目，对应内核的 ProjectView。 */
export const projectViewSchema = z.strictObject({
  id: projectIdSchema,
  /** 页头上的系统名。 */
  name: z.string(),
  repoKind: repoKind.codec,
  ignoreFile: z.string().nullable(),
  /** 停在哪一版 skill。迁移完成以前为空。 */
  skillVersion: z.string().nullable(),
  legacySource: z.string().nullable(),
  /** 登记过的根目录，按登记的先后排。 */
  roots: z.array(z.string()).readonly(),
  createdAt: timestamp,
});

/** 登记的结果：项目和建好的第 1 版。 */
export const registeredProjectSchema = z.strictObject({
  project: projectViewSchema,
  version: z.int().min(1),
});

/** 按路径找到的项目，和路径所在的那个根目录。 */
export const foundProjectSchema = z.strictObject({
  project: projectViewSchema,
  root: z.string(),
});

/** 一版，对应内核的 VersionView。 */
export const versionViewSchema = z.strictObject({
  version: z.int().min(1),
  status: versionStatus.codec,
  startedAt: timestamp,
  endedAt: timestamp.nullable(),
  /** 一句话小结。 */
  summary: z.string().nullable(),
  /** 这一版结束的原因：提前结束时写的原因，或提升轮收尾以后自动结束的说明。 */
  endReason: z.string().nullable(),
});

/** 一轮，对应内核的 RoundView。 */
export const roundViewSchema = z.strictObject({
  /** 轮次的写法，例如 v2-落地-3。 */
  label: roundLabelSchema,
  version: z.int().min(1),
  stage: stage.codec,
  seq: z.int().min(1),
  status: roundStatus.codec,
  startedAt: timestamp,
  closedAt: timestamp.nullable(),
  /** 迁移前的旧编号，例如 fix-13。 */
  legacyId: z.string().nullable(),
  /** 收尾时写的一句话小结。没收尾或没写时为空。项目页的进度格子悬停时显示。 */
  summary: z.string().nullable(),
});

/** 项目要先体检的原因，见「08 版本与迁移」第三、四节。 */
export const doctorReason = defineEnum({
  migrationIncomplete: "迁移未完成",
  skillOutdated: "停在旧版本",
});

/** 项目停在的 skill 版本和这一版软件比较的结果。 */
export const skillStateSchema = z.strictObject({
  version: z.string().nullable(),
  /** 这一版软件自带的 skill 版本。 */
  current: z.string(),
  /** 要先体检的原因。不用体检时为空。 */
  doctor: doctorReason.codec.nullable(),
  /** 有项目还没用上的规则，ploop status 要写一句。 */
  newerRules: z.boolean(),
});

/**
 * 在等的一页。页面的编号是后端生成的全局整数（第一期约定第 4 条），只在机器读的输出里用；
 * 对用户写的是它在这个阶段里的第几页，也就是 seq。
 */
export const waitingPageSchema = z.strictObject({
  id: z.int().min(1),
  /** 这一页在所在阶段里的第几页，从 1 数。 */
  seq: z.int().min(1),
  round: roundLabelSchema,
  purpose: pagePurpose.codec,
  presentedAt: timestamp,
});

/** 一个阶段在队列里还没做完的件数。 */
export const queueCountSchema = z.strictObject({
  stage: stage.codec,
  count: z.int().min(0),
  /** 其中停了七天以上的件数：待办或等待，最近一次变动在七天以前。 */
  stale: z.int().min(0),
});

/** 主线缺哪几样，按十样和设计规范十二样的顺序，见「07 校验」第四节。 */
export const mainlineStatusSchema = z.strictObject({
  /** 最新的主线版本号。还没交过主线时为空。 */
  revision: z.int().min(1).nullable(),
  missingParts: z.array(mainlinePart.codec).readonly(),
  missingDesignSpec: z.array(designSpecItem.codec).readonly(),
});

/**
 * 一个项目的状态，内容和 ploop status 的输出一致。
 * 内核给的下一步和警告由接口层放进响应外壳的 next 和 warnings，这里不重复。
 */
export const projectStatusSchema = z.strictObject({
  project: projectViewSchema,
  /** 当前的一版。 */
  version: versionViewSchema,
  /** 当前的一版里最近的一轮。还没开始任何阶段时为空。 */
  round: roundViewSchema.nullable(),
  waitingPages: z.array(waitingPageSchema).readonly(),
  /** 五个阶段各一项，按阶段的顺序排。 */
  queue: z.array(queueCountSchema).readonly(),
  skill: skillStateSchema,
  mainline: mainlineStatusSchema,
  /** 最近一次改动的时间。 */
  lastChangedAt: timestamp,
  /** 从最近一次改动到现在停了几天。 */
  idleDays: z.int().min(0),
});

/** 所有项目的状态：GET /projects，有页在等的排在最前，其余按最近的改动排。 */
export const projectStatusListSchema = z.array(projectStatusSchema).readonly();
