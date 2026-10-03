import { z } from "zod";
import { queueStatus, roundStatus, skillIssueStatus } from "../names.ts";
import { doctorReason } from "./projects.ts";

// skill 的问题的接口：请求和响应的定义，路径见「05 接口」第四节的「skill 的问题和信号」。
// 字段见「03 数据模型」第二节的 skill_issue。项目、轮次和 skill 版本由后端从项目取，
// 请求里只写哪个项目。枚举在接口上写中文，见约定 0002 第 1 条。

const timestamp = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1);

/** 报一个问题：POST /skill/issues，ploop skill report 用。 */
export const skillIssueReportSchema = z.strictObject({
  project: z.string(),
  /** 哪个方面，例如页面、命令、正文。 */
  aspect: text,
  /** 问题的类：一句话写这一类问题是什么。 */
  issueClass: text,
  /** 原始情况，作为例子附上。 */
  example: text,
});

/** 一个问题。 */
export const skillIssueSchema = z.strictObject({
  id: z.int().min(1),
  project: z.string(),
  /** 报告时开着的一轮，或最近的一轮，写成 v2-检查-1。项目还没有轮次时为空。 */
  round: z.string().nullable(),
  reportedAt: timestamp,
  /** 报告者：客户端和版本，例如 cli/2.0.0。 */
  reporter: z.string(),
  aspect: z.string(),
  issueClass: z.string(),
  example: z.string(),
  /** 报告时项目用的 skill 版本。 */
  skillVersion: z.string().nullable(),
  status: skillIssueStatus.codec,
  /** 处理说明：回的理解、不改的理由。 */
  note: z.string().nullable(),
  /** 在哪一版改的。 */
  fixedIn: z.string().nullable(),
  updatedAt: timestamp,
});

/** GET /skill/issues 的查询参数：按状态和项目筛。 */
export const skillIssueQuerySchema = z.strictObject({
  status: skillIssueStatus.codec.optional(),
  project: z.string().optional(),
});

export const skillIssueListSchema = z.array(skillIssueSchema).readonly();

/** 处理一个问题：PATCH /skill/issues/:id。回理解和不改要写说明，改了要写在哪一版。 */
export const skillIssuePatchSchema = z.strictObject({
  status: skillIssueStatus.codec,
  note: text.optional(),
  fixedIn: text.optional(),
});

// ── 三类信号：GET /skill/signals，见「06 工作台」第七节 ──

/** 反复被拦截的规矩：最近十四天里被拦截两次以上、次数最多的几条。一次不叫反复。 */
export const blockedRuleSignalSchema = z.strictObject({
  /** 规矩的编号，例如 writing.sentence.tooLong。工作台不写它，写 summary。 */
  rule: z.string(),
  /** 这条规矩查什么，一句话，取自规则登记表。表里没有这条规矩（旧版本留下的记录）时为空。 */
  summary: z.string().nullable(),
  /** 最近十四天被拦截的次数，至少两次。 */
  count: z.int().min(2),
  /** 涉及几个项目。 */
  projects: z.int().min(1),
  /** 涉及的项目编号，按拦截次数从多到少排，页面据此进到项目页。 */
  projectIds: z.array(z.string()).readonly(),
  /** 最近一次的报错原文。 */
  latestMessage: z.string(),
  latestAt: timestamp,
});

/** 停在旧版本的项目。skillVersion 为空表示迁移还没完成。 */
export const outdatedProjectSignalSchema = z.strictObject({
  project: z.string(),
  name: z.string(),
  skillVersion: z.string().nullable(),
  /** 迁移未完成，或停在旧版本。 */
  reason: doctorReason.codec,
});

/** 进行中超过三天没有变化的轮次。 */
export const stalledRoundSignalSchema = z.strictObject({
  project: z.string(),
  name: z.string(),
  round: z.string(),
  status: roundStatus.codec,
  /** 这个项目最近一次有改动的时间，没有改动就是这一轮开始的时间。 */
  lastChangedAt: timestamp,
  /** 停了几整天。 */
  days: z.int().min(0),
});

/** 待办或进行中超过七天没有变化的队列事项。 */
export const stalledQueueSignalSchema = z.strictObject({
  project: z.string(),
  name: z.string(),
  /** 事项编号，例如 Q12。 */
  item: z.string(),
  content: z.string(),
  status: queueStatus.codec,
  lastChangedAt: timestamp,
  days: z.int().min(0),
});

/** GET /skill/signals 的结果，三类信号都由后端从数据里算出，不靠谁报告。 */
export const skillSignalsSchema = z.strictObject({
  blockedRules: z.array(blockedRuleSignalSchema).readonly(),
  outdatedProjects: z.array(outdatedProjectSignalSchema).readonly(),
  stalledRounds: z.array(stalledRoundSignalSchema).readonly(),
  stalledQueueItems: z.array(stalledQueueSignalSchema).readonly(),
});
