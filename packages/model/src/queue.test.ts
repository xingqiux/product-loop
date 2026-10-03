import { describe, expect, it } from "vitest";
import { z } from "zod";
import { renderCopy } from "./copy/define.ts";
import { parseCopy } from "./copy/errors.ts";
import { queueCopy } from "./copy/records.ts";
import { type QueueStatus, queueStatus, stage } from "./names.ts";
import {
  canTransition,
  queueEventReadSchema,
  queueEventSchema,
  queueIdSchema,
  queueItemCreateSchema,
  queueItemSchema,
  queueItemUpdateSchema,
  queueTransitions,
  replyLineRefSchema,
  roundLabelSchema,
} from "./queue.ts";
import { parseRoundLabel } from "./round-label.ts";

/** 解析失败时的全部问题，每条是字段的路径和报错。通过时是空的。 */
function issuesOf(schema: z.ZodType, input: unknown): [string, string][] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const item = {
  id: "Q12",
  content: "设置页的保存按钮在窄屏被挡住",
  stage: "落地",
  proposer: "AI",
  proposedIn: "v2-检查-1",
  createdAt: "2026-09-28T10:30:00+08:00",
  status: "待办",
  subItems: [],
  editCount: 0,
};

describe("队列事项的编号", () => {
  it("写成 Q 加数字", () => {
    for (const id of ["Q1", "Q12", "Q300"]) expect(issuesOf(queueIdSchema, id)).toEqual([]);
  });

  it.each([
    ["q12", "shape"],
    ["Q012", "shape"],
    ["12", "shape"],
    ["Q0", "zero"],
  ] as const)("拒绝 %s，报错和 parseQueueId 的文案相同", (text, error) => {
    const message = renderCopy(parseCopy.queueId[error].message, { text });
    expect(issuesOf(queueIdSchema, text)).toEqual([["", message]]);
  });

  it("没写和写成数字时，报错写明是哪个字段", () => {
    expect(issuesOf(queueIdSchema, undefined)).toEqual([["", "没有写队列事项的编号。"]]);
    expect(issuesOf(queueIdSchema, 12)).toEqual([["", "队列事项的编号要写成文字。"]]);
  });
});

describe("阶段的标识", () => {
  it("收的写法和 parseRoundLabel 相同", () => {
    const samples = [
      "v1-构思-1",
      "v2-使用-3",
      "v2-检查-1",
      "v12-落地-30",
      "v3-提升-2",
      "v2-修复-3",
      "v0-构思-1",
      "v2-构思-0",
      "v02-构思-1",
      "v2-land-3",
      "v2-落地",
      "2-落地-3",
      "v2－落地－3",
      " v2-落地-3",
      "v2-落地-3-4",
      "fix-13",
    ];
    for (const text of samples) {
      expect(roundLabelSchema.safeParse(text).success).toBe(parseRoundLabel(text).ok);
    }
  });

  it("版本 1 到 12、五个阶段、次数 1 到 30 都收", () => {
    for (let version = 1; version <= 12; version++) {
      for (const label of stage.labels) {
        for (let seq = 1; seq <= 30; seq++) {
          expect(roundLabelSchema.safeParse(`v${version}-${label}-${seq}`).success).toBe(true);
        }
      }
    }
  });

  it("写错时按错在哪里报，文案和第 1 步的解析相同", () => {
    expect(issuesOf(roundLabelSchema, "v2-修复-3")).toEqual([
      ["", "阶段「v2-修复-3」用了改过名的阶段名「修复」。"],
    ]);
    expect(issuesOf(roundLabelSchema, "v2-land-3")).toEqual([
      ["", renderCopy(parseCopy.roundLabel.stage.message, { text: "v2-land-3" })],
    ]);
    expect(issuesOf(roundLabelSchema, "v0-构思-1")).toEqual([
      ["", renderCopy(parseCopy.roundLabel.zero.message, { text: "v0-构思-1" })],
    ]);
    expect(issuesOf(roundLabelSchema, "v2-落地")).toEqual([
      ["", renderCopy(parseCopy.roundLabel.shape.message, { text: "v2-落地" })],
    ]);
  });
});

describe("回复里的一行", () => {
  it("写哪一份回复的第几行，都从 1 数", () => {
    expect(issuesOf(replyLineRefSchema, { submission: 7, line: 3 })).toEqual([]);
    expect(replyLineRefSchema.safeParse({ submission: 7, line: 0 }).success).toBe(false);
    expect(replyLineRefSchema.safeParse({ submission: 0, line: 1 }).success).toBe(false);
    expect(replyLineRefSchema.safeParse({ submission: 7, line: 1.5 }).success).toBe(false);
    expect(replyLineRefSchema.safeParse({ submission: 7, line: 3, card: "a" }).success).toBe(false);
  });
});

