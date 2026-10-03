import type { ChangedScreen, RuleContextOf, RuleSamples } from "@product-loop/model";
import { pageWith } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 screens.coverChanged 的样本。基础数据：这一版 S3 第 1 步和 S5 第 2 步变过，
// 元素清单写了这两屏。

type Context = RuleContextOf<"changedScreens">;

const changedScreens: readonly ChangedScreen[] = [
  { scene: "S3", step: 1 },
  { scene: "S5", step: 2 },
];

const screen = (scene: string, step: number) => ({
  name: `${scene} 第 ${String(step)} 步`,
  where: { scene, step },
  elements: [{ what: "块标题", answers: "这一块是什么" }],
});

const subject = (screens: ReturnType<typeof screen>[]): PresentSubject => ({
  page: pageWith((page) => {
    Object.assign(page, { screens });
  }),
  purpose: "ask",
});

export const coverChangedSamples: RuleSamples<PresentSubject, Context> = {
  base: { subject: subject([screen("S3", 1), screen("S5", 2)]), context: { changedScreens } },
  hits: [
    {
      why: "元素清单漏了 S5 第 2 步",
      subject: subject([screen("S3", 1)]),
      context: { changedScreens },
      expect: [{ where: ["screens"], params: { scene: "S5", step: 2 } }],
    },
    {
      why: "元素清单写的是 S5 第 3 步，不是变过的第 2 步",
      subject: subject([screen("S3", 1), screen("S5", 3)]),
      context: { changedScreens },
      expect: [{ where: ["screens"], params: { scene: "S5", step: 2 } }],
    },
  ],
};
