import { describe, expect, it } from "vitest";
import { parseMainline } from "./parse.ts";
import { parseSceneTitle } from "./scenes.ts";

/** 只有场景清单一节的主线。第 1 到 4 行是标题和空行，传进来的第一行是第 5 行。 */
const sceneList = (...lines: string[]): string =>
  ["# 主线", "", "## 场景清单", "", ...lines].join("\n");

const parse = (...lines: string[]) => parseMainline(sceneList(...lines));
const kinds = (...lines: string[]) => parse(...lines).problems.map((p) => p.kind);

// 「09 skill 与软件」第三节的两个例子，原样照抄
const s9 = [
  "### S9 看队列",
  "谁在什么时候用：你，想知道还有哪些事没做时。",
  "1. 在项目页点队列 → 看到五列看板；在等别的事的放在上面，写明在等什么。",
  "2. 点一张小卡 → 看到展示卡片列出十格，还有它的状态变化和出现在哪几轮。",
];
const s14 = [
  "### S14 会话中途接手",
  "谁在什么时候用：AI，会话被压缩或换了一个会话时。",
  "1. 敲 ploop → 看到当前第几版、哪个阶段、第几轮，有没有一页在等，下一步敲什么。",
  "2. 敲 ploop round show → 看到这一轮拿出来的事、给出过的页、收到的回复和每一行的去处。",
];

describe("新写法的场景", () => {
  it("「09 skill 与软件」第三节的两个例子：编号、名字、谁在什么时候用、每一步", () => {
    const result = parse(...s9, "", ...s14);
    expect(result.problems).toEqual([]);
    expect(result.scenes).toEqual([
      {
        id: 9,
        name: "看队列",
        who: "你，想知道还有哪些事没做时。",
        steps: [
          {
            step: 1,
            do: "在项目页点队列",
            expect: "看到五列看板；在等别的事的放在上面，写明在等什么。",
            line: 7,
          },
          {
            step: 2,
            do: "点一张小卡",
            expect: "看到展示卡片列出十格，还有它的状态变化和出现在哪几轮。",
            line: 8,
          },
        ],
        line: 5,
        endLine: 8,
        legacy: false,
      },
      {
        id: 14,
        name: "会话中途接手",
        who: "AI，会话被压缩或换了一个会话时。",
        steps: [
          {
            step: 1,
            do: "敲 ploop",
            expect: "看到当前第几版、哪个阶段、第几轮，有没有一页在等，下一步敲什么。",
            line: 12,
          },
          {
            step: 2,
            do: "敲 ploop round show",
            expect: "看到这一轮拿出来的事、给出过的页、收到的回复和每一行的去处。",
            line: 13,
          },
        ],
        line: 10,
        endLine: 13,
        legacy: false,
      },
    ]);
  });

  it("AI 写新场景时可以不写编号，不算问题", () => {
    const [scene] = parse("### 看队列", ...s9.slice(1)).scenes;
    expect(scene).toMatchObject({ name: "看队列", legacy: false });
    expect(scene).not.toHaveProperty("id");
    expect(kinds("### 看队列", ...s9.slice(1))).toEqual([]);
  });

  it("名字后面的括号是说明，不算名字", () => {
    expect(parseSceneTitle("S5 验收更改（这一页不用点）")).toEqual({
      id: 5,
      name: "验收更改",
      note: "这一页不用点",
      legacy: false,
    });
    expect(parseSceneTitle("（只看）")).toEqual({ name: "（只看）", legacy: false });
  });

  it("编号和名字之间可以不空格，也可以用全角空格或冒号隔开", () => {
    for (const title of ["S14会话中途接手", "S14　会话中途接手", "S14：会话中途接手"]) {
      expect(parseSceneTitle(title)).toEqual({ id: 14, name: "会话中途接手", legacy: false });
    }
  });

  it("S 后面紧跟英文字母的不是编号，整个是名字", () => {
    expect(parseSceneTitle("S3D 模型")).toEqual({ name: "S3D 模型", legacy: false });
    expect(parseSceneTitle("SQL 查询")).toEqual({ name: "SQL 查询", legacy: false });
  });

  it("谁在什么时候用可以写半角冒号，也可以写在步骤后面", () => {
    const [scene] = parse("### S1 看", "1. 打开 → 看到", "谁在什么时候用: 你，每天。").scenes;
    expect(scene?.who).toBe("你，每天。");
  });

  it("编号的步骤也认「1、」「1）」这两种写法", () => {
    const [scene] = parse(
      "### S1 看",
      "谁在什么时候用：你。",
      "1、打开 → 看到",
      "2）关掉 → 没了",
    ).scenes;
    expect(scene?.steps.map((s) => [s.step, s.do, s.expect])).toEqual([
      [1, "打开", "看到"],
      [2, "关掉", "没了"],
    ]);
  });

  it("步骤之间的空行不打断场景", () => {
    const [scene] = parse(
      "### S1 看",
      "谁在什么时候用：你。",
      "1. 甲 → 乙",
      "",
      "2. 丙 → 丁",
    ).scenes;
    expect(scene?.steps).toHaveLength(2);
    expect(scene?.endLine).toBe(9);
  });

  it("三级标题开始下一个场景，二级标题结束场景清单", () => {
    const result = parseMainline(
      [
        ...sceneList(...s9).split("\n"),
        "",
        "## 不做什么和胃口",
        "### S2 不是场景",
        "1. 甲 → 乙",
      ].join("\n"),
    );
    expect(result.scenes.map((s) => s.name)).toEqual(["看队列"]);
  });

  it("场景清单以外的三级标题不算场景", () => {
    const text = ["## 给谁用", "### S1 不是场景", "谁在什么时候用：你。", "1. 甲 → 乙"].join("\n");
    expect(parseMainline(text).scenes).toEqual([]);
  });

  it("代码块里的三级标题和编号不算", () => {
    const result = parse(...s9, "```", "### S2 不是场景", "1. 甲 → 乙", "```");
    expect(result.scenes.map((s) => s.name)).toEqual(["看队列"]);
    expect(result.problems).toEqual([
      { kind: "sceneExtraText", line: 9, scene: "S9 看队列", count: 4 },
    ]);
  });
});

