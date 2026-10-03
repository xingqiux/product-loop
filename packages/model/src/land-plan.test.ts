import { describe, expect, it } from "vitest";
import * as model from "./index.ts";
import {
  describeLandPlanProblem,
  describeMissingSections,
  type LandPlanProblem,
  landPlanSection,
  parseLandPlan,
  shortPlanTidyReason,
} from "./land-plan.ts";

// 旧 check-land.py 的计划模板，原样照抄。{tidy} 换成「要不要先重构」一节的正文。
const legacyPlan = (tidy: string): string =>
  "# 计划\n\n## 要做的事\n一件。\n\n## 现状\n读过了。\n\n## 要不要先重构\n{tidy}\n\n## 功能改动\n1. 一件。\n\n## 用什么锁住现有的行为\n样例检查。\n\n## 对应哪个场景\n验收更改。\n\n## 裁决\n| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n".replace(
    "{tidy}",
    tidy,
  );

// 旧 check-samples.py 里那一份齐全的落地记录的计划，原样照抄。
const legacySamplePlan = [
  ["要做的事", "一件。"],
  ["现状", "读过了。"],
  ["要不要先重构", "不要。只改一句文案，不碰结构。"],
  ["功能改动", "1. 一件。"],
  ["用什么锁住现有的行为", "样例检查。"],
  ["对应哪个场景", "验收更改。"],
  ["裁决", "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n| 一件 | 理由 | 小 |"],
]
  .map(([title, body]) => `## ${title}\n${body}`)
  .join("\n\n");

/** 七节都有正文的计划，裁决一节换成给定的正文。 */
const planWithVerdicts = (verdicts: string): string =>
  legacyPlan("要。拆一个函数。").replace(
    "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n",
    verdicts,
  );

function problemsOf(text: string): readonly LandPlanProblem[] {
  const result = parseLandPlan(text);
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.error;
}

function planOf(text: string) {
  const result = parseLandPlan(text);
  if (!result.ok) throw new Error(`计划解析失败：${JSON.stringify(result.error)}`);
  return result.value;
}

