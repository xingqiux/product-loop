import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  decisionKind,
  decisionProblemNeedsCheck,
  decisionStatus,
  describeLegacyDecisionProblem,
  describeLegacyDecisionSkip,
  describeLegacyQueueCheck,
  type LegacyDecisionFile,
  type LegacyDecisionProblem,
  type LegacyImportBody,
  type LegacyQueueCheck,
  type LegacyQueueRow,
  legacyQueueStatus,
  projectCacheDirName,
  proposer,
  queueStatus,
  renderCopy,
  stage,
} from "@product-loop/model";
import { doctorCopy } from "../copy/doctor.ts";
import { isFile, readText } from "./files.ts";
import {
  type Checklist,
  type Column,
  checklistLine,
  readChecklist,
  readTable,
  tableLines,
} from "./md-table.ts";

// 迁移检查写进 .product-loop/migrate/ 的迁移对照，见「08 版本与迁移」第四节和第五节。
// - 队列迁移对照.md：每件旧事项一行，写建议的新状态。AI 核对以后在确认一格写「是」。
// - 决定迁移对照.md：每条旧决定一行，另列没有读的行。AI 补齐日期，核对以后写「是」。
// - 其他确认.md：别的检查项要确认的地方，AI 看过以后勾上。
// 已经写好的文件不再覆盖，AI 改过的内容就是导入的依据。旧页面的一份一份写在 pages/，见 migrate-pages.ts。

const text = doctorCopy.migrate;

export const migrateFile = {
  queue: "队列迁移对照.md",
  decisions: "决定迁移对照.md",
  acks: "其他确认.md",
} as const;

/** 确认一格写的字。 */
const yes = "是";

export function migrateDirOf(root: string): string {
  return join(root, projectCacheDirName, "migrate");
}

type ImportQueueItem = LegacyImportBody["queue"][number];
type ImportDecision = LegacyImportBody["decisions"][number];

/** 读回来的一份对照：能导入的内容，和还要确认的地方。 */
export type MigrateRead<T> = { readonly items: readonly T[]; readonly confirm: readonly string[] };

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** 同一句话的几项并成一行，列出编号。 */
function grouped(pairs: readonly (readonly [string, string])[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const [said, id] of pairs) groups.set(said, [...(groups.get(said) ?? []), id]);
  return groups;
}

/** 在多的里而不在少的里的。 */
const minus = (from: Iterable<string>, other: ReadonlySet<string>) =>
  [...from].filter((id) => !other.has(id));

const duplicates = (ids: readonly string[]) => [
  ...new Set(ids.filter((id, i) => ids.indexOf(id) !== i)),
];

// ---- 队列

const queueColumns = [
  ["id", "编号"],
  ["content", "内容"],
  ["stage", "阶段"],
  ["proposer", "提出"],
  ["createdAt", "日期"],
  ["old", "旧状态"],
  ["status", "新状态"],
  ["dependsOn", "依赖"],
  ["statusNote", "状态说明"],
  ["evidence", "完成证据"],
  ["acceptance", "验收标准"],
  ["source", "来源"],
  ["checks", "要确认的地方"],
  ["confirmed", "确认"],
] as const satisfies readonly Column<string>[];
type QueueColumn = (typeof queueColumns)[number][0];

/** 旧表格的每一行都要 AI 确认。队列.json 里没有要确认的地方的，预先写好「是」。 */
export function queueFileText(rows: readonly LegacyQueueRow[]): string {
  const cells = rows.map(
    (row) =>
      new Map<QueueColumn, string>([
        ["id", row.id],
        ["content", row.content],
        ["stage", row.stage === undefined ? row.old.stage : stage.label(row.stage)],
        ["proposer", proposer.label(row.proposer)],
        ["createdAt", row.createdAt ?? row.old.date],
        ["old", row.old.status],
        ["status", legacyQueueStatus.label(row.status)],
        ["dependsOn", row.dependsOn ?? ""],
        ["statusNote", row.statusNote ?? ""],
        ["evidence", row.evidence ?? ""],
        ["acceptance", row.acceptance ?? ""],
        ["source", row.source ?? ""],
        ["checks", row.checks.map(describeLegacyQueueCheck).join("\n")],
        ["confirmed", row.from === "json" && row.checks.length === 0 ? yes : ""],
      ]),
  );
  const title = migrateFile.queue.replace(/\.md$/u, "");
  return [
    `# ${title}`,
    "",
    renderCopy(text.queueIntro),
    "",
    ...tableLines(queueColumns, cells),
    "",
  ].join("\n");
}

