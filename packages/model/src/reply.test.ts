import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type Destination, destination } from "./names.ts";
import {
  replyDestinationSchema,
  replyHandleEntrySchema,
  replyHandleInputSchema,
  replyLineSchema,
} from "./reply.ts";

/** 解析失败时的全部问题，每条是字段的路径和报错。通过时是空的。 */
function issuesOf(schema: z.ZodType, input: unknown): [string, string][] {
  const result = schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

const hash = "3b7e0f0c8a1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b";
const unknownDestination = "去处要写这五种之一：主线、决定、队列、当场做、不处理。";

describe("去处", () => {
  it("两份定义都正好是五种去处，顺序和名称表相同", () => {
    const stored = replyDestinationSchema.options.map((option) => option.shape.to);
    const handled = replyHandleEntrySchema.options.map((option) => option.shape.to);
    // 接口上写中文，解码以后是英文键。
    expect(stored.map((to) => to.in.value)).toEqual(destination.labels);
    expect(stored.map((to) => to.out.value)).toEqual(destination.keys);
    expect(handled.map((to) => to.in.value)).toEqual(destination.labels);
    expect(handled.map((to) => to.out.value)).toEqual(destination.keys);
  });

  it("编码时去处换回中文", () => {
    const stored = { to: "noAction", reason: "用户说只是顺口一提" } as const;
    expect(z.encode(replyDestinationSchema, stored)).toEqual({ ...stored, to: "不处理" });
  });
});

describe("处理一行：五种去处的写法", () => {
  // 每种去处一份能通过的和一份不能通过的，不能通过的写明报在哪个字段、报什么。
  const cases: [Destination, object, object, [string, string][]][] = [
    [
      "mainline",
      { line: 1, to: "主线", part: "场景清单" },
      { line: 1, to: "主线" },
      [["part", "没有写主线改的是哪个部分。"]],
    ],
    [
      "decision",
      {
        line: 2,
        to: "决定",
        decision: "返回永远回到打开它的那一页",
        reason: "返回按固定父级写，新页面一出现就错",
        case: "从我的设计点新建，返回却写着返回工作台",
      },
      { line: 2, to: "决定", decision: "返回永远回到打开它的那一页", reason: "新页面会错" },
      [["case", "决定、原因、案例三项都要写，这里缺了案例。"]],
    ],
    [
      "queue",
      {
        line: 3,
        to: "队列",
        item: { content: "队列看板的等待列", stage: "落地", proposer: "用户" },
      },
      { line: 3, to: "队列" },
      [["", "去处是队列时要写 id 或 item：id 指已有的一件，item 放进一件新的。"]],
    ],
    [
      "doneHere",
      { line: 4, to: "当场做", evidence: "改了设置页的保存按钮，窄屏截图见 v2-落地-3" },
      { line: 4, to: "当场做" },
      [["evidence", "没有写完成证据。"]],
    ],
    [
      "noAction",
      { line: 5, to: "不处理", reason: "用户说只是顺口一提" },
      { line: 5, to: "不处理", reason: " " },
      [["reason", "没有写不处理的原因。"]],
    ],
  ];

  it.each(cases)("%s：一份能通过，一份报在该报的字段", (_to, passing, failing, expected) => {
    expect(issuesOf(replyHandleEntrySchema, passing)).toEqual([]);
    expect(issuesOf(replyHandleEntrySchema, failing)).toEqual(expected);
  });

  it("五种一起写在一份输入里能通过", () => {
    const input = cases.map(([, passing]) => passing);
    expect(issuesOf(replyHandleInputSchema, input)).toEqual([]);
  });

  it("主线可以写改后的版本号，版本号从 1 数", () => {
    const entry = { line: 1, to: "主线", part: "设计规范", revision: 8 };
    expect(issuesOf(replyHandleEntrySchema, entry)).toEqual([]);
    expect(replyHandleEntrySchema.safeParse({ ...entry, revision: 0 }).success).toBe(false);
  });

  it("队列可以指已有的一件，和新放进的一件只能写一样", () => {
    expect(issuesOf(replyHandleEntrySchema, { line: 3, to: "队列", id: "Q15" })).toEqual([]);
    const both = {
      line: 3,
      to: "队列",
      id: "Q15",
      item: { content: "队列看板的等待列", stage: "落地", proposer: "用户" },
    };
    expect(issuesOf(replyHandleEntrySchema, both)).toEqual([["item", "id 和 item 只能写一样。"]]);
    expect(issuesOf(replyHandleEntrySchema, { line: 3, to: "队列", id: "q15" })).toEqual([
      ["id", "队列事项的编号「q15」写法不对。"],
    ]);
  });

  it("指已有的一件时可以写阶段，改标要做它的阶段；放进新的一件时阶段写在 item 里", () => {
    expect(
      issuesOf(replyHandleEntrySchema, { line: 3, to: "队列", id: "Q15", stage: "落地" }),
    ).toEqual([]);
    const withItem = {
      line: 3,
      to: "队列",
      stage: "落地",
      item: { content: "队列看板的等待列", stage: "落地", proposer: "用户" },
    };
    expect(issuesOf(replyHandleEntrySchema, withItem)).toEqual([
      ["stage", "放进一件新的时，阶段写在 item 里，不另写 stage。"],
    ]);
    expect(
      replyHandleEntrySchema.safeParse({ line: 3, to: "队列", id: "Q15", stage: "修复" }).success,
    ).toBe(false);
  });

  it("新放进的一件按放进队列的定义查", () => {
    const entry = { line: 3, to: "队列", item: { content: "队列看板的等待列", proposer: "用户" } };
    const issues = issuesOf(replyHandleEntrySchema, entry);
    expect(issues.map(([path]) => path)).toEqual(["item.stage"]);
  });

  it("当场做的阶段由后端填，写了就拦截", () => {
    const entry = { line: 4, to: "当场做", evidence: "改好了", round: "v2-落地-3" };
    expect(replyHandleEntrySchema.safeParse(entry).success).toBe(false);
  });

  it("去处写中文标签，写英文键或别的词时报出五种去处", () => {
    for (const to of ["decision", "以后再说", undefined]) {
      expect(issuesOf(replyHandleEntrySchema, { line: 1, to, reason: "不做" })).toEqual([
        ["to", unknownDestination],
      ]);
    }
  });

  it("带图的行可以写已经读过图", () => {
    const entry = { line: 5, to: "不处理", reason: "图里是旧版本", imagesRead: true };
    expect(issuesOf(replyHandleEntrySchema, entry)).toEqual([]);
    expect(replyHandleEntrySchema.safeParse({ ...entry, imagesRead: "是" }).success).toBe(false);
  });

  it("行号从 1 数", () => {
    const entry = { line: 0, to: "不处理", reason: "不做" };
    expect(replyHandleEntrySchema.safeParse(entry).success).toBe(false);
  });
});

describe("处理回复的输入", () => {
  it("至少要处理一行", () => {
    expect(issuesOf(replyHandleInputSchema, [])).toEqual([["", "至少要处理一行。"]]);
  });

  it("同一行只能出现一次，报在第二次出现的地方", () => {
    const input = [
      { line: 3, to: "不处理", reason: "不做" },
      { line: 4, to: "主线", part: "场景清单" },
      { line: 3, to: "当场做", evidence: "改好了" },
      { line: 3, to: "不处理", reason: "还是不做" },
    ];
    expect(issuesOf(replyHandleInputSchema, input)).toEqual([
      ["2.line", "第 3 行出现了 3 次，一行只能有一个去处。"],
    ]);
  });

  it("每一项的错都报到它的位置", () => {
    const input = [
      { line: 1, to: "不处理", reason: "不做" },
      { line: 2, to: "当场做" },
    ];
    expect(issuesOf(replyHandleInputSchema, input)).toEqual([["1.evidence", "没有写完成证据。"]]);
  });
});

describe("存下的去处：五种各指向什么", () => {
  // 不能通过的一份各缺一样或写错一样，报在它指向的东西上。
  const cases: [Destination, string, object, object][] = [
    [
      "mainline",
      "revision",
      { to: "主线", revision: 8, part: "场景清单" },
      { to: "主线", part: "场景清单" },
    ],
    ["decision", "id", { to: "决定", id: 12 }, { to: "决定", id: "12" }],
    ["queue", "id", { to: "队列", id: "Q12" }, { to: "队列", id: 12 }],
    [
      "doneHere",
      "round",
      { to: "当场做", round: "v2-检查-1", evidence: "改好了" },
      { to: "当场做", evidence: "改好了" },
    ],
    ["noAction", "reason", { to: "不处理", reason: "用户说只是顺口一提" }, { to: "不处理" }],
  ];

  it.each(cases)("%s：一份能通过，一份报在 %s", (_to, field, passing, failing) => {
    expect(issuesOf(replyDestinationSchema, passing)).toEqual([]);
    expect(issuesOf(replyDestinationSchema, failing).map(([path]) => path)).toEqual([field]);
  });

  it("去处不是五种之一时报出五种去处", () => {
    expect(issuesOf(replyDestinationSchema, { to: "mainline", revision: 8 })).toEqual([
      ["to", unknownDestination],
    ]);
  });
});

describe("回复的一行", () => {
  const line = {
    submission: 7,
    line: 1,
    section: "疑问",
    card: "spec-twelve",
    kind: "选了选项",
    option: "a",
    images: [],
    imagesRead: false,
  };

  it("还没处理的行没有 handled", () => {
    expect(issuesOf(replyLineSchema, line)).toEqual([]);
  });

  it("处理以后写去处、时间和执行者", () => {
    const handled = {
      ...line,
      images: [hash],
      imagesRead: true,
      handled: {
        destination: { to: "决定", id: 12 },
        at: "2026-09-28T10:30:00+08:00",
        by: "cli/2.0.0",
      },
    };
    expect(issuesOf(replyLineSchema, handled)).toEqual([]);
    const { by: _by, ...withoutBy } = handled.handled;
    expect(issuesOf(replyLineSchema, { ...handled, handled: withoutBy })).toEqual([
      ["handled.by", "没有写执行者。"],
    ]);
  });

  it("选了选项的行要写选的是哪一个", () => {
    expect(issuesOf(replyLineSchema, { ...line, option: undefined })).toEqual([
      ["option", "选了选项的行要写选的是哪一个。"],
    ]);
  });

  it("想法和只写了备注的行要写备注", () => {
    const idea = { submission: 7, line: 9, kind: "想法", images: [], imagesRead: false };
    expect(issuesOf(replyLineSchema, idea)).toEqual([["note", "想法的行要写备注。"]]);
    expect(issuesOf(replyLineSchema, { ...idea, note: "看板可以按阶段分列" })).toEqual([]);
    expect(issuesOf(replyLineSchema, { ...idea, kind: "只写了备注" })).toEqual([
      ["note", "只写了备注的行要写备注。"],
    ]);
  });

  it("取消队列事项的行要写取消的是哪一件", () => {
    const drop = { submission: 7, line: 3, section: "队列看板", kind: "取消队列事项", images: [] };
    const row = { ...drop, imagesRead: false };
    expect(issuesOf(replyLineSchema, row)).toEqual([
      ["queue", "取消队列事项的行要写取消的是哪一件。"],
    ]);
    expect(issuesOf(replyLineSchema, { ...row, queue: "Q12" })).toEqual([]);
  });

  it("图写附件的哈希：六十四位小写十六进制", () => {
    expect(replyLineSchema.safeParse({ ...line, images: [hash.toUpperCase()] }).success).toBe(
      false,
    );
    expect(replyLineSchema.safeParse({ ...line, images: ["reply-img/1.png"] }).success).toBe(false);
  });

  it("种类写中文标签，解析以后是英文键，写英文键不收", () => {
    expect(replyLineSchema.parse(line).kind).toBe("option");
    expect(replyLineSchema.safeParse({ ...line, kind: "option" }).success).toBe(false);
  });
});

describe("JSON Schema", () => {
  it.each([
    ["replyDestination", replyDestinationSchema],
    ["replyLine", replyLineSchema],
    ["replyHandleEntry", replyHandleEntrySchema],
    ["replyHandleInput", replyHandleInputSchema],
  ] as const)("%s 能导出，结果和快照相同", (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: "input" })).toMatchSnapshot();
  });
});
