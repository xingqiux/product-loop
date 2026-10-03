import { renderCopy } from "../copy/define.ts";
import { legacyQueueCopy } from "../copy/legacy-tables.ts";
import { queueCopy } from "../copy/records.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import { formatQueueId } from "../ids.ts";
import {
  type Proposer,
  proposer as proposerName,
  renamedStages,
  type Stage,
  stage,
} from "../names.ts";
import { headerKey, type LegacyTableRow, legacyTableBlocks } from "./table-rows.ts";

// 旧队列的迁移，见「08 版本与迁移」第五节。
// 旧的 队列.md 是手写的表格，状态是随手写的一句话。体检按第五节的表给每一行定一个建议状态，
// 写进 migrate/队列迁移对照.md，由 AI 逐行确认（第一期计划第 60 步）。
// 队列.json 已经是十格，直接导入，只补编号。它的「提出」也是随手写的，同样换成提出者。
// 编号按先后从 Q1 起，旧页面的 queueRow 按它换成队列编号，见 convert-page.ts。
// 这里只读，不补内容。认不出的地方记进 checks，由 AI 确认。

/**
 * 建议的新状态：队列状态里的四种，另加待核对。
 * 待核对不是队列的状态：AI 查过提交记录，定为已完成或待办（第五节的表）。
 * 没有进行中：迁移完成时第 1 版结束，没有开着的轮次。
 */
export const legacyQueueStatus = defineEnum({
  todo: "待办",
  waiting: "等待",
  done: "已完成",
  dropped: "已取消",
  verify: "待核对",
});
export type LegacyQueueStatus = KeyOf<typeof legacyQueueStatus>;

/** 旧的写法去了哪一格：完成证据、状态说明或依赖。 */
export type LegacyQueueField = "evidence" | "statusNote" | "dependsOn";

/** 按第五节的表给一种旧写法定的建议。 */
export type LegacyStatusSuggestion = {
  readonly status: LegacyQueueStatus;
  /** 旧的写法写进哪一格。空着的没有。 */
  readonly field?: LegacyQueueField;
  /** 写进那一格的字。 */
  readonly text?: string;
  /** 表里有这种写法。认不出的按待核对，要 AI 看。 */
  readonly known: boolean;
};

/** 写着第几轮，例如「已进第 14 轮」「构思 1 轮 2a」。 */
const roundRef = /第?\s*\d+\s*轮/u;

/**
 * 按第五节的表，给旧状态的一种写法定建议的新状态。
 * - 做完、做完（第 1 轮）、已落地加提交号、已定加决定编号：已完成，旧的写法进完成证据。
 * - 已进第 N 轮：待核对，AI 查提交记录后定为已完成或待办。写着未做完的是待办。旧的写法进状态说明。
 * - 等你定……：等待，依赖写用户，旧的写法跟在后面。
 * - 等、等逐屏检查、等落地、等检查（第 2 轮）：待办，旧的写法进状态说明。
 * - 空着：待办。
 * 表里没有的写法按待核对，要 AI 看。写成新状态名「待办」「进行中」的，按待办和已进第 N 轮。
 */
export function suggestQueueStatus(old: string): LegacyStatusSuggestion {
  const text = old.trim();
  if (text === "" || text === legacyQueueStatus.label("todo")) {
    return { status: "todo", known: true };
  }
  if (/^(?:做完|已完成|已落地|已定)/u.test(text)) {
    return { status: "done", field: "evidence", text, known: true };
  }
  if (/^已进/u.test(text) && roundRef.test(text)) {
    const status = text.includes("未做完") ? "todo" : "verify";
    return { status, field: "statusNote", text, known: true };
  }
  if (text === "进行中") return { status: "verify", field: "statusNote", text, known: true };
  const waitingOn = /^等(?:你|用户)定?/u.exec(text);
  if (waitingOn !== null) {
    const rest = text.slice(waitingOn[0].length).replace(/^[\s：:，,]+/u, "");
    const user = proposerName.label("user");
    const dependsOn = rest === "" ? user : `${user}：${rest}`;
    return { status: "waiting", field: "dependsOn", text: dependsOn, known: true };
  }
  if (text.startsWith("等")) return { status: "todo", field: "statusNote", text, known: true };
  return { status: "verify", field: "statusNote", text, known: false };
}