/** 各状态要求填的一格，和后端导入时查的相同。 */
const requiredField = new Map([
  ["waiting", "dependsOn"],
  ["done", "evidence"],
  ["dropped", "statusNote"],
] as const);

const optional = (value: string) => (value === "" ? undefined : value);

/** 一行对照读成导入的一件，或者要确认的地方。 */
function queueRow(
  cell: ReadonlyMap<QueueColumn, string>,
  subItems: readonly string[],
): { item?: ImportQueueItem; checks: string[] } {
  const get = (key: QueueColumn) => cell.get(key) ?? "";
  const checks: LegacyQueueCheck[] = [];
  const said: string[] = [];
  const content = get("content");
  if (content === "") checks.push({ kind: "contentEmpty" });
  const stageKey = stage.key(get("stage"));
  if (stageKey === undefined) checks.push({ kind: "stageUnknown", text: get("stage") });
  const who = proposer.key(get("proposer"));
  if (who === undefined)
    said.push(renderCopy(text.queue.proposerInvalid, { text: get("proposer") }));
  const createdAt = get("createdAt");
  if (!datePattern.test(createdAt)) checks.push({ kind: "dateMissing" });
  const statusText = get("status");
  const status = queueStatus.key(statusText);
  if (statusText === legacyQueueStatus.label("verify")) checks.push({ kind: "verify" });
  else if (status === undefined || status === "doing") {
    checks.push({ kind: "statusUnknown", text: statusText });
  } else {
    const field = requiredField.get(status as "waiting" | "done" | "dropped");
    if (field !== undefined && get(field) === "") {
      checks.push({ kind: "fieldMissing", status: status as "waiting", field });
    }
  }
  const all = [...checks.map(describeLegacyQueueCheck), ...said];
  if (all.length > 0 || stageKey === undefined || who === undefined || status === undefined) {
    return { checks: all };
  }
  const item = {
    id: get("id"),
    content,
    stage: stage.label(stageKey),
    proposer: proposer.label(who),
    createdAt,
    status: queueStatus.label(status),
    statusNote: optional(get("statusNote")),
    dependsOn: optional(get("dependsOn")),
    acceptance: optional(get("acceptance")),
    evidence: optional(get("evidence")),
    subItems: [...subItems],
    source: optional(get("source")),
  };
  const defined = Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined));
  return { item: defined as ImportQueueItem, checks: [] };
}

