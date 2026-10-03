import { researchCopy } from "../copy/research.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { AskCard } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import {
  researchApprovedSamples,
  researchReasonSamples,
  researchTierSamples,
} from "./research.samples.ts";
import { defineRule, type Rule, type RuleContextOf, type RuleScope } from "./rule.ts";

// 调研分档的规则，见「07 校验」第四节的 check_research 和决定 92：不查写明理由，
// 深查先把问句和检索计划给用户批。照旧 build-report.py 的第 445 到 460 行：
// - 只在构思查，只查疑问卡。
// - 只查来源里有外面的东西的疑问卡，也就是有一条来源标了 outside。没有外面来源的卡，
//   写了调研也不查理由和批的计划，和旧脚本相同。
// research 写成对象、tier 取三档之一，由数据定义查，见 page/card.ts。
// 旧脚本遇到第一处就停下，这里每一处各报一次。

/** 调研分档的三道检查加进构建校验的那一天，提交 a93c3df。 */
const researchAdded = "2026-09-21";

const onAsks: RuleScope = {
  subjects: ["page"],
  stages: ["think"],
  sections: ["asks"],
  commands: ["page check", "page present"],
};

/** 来源里有外面的东西的疑问卡，连同它是第几张。 */
function outsideAsks(page: PageSections): { readonly card: AskCard; readonly index: number }[] {
  return (page.asks ?? []).flatMap((card, index) =>
    card.sources.some((source) => source.outside === true) ? [{ card, index }] : [],
  );
}

/** 规则 research.tier：带着外面来源、没写调研的疑问卡各报一处。 */
const researchTier = defineRule({
  id: "research.tier",
  level: "block",
  scope: onAsks,
  since: researchAdded,
  needs: [],
  about: rulesCopy.about.research.tier,
  copy: researchCopy.tier,
  check: (page: PageSections) =>
    outsideAsks(page).flatMap(({ card, index }) =>
      card.research === undefined
        ? [{ where: ["asks", index, "research"], params: { title: card.title } }]
        : [],
    ),
  samples: researchTierSamples,
});

/** 规则 research.reason：写了不查、没写理由的各报一处。 */
const researchReason = defineRule({
  id: "research.reason",
  level: "block",
  scope: onAsks,
  since: researchAdded,
  needs: [],
  about: rulesCopy.about.research.reason,
  copy: researchCopy.reason,
  check: (page: PageSections) =>
    outsideAsks(page).flatMap(({ card, index }) =>
      card.research?.tier === "none" && card.research.reason === undefined
        ? [{ where: ["asks", index, "research", "reason"], params: { title: card.title } }]
        : [],
    ),
  samples: researchReasonSamples,
});

/** 规则 research.approved：写了深查、没写哪一轮批的各报一处。 */
const researchApproved = defineRule({
  id: "research.approved",
  level: "block",
  scope: onAsks,
  since: researchAdded,
  needs: [],
  about: rulesCopy.about.research.approved,
  copy: researchCopy.approved,
  check: (page: PageSections) =>
    outsideAsks(page).flatMap(({ card, index }) =>
      card.research?.tier === "deep" && card.research.approved === undefined
        ? [{ where: ["asks", index, "research", "approved"], params: { title: card.title } }]
        : [],
    ),
  samples: researchApprovedSamples,
});

/** 调研分档的规则，登记在 registry.ts。 */
export const researchRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  researchTier,
  researchReason,
  researchApproved,
];
