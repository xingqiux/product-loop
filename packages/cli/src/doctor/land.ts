import { join } from "node:path";
import { type LandPlanProblem, parseLandPlan } from "@product-loop/model";
import { isDir, listDir, readText } from "./files.ts";
import type { PageScan } from "./pages.ts";

// 迁移检查的落地记录一项，见「08 版本与迁移」第四节：land/ 下每一轮一个文件夹，导入成对应轮次的落地记录。
// 旧 land.py 在文件夹里记四样：计划.md、整理.json、功能改动的记录、评审.json。
// 功能改动的记录文件名沿用旧脚本，写在下面的常量里。这里只看记录齐不齐、对得上哪一轮，不补。

/** 旧 land.py 写的四个文件。 */
const planFile = "计划.md";
const tidyFile = "整理.json";
const changesFile = "改行为.json";
const reviewFile = "评审.json";
const knownFiles: ReadonlySet<string> = new Set([planFile, tidyFile, changesFile, reviewFile]);

/**
 * 一轮记录不全的地方。旧 land.py 的 status 查的就是这几样。
 * - plan：计划.md 没有，或者七节不齐。problems 空着表示没有这个文件。
 * - tidyMissing：没有重构的记录，也没有写跳过。
 * - changesMissing：一件功能改动的记录都没有。
 * - redOnly：这几件只有失败、没有通过。greenOnly：这几件没有先失败的记录。
 * - reviewMissing：没有评审的记录。
 * - badFile：这个文件不是合法的 JSON，或者格式不对。
 */
export type LandIssue =
  | { readonly kind: "plan"; readonly problems: readonly LandPlanProblem[] }
  | { readonly kind: "tidyMissing" | "changesMissing" | "reviewMissing" }
  | { readonly kind: "redOnly" | "greenOnly"; readonly names: readonly string[] }
  | { readonly kind: "badFile"; readonly file: string };

/** land/ 下的一轮。 */
type LandScan = {
  /** 文件夹的名字，就是旧的落地轮号，例如 13。 */
  readonly name: string;
  readonly issues: readonly LandIssue[];
  /** 记了几件功能改动。 */
  readonly changes: number;
  /** 四个文件以外的，例如 对照.html、对照图/、场景.md，随记录进归档。 */
  readonly extra: readonly string[];
  /** 对应的页面，写迁移前的文件名。空的表示没有对应的页面。 */
  readonly pages: readonly string[];
};

export type LandFinding = { readonly exists: boolean; readonly records: readonly LandScan[] };

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 读一个 JSON 文件。没有是 undefined，不是 JSON 时是 bad。 */
async function readJson(file: string): Promise<{ readonly value: unknown } | "bad" | undefined> {
  const text = await readText(file);
  if (text === undefined) return undefined;
  try {
    return { value: JSON.parse(text) };
  } catch {
    return "bad";
  }
}

async function planIssues(dir: string): Promise<LandIssue[]> {
  const text = await readText(join(dir, planFile));
  if (text === undefined) return [{ kind: "plan", problems: [] }];
  const plan = parseLandPlan(text);
  return plan.ok ? [] : [{ kind: "plan", problems: plan.error }];
}

async function changeIssues(dir: string): Promise<{ issues: LandIssue[]; changes: number }> {
  const read = await readJson(join(dir, changesFile));
  if (read === undefined) return { issues: [{ kind: "changesMissing" }], changes: 0 };
  if (read === "bad" || !isRecord(read.value)) {
    return { issues: [{ kind: "badFile", file: changesFile }], changes: 0 };
  }
  const entries = Object.entries(read.value);
  const has = (record: unknown, step: string) => isRecord(record) && isRecord(record[step]);
  const redOnly = entries.filter(([, r]) => has(r, "red") && !has(r, "green")).map(([n]) => n);
  const greenOnly = entries.filter(([, r]) => !has(r, "red")).map(([n]) => n);
  const issues: LandIssue[] = [];
  if (entries.length === 0) issues.push({ kind: "changesMissing" });
  if (redOnly.length > 0) issues.push({ kind: "redOnly", names: redOnly });
  if (greenOnly.length > 0) issues.push({ kind: "greenOnly", names: greenOnly });
  return { issues, changes: entries.length };
}

async function scanRecord(landDir: string, name: string): Promise<Omit<LandScan, "pages">> {
  const dir = join(landDir, name);
  const issues = await planIssues(dir);
  const tidy = await readJson(join(dir, tidyFile));
  if (tidy === undefined) issues.push({ kind: "tidyMissing" });
  else if (tidy === "bad" || !isRecord(tidy.value))
    issues.push({ kind: "badFile", file: tidyFile });
  const changes = await changeIssues(dir);
  issues.push(...changes.issues);
  const review = await readJson(join(dir, reviewFile));
  if (review === undefined) issues.push({ kind: "reviewMissing" });
  else if (review === "bad" || !Array.isArray(review.value)) {
    issues.push({ kind: "badFile", file: reviewFile });
  }
  const extra = (await listDir(dir))
    .filter((entry) => !knownFiles.has(entry.name))
    .map((entry) => (entry.dir ? `${entry.name}/` : entry.name));
  return { name, issues, changes: changes.changes, extra };
}

/**
 * land/<n>/ 对应哪几页。先找文件名是 land-n 的页，例如 skill 自己的 land-15 和 land-15-plan。
 * 没有时，找数据里阶段写「落地」、轮号是 n 的页，例如鹿鸣按日期文件夹编的 report-1。
 * 写「修复」的页早于 land/ 文件夹，不算。
 */
function pagesOf(name: string, pages: readonly PageScan[]): string[] {
  const n = /^[1-9]\d*$/u.test(name) ? Number(name) : undefined;
  if (n === undefined) return [];
  const byName = pages.filter((page) => page.round.prefix === "land" && page.round.n === n);
  const found =
    byName.length > 0
      ? byName
      : pages.filter(
          ({ result }) =>
            result.kind === "converted" && result.oldStage === "落地" && result.round === n,
        );
  return found.map((page) => page.legacyId);
}

/** 看 land/ 下的每一轮。pages 是 walk/ 下的页面，用来对上是哪一轮。 */
export async function scanLand(landDir: string, pages: readonly PageScan[]): Promise<LandFinding> {
  if (!(await isDir(landDir))) return { exists: false, records: [] };
  const records: LandScan[] = [];
  const dirs = (await listDir(landDir)).filter((entry) => entry.dir);
  // 按轮号排，不是数字的排在后面
  dirs.sort(
    (a, b) =>
      (Number(a.name) || Number.MAX_SAFE_INTEGER) - (Number(b.name) || Number.MAX_SAFE_INTEGER),
  );
  for (const entry of dirs) {
    const record = await scanRecord(landDir, entry.name);
    records.push({ ...record, pages: pagesOf(entry.name, pages) });
  }
  return { exists: true, records };
}
