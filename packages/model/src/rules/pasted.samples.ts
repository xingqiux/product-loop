import type { AskCard, FindingCard } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 卡里整段写场景清单或设计规范两条规则的样本，见「07 校验」第六节。每份会命中的样本在基础数据上改一处。
// 基础数据里的疑问卡提到了场景和规范，各只有一行，不算整段。
// 来源的 saw 照录了主线里的两个场景，来源不查，也不算。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;

const context: RuleContextOf<never> = {};

const ask: AskCard = {
  title: "一条疑问",
  why: "场景一第二步写的是每个项目一张图，这一版三张卡都没有图。",
  sources: [
    {
      name: "主线的场景清单",
      saw: "场景一只有一步。\n场景二没有写谁在什么时候用。",
      img: "img/scenes.png",
    },
  ],
  shared: { text: "两个选项共同的部分。" },
  rows: ["页面上的变化"],
  options: [
    {
      key: "a",
      title: "做法 a",
      diffs: ["状态：改完看到什么。"],
      why: "理由。",
      cost: "代价。",
      when: "什么时候选。",
    },
    {
      key: "b",
      title: "做法 b",
      diffs: ["改完看到什么。"],
      why: "理由。",
      cost: "代价。",
      when: "什么时候选。",
    },
  ],
};

const finding: FindingCard = {
  title: "一条发现",
  why: "哪里不舒服。",
  sources: [{ name: "疑问块", saw: "名字下面有一句说明。", img: "img/ask-block.png" }],
  where: { scene: "S3", step: 2 },
};

const base: PageSections = { asks: [ask], findings: [finding] };

/** 旧 check-samples.py 里「场景清单的草稿整段写进了疑问卡」的那段文字，真实项目里发生过。 */
const sceneDraft =
  "请直接删改。\n场景一　讲师确认分数可用\n一　打开工作台\n场景二　新装好的系统\n一　登录";

export const scenesPastedSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "疑问卡的 why 里整段写了场景清单",
      subject: { asks: [{ ...ask, why: sceneDraft }], findings: [finding] },
      expect: [{ where: ["asks", 0], params: { section: "疑问", title: "一条疑问" } }],
    },
    {
      why: "发现问题的两个选项里各有一行以场景加编号开头，合起来算整段",
      subject: {
        asks: [ask],
        findings: [
          {
            ...finding,
            shared: { text: "共同的部分。" },
            rows: ["改哪里"],
            options: [
              {
                key: "a",
                title: "改场景",
                diffs: ["场景3 加一步"],
                why: "理由。",
                cost: "代价。",
                when: "什么时候选。",
              },
              { key: "b", title: "不改", diffs: ["场景4 照旧"] },
            ],
          },
        ],
      },
      expect: [{ where: ["findings", 0], params: { section: "发现问题", title: "一条发现" } }],
    },
  ],
};

/** 设计规范的草稿整段写进疑问卡，照一个真实项目的页面改短，每一样起一行当作小标题。 */
const specDraft =
  "下面是从仓库里已有的令牌整理出来的草稿。\n\n交互\n全站只有一种焦点样式。\n\n动效\n时长 140 到 180 毫秒。\n\n文案：按钮写动作，不写对象。";

export const specPastedSamples: Samples = {
  base: { subject: base, context },
  hits: [
    {
      why: "疑问卡的 why 里整段写了设计规范",
      subject: { asks: [{ ...ask, why: specDraft }], findings: [finding] },
      expect: [{ where: ["asks", 0], params: { section: "疑问", title: "一条疑问" } }],
    },
    {
      why: "一样写在 why 里，一样写在选项的 diffs 里，合起来有两样",
      subject: {
        asks: [{ ...ask, why: "### 配色（用在：状态标签）\n待办用灰色。" }],
        findings: [finding],
      },
      expect: [{ where: ["asks", 0], params: { section: "疑问", title: "一条疑问" } }],
    },
  ],
};
