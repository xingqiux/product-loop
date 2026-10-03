import { renderCopy } from "../copy/define.ts";
import { legacyDecisionCopy } from "../copy/legacy-tables.ts";
import { decisionCopy } from "../copy/records.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import type { DecisionKind, DecisionStatus } from "../names.ts";
import {
  headerKey,
  type LegacyTableBlock,
  type LegacyTableRow,
  legacyTableBlocks,
} from "./table-rows.ts";

// 旧决定表的迁移，见「08 版本与迁移」第五节。按列数和表头识别每一行：
// 1. 五列带编号的，编号原样保留。
// 2. 四列不带编号的，按出现的顺序编号。
// 3. 四列带编号、没有日期的，日期留空，并标「迁移时缺日期」。
// 4. 三列的「以后再说」表，每行导入成种类为「以后再说」的决定。
// 5. 被空行截断、或接在别的表后面的行，按列数归到对应的表。
// 6. 文字里写着「已作废」的，状态记为已作废。
// 这里只读，不补内容。过不了现在的决定定义的地方记进每一行的 problems，见文件末尾。

/** 决定表的几种表头。认不出的表不是决定，例如 Sketch Board 的「等用户选」。 */
export const legacyDecisionShape = defineEnum({
  numbered: "五列带编号",
  unnumbered: "四列不带编号",
  numberedNoDate: "四列带编号，没有日期",
  later: "三列的以后再说",
  unknown: "认不出的表",
});
export type LegacyDecisionShape = KeyOf<typeof legacyDecisionShape>;

/** 文件里的一张表：表头所在的行号、前面最近的标题、表头的各格和认出的形状。 */
export type LegacyDecisionTableInfo = {
  readonly line: number;
  readonly heading?: string;
  readonly header: readonly string[];
  readonly shape: LegacyDecisionShape;
};

/**
 * 一行要改的地方。
 * - dateMissing：没有日期，就是第五节说的「迁移时缺日期」。suggested 是这一行的字里写着的日期。
 * - dateInvalid：日期不是 2026-09-20 这样的写法。
 * - laterWithoutCase：以后再说的一行没有案例。旧的以后再说表本来只有请求、原因、日期三列。
 * - caseMissing：决定的一行，案例一格是空的。
 * - voidedByMissing：已作废，但没写被哪一条推翻。
 * - voidedByMany：已作废，写了几条，决定只记一条。
 * - voidUnclear：「已作废」不在开头，也不是括号里的说明，可能只作废了一部分。按有效建议。
 * - idInvalid：编号一格不是数字，按出现的顺序另编了编号。
 * - idDuplicate：几行写了同一个编号，第一行保留，其余另编。lines 是这几行的行号。
 * - textMissing：决定或原因一格是空的。
 */
export type LegacyDecisionProblem =
  | { readonly kind: "dateMissing"; readonly suggested?: string }
  | { readonly kind: "dateInvalid"; readonly text: string }
  | { readonly kind: "laterWithoutCase" | "caseMissing" | "voidedByMissing" | "voidUnclear" }
  | { readonly kind: "voidedByMany"; readonly ids: readonly number[] }
  | { readonly kind: "idInvalid"; readonly text: string }
  | { readonly kind: "idDuplicate"; readonly lines: readonly number[] }
  | { readonly kind: "textMissing"; readonly field: "decision" | "reason" };
export type LegacyDecisionProblemKind = LegacyDecisionProblem["kind"];

/** 认出的一条决定。字段的意思和 decision.ts 的决定相同，没有的格不写。 */
export type LegacyDecisionRow = {
  /** 在 决定.md 里的行号。 */
  readonly line: number;
  readonly id: number;
  /** 编号是原来写的。按出现的顺序另编的是 false。 */
  readonly idGiven: boolean;
  readonly kind: DecisionKind;
  readonly decision: string;
  readonly reason: string;
  readonly case?: string;
  readonly date?: string;
  readonly status: DecisionStatus;
  /** 被哪一条推翻。写了几条时是第一条。 */
  readonly voidedBy?: number;
  /** 归到哪张表：那张表的表头所在的行号。 */
  readonly table: number;
  /** 被空行截断、或接在别的表后面，按列数归到这张表。 */
  readonly attached: boolean;
  readonly problems: readonly LegacyDecisionProblem[];
};