/** 读回队列迁移对照。scanned 是迁移检查从旧文件读出的各件，用来对编号和取子项。 */
export function readQueueFile(
  content: string,
  scanned: readonly LegacyQueueRow[],
): MigrateRead<ImportQueueItem> {
  const rows = readTable(content, queueColumns);
  if (rows === undefined) {
    return { items: [], confirm: [renderCopy(text.queue.noTable, { file: migrateFile.queue })] };
  }
  const subItems = new Map(scanned.map((row) => [row.id, row.subItems]));
  const items: ImportQueueItem[] = [];
  const pairs: [string, string][] = [];
  const unconfirmed: string[] = [];
  const ids = rows.map((row) => row.get("id") ?? "");
  for (const row of rows) {
    const id = row.get("id") ?? "";
    const read = queueRow(row, subItems.get(id) ?? []);
    for (const said of read.checks) pairs.push([said, id]);
    if (row.get("confirmed") !== yes) unconfirmed.push(id);
    if (read.item !== undefined) items.push(read.item);
  }
  const t = text.queue;
  const confirm: string[] = [];
  if (unconfirmed.length > 0)
    confirm.push(renderCopy(t.unconfirmed, { ids: unconfirmed.join("、") }));
  for (const [said, list] of grouped(pairs)) {
    confirm.push(renderCopy(t.row, { id: list.join("、"), text: said }));
  }
  const listed = new Set(ids);
  const known = new Set(scanned.map((row) => row.id));
  const missing = minus(known, listed);
  const extra = minus(listed, known);
  const twice = duplicates(ids);
  if (missing.length > 0) confirm.push(renderCopy(t.missing, { ids: missing.join("、") }));
  if (extra.length > 0) confirm.push(renderCopy(t.extra, { ids: extra.join("、") }));
  if (twice.length > 0) confirm.push(renderCopy(t.duplicate, { ids: twice.join("、") }));
  return { items, confirm };
}

// ---- 决定

const decisionColumns = [
  ["id", "编号"],
  ["kind", "种类"],
  ["decision", "决定"],
  ["reason", "原因"],
  ["case", "案例"],
  ["date", "日期"],
  ["status", "状态"],
  ["voidedBy", "被哪一条推翻"],
  ["voidReason", "作废原因"],
  ["checks", "要确认的地方"],
  ["confirmed", "确认"],
] as const satisfies readonly Column<string>[];
type DecisionColumn = (typeof decisionColumns)[number][0];

/** 没有要确认的地方的行预先写好「是」。没有读的行列在表后面，由 AI 勾上。 */
export function decisionsFileText(file: LegacyDecisionFile): string {
  const cells = file.rows.map((row) => {
    const checks = row.problems.filter(decisionProblemNeedsCheck);
    return new Map<DecisionColumn, string>([
      ["id", String(row.id)],
      ["kind", decisionKind.label(row.kind)],
      ["decision", row.decision],
      ["reason", row.reason],
      ["case", row.case ?? ""],
      ["date", row.date ?? ""],
      ["status", decisionStatus.label(row.status)],
      ["voidedBy", row.voidedBy === undefined ? "" : String(row.voidedBy)],
      ["voidReason", ""],
      ["checks", checks.map(describeLegacyDecisionProblem).join("\n")],
      ["confirmed", checks.length === 0 ? yes : ""],
    ]);
  });
  const skipped =
    file.skipped.length === 0
      ? []
      : [
          "",
          `## ${renderCopy(text.skippedHead)}`,
          "",
          renderCopy(text.skippedIntro),
          "",
          ...file.skipped.map((skip) =>
            checklistLine(
              renderCopy(text.skippedLine, {
                line: skip.line,
                text: describeLegacyDecisionSkip(skip),
              }),
            ),
          ),
        ];
  const title = migrateFile.decisions.replace(/\.md$/u, "");
  return [
    `# ${title}`,
    "",
    renderCopy(text.decisionsIntro),
    "",
    ...tableLines(decisionColumns, cells),
    ...skipped,
    "",
  ].join("\n");
}

const positiveInt = (value: string) => (/^[1-9]\d*$/u.test(value) ? Number(value) : undefined);

