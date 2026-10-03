import { defineEnum, type KeyOf } from "../enum.ts";

// 主线十样和设计规范十二样的名字，以及按标题认它们的办法。
// 十样的名字取自旧 skill 正文第三节的表和主线模板的二级标题，两处相同。
// 十二样的名字取自旧 skill 正文第三节的表，因为「09 skill 与软件」第三节说十二个职能保留在正文。
// 旧的主线模板写「图标与 SVG」「做法」，「构思反问」的节名也略有不同，都不算。

/** 主线的十样，顺序就是主线里写的顺序。 */
export const mainlinePart = defineEnum({
  pressRelease: "一句话新闻稿",
  audience: "给谁用",
  jobs: "要完成的任务",
  scenes: "场景清单",
  nonGoals: "不做什么和胃口",
  deliveryLine: "交付线",
  risks: "四个风险",
  faq: "常见问题与待定",
  preMortem: "事前验尸",
  designSpec: "设计规范",
});
export type MainlinePart = KeyOf<typeof mainlinePart>;

/** 设计规范的十二样，顺序和旧 skill 正文相同。 */
export const designSpecItem = defineEnum({
  informationArchitecture: "信息结构",
  color: "配色",
  typography: "字体排版",
  layout: "布局",
  interaction: "交互",
  motion: "动效",
  icons: "图标和 SVG",
  copywriting: "文案",
  agentInterface: "给 AI 的界面",
  states: "状态",
  accessibility: "无障碍",
  approach: "做法和阶段",
});
export type DesignSpecItem = KeyOf<typeof designSpecItem>;

/** 写作规范一节的名字，见 ADR 0001 第 24 条。 */
const writingSpecTitle = "写作规范";

/** 括号连同其中的文字，全角、半角都算。套着的括号由里到外一层层去掉。 */
const parenGroup = /[（(][^（）()]*[）)]/gu;

/** 标题前的编号，例如「1 」「1.」「1、」「一、」。汉字的数字后面必须有标点或空白。 */
const numberPrefix = /^(?:[0-9]+|[一二三四五六七八九十]+)(?:[.、．:：)）]\s*|\s+)/u;

/** 去掉括号连同其中的文字。 */
export function removeParens(text: string): string {
  let rest = text;
  let before: string;
  do {
    before = rest;
    rest = rest.replace(parenGroup, "");
  } while (rest !== before);
  return rest;
}

/** 去掉全部空白，包括全角空格。 */
export function squash(text: string): string {
  return text.replace(/\s+/gu, "");
}

const partByName: ReadonlyMap<string, MainlinePart> = new Map(
  mainlinePart.keys.map((part) => [mainlinePart.label(part), part]),
);

/**
 * 二级标题是十样里的哪一样，见 ADR 0001 第 23 条：去掉编号和括号，按名字认。
 * 去掉空白以后要和名字完全一样。名字后面隔着空白另写了说明的也认，
 * 例如「## 1 一句话新闻稿　已定」，按空白前的部分认。
 */
export function mainlinePartOf(title: string): MainlinePart | undefined {
  const bare = removeParens(title.trim().replace(numberPrefix, "")).trim();
  const [first = ""] = bare.split(/\s+/u);
  return partByName.get(squash(bare)) ?? partByName.get(first);
}

const itemByName: ReadonlyMap<string, DesignSpecItem> = new Map(
  designSpecItem.keys.map((item) => [squash(designSpecItem.label(item)), item]),
);

/**
 * 三级标题是设计规范十二样里的哪一样，认法见「09 skill 与软件」第三节。
 * 去掉括号连同其中的文字，再去掉空格，要和名字完全一样。标题前的编号不去掉。
 * 按整个标题认，所以一个标题最多算一样，「配色和字体排版」哪一样都不算。
 */
export function designSpecItemOf(title: string): DesignSpecItem | undefined {
  return itemByName.get(squash(removeParens(title)));
}

/** 标题是不是写作规范一节。和十样一样，去掉编号、括号和空白以后认。 */
export function isWritingSpecTitle(title: string): boolean {
  return squash(removeParens(title.trim().replace(numberPrefix, ""))) === writingSpecTitle;
}
