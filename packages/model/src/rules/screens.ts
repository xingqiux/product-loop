import { rulesCopy } from "../copy/rules.ts";
import { screensCopy } from "../copy/screens.ts";
import type { PageSections } from "../page/sections.ts";
import { defineRule, type Rule, type RuleContextOf, sinceRelease } from "./rule.ts";
import { screensPresentSamples, screensWhereSamples } from "./screens.samples.ts";

// 元素清单区块的规则，见「07 校验」第四节的 check_screens 和决定 44。
// 旧 build-report.py 的 check_screens 有三条报错。每一屏写 name 和 elements、
// 每一行写 what 和 answers，由数据定义查，见 page/screen.ts。定义查不了的有两条：
// - 检查阶段的页面要有元素清单，照旧第 329 到 330 行。区块只在检查能写，由定义管。
//   检查要有这一块，第 21 步按阶段区分区块时留给规则，见 page/stages.ts。
// - 每一屏写 where，指到主线的场景编号和步号，见约定 0001 第 8 条。
//   旧格式没有 where，所以按新规则写 2.0.0，历史页面模式跳过它，旧的元素清单也能迁进来。
// 元素清单要盖住这一版变过的屏，要查屏的记录，是后端的规则 screens.coverChanged，由第 53 步写。

/** 检查阶段要有元素清单，建仓库的提交 75b4c2d 里已经有了，那一天是 2026-09-20。 */
const screensAdded = "2026-09-20";

/** 规则 screens.present：检查阶段的页面没有元素清单时报一处，报在元素清单上。 */
const screensPresent = defineRule({
  id: "screens.present",
  level: "block",
  scope: {
    subjects: ["page"],
    stages: ["check"],
    sections: ["screens"],
    commands: ["page check", "page present"],
  },
  since: screensAdded,
  needs: [],
  about: rulesCopy.about.screens.present,
  copy: screensCopy.present,
  check: (page: PageSections) =>
    page.screens === undefined ? [{ where: ["screens"], params: {} }] : [],
  samples: screensPresentSamples,
});

/** 规则 screens.where：没写 where 的每一屏报一处。 */
const screensWhere = defineRule({
  id: "screens.where",
  level: "block",
  scope: { subjects: ["page"], sections: ["screens"], commands: ["page check", "page present"] },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.screens.where,
  copy: screensCopy.where,
  check: (page: PageSections) =>
    (page.screens ?? []).flatMap((screen, i) =>
      screen.where === undefined
        ? [{ where: ["screens", i, "where"], params: { name: screen.name } }]
        : [],
    ),
  samples: screensWhereSamples,
});

/** 元素清单区块的规则，登记在 registry.ts。 */
export const screensRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  screensPresent,
  screensWhere,
];