/** 没有导入的一行：认不出的表里的行，或者列数和哪张表都对不上的行。 */
export type LegacyDecisionSkip = {
  readonly line: number;
  readonly reason: "unknownTable" | "columnCount";
  readonly count: number;
};

export type LegacyDecisionFile = {
  readonly tables: readonly LegacyDecisionTableInfo[];
  readonly rows: readonly LegacyDecisionRow[];
  readonly skipped: readonly LegacyDecisionSkip[];
};

type DecisionColumn = "id" | "decision" | "reason" | "case" | "date";

/** 表头的写法和它是哪一列。以后再说表的「请求」就是决定一列。 */
const decisionColumns: ReadonlyMap<string, DecisionColumn> = new Map<string, DecisionColumn>([
  ["#", "id"],
  ["＃", "id"],
  ["编号", "id"],
  ["序号", "id"],
  ["决定", "decision"],
  ["请求", "decision"],
  ["原因", "reason"],
  ["理由", "reason"],
  ["案例", "case"],
  ["当时的案例", "case"],
  ["日期", "date"],
]);

const laterTitle = "以后再说";

type Table = LegacyDecisionTableInfo & {
  readonly count: number;
  readonly at: ReadonlyMap<DecisionColumn, number>;
};

function tableOf(block: LegacyTableBlock, header: LegacyTableRow): Table {
  const at = new Map<DecisionColumn, number>();
  header.cells.forEach((cell, i) => {
    const column = decisionColumns.get(headerKey(cell));
    if (column !== undefined && !at.has(column)) at.set(column, i);
  });
  const request = header.cells.some((cell) => headerKey(cell) === "请求");
  const isLater = request || (block.heading ?? "").includes(laterTitle);
  let shape: LegacyDecisionShape = "unknown";
  if (at.has("decision") && at.has("reason")) {
    if (isLater) shape = "later";
    else if (at.has("id")) shape = at.has("date") ? "numbered" : "numberedNoDate";
    else shape = "unnumbered";
  }
  return {
    line: header.line,
    ...(block.heading === undefined ? {} : { heading: block.heading }),
    header: header.cells,
    shape,
    count: header.cells.length,
    at,
  };
}

/** 一行和它归到的表，编号还没有定。 */
type Draft = {
  readonly row: LegacyTableRow;
  readonly table: Table;
  readonly attached: boolean;
};

/**
 * 读旧的 决定.md。每一段表格按表头认形状，行按列数归到表里：
 * 自己那一段的表头列数相同的，归到它。被空行截断的后半段和列数不同的行，
 * 先找前面最近的一张列数相同、认得出的表，没有再找后面的。
 */
export function parseLegacyDecisions(markdown: string): LegacyDecisionFile {
  const blocks = legacyTableBlocks(markdown);
  const tables = blocks.map((block) =>
    block.header === undefined ? undefined : tableOf(block, block.header),
  );
  const drafts: Draft[] = [];
  const skipped: LegacyDecisionSkip[] = [];
  blocks.forEach((block, b) => {
    const own = tables[b];
    for (const row of block.rows) {
      const count = row.cells.length;
      if (own !== undefined && own.count === count) {
        if (own.shape === "unknown")
          skipped.push({ line: row.line, reason: "unknownTable", count });
        else drafts.push({ row, table: own, attached: false });
        continue;
      }
      const table = nearestTable(tables, b, count);
      if (table === undefined) skipped.push({ line: row.line, reason: "columnCount", count });
      else drafts.push({ row, table, attached: true });
    }
  });
  const known = tables.filter((table) => table !== undefined);
  return {
    tables: known.map(({ line, heading, header, shape }) => ({
      line,
      ...(heading === undefined ? {} : { heading }),
      header,
      shape,
    })),
    rows: numberRows(drafts),
    skipped,
  };
}

