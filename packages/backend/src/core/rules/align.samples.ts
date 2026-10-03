import type { RuleContextOf, RuleSamples, UnclearTerm } from "@product-loop/model";
import { pageWith } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 align.unclear.reworded 的样本。基础数据：用户在上一轮对「看板」点了不明白，
// 这一页的先对齐里「看板」换了意思和例子。会命中的样本在基础数据上改一处。

type Context = RuleContextOf<"unclearTerms">;

const unclear: UnclearTerm = {
  name: "看板",
  meaning: "工作台首页上按阶段排的队列。",
  example: "Q12 排在检查那一列。",
  round: "v1-构思-3",
};

const context: Context = { unclearTerms: [unclear] };

/** 这一页的先对齐只有「看板」一项，意思和例子由参数给出。疑问卡的标题照基础数据写。 */
function withBoard(meaning: string, example: string, name = "看板"): PresentSubject {
  const page = pageWith((input) => {
    Object.assign(input, {
      align: [{ name, usedIn: ["队列看板放在哪里"], meaning, example }],
    });
  });
  return { page, purpose: "ask" };
}

export const unclearRewordedSamples: RuleSamples<PresentSubject, Context> = {
  base: {
    subject: withBoard(
      "还没做完的事按要做的阶段分成五列，摆在首页上。",
      "用户打开首页，就看到检查那一列里排着 Q12。",
    ),
    context,
  },
  hits: [
    {
      why: "意思和例子都照抄上一页",
      subject: withBoard(unclear.meaning, unclear.example),
      expect: [{ where: ["align", 0], params: { round: "v1-构思-3", name: "看板" } }],
    },
    {
      why: "名称和两句只多了首尾的空白，仍算没变",
      subject: withBoard(` ${unclear.meaning}`, `${unclear.example} `, " 看板 "),
      expect: [{ where: ["align", 0], params: { round: "v1-构思-3", name: "看板" } }],
    },
  ],
};
