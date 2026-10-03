import { alignCopy } from "../copy/align.ts";
import { rulesCopy } from "../copy/rules.ts";
import type { PageSections } from "../page/sections.ts";
import { strip } from "../writing/python.ts";
import { alignNameUniqueSamples, alignUsedInMatchedSamples } from "./align.samples.ts";
import { defineRule, type Rule, type RuleContextOf, type RuleHit } from "./rule.ts";

// 先对齐的规则，见「07 校验」第四节的 check_align 和决定 114。
// 四项齐全、usedIn 至少写一项由数据定义查，见 page/align.ts。定义查不了的有两条：
// - usedIn 写的是本页疑问卡的标题。
// - 名称不重复。
// 上一轮点了不明白的术语这一轮换没换讲法，要看上一轮的回复，是后端的规则 align.unclear.reworded。
// 照旧 build-report.py 的第 524 到 545 行移植：标题一字不差地比，名称按 Python 的 strip() 去掉两头的空白再比。
// 旧脚本遇到第一处就停下。这里每一处各报一次。

/** 两道检查加进构建校验的那一天，提交 73fd0c0。 */
const alignAdded = "2026-09-21";

/** 规则 align.usedIn.matched：usedIn 里对不上本页疑问卡标题的每一项报一处。本页没有疑问卡时每一项都报。 */
export const alignUsedInMatched = defineRule({
  id: "align.usedIn.matched",
  level: "block",
  scope: {
    subjects: ["page"],
    sections: ["align", "asks"],
    commands: ["page check", "page present"],
  },
  since: alignAdded,
  needs: [],
  about: rulesCopy.about.align.usedIn.matched,
  copy: alignCopy.usedIn.matched,
  check: (page: PageSections) => {
    const titles = new Set((page.asks ?? []).map((card) => card.title));
    return (page.align ?? []).flatMap((term, i) =>
      term.usedIn.flatMap((title, j) =>
        titles.has(title)
          ? []
          : [{ where: ["align", i, "usedIn", j], params: { name: strip(term.name), title } }],
      ),
    );
  },
  samples: alignUsedInMatchedSamples,
});

/** 规则 align.name.unique：名称和前面某一项相同的，从第二次出现起每一项报一处。 */
export const alignNameUnique = defineRule({
  id: "align.name.unique",
  level: "block",
  scope: {
    subjects: ["page"],
    sections: ["align"],
    commands: ["page check", "page present"],
  },
  since: alignAdded,
  needs: [],
  about: rulesCopy.about.align.name.unique,
  copy: alignCopy.name.unique,
  check: (page: PageSections) => {
    const seen = new Set<string>();
    const hits: RuleHit<{ readonly name: string }>[] = [];
    (page.align ?? []).forEach((term, i) => {
      const name = strip(term.name);
      if (seen.has(name)) hits.push({ where: ["align", i, "name"], params: { name } });
      seen.add(name);
    });
    return hits;
  },
  samples: alignNameUniqueSamples,
});

/** 先对齐的规则，登记在 registry.ts。 */
export const alignRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  alignUsedInMatched,
  alignNameUnique,
];
