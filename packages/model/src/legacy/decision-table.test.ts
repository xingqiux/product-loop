import { describe, expect, it } from "vitest";
import {
  decisionRowNeedsCheck,
  describeLegacyDecisionProblem,
  describeLegacyDecisionSkip,
  type LegacyDecisionRow,
  parseLegacyDecisions,
} from "./decision-table.ts";

// 「08 版本与迁移」第五节：决定的迁移按列数和表头识别，共六种形状。
// 每种的样子取自第六节的项目：Sketch Board 和个人网站五列带编号，鹿鸣四列被空行截断，
// 阿贝记账四列带编号没有日期，skill 自己的以后再说表后面接着五列的行。

/** 每一行的编号、种类、状态和要改的地方，按行号排。 */
const brief = (rows: readonly LegacyDecisionRow[]) =>
  rows.map((row) => [row.line, row.id, row.kind, row.status, row.problems.map((p) => p.kind)]);

describe("六种形状", () => {
  it("一、五列带编号的，编号原样保留", () => {
    const file = parseLegacyDecisions(`# 决定

| # | 决定 | 原因 | 案例 | 日期 |
| --- | --- | --- | --- | --- |
| 1 | 返回回到打开它的那一页 | 按固定父级写会错 | 从我的设计点新建 | 2026-09-18 |
| 7 | 模板页的标签用淡色底 | 颜色要有含义 | 模板页第三行 | 2026-09-19 |
`);
    expect(file.tables).toEqual([
      {
        line: 3,
        heading: "决定",
        header: ["#", "决定", "原因", "案例", "日期"],
        shape: "numbered",
      },
    ]);
    expect(file.rows[1]).toEqual({
      line: 6,
      id: 7,
      idGiven: true,
      kind: "decision",
      decision: "模板页的标签用淡色底",
      reason: "颜色要有含义",
      case: "模板页第三行",
      date: "2026-09-19",
      status: "active",
      table: 3,
      attached: false,
      problems: [],
    });
    expect(file.skipped).toEqual([]);
  });

  it("二、四列不带编号的，按出现的顺序编号", () => {
    const file = parseLegacyDecisions(`| 决定 | 原因 | 当时的案例 | 日期 |
| --- | --- | --- | --- |
| 隧道指向网卡地址 | 127.0.0.1 被别的项目占了 | 返回了别的项目的 404 | 2026-09-20 |
| 主角是讲师 | 一线销售那一侧没有真实行为 | 管理端没有主角 | 2026-09-20 |
`);
    expect(file.tables[0]?.shape).toBe("unnumbered");
    expect(file.rows.map((row) => [row.id, row.idGiven, row.case])).toEqual([
      [1, false, "返回了别的项目的 404"],
      [2, false, "管理端没有主角"],
    ]);
    expect(file.rows.every((row) => row.problems.length === 0)).toBe(true);
  });

  it("三、四列带编号、没有日期的，日期留空并标迁移时缺日期，字里写着日期的给出建议", () => {
    const file = parseLegacyDecisions(`| # | 决定 | 原因 | 案例 |
| --- | --- | --- | --- |
| 1 | 这一版只写主人自己 | 主流程还会断 | 构思第 1 轮，2026-09-20 |
| 2 | 承诺写结果 | 最贵的排查在对余额时 | 构思第 1 轮 |
`);
    expect(file.tables[0]?.shape).toBe("numberedNoDate");
    expect(file.rows.map((row) => [row.id, row.date, row.problems])).toEqual([
      [1, undefined, [{ kind: "dateMissing", suggested: "2026-09-20" }]],
      [2, undefined, [{ kind: "dateMissing" }]],
    ]);
    expect(file.rows.every(decisionRowNeedsCheck)).toBe(true);
  });

  it("四、三列的以后再说表，每行导入成以后再说，缺案例不用确认", () => {
    const file = parseLegacyDecisions(`## 以后再说

不在主流程上的请求，主流程全通那天逐条重看：

| 请求 | 原因 | 日期 |
| --- | --- | --- |
| 每天自动用一遍 | 还没有发生过 | 2026-09-20 |
`);
    expect(file.tables[0]).toMatchObject({ heading: "以后再说", shape: "later" });
    expect(file.rows[0]).toMatchObject({
      id: 1,
      kind: "later",
      decision: "每天自动用一遍",
      reason: "还没有发生过",
      date: "2026-09-20",
      problems: [{ kind: "laterWithoutCase" }],
    });
    expect(decisionRowNeedsCheck(file.rows[0] as LegacyDecisionRow)).toBe(false);
  });

  it("五、被空行截断的后半段，按列数归到前面的表", () => {
    const file = parseLegacyDecisions(`| 决定 | 原因 | 当时的案例 | 日期 |
| --- | --- | --- | --- |
| 草稿存在浏览器里 | 离开就要重填 | 切回来时全空 | 2026-09-21 |

| 做完再出报告 | 一件事问两次 | 第 5 轮提交了三次 | 2026-09-22 |
| 理由只有一份 | 要写两遍 | 选项 b 被否决 | 2026-09-22 |
`);
    expect(file.tables).toHaveLength(1);
    expect(brief(file.rows)).toEqual([
      [3, 1, "decision", "active", []],
      [5, 2, "decision", "active", []],
      [6, 3, "decision", "active", []],
    ]);
    expect(file.rows.map((row) => row.attached)).toEqual([false, true, true]);
  });

  it("五、接在以后再说表后面的五列行，归到前面的五列表，编号原样保留", () => {
    const file = parseLegacyDecisions(`| # | 决定 | 原因 | 当时的案例 | 日期 |
| --- | --- | --- | --- | --- |
| 88 | 队列的一张卡第一句写是什么 | 六件事挤成一段 | 修复第 10 轮 | 2026-09-21 |

## 以后再说

| 请求 | 原因 | 日期 |
| --- | --- | --- |
| 真组件放不下时放大 | 胃口到期砍掉 | 2026-09-20 |
| 89 | 文档放进项目根的隐藏文件夹 | 混在 docs 里是污染 | 看着仓库提的 | 2026-09-21 |
| 90 | 队列只由脚本来写 | 分号是手抄带进去的 | 构思第 17 轮 | 2026-09-21 |
`);
    expect(file.tables.map((table) => table.shape)).toEqual(["numbered", "later"]);
    expect(brief(file.rows)).toEqual([
      [3, 88, "decision", "active", []],
      [9, 91, "later", "active", ["laterWithoutCase"]],
      [10, 89, "decision", "active", []],
      [11, 90, "decision", "active", []],
    ]);
    expect(file.rows.map((row) => [row.table, row.attached])).toEqual([
      [1, false],
      [7, false],
      [1, true],
      [1, true],
    ]);
  });

  it("六、写着已作废的，状态记为已作废，并认出被哪一条推翻", () => {
    const file = parseLegacyDecisions(`| # | 决定 | 原因 | 案例 | 日期 |
| --- | --- | --- | --- | --- |
| 3 | 已作废（被 11 取代）。原决定：颜色只表示选中 | 整页只剩灰 | 模板页 | 2026-09-18 |
| 17 | 已作废（见 25）。左边只留一句 | 用户在 5b 上加的 | 构思第 2 轮 5b | 2026-09-19 |
| 70 | 已作废（第 80 条）。按钮叫用作起点 | 说不出按下去会怎样 | 第 12 轮 | 2026-09-19 |
| 23 | 插图放在首屏右上角（已作废，见决定 41、42） | 右上角空着 | 构思第 7 轮 | 2026-09-21 |
| 30 | 联系方式竖着排（已作废：首屏够宽，见决定 41） | 左栏太窄 | 落地第 3 轮 | 2026-09-22 |
| 132 | （已作废：取消随回复交给后端，见决定 141）列出队列脚本命令 | 规矩要闭合 | 落地第 17 轮 | 2026-09-22 |
| 14 | 已作废。配色用白底加简历那个蓝 | 用户不喜欢 | 构思第 5 轮 | 2026-09-21 |
| 17 | 项目卡放图（abei 那一半已作废，见决定 34） | 截图是证据 | 落地第 2 轮 | 2026-09-21 |
`);
    expect(file.rows.map((row) => [row.id, row.status, row.voidedBy, row.problems])).toEqual([
      [3, "voided", 11, []],
      [17, "voided", 25, []],
      [70, "voided", 80, []],
      [23, "voided", 41, [{ kind: "voidedByMany", ids: [41, 42] }]],
      [30, "voided", 41, []],
      [132, "voided", 141, []],
      [14, "voided", undefined, [{ kind: "voidedByMissing" }]],
      [
        133,
        "active",
        undefined,
        [{ kind: "idDuplicate", lines: [4, 10] }, { kind: "voidUnclear" }],
      ],
    ]);
  });
});

