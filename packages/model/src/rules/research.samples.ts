import type { AskCard } from "../page/card.ts";
import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 调研分档三条规则的样本，见「07 校验」第六节。基础数据是一页合格的构思页：
// 一张疑问卡带着外面看来的截图，写了快查。每份会命中的样本在它上面改一处，
// 和旧 check-samples.py 的三份调研样本一一对应。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type Research = NonNullable<AskCard["research"]>;

const context: RuleContextOf<never> = {};

const ask: AskCard = {
  title: "队列看板参考哪几家的做法",
  why: "看板的列和小卡上写什么还没定。",
  sources: [
    {
      name: "Linear 的队列页",
      saw: "筛选放在列表上方。",
      img: "img/linear-queue.png",
      outside: true,
    },
  ],
  research: { tier: "quick" },
};

/** 没有外面来源的追问卡。它不写调研，也不查。 */
const followUp: AskCard = {
  title: "上次你自己排队列是什么时候",
  why: "答案写进给谁用。",
  sources: [{ name: "用户昨天说的", saw: "「上周排过一次」", quote: true }],
};

const withResearch = (research: Research): PageSections => ({
  asks: [{ ...ask, research }, followUp],
});

const title = "队列看板参考哪几家的做法";

export const researchTierSamples: Samples = {
  base: { subject: { asks: [ask, followUp] }, context },
  hits: [
    {
      why: "卡上有外面看来的截图，没写调研是哪一档",
      subject: {
        asks: [{ title: ask.title, why: ask.why, sources: ask.sources }, followUp],
      },
      expect: [{ where: ["asks", 0, "research"], params: { title } }],
    },
  ],
};

export const researchReasonSamples: Samples = {
  base: {
    subject: withResearch({ tier: "none", reason: "看板是我们自己定的，不用参考别家。" }),
    context,
  },
  hits: [
    {
      why: "调研写了不查，没写理由",
      subject: withResearch({ tier: "none" }),
      expect: [{ where: ["asks", 0, "research", "reason"], params: { title } }],
    },
  ],
};

export const researchApprovedSamples: Samples = {
  base: { subject: withResearch({ tier: "deep", approved: "v2-构思-3" }), context },
  hits: [
    {
      why: "调研写了深查，没写计划是哪个阶段批的",
      subject: withResearch({ tier: "deep" }),
      expect: [{ where: ["asks", 0, "research", "approved"], params: { title } }],
    },
  ],
};