describe("计划的七节", () => {
  it("七节的名字和顺序沿用旧 land.py", () => {
    expect(landPlanSection.labels).toEqual([
      "要做的事",
      "现状",
      "要不要先重构",
      "功能改动",
      "用什么锁住现有的行为",
      "对应哪个场景",
      "裁决",
    ]);
  });

  it("旧 check-land.py：合格的计划，七节的正文原样取出", () => {
    expect(parseLandPlan(legacyPlan("要。拆一个函数。"))).toEqual({
      ok: true,
      value: {
        sections: {
          goal: "一件。",
          current: "读过了。",
          tidy: "要。拆一个函数。",
          changes: "1. 一件。",
          guard: "样例检查。",
          scenes: "验收更改。",
          verdicts: "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |",
        },
        short: false,
        tidy: { wanted: true },
        verdicts: [],
      },
    });
  });

  it("旧 check-land.py：计划缺标题，一次报出缺的六节", () => {
    expect(problemsOf("# 计划\n\n## 要做的事\n一件。\n")).toEqual([
      { kind: "missing", section: "current" },
      { kind: "missing", section: "tidy" },
      { kind: "missing", section: "changes" },
      { kind: "missing", section: "guard" },
      { kind: "missing", section: "scenes" },
      { kind: "missing", section: "verdicts" },
    ]);
  });

  it("空的计划报出七节都缺", () => {
    expect(problemsOf("")).toEqual(
      landPlanSection.keys.map((section) => ({ kind: "missing", section })),
    );
  });

  it("旧 check-land.py：要不要先重构那一节是空的，只报空，不再查要不要", () => {
    expect(problemsOf(legacyPlan(""))).toEqual([{ kind: "empty", section: "tidy", line: 9 }]);
  });

  it("缺的、空的、写了两次的、要不要重构没写清的，一次全部报出", () => {
    const text = [
      "## 要做的事",
      "",
      "## 要不要先重构",
      "先不动结构。",
      "## 功能改动",
      "1. 一件。",
      "## 用什么锁住现有的行为",
      "样例检查。",
      "## 功能改动（续）",
      "2. 另一件。",
      "## 裁决",
      "无。",
    ].join("\n");
    expect(problemsOf(text)).toEqual([
      { kind: "empty", section: "goal", line: 1 },
      { kind: "missing", section: "current" },
      { kind: "tidyWord", line: 3 },
      { kind: "duplicate", section: "changes", lines: [5, 9] },
      { kind: "missing", section: "scenes" },
    ]);
  });

  it("七节的先后不限", () => {
    const sections = legacySamplePlan.split("\n\n").reverse().join("\n\n");
    expect(planOf(sections).sections.goal).toBe("一件。");
  });

  it("标题可以带编号、括号里的补充和结尾的 #", () => {
    const text = legacyPlan("要。拆一个函数。")
      .replace("## 要做的事", "## 1. 要做的事（Q12、Q15）")
      .replace("## 现状", "## 二、现状 ##")
      .replace("## 功能改动", "  ## 3、功能改动");
    const { sections } = planOf(text);
    expect(sections.goal).toBe("一件。");
    expect(sections.current).toBe("读过了。");
    expect(sections.changes).toBe("1. 一件。");
  });

  it("编号和节名之间不能夹别的字，井号后面要有空格", () => {
    const text = legacyPlan("要。拆一个函数。")
      .replace("## 现状", "## 第二节 现状")
      .replace("## 功能改动", "##功能改动");
    expect(problemsOf(text)).toEqual([
      { kind: "missing", section: "current" },
      { kind: "missing", section: "changes" },
    ]);
  });

  it("三级标题和一级标题留在这一节的正文里", () => {
    const text = legacyPlan("要。拆一个函数。").replace(
      "1. 一件。",
      "### 第一件\n改列表页。\n# 附\n截图在 img/ 下。",
    );
    expect(planOf(text).sections.changes).toBe("### 第一件\n改列表页。\n# 附\n截图在 img/ 下。");
  });

  it("代码块里以 ## 开头的行不算标题，两种围栏都认", () => {
    const changes = [
      "1. 主线的场景清单加一步：",
      "```md",
      "## 现状",
      "### S3 逐条点选项并提交",
      "```",
      "2. 帮助里的样例：",
      "~~~~",
      "## 裁决",
      "~~~",
      "~~~~",
    ].join("\n");
    const plan = planOf(legacyPlan("要。拆一个函数。").replace("1. 一件。", changes));
    expect(plan.sections.changes).toBe(changes);
    expect(plan.sections.current).toBe("读过了。");
  });

  it("行内代码的反引号不算围栏", () => {
    const changes = "```js 写成 `a` 的样子\n## 现状\n读过了。";
    const text = legacyPlan("要。拆一个函数。").replace("## 现状\n读过了。\n\n", "");
    expect(planOf(text.replace("1. 一件。", changes)).sections.current).toBe("读过了。");
  });

  it("没有闭合的代码块一直到全文的末尾", () => {
    const text = legacyPlan("要。拆一个函数。").replace("1. 一件。", "```sh\npnpm test");
    expect(problemsOf(text)).toEqual([
      { kind: "missing", section: "guard" },
      { kind: "missing", section: "scenes" },
      { kind: "missing", section: "verdicts" },
    ]);
  });

  it("七节以外的二级标题不管，它的正文也不算进上一节", () => {
    const text = legacyPlan("要。拆一个函数。").replace(
      "## 功能改动",
      "## 风险\n改动可能影响队列看板。\n\n## 功能改动",
    );
    expect(planOf(text).sections.tidy).toBe("要。拆一个函数。");
  });

  it("开头带字节顺序标记时，第一行的标题照样认得出", () => {
    expect(planOf(`\uFEFF${legacySamplePlan}`).sections.goal).toBe("一件。");
  });

  it("Windows 的换行也能解析", () => {
    expect(planOf(legacyPlan("要。拆一个函数。").replaceAll("\n", "\r\n")).sections.current).toBe(
      "读过了。",
    );
  });
});

