import type { RuleContextOf, RuleSamples } from "@product-loop/model";
import { basePage } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 page.oneWaiting 的样本。基础数据：要给出一页要用户点的，没有别的页在等。
// 要给出的是只看的页时，有页在等也不报，见 registry.test.ts 里的用例。

type Context = RuleContextOf<"waitingPages">;

const subject: PresentSubject = { page: basePage, purpose: "ask" };

export const oneWaitingSamples: RuleSamples<PresentSubject, Context> = {
  base: { subject, context: { waitingPages: [] } },
  hits: [
    {
      why: "上一页还在等用户点，又要给出一页",
      subject,
      context: { waitingPages: [{ id: 12, seq: 2, round: "v2-检查-1" }] },
      expect: [{ where: "第 2 版的检查阶段", params: { round: "第 2 版的检查阶段", page: 2 } }],
    },
  ],
};
