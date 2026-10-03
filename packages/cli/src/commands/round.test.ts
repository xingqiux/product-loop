import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { buildProgram } from "../program.ts";
import {
  closedLines,
  collectDefer,
  collectDone,
  collectReturn,
  collectTake,
  detailLines,
  startedLines,
} from "./round.ts";
import { beijingTime as local } from "./shared.ts";

// 阶段的文字输出、选项的取值，和不用碰后端就能报的错。开始、收尾的整个过程写在使用测试里。

type Started = Parameters<typeof startedLines>[0];
type Detail = Parameters<typeof detailLines>[0];
type Item = Started["taken"][number];

const at = "2026-09-28T08:05:00.000Z";

function item(patch: Partial<Item> = {}): Item {
  return {
    id: "Q12",
    content: "设置页的保存按钮在窄屏被挡住",
    stage: "检查",
    proposer: "AI",
    createdAt: at,
    status: "进行中",
    subItems: [],
    editCount: 0,
    ...patch,
  };
}

const round = {
  label: "v2-检查-1",
  version: 2,
  stage: "检查",
  seq: 1,
  status: "进行中",
  startedAt: at,
  closedAt: null,
  legacyId: null,
  summary: null,
} as const;

const version = {
  version: 1,
  status: "已结束",
  startedAt: at,
  endedAt: at,
  summary: null,
  endReason: "第 1 版的提升阶段已收尾。",
} as const;

function started(patch: Partial<Started> = {}): Started {
  return {
    round,
    versionChange: null,
    autoClosed: null,
    taken: [item(), item({ id: "Q15", content: "队列看板的等待行和列里的卡重复" })],
    deferred: [],
    waiting: [],
    baseCommits: null,
    mainline: { revision: 3, missingParts: [], missingDesignSpec: [] },
    screens: null,
    ...patch,
  };
}

describe("选项的取值", () => {
  it("--take 用逗号隔开，全角逗号和顿号也收，可以写多次", () => {
    expect(collectTake("Q12,Q15", undefined)).toEqual(["Q12", "Q15"]);
    expect(collectTake("Q3，Q4、 Q5", ["Q1"])).toEqual(["Q1", "Q3", "Q4", "Q5"]);
    expect(() => collectTake(" , ", undefined)).toThrow("写成用逗号隔开的编号");
  });

  it("--defer 在第一个等号处分开，依赖里可以再有等号", () => {
    expect(collectDefer("Q9=等构思定下场景 S4", undefined)).toEqual([
      { id: "Q9", dependsOn: "等构思定下场景 S4" },
    ]);
    expect(collectDefer("Q9=a=b", undefined)).toEqual([{ id: "Q9", dependsOn: "a=b" }]);
    expect(() => collectDefer("Q9", undefined)).toThrow("写成 <编号>=<依赖>");
    expect(() => collectDefer("=等", undefined)).toThrow("写成 <编号>=<依赖>");
  });

  it("--done 写编号和证据；--return 可以在编号后面写冒号和阶段", () => {
    expect(collectDone("Q12=提交 3f2a9c1", undefined)).toEqual([
      { id: "Q12", result: "做完", note: "提交 3f2a9c1" },
    ]);
    expect(collectReturn("Q15=定义不对", undefined)).toEqual([
      { id: "Q15", result: "退回", note: "定义不对" },
    ]);
    expect(collectReturn("Q15：构思=定义不对", undefined)).toEqual([
      { id: "Q15", result: "退回", note: "定义不对", stage: "构思" },
    ]);
    expect(() => collectReturn("Q15:评审=定义不对", undefined)).toThrow("取值只能写下面之一：构思");
    expect(() => collectReturn("Q15:构思:落地=x", undefined)).toThrow("<编号>:<阶段名>=<原因>");
    expect(() => collectDone("Q12", undefined)).toThrow("写成 <编号>=<证据>");
  });
});

describe("ploop round start 的文字", () => {
  it("主线齐全时照「04 命令行」第五节的样例写", () => {
    expect(startedLines(started(), ".product-loop/rounds/v2-检查-1/")).toEqual([
      "开始了：第 2 版的检查阶段",
      "拿出来的事：",
      "  Q12  设置页的保存按钮在窄屏被挡住",
      "  Q15  队列看板的等待行和列里的卡重复",
      "主线：10 个部分齐全，设计规范 12 个部分齐全",
      "工作区：.product-loop/rounds/v2-检查-1/",
      "",
      "先做：",
      "  判断：不成立的，运行 ploop queue drop Q12 --reason <原因>。",
      "  页面：逐屏看，页面数据写进 .product-loop/rounds/v2-检查-1/page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。",
    ]);
  });

  it("替上一个阶段收了尾、进入了新的一版、改成等待、落地的提交，各写一段", () => {
    const lines = startedLines(
      started({
        autoClosed: { ...round, label: "v1-提升-1", status: "已收尾" },
        versionChange: { ended: version, started: { ...version, version: 2, status: "进行中" } },
        taken: [],
        deferred: [item({ id: "Q9", status: "等待", dependsOn: "等构思定下场景 S4" })],
        baseCommits: [{ root: "/work/app", commit: "3f2a9c1e5b7d".padEnd(40, "0") }],
        mainline: { revision: null, missingParts: ["给谁用"], missingDesignSpec: ["配色", "动效"] },
      }),
      undefined,
    );
    expect(lines).toEqual([
      "开始了：第 2 版的检查阶段",
      "开始以前替第 1 版的提升阶段收了尾。",
      "进入了第 2 版，第 1 版已结束：第 1 版的提升阶段已收尾。",
      "这个阶段没有待办的事。",
      "改成等待的事：",
      "  Q9  设置页的保存按钮在窄屏被挡住（等：等构思定下场景 S4）",
      "起点提交：",
      "  3f2a9c1e5b7d",
      "",
      "先做：",
      "  页面：逐屏看，页面数据写进 rounds/v2-检查-1/page.json，要有元素清单。例子运行 ploop page example --stage 检查，字段运行 ploop page schema --brief --stage 检查。写好运行 ploop page check。",
    ]);
  });
});

