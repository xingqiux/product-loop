import { describe, expect, it } from "vitest";
import {
  describeLegacyQueueCheck,
  describeLegacyQueueProblem,
  legacyProposer,
  parseLegacyQueueTable,
  readLegacyQueueJson,
  suggestQueueStatus,
} from "./queue-table.ts";

// 「08 版本与迁移」第五节：旧队列的状态怎么给建议、谁提的怎么换。
// 表格的样子取自八个项目的 队列.md，队列.json 的样子取自 skill 自己和个人网站。

describe("旧状态的建议", () => {
  it.each([
    ["做完", "done", "evidence", "做完"],
    ["做完（第 1 轮）", "done", "evidence", "做完（第 1 轮）"],
    ["已落地 845b720ab", "done", "evidence", "已落地 845b720ab"],
    ["已定，决定 35", "done", "evidence", "已定，决定 35"],
    ["已进第 14 轮", "verify", "statusNote", "已进第 14 轮"],
    ["已进第 16 轮（名字按第 16 轮改成「使用」）", "verify", "statusNote", undefined],
    ["已进第 1 轮，未做完", "todo", "statusNote", "已进第 1 轮，未做完"],
    ["等", "todo", "statusNote", "等"],
    ["等逐屏检查", "todo", "statusNote", "等逐屏检查"],
    ["等落地", "todo", "statusNote", "等落地"],
    ["等检查（第 2 轮）", "todo", "statusNote", "等检查（第 2 轮）"],
    ["等你定补进场景还是进不做什么", "waiting", "dependsOn", "用户：补进场景还是进不做什么"],
    ["等你定", "waiting", "dependsOn", "用户"],
  ])("「%s」建议%s，旧的写法进 %s", (old, status, field, text) => {
    const suggestion = suggestQueueStatus(old);
    expect(suggestion).toMatchObject({ status, field, known: true });
    expect(suggestion.text).toBe(text ?? old);
  });

  it("空着的建议待办，没有旧的写法要放", () => {
    expect(suggestQueueStatus("")).toEqual({ status: "todo", known: true });
    expect(suggestQueueStatus("  ")).toEqual({ status: "todo", known: true });
  });

  it("表里没有的写法按待核对，并标出认不出", () => {
    expect(suggestQueueStatus("先放着")).toEqual({
      status: "verify",
      field: "statusNote",
      text: "先放着",
      known: false,
    });
  });
});

describe("谁提的", () => {
  it.each([
    ["我", "ai"],
    ["AI", "ai"],
    ["你", "user"],
    ["用户", "user"],
    ["评审", "review"],
  ])("只写「%s」的直接换，不写来源", (old, proposer) => {
    expect(legacyProposer(old)).toEqual({ proposer, known: true });
  });

  it.each([
    ["第 9 轮报告的疑问，用户没答", "ai"],
    ["第 12 轮你选的提升 1a，写进了场景清单", "ai"],
    ["构思 1 轮 2a", "ai"],
    ["用户，构思第 3 轮", "user"],
    ["用户（检查 1 轮发现 9 的备注）", "user"],
    ["评审子代理", "review"],
    ["我，第 9 轮时说过做出来再看", "ai"],
  ])("句子「%s」换成提出者，原句进来源", (old, proposer) => {
    expect(legacyProposer(old)).toEqual({ proposer, source: old, known: true });
  });

  it("人名和项目名认不出，暂写 AI，要确认", () => {
    expect(legacyProposer("李昶乐")).toEqual({ proposer: "ai", source: "李昶乐", known: false });
    expect(legacyProposer("atlas design 会话")).toMatchObject({ proposer: "ai", known: false });
    expect(legacyProposer("")).toEqual({ proposer: "ai", known: false });
  });
});

const table = `# 队列

还没做的事先停在这里。

| 内容 | 属于哪个阶段 | 谁提的 | 日期 | 状态 |
| --- | --- | --- | --- | --- |
| 成绩复核保存不了 | 落地 | 我 | 2026-09-20 | 已进第 1 轮 |
| 学员端空态的说法不对 | 检查 | 我 | 2026-09-20 | 等逐屏检查 |
| 两个入口还没有场景走到 | 使用 | 我 | 2026-09-20 | 等你定补进场景还是进不做什么 |
| 首页头图换成工作区 | 修复 | 用户 | 2026-09-21 | 做完（第 2 轮） |
`;