describe("队列事项", () => {
  it("十格加编号和修改计数，全写上能通过", () => {
    const full = {
      ...item,
      status: "已完成",
      statusNote: "v2-落地-3 的改后截图",
      dependsOn: "等构思定下场景 S4",
      acceptance: "窄屏下保存按钮完整可见",
      evidence: "v2-落地-3 的改后截图",
      subItems: ["设置页", "项目页"],
      source: "接 Q7",
      note: "第一行\n第二行",
      fromLine: { submission: 7, line: 3 },
      editCount: 2,
    };
    expect(issuesOf(queueItemSchema, full)).toEqual([]);
    expect(issuesOf(queueItemSchema, item)).toEqual([]);
  });

  it("枚举写中文标签，解析以后是英文键，写英文键不收", () => {
    const parsed = queueItemSchema.parse(item);
    expect(parsed).toMatchObject({ stage: "land", proposer: "ai", status: "todo" });
    expect(queueItemSchema.safeParse({ ...item, stage: "land" }).success).toBe(false);
    expect(queueItemSchema.safeParse({ ...item, status: "todo" }).success).toBe(false);
    expect(queueItemSchema.safeParse({ ...item, proposer: "user" }).success).toBe(false);
  });

  it("不认识的字段拦截，旧格式的写法也不收", () => {
    expect(queueItemSchema.safeParse({ ...item, queueRow: "设置页" }).success).toBe(false);
    expect(queueItemSchema.safeParse({ ...item, status: { value: "待办" } }).success).toBe(false);
  });

  it("没有的格不写，写成空字符串或空白就拦截", () => {
    expect(issuesOf(queueItemSchema, { ...item, content: " " })).toEqual([
      ["content", "没有写内容。"],
    ]);
    expect(issuesOf(queueItemSchema, { ...item, acceptance: "" })).toEqual([
      ["acceptance", "没有写验收标准。"],
    ]);
    expect(issuesOf(queueItemSchema, { ...item, subItems: ["设置页", ""] })).toEqual([
      ["subItems.1", "没有写子项。"],
    ]);
    expect(issuesOf(queueItemSchema, { ...item, note: " \n " })).toEqual([
      ["note", "没有写备注。"],
    ]);
  });

  it("备注是多行文字，不限长度，读出来不查字数", () => {
    const long = `${"备注里写内容放不下的细节。".repeat(100)}\n第二行`;
    expect(issuesOf(queueItemSchema, { ...item, note: long })).toEqual([]);
    expect(queueItemSchema.parse({ ...item, note: long }).note).toBe(long);
    expect(queueItemSchema.parse(item)).not.toHaveProperty("note");
  });

  it("时间要带时区", () => {
    expect(queueItemSchema.safeParse({ ...item, createdAt: "2026-09-28T02:30:00Z" }).success).toBe(
      true,
    );
    for (const createdAt of ["2026-09-28T10:30:00", "2026-09-28"]) {
      expect(queueItemSchema.safeParse({ ...item, createdAt }).success).toBe(false);
    }
  });

  it.each([
    ["等待", "dependsOn", "等待的事要写明依赖。", "等构思定下场景 S4"],
    ["已完成", "evidence", "已完成的事要写完成证据。", "v2-落地-3 的改后截图"],
    ["已取消", "statusNote", "已取消的事要在状态说明里写取消的原因。", "已在 v2-落地-3 修掉"],
  ])("状态是%s时要写 %s", (status, field, message, value) => {
    expect(issuesOf(queueItemSchema, { ...item, status })).toEqual([[field, message]]);
    expect(issuesOf(queueItemSchema, { ...item, status, [field]: value })).toEqual([]);
  });

  it("修改计数从 0 数", () => {
    expect(queueItemSchema.safeParse({ ...item, editCount: -1 }).success).toBe(false);
    const { editCount: _count, ...rest } = item;
    expect(queueItemSchema.safeParse(rest).success).toBe(false);
  });
});

