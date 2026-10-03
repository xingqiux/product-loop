import { describe, expect, it } from "vitest";
import { mainlineCopy } from "../copy/mainline.ts";
import * as model from "../index.ts";
import { checkWriting } from "../writing/check.ts";
import {
  describeMainlineProblem,
  describeMainlineProblems,
  type MainlineProblem,
  sortProblems,
} from "./problems.ts";

const scene = "S14 会话中途接手";

/** 每种问题一条，用来渲染报错。 */
const samples: readonly MainlineProblem[] = [
  { kind: "partDuplicate", line: 23, part: "scenes", lines: [23, 88] },
  { kind: "scenesNone", line: 23 },
  { kind: "sceneLegacy", line: 27, scene: "回答疑问" },
  { kind: "sceneIdInvalid", line: 27, text: "S03" },
  { kind: "sceneIdDuplicate", line: 27, id: 14, lines: [27, 40] },
  { kind: "sceneNameEmpty", line: 27 },
  { kind: "sceneWhoMissing", line: 27, scene },
  { kind: "sceneNoSteps", line: 27, scene },
  { kind: "sceneExtraText", line: 31, scene, count: 3 },
  { kind: "stepArrowMissing", line: 29, scene, step: 2 },
  { kind: "stepArrowExtra", line: 29, scene, step: 2, count: 2 },
  { kind: "stepDoEmpty", line: 29, scene, step: 2 },
  { kind: "stepExpectEmpty", line: 29, scene, step: 2 },
  { kind: "stepNumber", line: 30, scene, step: 3, written: 4 },
  { kind: "designSpecDuplicate", line: 190, item: "color", lines: [190, 200] },
  { kind: "designSpecEmpty", line: 190, item: "motion" },
  { kind: "designSpecNoneReason", line: 190, item: "motion" },
  { kind: "designSpecTable", line: 80 },
  { kind: "writingSpecDuplicate", line: 287, lines: [287, 320] },
  { kind: "writingSpecTable", line: 291 },
  { kind: "writingSpecReplacementEmpty", line: 295, phrase: "工作流" },
  { kind: "writingSpecEllipsis", line: 305, phrase: "查……齐不齐" },
];

describe("主线问题的报错", () => {
  it("每种问题都有一条样例，也都有文案", () => {
    const kinds = samples.map((problem) => problem.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual(Object.keys(mainlineCopy.problem).sort());
  });

  it("每条报错都写了什么不对和怎么改，参数都填上了，没有拦截一级的写法问题", () => {
    for (const problem of samples) {
      const { message, hint = "" } = describeMainlineProblem(problem);
      expect(message).not.toMatch(/^$|[{}]/u);
      expect(hint).not.toMatch(/^$|[{}]/u);
      expect(checkWriting(message).block).toEqual([]);
      expect(checkWriting(hint).block).toEqual([]);
    }
  });

  it("填进报错的是中文的名字", () => {
    expect(describeMainlineProblem(samples[0] as MainlineProblem).message).toBe(
      "主线里「场景清单」写了 2 个二级标题。",
    );
    expect(describeMainlineProblem(samples[4] as MainlineProblem).message).toBe(
      "2 个场景都写了编号 S14。",
    );
    expect(describeMainlineProblem(samples[15] as MainlineProblem).message).toBe(
      "设计规范里「动效」的标题下面是空的。",
    );
  });

  it("给了主线文件的路径时写在哪里，写了几处的列出各处的行号", () => {
    expect(describeMainlineProblem(samples[2] as MainlineProblem, "主线.md")).toEqual({
      message: "场景「回答疑问」是旧的写法。",
      hint: "标题改成「### 名字」，下一行写「谁在什么时候用：」，再写编号的步骤。场景编号由命令补上。",
      where: "主线.md 第 27 行",
    });
    expect(describeMainlineProblem(samples[4] as MainlineProblem, "主线.md").where).toBe(
      "主线.md 第 27、40 行",
    );
  });

  it("按行号排，同一行的按查出的先后", () => {
    const a: MainlineProblem = { kind: "scenesNone", line: 9 };
    const b: MainlineProblem = { kind: "sceneNameEmpty", line: 3 };
    const c: MainlineProblem = { kind: "designSpecTable", line: 3 };
    expect(sortProblems([a, b, c])).toEqual([b, c, a]);
  });
});

describe("共用定义的入口", () => {
  it("导出主线的解析、补编号和十个部分、十二个部分的名称表", () => {
    expect(model.parseMainline("").parts).toHaveLength(10);
    expect(model.assignSceneIds("").assigned).toEqual([]);
    expect(model.mainlinePart.keys).toHaveLength(10);
    expect(model.designSpecItem.keys).toHaveLength(12);
    expect(model.describeMainlineProblem({ kind: "scenesNone", line: 1 }).message).toBe(
      "场景清单里没有认出任何场景。",
    );
  });
});

describe("一批主线问题的报错", () => {
  const who = (line: number, name: string): MainlineProblem => ({
    kind: "sceneWhoMissing",
    line,
    scene: name,
  });

  it("好几个场景都没写谁在什么时候用：合成一条，列出场景和全部行号（P22）", () => {
    const issues = describeMainlineProblems(
      [
        who(10, "S1 看队列"),
        { kind: "scenesNone", line: 5 },
        who(20, "S2 换阶段"),
        who(30, "S9 导出"),
      ],
      "主线.md",
    );
    expect(issues.map((issue) => issue.message)).toEqual([
      "3 个场景没有写谁在什么时候用：S1、S2、S9。",
      expect.stringContaining("没有"),
    ]);
    expect(issues[0]?.where).toBe("主线.md 第 10、20、30 行");
    expect(issues[0]?.hint).toBe("标题下一行写「谁在什么时候用：」加内容。");
  });

  it("只有一个场景没写：照单条的写法，不合并", () => {
    const problems = [who(10, "S1 看队列")];
    expect(describeMainlineProblems(problems, "主线.md")).toEqual([
      describeMainlineProblem(problems[0] as MainlineProblem, "主线.md"),
    ]);
  });
});