describe("旧的队列表格", () => {
  it("每一行按先后编号，给出建议的状态和提出者", () => {
    const { rows, problems } = parseLegacyQueueTable(table);
    expect(problems).toEqual([]);
    expect(rows.map((row) => [row.id, row.at, row.stage, row.proposer, row.status])).toEqual([
      ["Q1", 7, "land", "ai", "verify"],
      ["Q2", 8, "check", "ai", "todo"],
      ["Q3", 9, "use", "ai", "waiting"],
      ["Q4", 10, "land", "user", "done"],
    ]);
    expect(rows[0]).toMatchObject({
      content: "成绩复核保存不了",
      createdAt: "2026-09-20",
      statusNote: "已进第 1 轮",
      subItems: [],
      old: { stage: "落地", proposer: "我", date: "2026-09-20", status: "已进第 1 轮" },
      checks: [{ kind: "verify" }],
    });
    expect(rows[2]).toMatchObject({ dependsOn: "用户：补进场景还是进不做什么", checks: [] });
    expect(rows[3]).toMatchObject({ evidence: "做完（第 2 轮）", checks: [] });
    // 阶段写「修复」的换成落地，旧的写法留着
    expect(rows[3]?.old.stage).toBe("修复");
  });

  it("被空行截断的后半段没有表头，按列数接着编号", () => {
    const cut = `${table}\n| 管理端没有重置密码的入口 | 检查 | 我 | 2026-09-21 | 等 |\n`;
    const { rows, problems } = parseLegacyQueueTable(cut);
    expect(problems).toEqual([]);
    expect(rows.map((row) => row.id)).toEqual(["Q1", "Q2", "Q3", "Q4", "Q5"]);
    expect(rows[4]).toMatchObject({ at: 12, content: "管理端没有重置密码的入口", status: "todo" });
  });

  it("列数对不上的行不读，报出行号和格数", () => {
    const odd = `${table}| 只有三格 | 检查 | 等 |\n`;
    const { rows, problems } = parseLegacyQueueTable(odd);
    expect(rows).toHaveLength(4);
    expect(problems).toEqual([{ kind: "columnCount", line: 11, count: 3 }]);
  });

  it("格里写成 \\| 的是竖线本身", () => {
    const pipe = table.replace("成绩复核保存不了", "a \\| b 两种写法");
    expect(parseLegacyQueueTable(pipe).rows[0]?.content).toBe("a | b 两种写法");
  });

  it("认不出的写法都记下要确认的地方", () => {
    const rows = parseLegacyQueueTable(`| 内容 | 阶段 | 谁提的 | 日期 | 状态 |
| --- | --- | --- | --- | --- |
|  | 复盘 | 李昶乐 | 九月 | 先放着 |
| 已经做完的事 | 构思 |  | 2026-09-20 | 已完成 |
`).rows;
    expect(rows[0]?.checks).toEqual([
      { kind: "contentEmpty" },
      { kind: "statusUnknown", text: "先放着" },
      { kind: "proposerUnknown", text: "李昶乐" },
      { kind: "stageUnknown", text: "复盘" },
      { kind: "dateMissing" },
    ]);
    expect(rows[1]).toMatchObject({ status: "done", evidence: "已完成" });
    expect(rows[1]?.checks).toEqual([{ kind: "proposerUnknown", text: "" }]);
  });

  it("没有一张表头带内容和状态两列的表格时，报出来", () => {
    const other = "| 请求 | 原因 | 日期 |\n| --- | --- | --- |\n| 深色模式 | 不急 | 2026-09-20 |\n";
    expect(parseLegacyQueueTable(other)).toEqual({ rows: [], problems: [{ kind: "noTable" }] });
    expect(parseLegacyQueueTable("# 队列\n\n还没有事。\n")).toEqual({ rows: [], problems: [] });
  });
});

// 旧 队列.json 用中文键，Biome 不收中文的对象键，所以按键值对拼出来。

/** 状态一格：值和说明。 */
const status = (value: string, note: string) =>
  Object.fromEntries([
    ["值", value],
    ["说明", note],
  ]);

/** 旧 队列.json 的一件，十格都写上。changes 按键替换。 */
function jsonItem(changes: readonly (readonly [string, unknown])[] = []): Record<string, unknown> {
  return Object.fromEntries([
    ["内容", "事前验尸两个原因各配什么对策"],
    ["阶段", "构思"],
    ["提出", "用户，构思第 3 轮"],
    ["创建时间", "2026-09-19"],
    ["状态", status("已完成", "已定，决定 36")],
    ["依赖", ""],
    ["验收标准", ""],
    ["完成证据", "已定，决定 36"],
    ["子项", []],
    ["来源", ""],
    ...changes,
  ]);
}

/** 整份 队列.json。 */
const queueDoc = (items: readonly unknown[]) =>
  Object.fromEntries([
    ["版本", 1],
    ["事项", items],
  ]);

