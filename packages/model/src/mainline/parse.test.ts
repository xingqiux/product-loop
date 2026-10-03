import { describe, expect, it } from "vitest";
import { parseMainline } from "./parse.ts";
import { designSpecItem, mainlinePart } from "./parts.ts";

/** 一份按新写法写满十样的主线，十二样各一个三级标题，另有覆盖表一节。 */
const full = [
  "# 主线",
  "",
  "## 一句话新闻稿",
  "给用 AI 写软件的人用的产品循环。",
  "",
  "## 给谁用",
  "用 AI 写软件的开发者。",
  "",
  "## 要完成的任务",
  "把项目收敛到能交付。",
  "",
  "## 场景清单",
  "",
  "### S1 看所有项目停在哪",
  "谁在什么时候用：你，每天打开工作台的第一眼。",
  "1. 打开工作台 → 看到每个项目停在哪一轮。",
  "",
  "## 不做什么和胃口",
  "不做手机端。",
  "",
  "## 交付线",
  "不询问 AI 就能点完。",
  "",
  "## 四个风险",
  "价值：省下逐屏检查的时间。",
  "",
  "## 常见问题与待定",
  "待定：无。",
  "",
  "## 事前验尸",
  "原因：页面太长。对策：一页只问当前阶段的事。",
  "",
  "## 设计规范",
  "",
  ...designSpecItem.labels.flatMap((name) => [`### ${name}`, "无。命令行产品。", ""]),
  "### 写作规范",
  "| 停用的说法 | 改成什么 |",
  "| --- | --- |",
  "| 工作流 | 流程 |",
  "",
  "## 覆盖表",
  "在 scripts/use/覆盖表.md。",
  "",
].join("\n");

describe("主线的解析", () => {
  const result = parseMainline(full);

  it("十个部分都在，每个部分带标题的行号和管到的行", () => {
    expect(result.parts.map((entry) => entry.part)).toEqual(mainlinePart.keys);
    expect(result.parts.slice(0, 4)).toEqual([
      {
        part: "pressRelease",
        present: true,
        heading: { text: "一句话新闻稿", line: 3, endLine: 4 },
      },
      { part: "audience", present: true, heading: { text: "给谁用", line: 6, endLine: 7 } },
      { part: "jobs", present: true, heading: { text: "要完成的任务", line: 9, endLine: 10 } },
      { part: "scenes", present: true, heading: { text: "场景清单", line: 12, endLine: 16 } },
    ]);
    expect(result.parts[9]).toEqual({
      part: "designSpec",
      present: true,
      heading: { text: "设计规范", line: 33, endLine: 74 },
    });
  });

  it("十个部分以外的二级标题单独列出", () => {
    expect(result.otherSections).toEqual([{ text: "覆盖表", line: 76, endLine: 77 }]);
  });

  it("场景、十二个部分和写作规范都解析出来，没有问题", () => {
    expect(result.scenes.map((scene) => [scene.id, scene.name])).toEqual([[1, "看所有项目停在哪"]]);
    expect(result.designSpec.every((entry) => entry.status === "none")).toBe(true);
    expect(result.otherSpecHeadings.map((heading) => heading.text)).toEqual(["写作规范"]);
    expect(result.writingSpec).toEqual({
      banned: [{ phrase: "工作流", replacement: "流程" }],
      exceptions: [],
    });
    expect(result.problems).toEqual([]);
  });

  it("解析结果是纯粹的数据，转成 JSON 再读回来不变", () => {
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});

describe("十个部分的标题", () => {
  it("带编号、不带编号、带括号的写法混在一起也都认", () => {
    const text = [
      "## 一、一句话新闻稿（定位）",
      "## 2. 给谁用",
      "## 3 要完成的任务",
      "## 场景清单（第 9 轮定）",
      "## 五、不做什么和胃口",
      "## 6、交付线",
      "## 7.四个风险",
      "## 常见问题与待定",
      "## （九）事前验尸",
      "## 10 设计规范（报告网页的）",
    ].join("\n");
    const result = parseMainline(text);
    expect(result.parts.map((entry) => (entry.present ? entry.heading.line : 0))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(result.otherSections).toEqual([]);
  });

  it("缺的几个部分记为不在，不算问题", () => {
    const result = parseMainline("## 给谁用\n你。\n## 覆盖表\n");
    expect(result.parts.filter((entry) => entry.present).map((entry) => entry.part)).toEqual([
      "audience",
    ]);
    expect(result.parts[0]).toEqual({ part: "pressRelease", present: false });
    expect(result.problems).toEqual([]);
  });

  it("空的主线十个部分都缺，没有场景，十二个部分都缺，写作规范是空的", () => {
    const result = parseMainline("");
    expect(result).toEqual({
      parts: mainlinePart.keys.map((part) => ({ part, present: false })),
      otherSections: [],
      scenes: [],
      designSpec: designSpecItem.keys.map((item) => ({ item, status: "missing" })),
      otherSpecHeadings: [],
      writingSpec: { banned: [], exceptions: [] },
      problems: [],
    });
  });

  it("同一样写了两次，用第一次，报出两处的行号", () => {
    const result = parseMainline("## 给谁用\n你。\n## 2 给谁用（补充）\n别人。\n");
    expect(result.parts[1]).toEqual({
      part: "audience",
      present: true,
      heading: { text: "给谁用", line: 1, endLine: 2 },
    });
    expect(result.problems).toEqual([
      { kind: "partDuplicate", line: 1, part: "audience", lines: [1, 3] },
    ]);
  });

  it("只认二级标题：一级、三级标题和代码块里的都不算", () => {
    const text = ["# 给谁用", "### 交付线", "```", "## 四个风险", "```", "####### 事前验尸"].join(
      "\n",
    );
    expect(parseMainline(text).parts.every((entry) => !entry.present)).toBe(true);
  });

  it("一级标题结束前面的一节", () => {
    const result = parseMainline("## 给谁用\n你。\n# 附录\n别的。\n");
    expect(result.parts[1]).toMatchObject({ heading: { line: 1, endLine: 2 } });
  });

  it("标题的 # 后面要有空白，结尾的一串 # 不算标题的字", () => {
    const result = parseMainline("##给谁用\n## 交付线 ##\n");
    expect(result.parts[1]).toEqual({ part: "audience", present: false });
    expect(result.parts[5]).toMatchObject({ heading: { text: "交付线", line: 2 } });
  });

  it("换行符是回车换行、只有回车，或者开头有字节顺序标记，行号都一样", () => {
    const lf = "## 给谁用\n你。\n\n## 交付线\n一条。";
    for (const text of [
      lf,
      lf.replaceAll("\n", "\r\n"),
      lf.replaceAll("\n", "\r"),
      `\uFEFF${lf}`,
    ]) {
      const result = parseMainline(text);
      expect(result.parts[1]).toMatchObject({ heading: { text: "给谁用", line: 1, endLine: 2 } });
      expect(result.parts[5]).toMatchObject({ heading: { text: "交付线", line: 4, endLine: 5 } });
    }
  });
});
