import type { RuleContextOf, RuleSamples } from "@product-loop/model";
import { basePage, pageWith } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 page.cards.none 的样本。基础数据：要用户点的一页，有一张疑问卡和一条更改。

type Context = RuleContextOf<never>;

const context: Context = {};

/** 只有参考没有卡的页面数据。 */
const onlyRefs = pageWith((page) => {
  Reflect.deleteProperty(page, "asks");
  Reflect.deleteProperty(page, "changes");
});

export const cardsNoneSamples: RuleSamples<PresentSubject, Context> = {
  base: { subject: { page: basePage, purpose: "ask" }, context },
  hits: [
    {
      why: "页面数据里一张卡都没有，要用户点",
      subject: { page: {}, purpose: "ask" },
      expect: [{ params: {} }],
    },
    {
      why: "卡都删了，只剩没有卡的区块",
      subject: { page: onlyRefs, purpose: "ask" },
      expect: [{ params: {} }],
    },
  ],
};
