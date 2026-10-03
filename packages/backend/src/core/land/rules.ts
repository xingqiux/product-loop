// 落地五步的规矩编号，写法见维护说明第一节。检查写在各个用例里，
// 说明登记在 model 的 rules/backend.ts 的 landRuleInfo，后端的总测试核对两边一一对应。
// land.change.planned 和 land.oneCommit 取自「07 校验」第四节，其余沿用旧 land.py 的检查，
// 另有「07 校验」第六节加的三条：命令不同、提交更早、超过界线却跳过评审。

export const landRules = {
  /** 计划七节都在，每节有正文，只写一次。旧 land.py 的 check_plan。 */
  planSections: "land.plan.sections",
  /** 「要不要先重构」写要或不要，写不要时带理由。旧 land.py 的 check_plan。 */
  planTidy: "land.plan.tidy",
  /** 五步按顺序记：先计划，再重构，再先失败后通过，全部通过以后评审。 */
  order: "land.order",
  /** 计划写了要重构时，不能跳过重构。 */
  tidySkip: "land.tidy.skip",
  /** 重构以后检查命令要通过，重构不该改变任何行为。 */
  tidyPassed: "land.tidy.passed",
  /** 重构单独提交：检查时的提交不是这一轮开始时的提交。 */
  tidyCommitted: "land.tidy.committed",
  /**
   * 检查命令原样写在计划里：重构的写在「用什么锁住现有的行为」，功能改动的写在这一件下面。
   * 功能改动要是计划「功能改动」里的一件，对应的队列事项要在这一批里（「07 校验」第四节）。
   */
  changePlanned: "land.change.planned",
  /** 改之前的检查要失败，并且命令真的跑起来了。 */
  redFailed: "land.red.failed",
  /** 通过时用的是失败时的那条命令（「07 校验」第六节加的第一条）。 */
  greenSameCommand: "land.green.sameCommand",
  /** 改之后的检查要通过。 */
  greenPassed: "land.green.passed",
  /** 通过时的提交在失败时的提交之后（「07 校验」第六节加的第二条）。 */
  greenLater: "land.green.later",
  /** 重构、失败、通过的运行都记下当时的提交。 */
  commitRecorded: "land.commit.recorded",
  /** 失败和通过之间多于一个提交时警告（「07 校验」第四节）。 */
  oneCommit: "land.oneCommit",
  /** 评审的每条意见指到文件和行。旧 land.py 的 check_review。 */
  reviewLocated: "land.review.located",
  /** 阻塞的意见写了处置。旧 land.py 的 check_review。 */
  reviewDisposed: "land.review.disposed",
  /** 改动超过评审界线时要评审，不能跳过（决定 173，「07 校验」第六节加的第三条）。 */
  reviewRequired: "land.review.required",
  /**
   * 给出验收页和收尾时，计划、重构、先失败后通过和评审四步都有记录（「07 校验」第四节）。
   * 检查在 core/pages/check.ts 和 core/rounds/close.ts。收尾时只在有做完的事时查。
   */
  steps: "land.steps",
  /** 收尾时工作区没有未提交的改动，退回的事写明退回哪个阶段（「07 校验」第四节）。 */
  commitClean: "land.commit.clean",
  /** 收尾落地轮以前，这一轮至少给用户看过一页带更改的页，见决定 206。检查和提升的收尾不查。 */
  pageShown: "land.page.shown",
  /** 用户对某条更改点了不认可，对应的事不能记成做完，要退回。落地的收尾一节，决定 136。 */
  changeRejected: "land.change.rejected",
} as const;
