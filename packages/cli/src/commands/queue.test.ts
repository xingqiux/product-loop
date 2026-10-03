import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { detailLines, listLines, patchOf } from "./queue.ts";
import { beijingTime as local } from "./shared.ts";

// 队列的文字输出和不用碰后端就能报的错。放进、改状态的整个过程要真的后端，写在使用测试里。

type Detail = Parameters<typeof detailLines>[0];
type Item = Detail["item"];

const at = "2026-09-28T02:05:00.000Z";

function item(patch: Partial<Item> = {}): Item {
  return {
    id: "Q12",
    content: "设置页的保存按钮在窄屏被挡住",
    stage: "落地",
    proposer: "AI",
    createdAt: at,
    status: "待办",
    subItems: [],
    editCount: 0,
    ...patch,
  };
}

describe("ploop queue list 的文字", () => {
  it("编号和状态按最宽的一项对齐，一个汉字算两列", () => {
    const items = [
      item({ id: "Q9", status: "待办", stage: "构思", content: "队列看板加上按阶段筛选" }),
      item({ id: "Q12", status: "进行中" }),
    ];
    expect(listLines(items)).toEqual([
      "  Q9   待办    构思  队列看板加上按阶段筛选",
      "  Q12  进行中  落地  设置页的保存按钮在窄屏被挡住",
    ]);
  });
});

describe("ploop queue show 的文字", () => {
  it("只有必填字段时，写内容、状态、阶段和提出，不写内部的修改计数", () => {
    expect(detailLines({ item: item(), events: [], appearances: [] })).toEqual([
      "Q12：设置页的保存按钮在窄屏被挡住",
      "状态：待办",
      "阶段：落地",
      `提出：AI，${local(at)}`,
    ]);
  });

  it("备注紧跟在内容下面：一行的写在「备注：」后面", () => {
    expect(
      detailLines({ item: item({ note: "先看窄屏的截图" }), events: [], appearances: [] }),
    ).toEqual([
      "Q12：设置页的保存按钮在窄屏被挡住",
      "备注：先看窄屏的截图",
      "状态：待办",
      "阶段：落地",
      `提出：AI，${local(at)}`,
    ]);
  });

  it("多行的备注先写「备注：」，每一行缩进两格，空行留着，行尾的空白去掉", () => {
    const note = "第一行  \n\n第二行\r\n第三行";
    expect(detailLines({ item: item({ note }), events: [], appearances: [] }).slice(0, 6)).toEqual([
      "Q12：设置页的保存按钮在窄屏被挡住",
      "备注：",
      "  第一行",
      "",
      "  第二行",
      "  第三行",
    ]);
  });

  it("没写备注时不出「备注」这一行", () => {
    const text = detailLines({ item: item(), events: [], appearances: [] }).join("\n");
    expect(text).not.toContain("备注");
  });

  it("写了的字段逐行写出，状态变化按先后排", () => {
    const full = item({
      status: "等待",
      proposedIn: "v2-检查-1",
      statusNote: "等构思定下场景 S4",
      dependsOn: "等构思定下场景 S4",
      acceptance: "窄屏下保存按钮完整可见",
      subItems: ["设置页", "队列页"],
      source: "接 Q3",
      fromLine: { submission: 4, line: 2 },
      editCount: 2,
    });
    const events = [
      { item: "Q12", at, to: "待办" as const, round: "v2-检查-1", actor: "cli/2.0.0" },
      {
        item: "Q12",
        at,
        from: "待办" as const,
        to: "等待" as const,
        note: "等构思定下场景 S4",
        actor: "cli/2.0.0",
      },
    ];
    expect(detailLines({ item: full, events, appearances: [] })).toEqual([
      "Q12：设置页的保存按钮在窄屏被挡住",
      "状态：等待",
      "阶段：落地",
      `提出：AI，${local(at)}，在第 2 版的检查阶段`,
      "状态说明：等构思定下场景 S4",
      "依赖：等构思定下场景 S4",
      "验收标准：窄屏下保存按钮完整可见",
      "子项：",
      "  1. 设置页",
      "  2. 队列页",
      "来源：接 Q3",
      "来自：第 4 份回复的第 2 行",
      "状态变化：",
      `  ${local(at)}  放进队列，待办，在第 2 版的检查阶段`,
      `  ${local(at)}  待办 → 等待：等构思定下场景 S4`,
    ]);
  });
});

describe("ploop queue edit 的请求体", () => {
  it("只带写了的几项", () => {
    expect(patchOf({ content: "新的内容", items: true })).toEqual({ content: "新的内容" });
  });

  it("--no-acceptance、--no-source 写 null，--no-items 写空的子项", () => {
    expect(patchOf({ acceptance: false, source: false, items: false })).toEqual({
      acceptance: null,
      source: null,
      subItems: [],
    });
  });

  it("--note 写文字，--no-note 写 null", () => {
    expect(patchOf({ note: "第一行\n第二行", items: true })).toEqual({ note: "第一行\n第二行" });
    expect(patchOf({ note: false, items: true })).toEqual({ note: null });
  });

  it("写了子项就整份替换", () => {
    expect(patchOf({ item: ["设置页", "队列页"], items: true })).toEqual({
      subItems: ["设置页", "队列页"],
    });
  });

  it("--stage、--status-note、--evidence、--depends-on 写进请求体，只改文字和标注", () => {
    expect(
      patchOf({
        stage: "落地",
        statusNote: "等第 1 版的结果",
        evidence: "提交 3f2a9c1",
        dependsOn: "等构思阶段定下场景",
        items: true,
      }),
    ).toEqual({
      stage: "落地",
      statusNote: "等第 1 版的结果",
      evidence: "提交 3f2a9c1",
      dependsOn: "等构思阶段定下场景",
    });
  });
});

describe("ploop queue 不用碰后端就能报的错", () => {
  it("drop 不写 --reason：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["queue", "drop", "Q1"]);
    expect(stderr).toBe(
      [
        "用法错误：ploop queue drop 缺少必填的选项 --reason <原因>。",
        '怎么改：写法例如 ploop queue drop Q15 --reason "已在第 2 版的落地阶段修掉"。运行 ploop queue drop --help 查看用法。',
        "",
      ].join("\n"),
    );
    expect(code).toBe(2);
  });

  it("wait 不写 --depends-on、done 不写 --evidence：退出码 2", async () => {
    expect((await ploop(["queue", "wait", "Q1"])).code).toBe(2);
    expect((await ploop(["queue", "done", "Q1"])).code).toBe(2);
  });

  it("编号写错：用法错误，报共用定义里的写法", async () => {
    const { code, stderr } = await ploop(["queue", "show", "q12"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：参数 <编号> 的取值「q12」不对。写成 Q12 这样：大写的 Q 加数字，数字前面不补 0。",
    );
    expect(code).toBe(2);
  });

  it("add 不写 --stage 或写错阶段：退出码 2", async () => {
    expect((await ploop(["queue", "add", "设置页的按钮被挡住"])).code).toBe(2);
    const { code, stderr } = await ploop(["queue", "list", "--stage", "评审"]);
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：选项 --stage <阶段名> 的取值「评审」不对。取值只能写下面之一：构思、使用、检查、落地、提升。",
    );
    expect(code).toBe(2);
  });
});
