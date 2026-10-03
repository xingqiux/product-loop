import { rulesCopy } from "../copy/rules.ts";
import { scenesCopy } from "../copy/scenes.ts";
import { parseSceneTitle } from "../mainline/scenes.ts";
import type { PageSections } from "../page/sections.ts";
import { defineRule, type Rule, type RuleContextOf, sinceRelease } from "./rule.ts";
import { scenesNameNumberSamples } from "./scenes.samples.ts";

// 场景清单区块的规则，见「07 校验」第四节的 check_scenes。
// 旧 build-report.py 的 check_scenes 有三条报错：区块只在构思、每个场景写名字和步骤、
// 每一步写做什么和该看到什么。三条都由数据定义查，见 page/scene.ts 和 page/stages.ts。
// 定义查不了的一条是编号写在哪里。「07 校验」第四节写场景要带编号，「06 工作台」第四节写
// 保留、修改、删除落在场景上，都按编号认场景，所以编号写进 scene，名字里不写。
// 名字按主线的场景标题来认，见 mainline/scenes.ts 的 parseSceneTitle：
// 认得出编号的名字，照原样写进主线的标题时会被当成编号，例如「S1 看所有项目停在哪」。
// 旧页面常这样写，所以按新规则写 2.0.0，历史页面模式跳过它。卡里整段写场景清单，见 pasted.ts。

/** 名字里带不带编号：S 加数字，或者旧写法的「场景一」「场景「名字」」。 */
function numbered(name: string): boolean {
  const title = parseSceneTitle(name);
  return title.id !== undefined || title.invalidId !== undefined || title.legacy;
}

/** 规则 scenes.name.number：名字里带着编号的场景各报一处。 */
const scenesNameNumber = defineRule({
  id: "scenes.name.number",
  level: "block",
  scope: { subjects: ["page"], sections: ["scenes"], commands: ["page check", "page present"] },
  since: sinceRelease,
  needs: [],
  about: rulesCopy.about.scenes.name.number,
  copy: scenesCopy.name.number,
  check: (page: PageSections) =>
    (page.scenes ?? []).flatMap((scene, i) =>
      numbered(scene.name) ? [{ where: ["scenes", i, "name"], params: { name: scene.name } }] : [],
    ),
  samples: scenesNameNumberSamples,
});

/** 场景清单区块的规则，登记在 registry.ts。 */
export const scenesRuleList: readonly Rule<PageSections, RuleContextOf<never>>[] = [
  scenesNameNumber,
];
