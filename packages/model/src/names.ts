import { defineEnum, type KeyOf, type LabelOf } from "./enum.ts";

// 名称表：取值按「03 数据模型」第二节。数据库里存英文键，对外一律显示中文。

/** 五个阶段名，顺序就是一版里走的顺序。英文键沿用旧页面文件名的前缀，迁移时容易对上。 */
export const stage = defineEnum({
  think: "构思",
  use: "使用",
  check: "检查",
  land: "落地",
  improve: "提升",
});
export type Stage = KeyOf<typeof stage>;
export type StageLabel = LabelOf<typeof stage>;

/** 改过名的阶段：旧名字只在迁移和报错里出现，不再收。 */
export const renamedStages: ReadonlyMap<string, StageLabel> = new Map([["修复", "落地"]]);

export const versionStatus = defineEnum({ open: "进行中", closed: "已结束" });
export type VersionStatus = KeyOf<typeof versionStatus>;

export const roundStatus = defineEnum({
  open: "进行中",
  waiting: "等用户回复",
  replied: "已回复",
  closed: "已收尾",
});
export type RoundStatus = KeyOf<typeof roundStatus>;

/** 开始阶段时拿出的事，收尾时的结果。 */
export const roundItemResult = defineEnum({
  done: "做完",
  returned: "退回",
  droppedAtStart: "开始时取消",
});
export type RoundItemResult = KeyOf<typeof roundItemResult>;

export const pagePurpose = defineEnum({ ask: "要用户点", view: "只看" });
export type PagePurpose = KeyOf<typeof pagePurpose>;

export const pageStatus = defineEnum({
  presented: "已给出",
  replied: "已回复",
  withdrawn: "已撤回",
});
export type PageStatus = KeyOf<typeof pageStatus>;

export const replyLineKind = defineEnum({
  option: "选了选项",
  agree: "同意",
  reject: "否决",
  keep: "保留",
  modify: "修改",
  remove: "删除",
  understood: "明白",
  notUnderstood: "不明白",
  noteOnly: "只写了备注",
  idea: "想法",
  queueDrop: "取消队列事项",
  changeRejected: "不认可一条更改",
  changeApproved: "认可一条更改",
});
export type ReplyLineKind = KeyOf<typeof replyLineKind>;

/** 一行回复处理以后的去处，共五种。 */
export const destination = defineEnum({
  mainline: "主线",
  decision: "决定",
  queue: "队列",
  doneHere: "当场做",
  noAction: "不处理",
});
export type Destination = KeyOf<typeof destination>;

export const queueStatus = defineEnum({
  todo: "待办",
  doing: "进行中",
  waiting: "等待",
  done: "已完成",
  dropped: "已取消",
});
export type QueueStatus = KeyOf<typeof queueStatus>;

export const proposer = defineEnum({
  user: "用户",
  ai: "AI",
  review: "评审",
  otherProject: "别的项目",
});
export type Proposer = KeyOf<typeof proposer>;

export const decisionKind = defineEnum({ decision: "决定", later: "以后再说" });
export type DecisionKind = KeyOf<typeof decisionKind>;

export const decisionStatus = defineEnum({ active: "有效", voided: "已作废" });
export type DecisionStatus = KeyOf<typeof decisionStatus>;

export const mainlineSource = defineEnum({
  cache: "项目缓存",
  migration: "迁移",
  reply: "处理回复",
});
export type MainlineSource = KeyOf<typeof mainlineSource>;

export const submissionSource = defineEnum({
  workbench: "工作台",
  legacyTemplate: "旧模板",
  chat: "对话",
});
export type SubmissionSource = KeyOf<typeof submissionSource>;

/** 迁移走到了哪一步，见「08 版本与迁移」第四节。完成以后项目才能改数据。 */
export const legacyMigrationStatus = defineEnum({
  archived: "已归档",
  imported: "已导入",
  completed: "已完成",
});
export type LegacyMigrationStatus = KeyOf<typeof legacyMigrationStatus>;

export const commandRunPurpose = defineEnum({
  tidyCheck: "重构后的检查",
  red: "改前失败",
  green: "改后通过",
  useCode: "使用代码",
  other: "其他",
});
export type CommandRunPurpose = KeyOf<typeof commandRunPurpose>;

export const useStepResult = defineEnum({
  pass: "通过",
  broken: "断了",
  skipped: "没走",
  environment: "环境",
});
export type UseStepResult = KeyOf<typeof useStepResult>;

export const skillIssueStatus = defineEnum({
  new: "新",
  understood: "已理解",
  confirmed: "已确认",
  fixed: "已改",
  wontFix: "不改",
});
export type SkillIssueStatus = KeyOf<typeof skillIssueStatus>;

export const ruleLevel = defineEnum({ block: "拦截", warn: "警告" });
export type RuleLevel = KeyOf<typeof ruleLevel>;

export const repoKind = defineEnum({ own: "自己的", shared: "共用的" });
export type RepoKind = KeyOf<typeof repoKind>;

export const draftRevisionReason = defineEnum({
  beforeDelete: "删之前",
  timer: "定时",
  beforeRestore: "放回之前",
});
export type DraftRevisionReason = KeyOf<typeof draftRevisionReason>;

/** 一个阶段的四步。 */
export const roundStep = defineEnum({
  start: "开始",
  present: "给出信息",
  reply: "回复",
  handle: "处理",
});
export type RoundStep = KeyOf<typeof roundStep>;

/** 评审意见的两级，沿用旧 land.py 的「阻塞」「建议」。 */
export const reviewLevel = defineEnum({ block: "阻塞", suggest: "建议" });
export type ReviewLevel = KeyOf<typeof reviewLevel>;

/**
 * 落地五步里重构和评审这两步的状态，见 backend 的 core/land/status.ts。
 * 过期指记过，但后来的记录让它不再算数，要重记。
 */
export const landStepState = defineEnum({
  missing: "还没记",
  skipped: "跳过了",
  done: "记了",
  stale: "要重记",
});
export type LandStepState = KeyOf<typeof landStepState>;

/** 一件功能改动的状态：还没有失败的记录、只有失败的记录、先失败后通过。 */
export const landChangeState = defineEnum({
  notStarted: "还没开始",
  failed: "只有失败",
  passed: "先失败后通过",
});
export type LandChangeState = KeyOf<typeof landChangeState>;

/** 一屏在某一版的情况：这一版第一次截到、和上一版比变过、没变。 */
export const screenStatus = defineEnum({ new: "新出现", changed: "变过", same: "没变" });
export type ScreenStatus = KeyOf<typeof screenStatus>;

/** 全部名称表，测试和生成文档时逐个检查。 */
export const allEnums = {
  stage,
  versionStatus,
  roundStatus,
  roundItemResult,
  pagePurpose,
  pageStatus,
  replyLineKind,
  destination,
  queueStatus,
  proposer,
  decisionKind,
  decisionStatus,
  mainlineSource,
  submissionSource,
  legacyMigrationStatus,
  commandRunPurpose,
  useStepResult,
  skillIssueStatus,
  ruleLevel,
  repoKind,
  draftRevisionReason,
  roundStep,
  reviewLevel,
  landStepState,
  landChangeState,
  screenStatus,
};
