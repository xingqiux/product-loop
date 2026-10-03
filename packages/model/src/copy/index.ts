import { alignCopy } from "./align.ts";
import { cardRulesCopy } from "./card-rules.ts";
import { type CopyItem, flattenCopy } from "./define.ts";
import { designCopy } from "./design.ts";
import { diagramCopy } from "./diagram.ts";
import { backendCopy, envelopeCopy, errorCodeCopy, exitCodeCopy, parseCopy } from "./errors.ts";
import { landCopy } from "./land.ts";
import { legacyPageCopy } from "./legacy-convert.ts";
import { legacyReplyCopy } from "./legacy-reply.ts";
import { legacyDecisionCopy, legacyQueueCopy } from "./legacy-tables.ts";
import { mainlineCopy } from "./mainline.ts";
import { formatChangeCopy, pageCopy } from "./page.ts";
import { pageFieldCopy } from "./page-fields.ts";
import { decisionCopy, queueCopy, replyCopy, textFieldCopy } from "./records.ts";
import { researchCopy } from "./research.ts";
import { rulesCopy } from "./rules.ts";
import { scenesCopy } from "./scenes.ts";
import { screensCopy } from "./screens.ts";
import { specCopy } from "./spec.ts";
import { useCopy } from "./use.ts";
import { writingCopy, writingHintCopy } from "./writing.ts";

// 文案表的汇总。文案按领域分文件，减少并行开发时的合并冲突，见第一期计划第二节。
// 新加一个领域的文件时，在这里导出，并加进 allCopy()。

export * from "./align.ts";
export * from "./card-rules.ts";
export * from "./define.ts";
export * from "./design.ts";
export * from "./diagram.ts";
export * from "./errors.ts";
export * from "./land.ts";
export * from "./legacy-convert.ts";
export * from "./legacy-reply.ts";
export * from "./legacy-tables.ts";
export * from "./mainline.ts";
export * from "./page.ts";
export * from "./page-fields.ts";
export * from "./records.ts";
export * from "./research.ts";
export * from "./rules.ts";
export * from "./scenes.ts";
export * from "./screens.ts";
export * from "./spec.ts";
export * from "./use.ts";
export * from "./writing.ts";

/** 全部文案，第 16 步对它跑写作校验。键在全表里唯一。 */
export function allCopy(): CopyItem[] {
  return [
    ...errorCodeCopy.flatMap(({ code, ...texts }) => flattenCopy(`errorCode.${code}`, texts)),
    ...flattenCopy("exitCode", exitCodeCopy),
    ...flattenCopy("backend", backendCopy),
    ...flattenCopy("parse", parseCopy),
    ...flattenCopy("envelope", envelopeCopy),
    ...flattenCopy("land", landCopy),
    ...flattenCopy("mainline", mainlineCopy),
    ...flattenCopy("use", useCopy),
    ...flattenCopy("textField", textFieldCopy),
    ...flattenCopy("queue", queueCopy),
    ...flattenCopy("decision", decisionCopy),
    ...flattenCopy("reply", replyCopy),
    ...flattenCopy("legacyReply", legacyReplyCopy),
    ...flattenCopy("writing", writingCopy),
    ...flattenCopy("writingHint", writingHintCopy),
    ...flattenCopy("page", pageCopy),
    ...flattenCopy("formatChange", formatChangeCopy),
    ...flattenCopy("pageField", pageFieldCopy),
    ...flattenCopy("rules", rulesCopy),
    ...flattenCopy("legacyPage", legacyPageCopy),
    ...flattenCopy("diagram", diagramCopy),
    ...flattenCopy("align", alignCopy),
    ...flattenCopy("card", cardRulesCopy),
    ...flattenCopy("scenes", scenesCopy),
    ...flattenCopy("spec", specCopy),
    ...flattenCopy("design", designCopy),
    ...flattenCopy("research", researchCopy),
    ...flattenCopy("screens", screensCopy),
    ...flattenCopy("legacyQueue", legacyQueueCopy),
    ...flattenCopy("legacyDecision", legacyDecisionCopy),
  ];
}
