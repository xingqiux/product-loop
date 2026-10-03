import type { RuleContextOf, RuleSamples } from "@product-loop/model";
import { basePage, pageWith } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 round.batch.covered 的样本。基础数据：这一轮拿出三件事，疑问卡处理 Q12，更改处理 Q15，
// Q9 由这一轮之前给出的第 3 页处理过了。

type Context = RuleContextOf<"batch">;

const context: Context = {
  batch: [
    { id: "Q9", content: "场景清单里的步骤写成动宾短语", coveredBy: 3 },
    { id: "Q12", content: "队列看板放到首页的第一屏" },
    { id: "Q15", content: "提交以后写明回复被取走了" },
  ],
};

const subject = (page = basePage): PresentSubject => ({ page, purpose: "ask" });

export const batchCoveredSamples: RuleSamples<PresentSubject, Context> = {
  base: { subject: subject(), context },
  hits: [
    {
      why: "疑问卡上没写 queue，Q12 哪张卡都没处理",
      subject: subject(
        pageWith((page) => {
          const [card] = page.asks;
          if (card !== undefined) Reflect.deleteProperty(card, "queue");
        }),
      ),
      expect: [{ where: "Q12", params: { id: "Q12", content: "队列看板放到首页的第一屏" } }],
    },
    {
      why: "之前的页没处理过 Q9，这一页也没写",
      subject: subject(),
      context: { batch: context.batch.map(({ id, content }) => ({ id, content })) },
      expect: [{ where: "Q9", params: { id: "Q9", content: "场景清单里的步骤写成动宾短语" } }],
    },
    {
      why: "这个阶段多拿出一件，内容很长，报错里只写开头",
      subject: subject(),
      context: {
        batch: [
          ...context.batch,
          {
            id: "Q20",
            content: "工作台的每一页都在顶上写明现在是哪个项目的哪个阶段，免得开着几个标签页时认错",
          },
        ],
      },
      expect: [
        {
          where: "Q20",
          params: {
            id: "Q20",
            content: "工作台的每一页都在顶上写明现在是哪个项目的哪个阶段，免得开着……",
          },
        },
      ],
    },
  ],
};