/** 按第五节换成的提出者。 */
export type LegacyProposer = {
  readonly proposer: Proposer;
  /** 写的不只是一个名字时，原句进来源。 */
  readonly source?: string;
  /** 认出来了。认不出的按第五节写 AI，要 AI 确认。 */
  readonly known: boolean;
};

/** 只写了一个名字的：「我」换成 AI，「你」换成用户。 */
const namedProposers: ReadonlyMap<string, Proposer> = new Map<string, Proposer>([
  ["我", "ai"],
  ["AI", "ai"],
  ["ai", "ai"],
  ["你", "user"],
  ["用户", "user"],
  ["评审", "review"],
]);

/** 以名字开头、后面还有字的，例如「用户，构思第 3 轮」「评审子代理」。 */
const leadingProposers: readonly (readonly [string, Proposer])[] = [
  ["用户", "user"],
  ["评审", "review"],
  ["AI", "ai"],
  ["我", "ai"],
  ["你", "user"],
];

/**
 * 「谁提的」换成提出者，见第五节：「我」换成 AI，「你」换成用户。
 * 「第 9 轮报告的疑问，用户没答」这类句子，提出写 AI，原句进来源。
 * 评审在提出者里有自己的一种，以评审开头的归到评审。
 * 既不是这几种名字、也不像句子的，例如一个人名或项目名，仍写 AI，但要 AI 确认。
 */