function nearestTable(
  tables: readonly (Table | undefined)[],
  own: number,
  count: number,
): Table | undefined {
  const fits = (table: Table | undefined) =>
    table !== undefined && table.shape !== "unknown" && table.count === count;
  for (let i = own - 1; i >= 0; i--) if (fits(tables[i])) return tables[i];
  for (let i = own + 1; i < tables.length; i++) if (fits(tables[i])) return tables[i];
  return undefined;
}

// ---- 编号：原来写的保留，其余按出现的顺序接在最大的编号后面

function numberRows(drafts: readonly Draft[]): LegacyDecisionRow[] {
  const given = drafts.map(({ row, table }) => idCell(row, table));
  const firstLine = new Map<number, number>();
  const linesById = new Map<number, number[]>();
  given.forEach((id, i) => {
    if (typeof id !== "number") return;
    const line = drafts[i]?.row.line ?? 0;
    linesById.set(id, [...(linesById.get(id) ?? []), line]);
    if (!firstLine.has(id)) firstLine.set(id, line);
  });
  let next = Math.max(0, ...linesById.keys()) + 1;
  return drafts.map((draft, i) => {
    const cell = given[i];
    const problems: LegacyDecisionProblem[] = [];
    let id: number;
    let idGiven = false;
    if (typeof cell === "number" && firstLine.get(cell) === draft.row.line) {
      id = cell;
      idGiven = true;
    } else {
      id = next++;
      if (typeof cell === "number") {
        problems.push({ kind: "idDuplicate", lines: linesById.get(cell) ?? [] });
      } else if (cell !== undefined) problems.push({ kind: "idInvalid", text: cell });
    }
    return rowOf(draft, id, idGiven, problems);
  });
}

/** 编号一格：数字，写了但不是数字的原样返回，没有这一列或空着时是 undefined。 */
function idCell(row: LegacyTableRow, table: Table): number | string | undefined {
  const i = table.at.get("id");
  const text = i === undefined ? "" : (row.cells[i] ?? "").trim();
  if (text === "") return undefined;
  return /^[1-9]\d*$/u.test(text) ? Number(text) : text;
}

// ---- 一行的各格

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const dateInText = /\d{4}-\d{2}-\d{2}/u;

function rowOf(
  draft: Draft,
  id: number,
  idGiven: boolean,
  problems: LegacyDecisionProblem[],
): LegacyDecisionRow {
  const { row, table, attached } = draft;
  const cell = (column: DecisionColumn): string | undefined => {
    const i = table.at.get(column);
    return i === undefined ? undefined : (row.cells[i] ?? "").trim();
  };
  const decision = cell("decision") ?? "";
  const reason = cell("reason") ?? "";
  const caseText = cell("case") ?? "";
  const dateText = cell("date") ?? "";
  const kind: DecisionKind = table.shape === "later" ? "later" : "decision";

  if (decision === "") problems.push({ kind: "textMissing", field: "decision" });
  if (reason === "") problems.push({ kind: "textMissing", field: "reason" });
  if (caseText === "")
    problems.push({ kind: kind === "later" ? "laterWithoutCase" : "caseMissing" });
  let date: string | undefined;
  if (datePattern.test(dateText)) date = dateText;
  else if (dateText === "") {
    const suggested = row.cells.map((text) => dateInText.exec(text)?.[0]).find(Boolean);
    problems.push(
      suggested === undefined ? { kind: "dateMissing" } : { kind: "dateMissing", suggested },
    );
  } else problems.push({ kind: "dateInvalid", text: dateText });

  const voided = voidOf(decision);
  const elsewhere = row.cells.some((text) => text !== decision && text.includes(voidWord));
  if (voided.status === "voided") {
    const [first, ...more] = voided.by;
    if (first === undefined) problems.push({ kind: "voidedByMissing" });
    else if (more.length > 0) problems.push({ kind: "voidedByMany", ids: voided.by });
  } else if (voided.mentioned || elsewhere) problems.push({ kind: "voidUnclear" });
  const [voidedBy] = voided.by;

  return {
    line: row.line,
    id,
    idGiven,
    kind,
    decision,
    reason,
    ...(caseText === "" ? {} : { case: caseText }),
    ...(date === undefined ? {} : { date }),
    status: voided.status,
    ...(voided.status === "voided" && voidedBy !== undefined ? { voidedBy } : {}),
    table: table.line,
    attached,
    problems,
  };
}

