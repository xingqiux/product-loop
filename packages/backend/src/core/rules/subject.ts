import type { PagePurpose, PageSections, RuleContextOf } from "@product-loop/model";

// 后端给出信息时的规则查的数据和要的上下文，见「07 校验」第三节和第四节。
// 页面数据是通过了数据定义的，枚举是英文键。页面表和卡片表在第 40 步加，
// 所以查的是这一页本身，别的页由调用的一方从数据库取好，写进上下文。

/** 要给出的一页：页面数据和用途。只看的页不占「一页在等」的名额，见「04 命令行」第十节。 */
export type PresentSubject = {
  readonly page: PageSections;
  readonly purpose: PagePurpose;
};

/** 给出信息的几条规则合起来要的上下文。每条规则只拿到自己在 needs 里写的几样。 */
export type PresentContext = RuleContextOf<
  "batch" | "waitingPages" | "images" | "unhandledReplies" | "unclearTerms" | "changedScreens"
>;
