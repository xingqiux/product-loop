import { rulesCopy } from "../copy/rules.ts";
import { specCopy } from "../copy/spec.ts";
import type { PageSections } from "../page/sections.ts";
import { splitLines, strip } from "../writing/python.ts";
import { defineRule, type Rule, type RuleContextOf, type RuleScope, sinceRelease } from "./rule.ts";
import { specForSamples, specTextLinesSamples } from "./spec.samples.ts";

// 设计规范区块的规则，见「07 校验」第四节的 check_spec 和决定 96。
// 旧 build-report.py 的 check_spec 有十二条报错。区块只在构思、每一格的种类和值、
// 表格每一行的格数，都由数据定义查，见 page/spec.ts 和 page/stages.ts。定义查不了的有两条：
// - 每一格写 for。旧格式里 for 可以不写，「07 校验」第四节改为必填，所以按新规则写 2.0.0。
//   历史页面模式跳过它，没写 for 的旧页面也能迁进来。
// - 文字的一格不超过三行，照旧 build-report.py 的第 369 到 370 行。
//   数行的办法和 Python 的 splitlines 相同，只有空白的行不算。
// 有设计类的卡时这一页要有设计规范，见 design.ts 的 design.spec。卡里整段写设计规范，见 pasted.ts。

/** 文字的一格超过三行就拦截，加进构建校验的那一天，提交 d6e1bdc。按 UTC 是 21 日，见 cards.ts 的开头。 */
const textLinesAdded = "2026-09-21";

/** 文字的一格最多几行。 */
const textLinesMax = 3;

/** 设计规范只在构思写，阶段由数据定义管，这里不再写阶段。 */
const inSpec: RuleScope = {
  subjects: ["page"],
  sections: ["spec"],
  commands: ["page check", "page present"],
};

/** 规则 spec.for：没写 for 的每一格报一处。 */
const specFor = defineRule({
  id: "spec.for",
  level: "block",
  scope: inSpec,
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.spec.for,
  copy: specCopy.for,
  check: (page: PageSections) =>
    (page.spec ?? []).flatMap((item, i) =>
      item.for === undefined ? [{ where: ["spec", i, "for"], params: { name: item.name } }] : [],
    ),
  samples: specForSamples,
});

/** 文字有几行。只有空白的行不算，和旧脚本的 splitlines 加 strip 相同。 */
function lineCount(text: string): number {
  return splitLines(text).filter((line) => strip(line) !== "").length;
}

/** 规则 spec.text.lines：文字的一格超过三行时报一处。 */
const specTextLines = defineRule({
  id: "spec.text.lines",
  level: "block",
  scope: inSpec,
  since: textLinesAdded,
  needs: [],
  about: rulesCopy.about.spec.text.lines,
  copy: specCopy.text.lines,
  check: (page: PageSections) =>
    (page.spec ?? []).flatMap((item, i) => {
      if (item.kind !== "text") return [];
      const lines = lineCount(item.text);
      return lines > textLinesMax
        ? [{ where: ["spec", i, "text"], params: { name: item.name, lines } }]
        : [];
    }),
  samples: specTextLinesSamples,
});

/** 设计规范区块的规则，登记在 registry.ts。 */
export const specRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  specFor,
  specTextLines,
];