// ---- 已作废

const voidWord = "已作废";

/** 推翻它的那一条：「被 11 取代」「第 80 条」「见 25」「见决定 41、42」「由 165 改为」。 */
const voidedByPattern = /(?:被|见|第|由|决定|、)\s*(\d+)(?!\s*轮|\d)/gu;

type VoidReading = {
  readonly status: DecisionStatus;
  /** 写着的推翻它的几条，按先后。 */
  readonly by: readonly number[];
  /** 文字里提到了已作废，但不是整条作废的写法。 */
  readonly mentioned: boolean;
};

/**
 * 决定一格的文字是不是整条作废。以「已作废」开头，或者括号以「已作废」开头，才算整条作废，
 * 例如「已作废（被 11 取代）。原决定：……」「……（已作废，见决定 41）」。
 * 「abei 那一半已作废」这类只作废一部分，按有效建议，由 AI 确认。
 * 推翻它的编号从「已作废」起找：开头的找到第一个句号，括号的找到括号结束。
 */
function voidOf(text: string): VoidReading {
  const at = text.indexOf(voidWord);
  if (at === -1) return { status: "active", by: [], mentioned: false };
  const before = text.slice(0, at).trim();
  const inParen = /[（(]$/u.test(before);
  if (before !== "" && !inParen) return { status: "active", by: [], mentioned: true };
  const rest = text.slice(at);
  const end = inParen ? rest.search(/[）)]/u) : rest.indexOf("。");
  const segment = end === -1 ? rest : rest.slice(0, end);
  const by = [...segment.matchAll(voidedByPattern)].map((m) => Number(m[1]));
  return { status: "voided", by: [...new Set(by)], mentioned: true };
}

// ---- 要不要 AI 确认

/**
 * 旧决定表里有三种行过不了现在的决定定义，约定 0002 第三节第 1 条留给第 59、61 步定。
 * 第 59 步按八个项目的真实数据建议如下：
 * - 缺日期的由 AI 在确认时补上。体检从这一行的字里找日期作为建议。
 * - 以后再说缺案例的，放宽定义，以后再说的决定不要求案例，不用确认。
 *   旧的以后再说表只有请求、原因、日期三列，让 AI 补案例就是编内容。
 * - 作废没写被哪一条推翻的，由 AI 在确认时补上。
 * 其余问题都要 AI 确认。
 */
export function decisionProblemNeedsCheck(problem: LegacyDecisionProblem): boolean {
  return problem.kind !== "laterWithoutCase";
}

/** 这一行有要 AI 确认的地方。 */
export function decisionRowNeedsCheck(row: LegacyDecisionRow): boolean {
  return row.problems.some(decisionProblemNeedsCheck);
}

/** 一行要改的地方写成一句话。 */
export function describeLegacyDecisionProblem(problem: LegacyDecisionProblem): string {
  const text = legacyDecisionCopy.problem;
  switch (problem.kind) {
    case "dateMissing":
      return problem.suggested === undefined
        ? renderCopy(text.dateMissing)
        : renderCopy(text.dateSuggested, { date: problem.suggested });
    case "dateInvalid":
    case "idInvalid":
      return renderCopy(text[problem.kind], { text: problem.text });
    case "laterWithoutCase":
    case "caseMissing":
    case "voidedByMissing":
    case "voidUnclear":
      return renderCopy(text[problem.kind]);
    case "voidedByMany":
      return renderCopy(text.voidedByMany, { ids: problem.ids.join("、") });
    case "idDuplicate":
      return renderCopy(text.idDuplicate, { lines: problem.lines.join("、") });
    case "textMissing":
      return renderCopy(text.textMissing, { field: renderCopy(decisionCopy.field[problem.field]) });
  }
}

/** 没有读的一行写成一句话。 */
export function describeLegacyDecisionSkip(skip: LegacyDecisionSkip): string {
  const text = legacyDecisionCopy.skip;
  return skip.reason === "unknownTable"
    ? renderCopy(text.unknownTable)
    : renderCopy(text.columnCount, { count: skip.count });
}