describe("别的情况", () => {
  it("认不出的表不读，列数对不上的行也不读", () => {
    const file = parseLegacyDecisions(`| # | 决定 | 原因 | 案例 | 日期 |
| --- | --- | --- | --- | --- |
| 1 | 返回回到打开它的那一页 | 按固定父级写会错 | 从我的设计点新建 | 2026-09-18 |

## 等用户选

| 事项 | 选项 | 日期 |
| --- | --- | --- |
| 第 9 轮疑问 1 到 5 | 见 report-9 | 2026-09-19 |

| 只有两格 | 2026-09-19 |
`);
    expect(file.tables.map((table) => [table.line, table.shape])).toEqual([
      [1, "numbered"],
      [7, "unknown"],
    ]);
    expect(file.rows.map((row) => row.id)).toEqual([1]);
    expect(file.skipped).toEqual([
      { line: 9, reason: "unknownTable", count: 3 },
      { line: 11, reason: "columnCount", count: 2 },
    ]);
  });

  it("编号不是数字的另编，空着的格报出来", () => {
    const file = parseLegacyDecisions(`| # | 决定 | 原因 | 案例 | 日期 |
| --- | --- | --- | --- | --- |
| 5 | 有编号的一条 | 原因 | 案例 | 2026-09-18 |
| 3a | 编号写错的一条 |  |  | 9 月 18 日 |
|  | 没写编号的一条 | 原因 | 案例 | 2026-09-18 |
`);
    expect(file.rows.map((row) => [row.id, row.idGiven, row.problems])).toEqual([
      [5, true, []],
      [
        6,
        false,
        [
          { kind: "idInvalid", text: "3a" },
          { kind: "textMissing", field: "reason" },
          { kind: "caseMissing" },
          { kind: "dateInvalid", text: "9 月 18 日" },
        ],
      ],
      [7, false, []],
    ]);
  });

  it("只有说明、没有表格时什么都不读", () => {
    expect(parseLegacyDecisions("# 决定\n\n只收用户看得见的行为决定。\n")).toEqual({
      tables: [],
      rows: [],
      skipped: [],
    });
  });

  it("代码块里的表格不算", () => {
    const file = parseLegacyDecisions(
      "```\n| 决定 | 原因 | 案例 | 日期 |\n| --- | --- | --- | --- |\n| a | b | c | 2026-09-18 |\n```\n",
    );
    expect(file.rows).toEqual([]);
  });
});

