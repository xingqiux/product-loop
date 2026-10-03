import type { z } from "zod";
import { type CopyEntry, type ParamNames, type ParamValue, renderCopy } from "../copy/define.ts";

// 页面数据的定义分两种报错。
// - Zod 的通用问题：缺字段、类型不对、取值不在枚举里、不认识的字段。按问题的种类写成中文，
//   见 messages.ts。check-page.ts 另给每条配上「怎么改」。
// - 定义自己查的：编号和路径的写法、字段之间的对应关系。报错带文案表里的「什么不对」和「怎么改」，
//   见「04 命令行」第六节。

/** 定义自己报的问题，放在 Zod 问题的 params 里。 */
export type PageIssueParams = {
  /** 查的是哪一项，写文案表里这条报错的键，例如 page.source.twoForms。 */
  readonly check: string;
  /** 怎么改，已经填好参数。 */
  readonly hint: string;
};

/** 一条报错的文案：什么不对，怎么改。 */
export type IssueCopy = { readonly message: CopyEntry; readonly hint: CopyEntry };

/** 两句文案里的参数合在一起，一个都不能少。 */
export type IssueValues<C extends IssueCopy> = {
  readonly [Name in ParamNames<C["message"]["text"]> | ParamNames<C["hint"]["text"]>]: ParamValue;
};

/** 在 Zod 的检查里报一个问题。path 相对于正在检查的那一层。 */
export function reportIssue<C extends IssueCopy>(
  ctx: z.RefinementCtx<unknown>,
  check: string,
  entry: C,
  values: IssueValues<C>,
  path: readonly PropertyKey[] = [],
): void {
  const message: CopyEntry = entry.message;
  const hint: CopyEntry = entry.hint;
  const params: PageIssueParams = { check, hint: renderCopy(hint, values) };
  ctx.addIssue({ code: "custom", message: renderCopy(message, values), path: [...path], params });
}

/** 读 Zod 问题里定义自己写的附加信息；通用的问题没有，返回 undefined。 */
export function pageIssueParams(issue: z.core.$ZodIssue): PageIssueParams | undefined {
  if (issue.code !== "custom") return undefined;
  const { check, hint } = issue.params ?? {};
  return typeof check === "string" && typeof hint === "string" ? { check, hint } : undefined;
}