describe("队列.json", () => {
  it("十格照收，只补编号", () => {
    const { rows, problems } = readLegacyQueueJson(
      queueDoc([
        jsonItem(),
        jsonItem([
          ["内容", "深色模式"],
          ["阶段", "修复"],
          ["提出", "我"],
          ["状态", status("等待", "等第二期定配色")],
          ["依赖", "等第二期定配色"],
          ["完成证据", ""],
          ["子项", ["配色", "  "]],
          ["验收标准", "系统切到深色时跟着变"],
        ]),
        jsonItem([
          ["状态", status("已取消", "用户说不做")],
          ["完成证据", ""],
        ]),
      ]),
    );
    expect(problems).toEqual([]);
    expect(rows[0]).toMatchObject({
      from: "json",
      at: 1,
      id: "Q1",
      stage: "think",
      proposer: "user",
      source: "用户，构思第 3 轮",
      createdAt: "2026-09-19",
      status: "done",
      evidence: "已定，决定 36",
      checks: [],
    });
    expect(rows[0]?.statusNote).toBeUndefined();
    expect(rows[1]).toMatchObject({
      id: "Q2",
      stage: "land",
      proposer: "ai",
      status: "waiting",
      dependsOn: "等第二期定配色",
      acceptance: "系统切到深色时跟着变",
      subItems: ["配色"],
      checks: [],
    });
    expect(rows[2]).toMatchObject({ status: "dropped", statusNote: "用户说不做", checks: [] });
  });

  it("进行中的事按待核对，说明留在状态说明里", () => {
    const { rows } = readLegacyQueueJson(
      queueDoc([
        jsonItem([
          ["状态", status("进行中", "已进构思第 27 轮")],
          ["完成证据", ""],
        ]),
      ]),
    );
    expect(rows[0]).toMatchObject({
      status: "verify",
      statusNote: "已进构思第 27 轮",
      checks: [{ kind: "verify" }],
    });
  });

  it("状态要求的一格空着时要确认", () => {
    const { rows } = readLegacyQueueJson(
      queueDoc([
        jsonItem([
          ["状态", status("已完成", "")],
          ["完成证据", ""],
        ]),
        jsonItem([["状态", status("已取消", "")]]),
        jsonItem([["状态", status("搁置", "")]]),
      ]),
    );
    expect(rows.map((row) => row.checks)).toEqual([
      [{ kind: "fieldMissing", status: "done", field: "evidence" }],
      [{ kind: "fieldMissing", status: "dropped", field: "statusNote" }],
      [{ kind: "statusUnknown", text: "搁置" }],
    ]);
  });

  it("不是对象的一件不读，编号照样占一个", () => {
    const { rows, problems } = readLegacyQueueJson(queueDoc(["坏的", jsonItem()]));
    expect(rows.map((row) => row.id)).toEqual(["Q2"]);
    expect(problems).toEqual([{ kind: "itemShape", at: 1 }]);
  });

  it.each([
    ["null", null],
    ["数组", []],
    ["没有事项", Object.fromEntries([["版本", 1]])],
    ["事项不是数组", Object.fromEntries([["事项", {}]])],
  ])("最外层不对时读不出事项：%s", (_name, doc) => {
    expect(readLegacyQueueJson(doc)).toEqual({ rows: [], problems: [{ kind: "notQueue" }] });
  });
});

describe("写成一句话", () => {
  it("每种要确认的地方都有说法", () => {
    expect(
      [
        { kind: "verify" },
        { kind: "statusUnknown", text: "先放着" },
        { kind: "proposerUnknown", text: "李昶乐" },
        { kind: "proposerUnknown", text: "" },
        { kind: "stageUnknown", text: "复盘" },
        { kind: "dateMissing" },
        { kind: "contentEmpty" },
        { kind: "fieldMissing", status: "waiting", field: "dependsOn" },
      ].map((check) =>
        describeLegacyQueueCheck(check as Parameters<typeof describeLegacyQueueCheck>[0]),
      ),
    ).toEqual([
      "写着「已进第几轮」，查提交记录以后定为已完成或待办。",
      "状态写着「先放着」，迁移的对照里没有这种写法，暂按待核对。",
      "谁提的写着「李昶乐」，看不出是用户还是 AI，暂写 AI。",
      "没写谁提的，暂写 AI。",
      "阶段写着「复盘」，不是五个阶段之一。",
      "没有日期，或者日期不是 2026-09-20 这样的写法。",
      "没写内容。",
      "建议的状态是等待，但没写依赖。",
    ]);
  });

  it("整份文件的问题都有说法", () => {
    expect([
      describeLegacyQueueProblem({ kind: "noTable" }),
      describeLegacyQueueProblem({ kind: "columnCount", line: 12, count: 4 }),
      describeLegacyQueueProblem({ kind: "notQueue" }),
      describeLegacyQueueProblem({ kind: "itemShape", at: 3 }),
    ]).toEqual([
      "队列.md 里没有表头带内容和状态两列的表格。",
      "第 12 行有 4 格，和队列表格的表头对不上，没有读。",
      "队列.json 的格式不对，读不出事项。",
      "队列.json 的第 3 件不是对象，没有读。",
    ]);
  });
});
