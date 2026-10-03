import { type PageSections, pageSectionsSchema } from "@product-loop/model";

// 后端规则的样本共用的页面数据，见「07 校验」第六节。写法和 model 的 cards.samples.ts 相同：
// 写成 AI 交来的样子，再过一遍数据定义，得到规则查的解析以后的数据。
// 一张疑问卡处理 Q12，来源是一张截图，右边另有一张图。一条更改处理 Q15，改后是一张截图。

/** 基础数据，AI 交来的样子。样本在它的拷贝上改。 */
export const pageInput = {
  asks: [
    {
      queue: ["Q12"],
      title: "队列看板放在哪里",
      why: "看板现在在首页最下面，要翻两屏才看得到。",
      sources: [{ name: "工作台首页", saw: "看板在最下面。", img: "img/home.png" }],
      image: { img: "img/board.png", caption: "看板现在的位置" },
    },
  ],
  changes: [
    {
      queue: ["Q15"],
      title: "提交按钮下面写明回复被取走了",
      problem: "提交以后看不出 AI 有没有收到。",
      fix: "回复被取走以后，按钮下面写「AI 已收到」。",
      after: { img: "img/after.png" },
    },
  ],
};

/** 在基础数据的拷贝上改一处，再过一遍数据定义。改完不合定义时抛出，说明样本写错了。 */
export function pageWith(change: (page: typeof pageInput) => void): PageSections {
  const copy = structuredClone(pageInput);
  change(copy);
  return pageSectionsSchema.parse(copy);
}

/** 基础数据，解析以后的样子。 */
export const basePage: PageSections = pageWith(() => {});
