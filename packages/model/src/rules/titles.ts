import { cardRulesCopy } from "../copy/card-rules.ts";
import { renderCopy } from "../copy/define.ts";
import { rulesCopy } from "../copy/rules.ts";
import { pageSection } from "../page/section-names.ts";
import { displayWidth } from "../writing/measure.ts";
import { cardPath, cardsOf, type PageRule, type PageSubject } from "./cards.ts";
import { pageDiagrams } from "./diagram.ts";
import { defineRule, type RuleWhere, sinceRelease } from "./rule.ts";
import { titleSamples } from "./titles.samples.ts";

// 标题写成名字，见决定 212 和主线设计规范的「文案」：值是短语，不成句。
// 页面上给用户看的标题，是卡片、选项、更改和图表的 title。标题是名字，不是一句解释，
// 解释放进正文。例如更改的标题写成「队列看板下面横着列出这个阶段做完的事」，
// 左边一栏、回复的各行和队列的展示卡片都拿它当名字用，读起来就成了一句话。
//
// 两条界线，超过或者碰到任何一条都拦：
// - 不超过 16 个字，按显示宽度算，和行名的宽度同一个算法，见 writing/measure.ts 的 displayWidth。
// - 不带「，。；：」。名字里不会有，有了就是在写一句话。
// 已经存在的历史页面不重新校验：起始写 2.0.0，历史页面模式跳过，见维护说明的「执行规则」。

/** 标题最多几个字，按显示宽度算。 */
const titleMax = 16;

/** 句子才有的标点：逗号、句号、分号、冒号。 */
const sentenceMarks: ReadonlySet<string> = new Set(["，", "。", "；", "："]);

/** 标题不是名字的原因，各写一句拼在一起；是名字就返回 undefined。 */
function problemOf(title: string): string | undefined {
  const width = displayWidth(title);
  const marks = [...new Set([...title].filter((char) => sentenceMarks.has(char)))].join("");
  const problems = [
    ...(width > titleMax ? [renderCopy(cardRulesCopy.title.tooLong, { width })] : []),
    ...(marks === "" ? [] : [renderCopy(cardRulesCopy.title.hasMark, { marks })]),
  ];
  return problems.length === 0 ? undefined : problems.join("");
}

/** 页面上一个要写成名字的标题：叫什么，在哪里，写的是什么。 */
type Titled = { readonly kind: string; readonly where: RuleWhere; readonly title: string };

/** 页面上全部要写成名字的标题，按页面上的顺序：先图表以外的卡片和选项，再更改，最后图表。 */
function titledOf(page: PageSubject): Titled[] {
  const titled: Titled[] = [];
  for (const at of cardsOf(page)) {
    titled.push({
      kind: pageSection.label(at.section),
      where: cardPath(at, "title"),
      title: at.card.title,
    });
    (at.card.options ?? []).forEach((option, i) => {
      titled.push({
        kind: "选项",
        where: cardPath(at, "options", i, "title"),
        title: option.title,
      });
    });
  }
  (page.changes ?? []).forEach((change, i) => {
    titled.push({
      kind: pageSection.label("changes"),
      where: ["changes", i, "title"],
      title: change.title,
    });
  });
  for (const { path, diagram } of pageDiagrams(page)) {
    titled.push({ kind: "图表", where: [...path, "title"], title: diagram.title });
  }
  return titled;
}

/** 规则 card.title.name：不是名字的标题各报一处，位置写到 title。 */
const titleName = defineRule({
  id: "card.title.name",
  level: "block",
  scope: {
    subjects: ["page"],
    sections: ["align", "asks", "findings", "improvements", "changes"],
    commands: ["page check", "page present"],
  },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.card.title.name,
  copy: cardRulesCopy.title.name,
  check: (page: PageSubject) =>
    titledOf(page).flatMap(({ kind, where, title }) => {
      const problem = problemOf(title);
      return problem === undefined ? [] : [{ where, params: { kind, title, problem } }];
    }),
  samples: titleSamples,
});

/** 标题的规则，登记在 registry.ts。 */
export const titleRuleList: readonly PageRule[] = [titleName];
