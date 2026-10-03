import type { HandledLine, RuleContextOf, RuleSamples } from "@product-loop/model";

// 依赖回复的两条规则的样本。
// reply.line.handled 的基础数据：没有还有行没处理的回复。它不看查的数据，写成 null。
// reply.images.read 的基础数据：处理两行，第 1 行没带图，第 2 行带一张图并且写了已读。

type Handled = RuleContextOf<"unhandledReplies">;

export const lineHandledSamples: RuleSamples<unknown, Handled> = {
  base: { subject: null, context: { unhandledReplies: [] } },
  hits: [
    {
      why: "上一份回复的第 3 行和第 5 行还没有去处",
      subject: null,
      context: { unhandledReplies: [{ submission: 7, round: "v1-构思-3", lines: [3, 5] }] },
      expect: [
        {
          where: "第 1 版的构思阶段（第 3 次）",
          params: { round: "第 1 版的构思阶段（第 3 次）", lines: "第 3 行、第 5 行" },
        },
      ],
    },
    {
      why: "两份回复各有一行没处理，各报一处",
      subject: null,
      context: {
        unhandledReplies: [
          { submission: 7, round: "v1-构思-3", lines: [2] },
          { submission: 8, round: "v1-构思-4", lines: [1] },
        ],
      },
      expect: [
        {
          where: "第 1 版的构思阶段（第 3 次）",
          params: { round: "第 1 版的构思阶段（第 3 次）", lines: "第 2 行" },
        },
        {
          where: "第 1 版的构思阶段（第 4 次）",
          params: { round: "第 1 版的构思阶段（第 4 次）", lines: "第 1 行" },
        },
      ],
    },
  ],
};

const noImages: HandledLine = { line: 1, images: 0, imagesRead: false };

export const imagesReadSamples: RuleSamples<readonly HandledLine[], RuleContextOf<never>> = {
  base: { subject: [noImages, { line: 2, images: 1, imagesRead: true }], context: {} },
  hits: [
    {
      why: "第 2 行带了两张图，处理时没写已读",
      subject: [noImages, { line: 2, images: 2, imagesRead: false }],
      expect: [{ where: [1, "imagesRead"], params: { line: 2, count: 2 } }],
    },
    {
      why: "一次处理两行带图的，都没写已读，各报一处",
      subject: [
        { line: 4, images: 1, imagesRead: false },
        { line: 6, images: 3, imagesRead: false },
      ],
      expect: [
        { where: [0, "imagesRead"], params: { line: 4, count: 1 } },
        { where: [1, "imagesRead"], params: { line: 6, count: 3 } },
      ],
    },
  ],
};