export function legacyProposer(old: string): LegacyProposer {
  const text = old.trim();
  const named = namedProposers.get(text);
  if (named !== undefined) return { proposer: named, known: true };
  for (const [name, who] of leadingProposers) {
    if (!text.startsWith(name)) continue;
    // 「我的」「你选的」是句子。「我，第 9 轮」「你（备注）」是名字加说明
    const after = text.slice(name.length);
    if ((name === "我" || name === "你") && !/^[\s，,（(：:、]/u.test(after)) continue;
    return { proposer: who, source: text, known: true };
  }
  const sentence = roundRef.test(text) || /[，,。]/u.test(text);
  return { proposer: "ai", ...(text === "" ? {} : { source: text }), known: sentence };
}

/**
 * 一件事要 AI 确认的地方。
 * - verify：已进第 N 轮，或 队列.json 里进行中的事，查提交记录后定为已完成或待办。
 * - statusUnknown：旧状态的写法第五节的表里没有，按待核对。text 是旧的写法。
 * - proposerUnknown：认不出谁提的，暂写 AI。text 是旧的写法，没写时是空的。
 * - stageUnknown：阶段不是五个之一。「修复」已经换成落地，不算在内。
 * - dateMissing：没写日期，或者不是 2026-09-20 这样的写法。
 * - contentEmpty：没写内容。
 * - fieldMissing：建议的状态要求的一格是空的：等待要依赖，已完成要完成证据，已取消要原因。
 */
export type LegacyQueueCheck =
  | { readonly kind: "verify" | "dateMissing" | "contentEmpty" }
  | {
      readonly kind: "statusUnknown" | "proposerUnknown" | "stageUnknown";
      readonly text: string;
    }
  | {
      readonly kind: "fieldMissing";
      readonly status: LegacyQueueStatus;
      readonly field: LegacyQueueField;
    };
export type LegacyQueueCheckKind = LegacyQueueCheck["kind"];

/** 旧队列的一件事，连同建议的新写法。字段的意思和 queue.ts 的队列事项相同。 */
export type LegacyQueueRow = {
  /** 来自旧的表格，还是 队列.json。 */
  readonly from: "table" | "json";
  /** 表格里的行号，或者 队列.json 里的第几件，都从 1 数。 */
  readonly at: number;
  /** 队列事项的编号，按先后从 Q1 起。 */
  readonly id: string;
  readonly content: string;
  /** 要做它的阶段，「修复」已经换成落地。认不出时没有。 */
  readonly stage?: Stage;
  readonly proposer: Proposer;
  /** 创建的日期，写成 2026-09-20。 */
  readonly createdAt?: string;
  readonly status: LegacyQueueStatus;
  readonly statusNote?: string;
  readonly dependsOn?: string;
  readonly acceptance?: string;
  readonly evidence?: string;
  readonly subItems: readonly string[];
  readonly source?: string;
  /** 原样的旧写法。队列.json 的状态是「值」，它的说明在 statusNote 等几格里。 */
  readonly old: {
    readonly stage: string;
    readonly proposer: string;
    readonly date: string;
    readonly status: string;
  };
  /** 要 AI 确认的地方。空的表示这一件按建议导入。 */
  readonly checks: readonly LegacyQueueCheck[];
};

/**
 * 整份文件的问题。
 * - noTable：文件里有表格，但没有一张的表头有「内容」和「状态」两列。
 * - columnCount：这一行的列数和哪张队列表格的表头都对不上，没有读。
 * - notQueue：队列.json 的最外层没有「事项」这个数组。
 * - itemShape：队列.json 里的这一件不是对象，没有读。编号照样占一个。
 */
export type LegacyQueueProblem =
  | { readonly kind: "noTable" | "notQueue" }
  | { readonly kind: "columnCount"; readonly line: number; readonly count: number }
  | { readonly kind: "itemShape"; readonly at: number };

export type LegacyQueueTable = {
  readonly rows: readonly LegacyQueueRow[];
  readonly problems: readonly LegacyQueueProblem[];
};

/** 一处要确认的地方写成一句话。 */
export function describeLegacyQueueCheck(check: LegacyQueueCheck): string {
  const text = legacyQueueCopy.check;
  switch (check.kind) {
    case "verify":
    case "dateMissing":
    case "contentEmpty":
      return renderCopy(text[check.kind]);
    case "statusUnknown":
    case "stageUnknown":
      return renderCopy(text[check.kind], { text: check.text });
    case "proposerUnknown":
      return check.text === ""
        ? renderCopy(text.proposerMissing)
        : renderCopy(text.proposerUnknown, { text: check.text });
    case "fieldMissing":
      return renderCopy(text.fieldMissing, {
        status: legacyQueueStatus.label(check.status),
        field: renderCopy(queueCopy.field[check.field]),
      });
  }
}

/** 整份文件的一个问题写成一句话。 */
export function describeLegacyQueueProblem(problem: LegacyQueueProblem): string {
  const text = legacyQueueCopy.problem;
  switch (problem.kind) {
    case "noTable":
    case "notQueue":
      return renderCopy(text[problem.kind]);
    case "columnCount":
      return renderCopy(text.columnCount, { line: problem.line, count: problem.count });
    case "itemShape":
      return renderCopy(text.itemShape, { at: problem.at });
  }
}

// ---- 旧的表格

type QueueColumn =
  | "content"
  | "stage"
  | "proposer"
  | "date"
  | "status"
  | "dependsOn"
  | "acceptance"
  | "evidence"
  | "source";

/** 表头的写法和它是哪一列。旧模板写「内容 / 属于哪个阶段 / 谁提的 / 日期 / 状态」。 */
const queueColumns: ReadonlyMap<string, QueueColumn> = new Map<string, QueueColumn>([
  ["内容", "content"],
  ["事项", "content"],
  ["属于哪个阶段", "stage"],
  ["阶段", "stage"],
  ["谁提的", "proposer"],
  ["提出", "proposer"],
  ["提出者", "proposer"],
  ["日期", "date"],
  ["创建时间", "date"],
  ["状态", "status"],
  ["依赖", "dependsOn"],
  ["验收标准", "acceptance"],
  ["完成证据", "evidence"],
  ["来源", "source"],
]);

/** 一张队列表格：各列在第几格。 */
type QueueHeader = {
  readonly count: number;
  readonly at: ReadonlyMap<QueueColumn, number>;
};

function queueHeader(cells: readonly string[]): QueueHeader | undefined {
  const at = new Map<QueueColumn, number>();
  cells.forEach((cell, i) => {
    const column = queueColumns.get(headerKey(cell));
    if (column !== undefined && !at.has(column)) at.set(column, i);
  });
  return at.has("content") && at.has("status") ? { count: cells.length, at } : undefined;
}

/**
 * 读旧的 队列.md。每一段表格按表头认，被空行截断的后半段和列数不同的行，
 * 按列数归到对应的表：先看自己这一段，再往前找，最后往后找。
 */
export function parseLegacyQueueTable(markdown: string): LegacyQueueTable {
  const blocks = legacyTableBlocks(markdown);
  const headers = blocks.map((block) =>
    block.header === undefined ? undefined : queueHeader(block.header.cells),
  );
  const rows: LegacyQueueRow[] = [];
  const problems: LegacyQueueProblem[] = [];
  if (blocks.length > 0 && headers.every((header) => header === undefined)) {
    return { rows, problems: [{ kind: "noTable" }] };
  }
  blocks.forEach((block, b) => {
    // 表头认不出的表不是队列，整段不读
    if (block.header !== undefined && headers[b] === undefined) return;
    for (const row of block.rows) {
      const header = pickHeader(headers, b, row.cells.length);
      if (header === undefined) {
        problems.push({ kind: "columnCount", line: row.line, count: row.cells.length });
        continue;
      }
      rows.push(tableRow(row, header, formatQueueId(rows.length + 1)));
    }
  });
  return { rows, problems };
}

function pickHeader(
  headers: readonly (QueueHeader | undefined)[],
  own: number,
  count: number,
): QueueHeader | undefined {
  const fits = (header: QueueHeader | undefined) => header?.count === count;
  if (fits(headers[own])) return headers[own];
  for (let i = own - 1; i >= 0; i--) if (fits(headers[i])) return headers[i];
  for (let i = own + 1; i < headers.length; i++) if (fits(headers[i])) return headers[i];
  return undefined;
}

function tableRow(row: LegacyTableRow, header: QueueHeader, id: string): LegacyQueueRow {
  const cell = (column: QueueColumn): string => {
    const i = header.at.get(column);
    return i === undefined ? "" : (row.cells[i] ?? "");
  };
  const suggestion = suggestQueueStatus(cell("status"));
  const fields: Record<LegacyQueueField, string> = {
    evidence: cell("evidence"),
    statusNote: "",
    dependsOn: cell("dependsOn"),
  };
  if (suggestion.field !== undefined && suggestion.text !== undefined) {
    fields[suggestion.field] = joinTexts(fields[suggestion.field], suggestion.text);
  }
  return assemble({
    from: "table",
    at: row.line,
    id,
    content: cell("content"),
    stageText: cell("stage"),
    proposerText: cell("proposer"),
    date: cell("date"),
    statusText: cell("status"),
    status: suggestion.status,
    known: suggestion.known,
    fields,
    acceptance: cell("acceptance"),
    subItems: [],
    source: cell("source"),
  });
}

// ---- 队列.json

/** 旧 队列.json 用中文键。Biome 只收 ASCII 的标识符，所以用常量表读，见第一期计划第三节。 */
const jsonKeys = {
  items: "事项",
  content: "内容",
  stage: "阶段",
  proposer: "提出",
  createdAt: "创建时间",
  status: "状态",
  value: "值",
  note: "说明",
  dependsOn: "依赖",
  acceptance: "验收标准",
  evidence: "完成证据",
  subItems: "子项",
  source: "来源",
} as const;

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * 读旧的 队列.json，doc 是 JSON 解析以后的值。十格照收，只补编号，编号按先后从 Q1 起。
 * 状态已经是新的写法。进行中的事在迁移以后没有开着的轮次，按待核对。
 */
export function readLegacyQueueJson(doc: unknown): LegacyQueueTable {
  const items = isRecord(doc) ? doc[jsonKeys.items] : undefined;
  if (!Array.isArray(items)) return { rows: [], problems: [{ kind: "notQueue" }] };
  const rows: LegacyQueueRow[] = [];
  const problems: LegacyQueueProblem[] = [];
  items.forEach((item: unknown, i) => {
    if (isRecord(item)) rows.push(jsonRow(item, i + 1));
    else problems.push({ kind: "itemShape", at: i + 1 });
  });
  return { rows, problems };
}

/** 队列.json 的一件：状态的值照收，说明按状态放进依赖、完成证据或状态说明。 */
function jsonStatus(
  value: string,
  note: string,
  given: { readonly evidence: string; readonly dependsOn: string },
): { status: LegacyQueueStatus; known: boolean; fields: Record<LegacyQueueField, string> } {
  const fields: Record<LegacyQueueField, string> = { ...given, statusNote: "" };
  const key = legacyQueueStatus.key(value);
  switch (key) {
    case "todo":
    case "dropped":
      fields.statusNote = note;
      return { status: key, known: true, fields };
    case "waiting":
      if (fields.dependsOn === "") fields.dependsOn = note;
      if (note !== fields.dependsOn) fields.statusNote = note;
      return { status: key, known: true, fields };
    case "done":
      if (fields.evidence === "") fields.evidence = note;
      if (note !== fields.evidence) fields.statusNote = note;
      return { status: key, known: true, fields };
    default:
      // 进行中和认不出的写法：说明留在状态说明里
      fields.statusNote = note === "" ? value : note;
      return { status: "verify", known: value === "进行中", fields };
  }
}

function jsonRow(item: JsonRecord, at: number): LegacyQueueRow {
  const status = item[jsonKeys.status];
  const value = isRecord(status) ? textOf(status[jsonKeys.value]) : "";
  const note = isRecord(status) ? textOf(status[jsonKeys.note]) : "";
  const given = {
    evidence: textOf(item[jsonKeys.evidence]),
    dependsOn: textOf(item[jsonKeys.dependsOn]),
  };
  const read = jsonStatus(value, note, given);
  const subItems = item[jsonKeys.subItems];
  return assemble({
    from: "json",
    at,
    id: formatQueueId(at),
    content: textOf(item[jsonKeys.content]),
    stageText: textOf(item[jsonKeys.stage]),
    proposerText: textOf(item[jsonKeys.proposer]),
    date: textOf(item[jsonKeys.createdAt]),
    statusText: value,
    status: read.status,
    known: read.known,
    fields: read.fields,
    acceptance: textOf(item[jsonKeys.acceptance]),
    subItems: Array.isArray(subItems) ? subItems.map(textOf).filter((text) => text !== "") : [],
    source: textOf(item[jsonKeys.source]),
  });
}

// ---- 两种来源共用

type RowParts = {
  readonly from: LegacyQueueRow["from"];
  readonly at: number;
  readonly id: string;
  readonly content: string;
  readonly stageText: string;
  readonly proposerText: string;
  readonly date: string;
  readonly statusText: string;
  readonly status: LegacyQueueStatus;
  /** 旧状态的写法认出来了。 */
  readonly known: boolean;
  readonly fields: Readonly<Record<LegacyQueueField, string>>;
  readonly acceptance: string;
  readonly subItems: readonly string[];
  readonly source: string;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** 状态要求写上的一格，和 queue.ts 的队列事项相同。 */
const requiredField: Partial<Record<LegacyQueueStatus, LegacyQueueField>> = {
  waiting: "dependsOn",
  done: "evidence",
  dropped: "statusNote",
};

/** 几段文字接起来，空的不要。 */
function joinTexts(...texts: readonly string[]): string {
  return texts.filter((text) => text !== "").join("；");
}

function stageOf(text: string): Stage | undefined {
  return stage.key(renamedStages.get(text) ?? text);
}

function checksOf(parts: RowParts, who: LegacyProposer, stageKey: Stage | undefined) {
  const checks: LegacyQueueCheck[] = [];
  if (parts.content === "") checks.push({ kind: "contentEmpty" });
  if (parts.status === "verify") {
    checks.push(
      parts.known ? { kind: "verify" } : { kind: "statusUnknown", text: parts.statusText },
    );
  }
  const field = requiredField[parts.status];
  if (field !== undefined && parts.fields[field] === "") {
    checks.push({ kind: "fieldMissing", status: parts.status, field });
  }
  if (!who.known) checks.push({ kind: "proposerUnknown", text: parts.proposerText });
  if (stageKey === undefined) checks.push({ kind: "stageUnknown", text: parts.stageText });
  if (!datePattern.test(parts.date)) checks.push({ kind: "dateMissing" });
  return checks;
}

function assemble(parts: RowParts): LegacyQueueRow {
  const who = legacyProposer(parts.proposerText);
  const stageKey = stageOf(parts.stageText);
  const source = joinTexts(parts.source, who.source ?? "");
  const { statusNote, dependsOn, evidence } = parts.fields;
  const { acceptance, date } = parts;
  return {
    from: parts.from,
    at: parts.at,
    id: parts.id,
    content: parts.content,
    ...(stageKey === undefined ? {} : { stage: stageKey }),
    proposer: who.proposer,
    ...(datePattern.test(date) ? { createdAt: date } : {}),
    status: parts.status,
    ...(statusNote === "" ? {} : { statusNote }),
    ...(dependsOn === "" ? {} : { dependsOn }),
    ...(acceptance === "" ? {} : { acceptance }),
    ...(evidence === "" ? {} : { evidence }),
    subItems: parts.subItems,
    ...(source === "" ? {} : { source }),
    old: {
      stage: parts.stageText,
      proposer: parts.proposerText,
      date: parts.date,
      status: parts.statusText,
    },
    checks: checksOf(parts, who, stageKey),
  };
}
