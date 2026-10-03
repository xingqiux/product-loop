import { countCards, defineRule, presentRuleInfo } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import { cardsNoneSamples } from "./cards.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 page.cards.none：要用户点的页至少有一张卡，只看的页可以没有。
// 空页面让 AI 在 ploop reply wait 上白等，用户什么也点不了。使用阶段的页是只看的，系统填内容，可以空。

export const cardsNone = defineRule({
  ...presentRuleInfo.cardsNone,
  copy: backendRulesCopy.cardsNone,
  check: (subject: PresentSubject) =>
    subject.purpose === "ask" && countCards(subject.page) === 0 ? [{ params: {} }] : [],
  samples: cardsNoneSamples,
});