describe("放进一件事", () => {
  const created = { content: "队列看板", stage: "落地", proposer: "用户" };

  it("内容、阶段、提出者必填，其余可以不写", () => {
    expect(issuesOf(queueItemCreateSchema, created)).toEqual([]);
    const full = {
      ...created,
      dependsOn: "等用户定文件的形式",
      acceptance: "五列看板点一张出展示卡片",
      subItems: ["看板", "展示卡片"],
      source: "构思第 17 轮的想法",
      note: "先做等待列，\n再做阶段列",
    };
    expect(issuesOf(queueItemCreateSchema, full)).toEqual([]);
    expect(issuesOf(queueItemCreateSchema, { ...created, note: "  " })).toEqual([
      ["note", "没有写备注。"],
    ]);
    expect(issuesOf(queueItemCreateSchema, { ...created, content: undefined })).toEqual([
      ["content", "没有写内容。"],
    ]);
    for (const field of ["stage", "proposer"]) {
      expect(queueItemCreateSchema.safeParse({ ...created, [field]: undefined }).success).toBe(
        false,
      );
    }
  });

  it("编号、状态、创建时间由后端定，写了就拦截", () => {
    for (const extra of [{ id: "Q3" }, { status: "进行中" }, { createdAt: item.createdAt }]) {
      expect(queueItemCreateSchema.safeParse({ ...created, ...extra }).success).toBe(false);
    }
  });

  it("阶段不是五个之一时拦截", () => {
    expect(queueItemCreateSchema.safeParse({ ...created, stage: "修复" }).success).toBe(false);
  });
});

describe("改一件事", () => {
  it("能改内容、阶段、验收标准、子项、来源、备注、状态说明、证据，状态和修改计数不能改", () => {
    expect(issuesOf(queueItemUpdateSchema, { content: "队列看板的等待列" })).toEqual([]);
    expect(issuesOf(queueItemUpdateSchema, { note: "先做等待列" })).toEqual([]);
    expect(issuesOf(queueItemUpdateSchema, { subItems: [] })).toEqual([]);
    expect(issuesOf(queueItemUpdateSchema, { stage: "检查" })).toEqual([]);
    expect(issuesOf(queueItemUpdateSchema, { statusNote: "等构思定下场景 S4" })).toEqual([]);
    expect(issuesOf(queueItemUpdateSchema, { evidence: "提交 3f2a9c1" })).toEqual([]);
    for (const extra of [
      { stage: "修复" },
      { status: "已完成" },
      { editCount: 3 },
      { evidence: " " },
      { statusNote: null },
    ]) {
      expect(queueItemUpdateSchema.safeParse(extra).success).toBe(false);
    }
  });

  it("验收标准、来源和备注写 null 表示删掉，内容不能删", () => {
    expect(issuesOf(queueItemUpdateSchema, { acceptance: null, source: null, note: null })).toEqual(
      [],
    );
    expect(issuesOf(queueItemUpdateSchema, { note: " " })).toEqual([["note", "没有写备注。"]]);
    expect(issuesOf(queueItemUpdateSchema, { content: null })).toEqual([
      ["content", "没有写内容。"],
    ]);
  });

  it("一项都不改时拦截", () => {
    const message = renderCopy(queueCopy.update.empty);
    expect(issuesOf(queueItemUpdateSchema, {})).toEqual([["", message]]);
    expect(issuesOf(queueItemUpdateSchema, { content: undefined })).toEqual([["", message]]);
  });
});

