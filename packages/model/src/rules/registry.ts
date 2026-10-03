import { decisionFields } from "../decision.ts";
import { alignRuleList } from "./align.ts";
import { cardRuleList } from "./cards.ts";
import { designRuleList } from "./design.ts";
import { diagramRuleList } from "./diagram.ts";
import { lengthRuleList } from "./length.ts";
import { optionRuleList } from "./options.ts";
import { pastedRuleList } from "./pasted.ts";
import { researchRuleList } from "./research.ts";
import type { Rule } from "./rule.ts";
import { scenesRuleList } from "./scenes.ts";
import { screensRuleList } from "./screens.ts";
import { sourceRuleList } from "./sources.ts";
import { specRuleList } from "./spec.ts";
import { titleRuleList } from "./titles.ts";
import { writingRuleList } from "./writing.ts";

// 共用定义里全部规则的登记处，见「07 校验」第三节和第八节。
// 总测试逐条查登记的规则：编号、样本、文案表里的报错、维护说明里的一行，缺一样就失败。
// 后端的规则要查数据库，检查写在后端。它们的说明登记在 backend.ts，和这里的一起查重、生成规则表。

/** 登记几组规则。顺序就是维护说明里的顺序，编号在全部规则里不能重复，由总测试查。 */
export function defineRules(...groups: readonly (readonly Rule[])[]): readonly Rule[] {
  return Object.freeze(groups.flat());
}

const registered = defineRules(
  writingRuleList,
  [decisionFields],
  lengthRuleList,
  diagramRuleList,
  alignRuleList,
  sourceRuleList,
  cardRuleList,
  optionRuleList,
  titleRuleList,
  scenesRuleList,
  specRuleList,
  designRuleList,
  researchRuleList,
  pastedRuleList,
  screensRuleList,
);

/** 共用定义里的全部规则。 */
export function allRules(): readonly Rule[] {
  return registered;
}

/** 已经定了编号、还没写成规则的一项。 */
export type PendingRule = {
  readonly id: string;
  /** 「07 校验」或第一期计划里的写法，和编号不同时写。 */
  readonly designId?: string;
  /** 现在在哪里：已有的检查写代码的位置，还没有的写第一期计划的哪一步写它。 */
  readonly now: string;
};

/**
 * 已经定了编号、还没写成规则的检查。搬进规则框架时，按维护说明登记，再从这里删掉。
 * 后端的规则登记在 backend.ts，检查写在用例里的也登记在那里。
 * 总测试查它们的编号也守同一种写法，并且不和已登记的重复。
 * 设计文档里带短横的编号，一律改成小驼峰。
 */
export const pendingRules: readonly PendingRule[] = [];
