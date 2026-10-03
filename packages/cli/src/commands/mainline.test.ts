import { mainlineParseSchema, parseMainline, textDiff } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { diffLines, historyLines, showLines, syncReport } from "./mainline.ts";
import { beijingTime } from "./shared.ts";

// 主线各子命令的文字输出和不用碰后端就能报的错。同步的整个过程要真的后端，写在使用测试里。

const at = "2026-09-28T02:05:00.000Z";
const text = [
  "# 主线",
  "",
  "## 不做什么和胃口",
  "",
  "不做多人协作。",
  "",
  "## 场景清单",
  "",
  "### S1 看队列",
  "谁在什么时候用：你。",
  "1. 点队列 → 看到看板",
  "",
  "### 看决定",
  "谁在什么时候用：你。",
  "1. 点决定 → 看到表格",
  "",
].join("\n");

/** 接口上的一次修订：解析结果照后端的写法编码成中文。 */
function revision() {
  const { problems: _problems, ...parsed } = parseMainline(text);
  return {
    revision: 4,
    hash: "a".repeat(64),
    source: "项目缓存" as const,
    round: "v1-构思-2",
    createdAt: at,
    text,
    parsed: mainlineParseSchema.encode(parsed),
  };
}

describe("ploop mainline show 的文字", () => {
  it("写第几次修订、缺哪几个部分和场景清单，没写编号的场景写明没有编号", () => {
    expect(showLines(revision(), false)).toEqual([
      `主线修订 4：${beijingTime(at)}，来自项目缓存，在第 1 版的构思阶段（第 2 次）交的`,
      "主线缺 8 个部分：",
      ...[
        "一句话新闻稿",
        "给谁用",
        "要完成的任务",
        "交付线",
        "四个风险",
        "常见问题与待定",
        "事前验尸",
        "设计规范",
      ].map((name) => `  ${name}`),
      "设计规范缺 12 个部分：",
      ...[
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
      ].map((name) => `  ${name}`),
      "场景 2 个：",
      "  S1  看队列",
      "  没有编号  看决定",
    ]);
  });

  it("--text 接上全文", () => {
    const lines = showLines({ ...revision(), round: null }, true);
    expect(lines[0]).toBe(`主线修订 4：${beijingTime(at)}，来自项目缓存`);
    expect(lines.slice(-2)).toEqual(["全文：", text.trimEnd()]);
  });
});

describe("ploop mainline history 和 diff 的文字", () => {
  it("每次修订一行，两个阶段之间交的不写阶段", () => {
    const summary = { hash: "a".repeat(64), source: "项目缓存" as const, createdAt: at };
    expect(
      historyLines([
        { ...summary, revision: 1, round: null },
        { ...summary, revision: 2, round: "v1-构思-1" },
      ]),
    ).toEqual([
      `  修订 1  ${beijingTime(at)}  项目缓存`,
      `  修订 2  ${beijingTime(at)}  项目缓存  第 1 版的构思阶段`,
    ]);
  });

  it("没变的空两格，删掉的写 -，加上的写 +，改了一部分的拆成两行，折起来的写省略号", () => {
    const before = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "保存按钮在右边"].join("\n");
    const after = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "保存按钮在左边", "", "新的一行"].join(
      "\n",
    );
    expect(diffLines(textDiff(before, after))).toEqual([
      "  …",
      "  己",
      "  庚",
      "- 保存按钮在右边",
      "+ 保存按钮在左边",
      "+",
      "+ 新的一行",
    ]);
  });
});

describe("ploop mainline push 和 pull 的文字", () => {
  const file = "/Users/me/proj/app/.product-loop/主线.md";

  it("交上了新的修订：写补上的场景编号、没有了的场景和删掉的主线.远端.md", () => {
    const report = syncReport(
      {
        kind: "pushed",
        rewritten: true,
        remoteRemoved: true,
        pushed: {
          revision: { revision: 5, hash: "b".repeat(64), text },
          created: true,
          assignedScenes: [{ id: "S2", name: "看决定" }],
          removedScenes: ["S3"],
          warnings: [],
        },
      },
      file,
    );
    expect(report.lines).toEqual([
      "交上了：主线修订 5",
      "补上了场景编号 S2 看决定，已写回主线.md。",
      "这次修订里没有了场景 S3。",
      "删掉了主线.远端.md。",
      `文件：${file}`,
    ]);
    expect(report.next).toEqual(["ploop mainline check"]);
  });

  it("全文和最新的修订相同：写没有改动", () => {
    const report = syncReport(
      {
        kind: "pushed",
        rewritten: false,
        remoteRemoved: false,
        pushed: {
          revision: { revision: 5, hash: "b".repeat(64), text },
          created: false,
          assignedScenes: [],
          removedScenes: [],
          warnings: [],
        },
      },
      file,
    );
    expect(report.lines[0]).toBe("主线没有改动：已是修订 5");
  });

  it("取回：丢掉了没交的改动时写明", () => {
    const report = syncReport(
      { kind: "pulled", revision: 5, discarded: true, remoteRemoved: false },
      file,
    );
    expect(report.lines).toEqual([
      "取回了：主线修订 5，覆盖了主线.md",
      "主线.md 里没交的改动已丢掉。",
      `文件：${file}`,
    ]);
  });
});

describe("ploop mainline 不用碰后端就能报的错", () => {
  it("修订的次数不是从 1 起的整数：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["mainline", "show", "0"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：参数 [修订] 的取值「0」不对。修订的次数要写从 1 起的整数，例如 3。",
    );
    expect(code).toBe(2);
    expect((await ploop(["mainline", "diff", "2", "x"])).code).toBe(2);
  });
});