describe("场景写错的地方", () => {
  it("没有「→」：整步算做什么，该看到什么是空的", () => {
    const result = parse("### S1 看", "谁在什么时候用：你。", "1. 打开网页，看到页头");
    expect(result.scenes[0]?.steps).toEqual([
      { step: 1, do: "打开网页，看到页头", expect: "", line: 7 },
    ]);
    expect(result.problems).toEqual([
      { kind: "stepArrowMissing", line: 7, scene: "S1 看", step: 1 },
    ]);
  });

  it("「→」前面或后面是空的", () => {
    const result = parse("### S1 看", "谁在什么时候用：你。", "1. → 看到页头", "2. 打开 →", "3. →");
    expect(result.problems).toEqual([
      { kind: "stepDoEmpty", line: 7, scene: "S1 看", step: 1 },
      { kind: "stepExpectEmpty", line: 8, scene: "S1 看", step: 2 },
      { kind: "stepDoEmpty", line: 9, scene: "S1 看", step: 3 },
      { kind: "stepExpectEmpty", line: 9, scene: "S1 看", step: 3 },
    ]);
  });

  it("一步里有两个「→」时报出来，按第一个分开", () => {
    const result = parse(
      "### S1 看",
      "谁在什么时候用：你。",
      "1. 全部点完 → 点复制回复 → 得到几行",
    );
    expect(result.scenes[0]?.steps[0]).toMatchObject({
      do: "全部点完",
      expect: "点复制回复 → 得到几行",
    });
    expect(result.problems).toEqual([
      { kind: "stepArrowExtra", line: 7, scene: "S1 看", step: 1, count: 2 },
    ]);
  });

  it("写的编号和先后对不上：步号按先后数，另报出写的编号", () => {
    const result = parse(
      "### S1 看",
      "谁在什么时候用：你。",
      "1. 甲 → 乙",
      "3. 丙 → 丁",
      "3. 戊 → 己",
    );
    expect(result.scenes[0]?.steps.map((s) => s.step)).toEqual([1, 2, 3]);
    expect(result.problems).toEqual([
      { kind: "stepNumber", line: 8, scene: "S1 看", step: 2, written: 3 },
    ]);
  });

  it("没写谁在什么时候用，或者冒号后面是空的", () => {
    expect(kinds("### S1 看", "1. 甲 → 乙")).toEqual(["sceneWhoMissing"]);
    expect(kinds("### S1 看", "谁在什么时候用：", "1. 甲 → 乙")).toEqual(["sceneWhoMissing"]);
    expect(parse("### S1 看", "谁在什么时候用：", "1. 甲 → 乙").scenes[0]).not.toHaveProperty(
      "who",
    );
  });

  it("没有步骤的三级标题也算一个场景，报没有步骤", () => {
    expect(parse("### 说明", "这一节写场景的来历。").problems).toEqual([
      { kind: "sceneWhoMissing", line: 5, scene: "说明" },
      { kind: "sceneNoSteps", line: 5, scene: "说明" },
      { kind: "sceneExtraText", line: 6, scene: "说明", count: 1 },
    ]);
  });

  it("既不是步骤、也不是谁在什么时候用的行，一个场景报一条，写第一行和行数", () => {
    const result = parse(
      "### S1 看",
      "谁在什么时候用：你。",
      "谁在什么时候用：别人。",
      "1. 甲 → 乙",
      "- 列表不是步骤",
      "#### 小标题",
      "一段说明。",
    );
    expect(result.problems).toEqual([
      { kind: "sceneExtraText", line: 7, scene: "S1 看", count: 4 },
    ]);
    expect(result.scenes[0]?.endLine).toBe(11);
  });

  it("标题只有编号，没有名字", () => {
    expect(kinds("### S3", "谁在什么时候用：你。", "1. 甲 → 乙")).toEqual(["sceneNameEmpty"]);
  });

  it.each([
    ["S03 看队列", "S03"],
    ["S0 看队列", "S0"],
    ["s3 看队列", "s3"],
  ])("编号写错了：「### %s」", (title, text) => {
    const result = parse(`### ${title}`, "谁在什么时候用：你。", "1. 甲 → 乙");
    expect(result.scenes[0]).toMatchObject({ name: "看队列" });
    expect(result.scenes[0]).not.toHaveProperty("id");
    expect(result.problems).toEqual([{ kind: "sceneIdInvalid", line: 5, text }]);
  });

  it("几个场景写了同一个编号，报一条，带上各处的行号", () => {
    const result = parse(
      ...s9,
      "",
      "### S9 看决定",
      "谁在什么时候用：你。",
      "1. 甲 → 乙",
      "",
      ...s9,
    );
    expect(result.scenes.map((s) => s.id)).toEqual([9, 9, 9]);
    expect(result.problems).toEqual([
      { kind: "sceneIdDuplicate", line: 5, id: 9, lines: [5, 10, 14] },
    ]);
  });

  it("场景清单里没有认出任何场景", () => {
    const table = ["| 编号 | 场景 |", "| --- | --- |", "| 1 | 第一次来 |"];
    expect(parse(...table).problems).toEqual([{ kind: "scenesNone", line: 3 }]);
    expect(parse().problems).toEqual([{ kind: "scenesNone", line: 3 }]);
  });

  it("每个场景的问题一次全部报出，按行号排", () => {
    const result = parse(
      "### S1 甲",
      "1. 没有箭头",
      "",
      "### S1 乙",
      "谁在什么时候用：你。",
      "2. → 看到",
    );
    expect(result.problems).toEqual([
      { kind: "sceneWhoMissing", line: 5, scene: "S1 甲" },
      { kind: "sceneIdDuplicate", line: 5, id: 1, lines: [5, 8] },
      { kind: "stepArrowMissing", line: 6, scene: "S1 甲", step: 1 },
      { kind: "stepNumber", line: 10, scene: "S1 乙", step: 1, written: 2 },
      { kind: "stepDoEmpty", line: 10, scene: "S1 乙", step: 1 },
    ]);
  });
});