describe("ploop round start 里还在等待的事", () => {
  it("这个阶段原来就在等待的事单独列出，写明这次没有拿出来和怎么改回待办", () => {
    const lines = startedLines(
      started({
        taken: [],
        waiting: [item({ id: "Q3", status: "等待", dependsOn: "等构思定下场景 S4" })],
      }),
      undefined,
    );
    expect(lines.slice(1, 5)).toEqual([
      "这个阶段没有待办的事。",
      "还在等待的事，这次没有拿出来：",
      "  Q3  设置页的保存按钮在窄屏被挡住（等：等构思定下场景 S4）",
      "  等的事做完了，运行 ploop queue reopen Q3，改回待办。",
    ]);
  });
});

describe("ploop round show 的文字", () => {
  const detail: Detail = {
    round: { ...round, status: "已收尾", closedAt: at, legacyId: "check-7" },
    openedBySession: "7f3a9c2e",
    openedByClient: "cli/2.0.0",
    baseCommits: null,
    summary: "查完了设置页",
    items: [
      { item: item({ status: "已完成" }), result: "做完", returnedTo: null, note: "提交 3f2a9c1" },
      {
        item: item({ id: "Q15", status: "待办", content: "卡重复" }),
        result: "退回",
        returnedTo: "构思",
        note: "定义不对",
      },
      { item: item({ id: "Q9", content: "等依赖" }), result: null, returnedTo: null, note: null },
    ],
    pages: [
      {
        id: 12,
        seq: 1,
        purpose: "要用户点",
        status: "已回复",
        presentedAt: at,
        withdrawnAt: null,
      },
    ],
    replies: [
      {
        id: 3,
        project: "app",
        page: 12,
        pageSeq: 1,
        round: "v2-检查-1",
        source: "工作台",
        submittedAt: at,
        takenAt: null,
        text: null,
        lines: [
          {
            submission: 3,
            line: 1,
            section: "疑问",
            card: "ask-a",
            cardTitle: "导出格式",
            kind: "只写了备注",
            note: "要 CSV",
            images: ["a".repeat(64)],
            imagesRead: false,
            handled: {
              destination: { to: "队列", id: "Q4" },
              at,
              by: "cli/2.0.0",
            },
          },
          { submission: 3, line: 2, kind: "想法", note: "加个搜索", images: [], imagesRead: false },
        ],
      },
    ],
  };

  it("写状态、谁开的、迁移前的文件名、收尾，拿出来的事、给出过的页和收到的回复", () => {
    expect(detailLines(detail)).toEqual([
      "第 2 版的检查阶段：已收尾",
      `开始：${local(at)}，会话 7f3a9c2e`,
      "迁移前的文件名：check-7",
      `收尾：${local(at)}`,
      "收尾说明：查完了设置页",
      "拿出来的事：",
      "  Q12  做完      设置页的保存按钮在窄屏被挡住",
      "  Q15  退回构思  卡重复",
      "  Q9   进行中    等依赖",
      "给出过的页：",
      `  第 1 页，要用户点，已回复，${local(at)}`,
      "收到的回复：",
      "  第 1 页的回复（回复 3），2 行，还没处理 1 行",
      "    第 1 行  疑问「导出格式」  只写了备注：要 CSV",
      "      去处：队列 Q4（命令行）",
      "    第 2 行  想法：加个搜索",
    ]);
  });

  it("没记下会话、没有事、没有页时各写一行", () => {
    const empty = {
      ...detail,
      round,
      openedBySession: null,
      summary: null,
      items: [],
      pages: [],
      replies: [],
    };
    expect(detailLines(empty)).toEqual([
      "第 2 版的检查阶段：进行中",
      `开始：${local(at)}`,
      "拿出来的事：没有",
      "给出过的页：没有",
      "收到的回复：没有",
    ]);
  });
});

describe("ploop round close 的文字", () => {
  it("写阶段，每件事的结果和收尾说明", () => {
    const closed = {
      round: { ...round, status: "已收尾" as const, closedAt: at },
      summary: null,
      items: [{ item: item({ status: "已完成" }), result: "做完", returnedTo: null, note: "x" }],
    } as const;
    expect(closedLines(closed)).toEqual([
      "收尾了：第 2 版的检查阶段",
      "拿出来的事的结果：",
      "  Q12  做完  设置页的保存按钮在窄屏被挡住",
    ]);
  });
});

describe("不用碰后端就能报的错", () => {
  it("阶段不对：用法错误，列出五个阶段", async () => {
    const { code, stderr } = await ploop(["round", "start", "评审"], { build: buildProgram });
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：参数 <阶段名> 的取值「评审」不对。取值只能写下面之一：构思、使用、检查、落地、提升。",
    );
    expect(code).toBe(2);
  });

  it("--defer 没写等号、--return 的阶段不对：用法错误", async () => {
    const build = buildProgram;
    const defer = await ploop(["round", "start", "落地", "--defer", "Q9"], { build });
    expect(defer.stderr).toContain("写成 <编号>=<依赖>");
    expect(defer.code).toBe(2);
    const back = await ploop(["round", "close", "--return", "Q1:评审=x"], { build });
    expect(back.code).toBe(2);
  });
});
