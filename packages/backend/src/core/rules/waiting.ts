import { defineRule, presentRuleInfo, roundNameOfLabel } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import type { PresentSubject } from "./subject.ts";
import { oneWaitingSamples } from "./waiting.samples.ts";

// 规则 page.oneWaiting：同一项目同一时间只有一页在等用户点，见「07 校验」第四节。
// 只看的页不算，见「04 命令行」第十节：要给出的是只看的页时不查，在等的页里也不列只看的页。
// 在等的页由调用的一方从数据库取出。给出信息的写事务里再取一次，前提在事务里重新确认。

export const oneWaiting = defineRule({
  ...presentRuleInfo.oneWaiting,
  copy: backendRulesCopy.oneWaiting,
  check: (subject: PresentSubject, context) =>
    subject.purpose === "view"
      ? []
      : context.waitingPages.map((page) => ({
          where: roundNameOfLabel(page.round),
          params: { round: roundNameOfLabel(page.round), page: page.seq },
        })),
  samples: oneWaitingSamples,
});