describe("写成一句话", () => {
  it("每种要改的地方都有说法", () => {
    expect([
      describeLegacyDecisionProblem({ kind: "dateMissing" }),
      describeLegacyDecisionProblem({ kind: "dateMissing", suggested: "2026-09-20" }),
      describeLegacyDecisionProblem({ kind: "dateInvalid", text: "9 月 20 日" }),
      describeLegacyDecisionProblem({ kind: "laterWithoutCase" }),
      describeLegacyDecisionProblem({ kind: "caseMissing" }),
      describeLegacyDecisionProblem({ kind: "voidedByMissing" }),
      describeLegacyDecisionProblem({ kind: "voidedByMany", ids: [41, 42] }),
      describeLegacyDecisionProblem({ kind: "voidUnclear" }),
      describeLegacyDecisionProblem({ kind: "idInvalid", text: "3a" }),
      describeLegacyDecisionProblem({ kind: "idDuplicate", lines: [9, 12] }),
      describeLegacyDecisionProblem({ kind: "textMissing", field: "decision" }),
      describeLegacyDecisionSkip({ line: 9, reason: "unknownTable", count: 3 }),
      describeLegacyDecisionSkip({ line: 11, reason: "columnCount", count: 2 }),
    ]).toEqual([
      "没有日期，迁移时缺日期。",
      "没有日期。这一行写着 2026-09-20，确认以后用它。",
      "日期写成「9 月 20 日」，要写成 2026-09-20 这样。",
      "以后再说的一行没有案例。旧表格本来没有这一列，不补。",
      "案例一格是空的。",
      "写着已作废，没写被哪一条推翻。",
      "写着被第 41、42 条推翻，决定只能记一条。",
      "文字里提到已作废，看不出是不是整条作废，暂按有效。",
      "编号写成「3a」，不是数字，已按出现的顺序另编。",
      "编号和第 9、12 行重复，已另编。",
      "决定一格是空的。",
      "这张表不是决定表，这一行没有读。",
      "这一行有 2 格，和哪张决定表都对不上，没有读。",
    ]);
  });
});