function decisionRow(cell: ReadonlyMap<DecisionColumn, string>): {
  item?: ImportDecision;
  checks: string[];
} {
  const get = (key: DecisionColumn) => cell.get(key) ?? "";
  const t = text.decisions;
  const problems: LegacyDecisionProblem[] = [];
  const said: string[] = [];
  const id = positiveInt(get("id"));
  if (id === undefined) said.push(renderCopy(t.idInvalid, { text: get("id") }));
  const kind = decisionKind.key(get("kind"));
  if (kind === undefined) said.push(renderCopy(t.kindInvalid, { text: get("kind") }));
  if (get("decision") === "") problems.push({ kind: "textMissing", field: "decision" });
  if (get("reason") === "") problems.push({ kind: "textMissing", field: "reason" });
  if (kind === "decision" && get("case") === "") problems.push({ kind: "caseMissing" });
  const date = get("date");
  if (date === "") problems.push({ kind: "dateMissing" });
  else if (!datePattern.test(date)) problems.push({ kind: "dateInvalid", text: date });
  const status = decisionStatus.key(get("status"));
  if (status === undefined) said.push(renderCopy(t.statusInvalid, { text: get("status") }));
  const voidedText = get("voidedBy");
  const voidedBy = positiveInt(voidedText);
  if (voidedText !== "" && voidedBy === undefined) {
    said.push(renderCopy(t.voidedByInvalid, { text: voidedText }));
  } else if (status === "voided" && voidedBy === undefined) {
    problems.push({ kind: "voidedByMissing" });
  }
  const checks = [...problems.map(describeLegacyDecisionProblem), ...said];
  if (checks.length > 0 || id === undefined || kind === undefined || status === undefined) {
    return { checks };
  }
  const item: ImportDecision = {
    id,
    kind: decisionKind.label(kind),
    decision: get("decision"),
    reason: get("reason"),
    case: get("case"),
    date,
    status: decisionStatus.label(status),
    ...(voidedBy === undefined ? {} : { voidedBy }),
    ...(get("voidReason") === "" ? {} : { voidReason: get("voidReason") }),
  };
  return { item, checks: [] };
}

/** 读回决定迁移对照。 */
export function readDecisionsFile(content: string): MigrateRead<ImportDecision> {
  const t = text.decisions;
  const rows = readTable(content, decisionColumns);
  if (rows === undefined) {
    return { items: [], confirm: [renderCopy(t.noTable, { file: migrateFile.decisions })] };
  }
  const items: ImportDecision[] = [];
  const confirm: string[] = [];
  const unconfirmed: string[] = [];
  for (const row of rows) {
    const id = row.get("id") ?? "";
    const read = decisionRow(row);
    for (const said of read.checks) confirm.push(renderCopy(t.row, { id, text: said }));
    if (row.get("confirmed") !== yes) unconfirmed.push(id);
    if (read.item !== undefined) items.push(read.item);
  }
  if (unconfirmed.length > 0) {
    confirm.unshift(renderCopy(t.unconfirmed, { ids: unconfirmed.join("、") }));
  }
  const twice = duplicates(rows.map((row) => row.get("id") ?? ""));
  if (twice.length > 0) confirm.push(renderCopy(t.duplicate, { ids: twice.join("、") }));
  const open = readChecklist(content).open.length;
  if (open > 0) confirm.push(renderCopy(t.skipped, { file: migrateFile.decisions, count: open }));
  return { items, confirm };
}

// ---- 其他确认

/**
 * 别的检查项要确认的地方写进其他确认.md。新出现的补在末尾，勾上的不再列出。
 * 返回还没勾上的几条。
 */
export async function syncAcks(dir: string, lines: readonly string[]): Promise<Checklist> {
  const file = join(dir, migrateFile.acks);
  const before = (await readText(file)) ?? "";
  const list = readChecklist(before);
  const known = new Set([...list.open, ...list.done]);
  const added = lines.filter((line) => !known.has(line));
  if (added.length > 0) {
    const head =
      before === ""
        ? [`# ${migrateFile.acks.replace(/\.md$/u, "")}`, "", renderCopy(text.acksIntro), ""]
        : [before.replace(/\n*$/u, "")];
    await writeFile(file, [...head, ...added.map(checklistLine), ""].join("\n"));
  }
  const done = new Set(list.done);
  return { open: lines.filter((line) => !done.has(line)), done: list.done };
}

/** 文件不在时才写，返回写了没有。 */
export async function writeOnce(file: string, content: string): Promise<boolean> {
  if (await isFile(file)) return false;
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, content);
  return true;
}
