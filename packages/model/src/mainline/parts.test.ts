import { describe, expect, it } from "vitest";
import {
  designSpecItem,
  designSpecItemOf,
  isWritingSpecTitle,
  mainlinePart,
  mainlinePartOf,
  removeParens,
} from "./parts.ts";

describe("十个部分和十二个部分的名字", () => {
  it("十个部分的名字和顺序照旧 skill 正文第三节的表，和旧主线模板的二级标题相同", () => {
    expect(mainlinePart.labels).toEqual([
      "一句话新闻稿",
      "给谁用",
      "要完成的任务",
      "场景清单",
      "不做什么和胃口",
      "交付线",
      "四个风险",
      "常见问题与待定",
      "事前验尸",
      "设计规范",
    ]);
  });

  it("十二个部分的名字和顺序照旧 skill 正文第三节的第 10 样", () => {
    expect(designSpecItem.labels).toEqual([
      "信息结构",
      "配色",
      "字体排版",
      "布局",
      "交互",
      "动效",
      "图标和 SVG",
      "文案",
      "给 AI 的界面",
      "状态",
      "无障碍",
      "做法和阶段",
    ]);
  });
});

describe("十个部分按二级标题认", () => {
  it.each([
    ["一句话新闻稿", "pressRelease"],
    ["1 一句话新闻稿", "pressRelease"],
    ["1. 一句话新闻稿", "pressRelease"],
    ["1.一句话新闻稿", "pressRelease"],
    ["1、一句话新闻稿", "pressRelease"],
    ["一、一句话新闻稿", "pressRelease"],
    ["一句话新闻稿（定位）", "pressRelease"],
    ["一、一句话新闻稿（定位）", "pressRelease"],
    ["（一）给谁用", "audience"],
    ["给 谁 用", "audience"],
    ["四个风险", "risks"],
    ["七、四个风险", "risks"],
    ["10 设计规范", "designSpec"],
    ["十、设计规范（报告网页的）", "designSpec"],
    ["设计规范(报告网页的)", "designSpec"],
    ["8 常见问题与待定", "faq"],
  ])("「## %s」是 %s", (title, part) => {
    expect(mainlinePartOf(title)).toBe(part);
  });

  it("名字后面隔着空白另写了说明的，按空白前的部分认", () => {
    expect(mainlinePartOf("1 一句话新闻稿　主人已定（构思第 1 轮）")).toBe("pressRelease");
    expect(mainlinePartOf("4 场景清单　主人已定（构思第 2 轮，八个全留）")).toBe("scenes");
    expect(mainlinePartOf("10 设计规范　已有，补了三处")).toBe("designSpec");
  });

  it.each([
    "新闻稿",
    "风险",
    "场景",
    "四大风险",
    "给谁用和为什么",
    "场景清单的说明",
    "覆盖表",
    "仓库和工程证据",
    "",
  ])("「## %s」不是十样里的任何一样", (title) => {
    expect(mainlinePartOf(title)).toBeUndefined();
  });

  it("汉字的数字后面没有标点或空白时不当编号，「四个风险」「一句话新闻稿」原样认", () => {
    expect(mainlinePartOf("四个风险")).toBe("risks");
    expect(mainlinePartOf("一句话新闻稿")).toBe("pressRelease");
  });
});

describe("设计规范十二个部分按三级标题认", () => {
  it.each([
    ["配色", "color"],
    ["配色（用在：状态标签）", "color"],
    ["配色 (用在：状态标签)", "color"],
    ["给 AI 的界面", "agentInterface"],
    ["给AI的界面", "agentInterface"],
    ["给 AI 的 界面（命令行和输出）", "agentInterface"],
    ["图标和 SVG", "icons"],
    ["图标和SVG", "icons"],
    ["状态（用在：状态标签）", "states"],
    ["做法和阶段", "approach"],
  ])("「### %s」是 %s", (title, item) => {
    expect(designSpecItemOf(title)).toBe(item);
  });

  it("去掉括号和空格以后要和名字完全一样，旧模板和反问清单里别的叫法都不算", () => {
    for (const title of ["图标与 SVG", "做法", "字体与排版", "布局与尺寸", "给 AI 用的界面"]) {
      expect(designSpecItemOf(title)).toBeUndefined();
    }
  });

  it("一个标题只算一个部分：「配色和字体排版」哪个部分都不算", () => {
    expect(designSpecItemOf("配色和字体排版")).toBeUndefined();
    expect(designSpecItemOf("配色、字体排版")).toBeUndefined();
  });

  it("标题前的编号不去掉，「1. 配色」不算", () => {
    expect(designSpecItemOf("1. 配色")).toBeUndefined();
    expect(designSpecItemOf("一、配色")).toBeUndefined();
  });

  it("名字后面接了别的字的不算", () => {
    expect(designSpecItemOf("配色：主色和强调色")).toBeUndefined();
    expect(designSpecItemOf("配色的来源")).toBeUndefined();
  });
});

describe("括号", () => {
  it("去掉全角、半角的括号连同其中的文字，套着的一层层去掉", () => {
    expect(removeParens("配色（用在：状态标签）")).toBe("配色");
    expect(removeParens("配色(用在)和（说明（里面））")).toBe("配色和");
  });

  it("不成对的括号原样留下", () => {
    expect(removeParens("配色（用在")).toBe("配色（用在");
  });
});

describe("写作规范一节的标题", () => {
  it.each(["写作规范", "写作规范（决定 119 到 122）", "11 写作规范", "十一、写作规范"])(
    "「%s」是写作规范",
    (title) => {
      expect(isWritingSpecTitle(title)).toBe(true);
    },
  );

  it.each(["写作", "写作规范的来源", "文案"])("「%s」不是写作规范", (title) => {
    expect(isWritingSpecTitle(title)).toBe(false);
  });
});