describe("旧写法的场景", () => {
  it("skill 自己的旧主线：「场景「名字」（说明）：」加编号的步骤", () => {
    const result = parse(
      "场景「回答疑问」：",
      "1. 打开网页 → 页头写着系统、阶段、第几轮。",
      "",
      "场景「验收更改」（这一页不用点）：",
      "1. 打开网页 → 目录里有更改这一组。",
    );
    expect(result.scenes).toEqual([
      {
        name: "回答疑问",
        steps: [{ step: 1, do: "打开网页", expect: "页头写着系统、阶段、第几轮。", line: 6 }],
        line: 5,
        endLine: 6,
        legacy: true,
      },
      {
        name: "验收更改",
        note: "这一页不用点",
        steps: [{ step: 1, do: "打开网页", expect: "目录里有更改这一组。", line: 9 }],
        line: 8,
        endLine: 9,
        legacy: true,
      },
    ]);
    expect(result.problems).toEqual([
      { kind: "sceneLegacy", line: 5, scene: "回答疑问" },
      { kind: "sceneLegacy", line: 8, scene: "验收更改" },
    ]);
  });

  it.each([
    ["场景 1（任务 1，产品卖的就是这条）：", { name: "任务 1，产品卖的就是这条" }],
    ["场景 2（第一次进来、看不懂中国公司名）", { name: "第一次进来、看不懂中国公司名" }],
    [
      "场景 1（产品卖的就是这条）：海外招聘方从邮件里的链接进来",
      { name: "海外招聘方从邮件里的链接进来", note: "产品卖的就是这条" },
    ],
    [
      "场景一　讲师确认一次刚完成的对练分数可用（产品卖的就是这条）",
      { name: "讲师确认一次刚完成的对练分数可用", note: "产品卖的就是这条" },
    ],
    ["**场景 3**（回头看）：", { name: "回头看" }],
  ])("旧模板和别的项目的写法：%s", (head, title) => {
    const [scene] = parse(head, "", "1. 打开 → 看到").scenes;
    expect(scene).toMatchObject({ ...title, legacy: true, line: 5 });
    expect(scene?.steps).toHaveLength(1);
  });

  it("三级标题以旧编号开头的，去掉旧编号，算旧写法", () => {
    const result = parse(
      "### 场景 1　每月整理，交给外部 AI（产品卖的就是这条）",
      "1. 对外部 AI 说一句话 → 回报服务正常",
    );
    expect(result.scenes[0]).toMatchObject({
      name: "每月整理，交给外部 AI",
      note: "产品卖的就是这条",
      legacy: true,
    });
    expect(result.problems).toEqual([
      { kind: "sceneLegacy", line: 5, scene: "每月整理，交给外部 AI" },
    ]);
  });

  it("旧写法的一行字后面紧跟编号的步骤才算场景", () => {
    expect(parse("场景 1 是产品卖的那条。", "", "一段说明。").problems).toEqual([
      { kind: "scenesNone", line: 3 },
    ]);
    expect(parse("场景里的「外部 AI」指终端里的 omp。", "1. 甲 → 乙").scenes).toEqual([]);
  });

  it("旧写法的场景到步骤后面第一行别的字为止，后面的说明不算进场景", () => {
    const result = parse(
      "场景「截图反馈」：",
      "1. 粘贴截图 → 出现缩略图",
      "2. 点缩略图 → 放大",
      "第 15 轮定了列表加详情。",
      "- 模板：编号只写数字。",
    );
    expect(result.scenes).toHaveLength(1);
    expect(result.scenes[0]).toMatchObject({ endLine: 7 });
    expect(result.problems.map((p) => p.kind)).toEqual(["sceneLegacy"]);
  });

  it("四级标题也结束旧写法的场景", () => {
    const result = parse(
      "场景「截图反馈」：",
      "1. 粘贴截图 → 出现缩略图",
      "#### 说明",
      "一段说明。",
    );
    expect(result.scenes[0]).toMatchObject({ endLine: 6 });
    expect(result.problems.map((p) => p.kind)).toEqual(["sceneLegacy"]);
  });

  it("旧写法不要求谁在什么时候用，写了也照样取出", () => {
    const [scene] = parse("场景「回答疑问」：", "谁在什么时候用：你。", "1. 甲 → 乙").scenes;
    expect(scene?.who).toBe("你。");
  });
});
