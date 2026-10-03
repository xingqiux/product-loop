import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 规则 scenes.name.number 的样本，见「07 校验」第六节。基础数据有一个主线里已有的场景，
// 写着编号，还有一个新场景，没有编号。每份会命中的样本在它上面改一处。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type SceneDraft = NonNullable<PageSections["scenes"]>[number];

const context: RuleContextOf<never> = {};

const steps: SceneDraft["steps"] = [
  { do: "打开工作台首页", expect: "每个项目一行，写着第几版、哪个阶段、第几次" },
  { do: "找有页在等我的项目", expect: "它们排在最前，行上有一个按钮直达那一页" },
];

const known: SceneDraft = {
  scene: "S1",
  name: "看所有项目停在哪",
  who: "你，每天打开工作台的第一眼",
  mark: "改过",
  steps,
};

const fresh: SceneDraft = {
  name: "看一个项目走到哪了",
  who: "你，想知道一个项目的进度时",
  mark: "新",
  steps: [{ do: "点一个项目", expect: "进度按版本一行、阶段五列摆开" }],
};

export const scenesNameNumberSamples: Samples = {
  base: { subject: { scenes: [known, fresh] }, context },
  hits: [
    {
      why: "编号写进了名字，没有写 scene，之前的构思阶段的页面这样写过",
      subject: { scenes: [known, { ...fresh, name: "S2 看一个项目走到哪了" }] },
      expect: [{ where: ["scenes", 1, "name"], params: { name: "S2 看一个项目走到哪了" } }],
    },
    {
      why: "写了 scene，名字里又写了一遍编号",
      subject: { scenes: [{ ...known, name: "S1 看所有项目停在哪" }, fresh] },
      expect: [{ where: ["scenes", 0, "name"], params: { name: "S1 看所有项目停在哪" } }],
    },
    {
      why: "名字用了旧主线的「场景一」",
      subject: { scenes: [known, { ...fresh, name: "场景一　讲师确认分数可用" }] },
      expect: [{ where: ["scenes", 1, "name"], params: { name: "场景一　讲师确认分数可用" } }],
    },
  ],
};
