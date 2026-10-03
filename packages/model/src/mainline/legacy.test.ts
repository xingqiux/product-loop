import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assignSceneIds } from "./assign.ts";
import { parseMainline } from "./parse.ts";

// 两份真实的旧主线，原样复制进 __fixtures__，测试不依赖仓库以外的文件：
// - skill-own.md：skill 自己的产品文档里的主线.md，在 iCloud 的「skill自己的产品文档」里。
// - quality-engineering.md：表单检查插件的 .product-loop/主线.md，基本是旧模板。
// 解析结果和补上场景编号以后的全文都存成快照。
// 体检迁移这两个项目时，要存下补上场景编号的一版，见「08 版本与迁移」第四节。快照就是那一版的样子。

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

describe("skill 自己的旧主线", () => {
  const text = fixture("skill-own.md");
  const result = parseMainline(text);

  it("十样都在，另有「仓库和工程证据」一节", () => {
    expect(result.parts.every((entry) => entry.present)).toBe(true);
    expect(result.otherSections.map((heading) => heading.text)).toEqual(["仓库和工程证据"]);
  });

  it("十个场景都是旧写法，名字取自书名号", () => {
    expect(result.scenes.map((scene) => scene.name)).toEqual([
      "回答疑问",
      "验收更改",
      "决定发现和提升",
      "看使用阶段的结果",
      "中途接手",
      "skill 的问题反馈回来",
      "截图反馈",
      "删改场景清单",
      "删改设计规范",
      "在窄屏上看",
    ]);
    expect(result.scenes.every((scene) => scene.legacy)).toBe(true);
  });

  it("设计规范十二样只认出状态和文案，别的三级标题记在十二样以外", () => {
    const written = result.designSpec.filter((entry) => entry.status === "written");
    expect(written.map((entry) => entry.item)).toEqual(["copywriting", "states"]);
    expect(result.otherSpecHeadings).toHaveLength(8);
  });

  it("写作规范一节在设计规范下面，术语表拆开以后收下，带省略号的一条报出来", () => {
    expect(result.writingSpec.banned).toHaveLength(19);
    expect(result.writingSpec.exceptions).toEqual([]);
    expect(result.problems.filter((p) => p.kind.startsWith("writingSpec"))).toEqual([
      { kind: "writingSpecEllipsis", line: 305, phrase: "查……齐不齐" },
    ]);
  });

  it("解析结果和快照相同", () => {
    expect(result).toMatchSnapshot();
  });

  it("补上场景编号以后的全文和快照相同，按先后编成 S1 到 S10", async () => {
    const { text: next, assigned } = assignSceneIds(text);
    expect(assigned.map((a) => a.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    await expect(next).toMatchFileSnapshot("__snapshots__/skill-own.ids.md");
  });
});

describe("表单检查插件的旧主线", () => {
  const text = fixture("quality-engineering.md");
  const result = parseMainline(text);

  it("十样都在，标题带编号，另有「覆盖表」一节", () => {
    expect(result.parts.every((entry) => entry.present)).toBe(true);
    expect(result.otherSections.map((heading) => heading.text)).toEqual(["覆盖表"]);
  });

  it("四个场景是旧模板的写法，名字取自括号，只写了省略号的步骤报没有「→」", () => {
    expect(result.scenes.map((scene) => scene.name)).toEqual([
      "任务 1，产品卖的就是这条",
      "第一次进来、空项目",
      "回头看、改、管理已有的东西",
      "等待和出错：加载中、失败、进行中、外部服务不在",
    ]);
    expect(result.problems.filter((p) => p.kind === "stepArrowMissing")).toHaveLength(4);
  });

  it("设计规范写成了旧模板的表格，十二样都缺", () => {
    expect(result.designSpec.every((entry) => entry.status === "missing")).toBe(true);
    expect(result.problems.filter((p) => p.kind === "designSpecTable")).toEqual([
      { kind: "designSpecTable", line: 80 },
    ]);
  });

  it("解析结果和快照相同", () => {
    expect(result).toMatchSnapshot();
  });

  it("补上场景编号以后的全文和快照相同", async () => {
    const { text: next, assigned } = assignSceneIds(text);
    expect(assigned.map((a) => a.id)).toEqual([1, 2, 3, 4]);
    await expect(next).toMatchFileSnapshot("__snapshots__/quality-engineering.ids.md");
  });
});