describe("从简的计划（R04）", () => {
  const shortPlan = (extra = "") =>
    [
      "# 计划",
      "",
      "## 要做的事",
      "改一句文案。",
      "",
      "## 功能改动",
      "1. 文案改成新的一句。检查 `pnpm test`。",
      "",
      "## 用什么锁住现有的行为",
      "`pnpm test`。",
      extra,
    ].join("\n");

  it("只写要做的事、功能改动、用什么锁住现有的行为三节：从简，不重构，另四节记成空", () => {
    expect(parseLandPlan(shortPlan())).toEqual({
      ok: true,
      value: {
        sections: {
          goal: "改一句文案。",
          current: "",
          tidy: "",
          changes: "1. 文案改成新的一句。检查 `pnpm test`。",
          guard: "`pnpm test`。",
          scenes: "",
          verdicts: "",
        },
        short: true,
        tidy: { wanted: false, reason: shortPlanTidyReason },
        verdicts: [],
      },
    });
  });

  it("三节里缺的、空的照样报；只有三节以外别的节写了一部分，就按七节查", () => {
    expect(
      problemsOf("## 要做的事\n一件。\n\n## 功能改动\n\n## 用什么锁住现有的行为\n检查。\n"),
    ).toEqual([{ kind: "empty", section: "changes", line: 4 }]);
    // 写了「现状」这一节，就是七节的计划，缺的另外几节都要报。
    expect(problemsOf(shortPlan("\n## 现状\n读过了。\n")).map((problem) => problem.kind)).toEqual([
      "missing",
      "missing",
      "missing",
    ]);
  });

  it("三节里缺一节时不是从简的计划，仍报缺的几节", () => {
    expect(problemsOf("## 要做的事\n一件。\n\n## 功能改动\n1. 一件。\n")).toHaveLength(5);
  });
});

describe("要不要先重构", () => {
  it.each([
    ["要。拆一个函数。", "要"],
    // 旧 check-land.py：「要整理一处：……」这种正常的写法
    ["要整理一处：拆一个函数。", "要"],
  ])("%j 算要", (tidy) => {
    expect(planOf(legacyPlan(tidy)).tidy).toEqual({ wanted: true });
  });

  it.each([
    // 旧 check-land.py 的用例「小改动写明理由跳过整理」
    ["不要。只改一句文案，不碰结构。", "只改一句文案，不碰结构。"],
    ["不要，只改一句文案", "只改一句文案"],
    ["不要重构：只改一句文案。", "重构：只改一句文案。"],
    ["不要。\n\n只改一句文案，不碰结构。", "只改一句文案，不碰结构。"],
  ])("%j 算不要，理由是 %j", (tidy, reason) => {
    expect(planOf(legacyPlan(tidy)).tidy).toEqual({ wanted: false, reason });
  });

  it.each([
    // 旧 check-land.py 的用例「写了不要整理，没写理由」
    "不要。",
    "不要",
    "不要，小改动",
    // 理由去掉开头的标点以后按字数算，标点也算，五个字不够
    "不要。只改文案了",
  ])("%j 没有写够理由", (tidy) => {
    expect(problemsOf(legacyPlan(tidy))).toEqual([{ kind: "tidyReason", line: 9 }]);
  });

  it.each([
    "先不动结构，只改文案。",
    "需要。拆一个函数。",
    "**不要**。只改一句文案，不碰结构。",
    "- 不要。只改一句文案，不碰结构。",
  ])("%j 没有以要或不要开头", (tidy) => {
    expect(problemsOf(legacyPlan(tidy))).toEqual([{ kind: "tidyWord", line: 9 }]);
  });
});

