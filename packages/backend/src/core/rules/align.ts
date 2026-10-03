import { defineRule, presentRuleInfo } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import { unclearRewordedSamples } from "./align.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 align.unclear.reworded：上一份回复里点了不明白的术语，这一页要换一种讲法。
// 见「07 校验」第四节的 check_align 和「04 命令行」第十节：这一页的先对齐里，
// 同名的一项意思和例子都没变时警告。只改了其中一样就算换了讲法。
// 这一页的先对齐里没有这个术语时不报，也许这一页已经用不到它。
// 名称、意思和例子都去掉首尾的空白再比。上一份回复点了不明白的术语由后端从数据库取出，
// 取法见 core/replies/pending.ts 的 unclearTermsOf。

export const unclearReworded = defineRule({
  ...presentRuleInfo.unclearReworded,
  copy: backendRulesCopy.unclearReworded,
  check: (subject: PresentSubject, context) =>
    (subject.page.align ?? []).flatMap((term, i) => {
      const same = context.unclearTerms.find(
        (old) =>
          old.name.trim() === term.name.trim() &&
          old.meaning.trim() === term.meaning.trim() &&
          old.example.trim() === term.example.trim(),
      );
      return same === undefined
        ? []
        : [{ where: ["align", i], params: { round: same.round, name: term.name.trim() } }];
    }),
  samples: unclearRewordedSamples,
});