describe("队列的状态图", () => {
  // 「03 数据模型」第二节的表，照抄中文。已完成是终态，表里没有它的一行。
  const table: [string, string[]][] = [
    ["待办", ["进行中", "等待", "已取消"]],
    ["进行中", ["已完成", "等待", "待办", "已取消"]],
    ["等待", ["待办", "已取消"]],
    ["已取消", ["待办"]],
  ];
  const key = (label: string): QueueStatus => {
    const found = queueStatus.key(label);
    if (found === undefined) throw new Error(`不是队列的状态：${label}`);
    return found;
  };
  const allowed = new Map(table.map(([from, tos]) => [key(from), tos.map(key)]));

  it("数据和表相同", () => {
    expect(queueTransitions).toEqual({ ...Object.fromEntries(allowed), done: [] });
  });

  const pairs = queueStatus.keys.flatMap((from) =>
    queueStatus.keys.map((to): [QueueStatus, QueueStatus] => [from, to]),
  );
  const restore = { droppedAtRoundStart: true, namedInReply: true };

  /** 按表算出每一对该怎样：终态、不在表里、只限捞回、可以。 */
  function verdict(from: QueueStatus, to: QueueStatus): string {
    if (from === "done") return "终态";
    if (!(allowed.get(from)?.includes(to) ?? false)) return "不在表里";
    return from === "dropped" ? "只限捞回" : "可以";
  }
  const cases = pairs.map(([from, to]) => {
    const labels = [queueStatus.label(from), queueStatus.label(to), verdict(from, to)] as const;
    return [...labels, from, to] as const;
  });

  it("五个状态两两之间一共二十五对", () => {
    expect(cases).toHaveLength(25);
  });

  it.each(cases)("%s → %s：%s", (_fromLabel, _toLabel, expected, from, to) => {
    const bare = canTransition(from, to);
    const named = canTransition(from, to, restore);
    const passed = { ok: true, value: { from, to } };
    switch (expected) {
      case "终态":
        expect(bare).toEqual({ ok: false, error: "terminal" });
        expect(named).toEqual({ ok: false, error: "terminal" });
        break;
      case "不在表里":
        expect(bare).toEqual({ ok: false, error: "notInGraph" });
        expect(named).toEqual({ ok: false, error: "notInGraph" });
        break;
      case "只限捞回":
        expect(bare).toEqual({ ok: false, error: "notDroppedAtRoundStart" });
        expect(named).toEqual(passed);
        break;
      default:
        expect(bare).toEqual(passed);
        expect(named).toEqual(passed);
    }
  });

  it("表里的十条边都能走，其余十五对都不行", () => {
    const counts = new Map<string, number>();
    for (const [, , expected] of cases) counts.set(expected, (counts.get(expected) ?? 0) + 1);
    const expected = [
      ["可以", 9],
      ["只限捞回", 1],
      ["不在表里", 10],
      ["终态", 5],
    ] as const;
    expect(counts).toEqual(new Map(expected));
  });

  it("已取消回到待办，只限开始时取消、又被用户点名的", () => {
    const cases = [
      [{}, "notDroppedAtRoundStart"],
      [{ namedInReply: true }, "notDroppedAtRoundStart"],
      [{ droppedAtRoundStart: true }, "notNamedInReply"],
      [{ droppedAtRoundStart: false, namedInReply: true }, "notDroppedAtRoundStart"],
    ] as const;
    for (const [context, error] of cases) {
      expect(canTransition("dropped", "todo", context)).toEqual({ ok: false, error });
    }
    expect(canTransition("dropped", "todo", restore).ok).toBe(true);
  });

  it("每条边都写了由什么引起，没有多出来的", () => {
    const causes = Object.entries(queueCopy.cause).flatMap(([from, tos]) =>
      Object.keys(tos).map((to) => `${from}→${to}`),
    );
    const edges = Object.entries(queueTransitions).flatMap(([from, tos]) =>
      tos.map((to) => `${from}→${to}`),
    );
    expect(causes.sort()).toEqual(edges.sort());
  });

  it("每种不允许的情况都有报错和改法", () => {
    const errors = pairs.flatMap(([from, to]) => {
      const result = canTransition(from, to);
      return result.ok ? [] : [result.error];
    });
    const listed = [...new Set([...errors, "notNamedInReply"])].sort();
    expect(Object.keys(queueCopy.transition).sort()).toEqual(listed);
  });
});

describe("队列变动", () => {
  const event = { item: "Q12", at: "2026-09-28T10:30:00+08:00", to: "待办", actor: "cli/2.0.0" };

  it("放进队列的那一次没有 from，状态是待办", () => {
    expect(issuesOf(queueEventSchema, event)).toEqual([]);
    expect(issuesOf(queueEventSchema, { ...event, to: "进行中" })).toEqual([
      ["to", renderCopy(queueCopy.event.createdNotTodo)],
    ]);
  });

  it("其余每一次都是状态图里的一条边", () => {
    const taken = { ...event, from: "待办", to: "进行中", round: "v2-落地-3" };
    expect(issuesOf(queueEventSchema, taken)).toEqual([]);
    const restored = { ...event, from: "已取消", to: "待办", note: "用户在回复里点名捞回" };
    expect(issuesOf(queueEventSchema, restored)).toEqual([]);
    expect(issuesOf(queueEventSchema, { ...event, from: "已完成", to: "待办" })).toEqual([
      ["to", "从已完成改成待办，不在状态图里。"],
    ]);
  });

  it("读出来的变动不查状态图：迁移来的事项，第一条变动可以不是待办", () => {
    const migrated = { ...event, to: "已完成" };
    expect(issuesOf(queueEventSchema, migrated)).toHaveLength(1);
    expect(issuesOf(queueEventReadSchema, migrated)).toEqual([]);
    const { actor: _actor, ...rest } = event;
    expect(issuesOf(queueEventReadSchema, rest)).toEqual([["actor", "没有写执行者。"]]);
  });

  it("执行者必填", () => {
    const { actor: _actor, ...rest } = event;
    expect(issuesOf(queueEventSchema, rest)).toEqual([["actor", "没有写执行者。"]]);
  });
});

describe("JSON Schema", () => {
  it.each([
    ["queueId", queueIdSchema],
    ["roundLabel", roundLabelSchema],
    ["replyLineRef", replyLineRefSchema],
    ["queueItem", queueItemSchema],
    ["queueItemCreate", queueItemCreateSchema],
    ["queueItemUpdate", queueItemUpdateSchema],
    ["queueEvent", queueEventSchema],
  ] as const)("%s 能导出，结果和快照相同", (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: "input" })).toMatchSnapshot();
  });
});