describe("裁决表", () => {
  it("旧 check-samples.py 的计划：表头不算，其余每行一条裁决", () => {
    expect(planOf(legacySamplePlan).verdicts).toEqual([["一件", "理由", "小"]]);
  });

  it("某一格里有 --- 的行照常收下", () => {
    const table = [
      "| 裁决 | 理由 | 错了的代价 |",
      "| --- | --- | --- |",
      "| 输出里用 --- 隔开两段 | 读的人一眼能分开 | 小 |",
      "| 拆成两个函数 | 好测 | 小 |",
    ].join("\n");
    expect(planOf(planWithVerdicts(table)).verdicts).toEqual([
      ["输出里用 --- 隔开两段", "读的人一眼能分开", "小"],
      ["拆成两个函数", "好测", "小"],
    ]);
  });

  it("旧脚本丢掉某一格里有 --- 的行，这是有意改掉的", () => {
    // build-report.py 里摆工程证据的那一句：以竖线开头、不含 --- 的行，去掉第一行
    const legacyRulings = (section: string): string[][] =>
      section
        .split("\n")
        .filter((line) => line.trim().startsWith("|") && !line.includes("---"))
        .map((line) =>
          line
            .trim()
            .replace(/^\|+|\|+$/gu, "")
            .split("|")
            .map((cell) => cell.trim()),
        )
        .slice(1);
    const table = "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n| 用 --- 隔开 | 好读 | 小 |";
    expect(legacyRulings(table)).toEqual([]);
    expect(planOf(planWithVerdicts(table)).verdicts).toEqual([["用 --- 隔开", "好读", "小"]]);
  });

  it("分隔行只认只有竖线、连字符、冒号和空格的行", () => {
    const table = [
      "| 裁决 | 理由 | 错了的代价 |",
      "|:---|:---:|---:|",
      "| 先改列表页 | 改动少 | 小 |",
      "|:--|:--|--:|",
      "| - | - | - |",
      "|   |   |   |",
      "|\t---\t|\t---\t|",
      "| 名字叫 fill | 和旧脚本一致 | 改名要动三处 |",
    ].join("\n");
    expect(planOf(planWithVerdicts(table)).verdicts).toEqual([
      ["先改列表页", "改动少", "小"],
      ["名字叫 fill", "和旧脚本一致", "改名要动三处"],
    ]);
  });

  it("格里写成 \\| 的是竖线本身，缩进和格里的空白去掉", () => {
    const table =
      "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n   |  用 a \\| b 分开  | 好读 | 小 |";
    expect(planOf(planWithVerdicts(table)).verdicts).toEqual([["用 a | b 分开", "好读", "小"]]);
  });

  it("「裁决」一节里没有表格时，没有裁决", () => {
    expect(planOf(planWithVerdicts("这一轮没有要裁决的歧义。")).verdicts).toEqual([]);
  });

  it("代码块里的表格不算裁决", () => {
    const table =
      "| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n| 一件 | 理由 | 小 |\n\n```md\n| 示例 | 不算 | 无 |\n```";
    expect(planOf(planWithVerdicts(table)).verdicts).toEqual([["一件", "理由", "小"]]);
  });

  it("裁决表只取「裁决」一节，别的节里的表格不算", () => {
    const text = planWithVerdicts("| 裁决 | 理由 | 错了的代价 |\n| --- | --- | --- |\n").replace(
      "读过了。",
      "| 文件 | 行数 |\n| --- | --- |\n| list.tsx | 420 |",
    );
    expect(planOf(text).verdicts).toEqual([]);
  });
});

describe("计划的报错", () => {
  const file = "rounds/v2-落地-3/计划.md";
  const problems: readonly LandPlanProblem[] = [
    { kind: "missing", section: "current" },
    { kind: "empty", section: "goal", line: 3 },
    { kind: "duplicate", section: "changes", lines: [5, 9] },
    { kind: "tidyWord", line: 7 },
    { kind: "tidyReason", line: 7 },
  ];

  it.each(problems)("$kind 写清什么不对、怎么改，没有残留的 {…}", (problem) => {
    const { message, hint } = describeLandPlanProblem(problem);
    expect(message).not.toBe("");
    expect(hint).not.toBe("");
    expect(`${message}${hint}`).not.toMatch(/[{}]/u);
  });

  it("缺一节的报错写出缺的是哪一节，七节的名字看帮助", () => {
    const issue = describeLandPlanProblem({ kind: "missing", section: "guard" }, file);
    expect(issue.message).toBe("计划里没有「用什么锁住现有的行为」这一节。");
    expect(issue.hint).toContain("ploop land plan --help");
    expect(issue.where).toBe(file);
  });

  it("缺两节以上合成一条：写缺几节，节名一行一个，句子都不长", () => {
    const issue = describeMissingSections(["current", "changes", "verdicts"], file);
    expect(issue.message).toBe("计划缺 3 节：\n  现状\n  功能改动\n  裁决");
    expect(issue.where).toBe(file);
    const all = describeMissingSections(landPlanSection.keys.slice(1), file);
    expect(all.message.split("\n").every((line) => line.length <= 40)).toBe(true);
  });

  it("位置写到计划文件和标题所在的行，写了两次的列出各次的行号", () => {
    expect(describeLandPlanProblem({ kind: "tidyWord", line: 7 }, file).where).toBe(
      `${file} 第 7 行`,
    );
    const duplicate = describeLandPlanProblem(
      { kind: "duplicate", section: "changes", lines: [5, 9] },
      file,
    );
    expect(duplicate.message).toBe("计划里「功能改动」这一节写了 2 次。");
    expect(duplicate.where).toBe(`${file} 第 5、9 行`);
  });

  it("没给计划文件的路径时不写位置", () => {
    expect(describeLandPlanProblem({ kind: "tidyReason", line: 7 })).not.toHaveProperty("where");
  });

  it("从共用定义的入口导出", () => {
    expect(model.parseLandPlan).toBe(parseLandPlan);
    expect(model.landCopy.plan.missing.message.text).toContain("{section}");
  });
});
