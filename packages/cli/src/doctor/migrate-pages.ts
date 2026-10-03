import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  convertLegacyPage,
  type ErrorBody,
  type Issue,
  type LegacyPageContext,
  ok,
  parseLegacyRoundId,
  type Result,
  renderCopy,
  type Stage,
  type StageLabel,
  stage,
} from "@product-loop/model";
import { doctorCopy } from "../copy/doctor.ts";
import { jsonSyntaxError } from "../project/json-error.ts";
import { imagePattern, isFile, readText } from "./files.ts";
import { writeOnce } from "./migrate-files.ts";
import type { PagesFinding } from "./pages.ts";

// 旧页面的迁移对照：每一页一份，写在 migrate/pages/，见「08 版本与迁移」第五节。
// 文件名是日期文件夹加旧文件名，例如 2026-09-20_think-27.json。里面写迁移前的文件名、归到的阶段、阶段名、日期，
// 和转成当前格式的页面数据。只有网页的一页写「快照」。转不了的，页面数据留空，写明原因。
// 每次迁移检查都按历史页面模式校验一遍，仍被拦截的写进同名的 .报错.md，改好以后自动删掉。

const text = doctorCopy.migrate.pages;

/** 文件里的几个键。文件是给 AI 看、改的，键写中文。 */
const key = {
  legacyId: "迁移前的文件名",
  file: "文件",
  round: "归到的阶段",
  stage: "阶段名",
  date: "日期",
  data: "页面数据",
  snapshot: "快照",
  reason: "转不了的原因",
} as const;

/** 早先写的对照文件用的键，读的时候也认，写只写上面的新键。 */
const oldKey = { legacyId: "旧编号", round: "轮", stage: "阶段" } as const;

export const pagesDirName = "pages";

/** 读回来的一页。 */
export type MigratedPage = {
  readonly legacyId: string;
  /** 相对 walk/ 的旧文件。 */
  readonly file: string;
  /** 所在的日期文件夹。 */
  readonly folder: string;
  /** 归到的阶段，同一个阶段的几页写相同的字。 */
  readonly round: string;
  readonly stage: Stage;
  readonly date: string;
  /** 转好的页面数据，只有网页的一页没有。 */
  readonly data?: unknown;
};

/** 历史页面模式的校验，由后端做：POST /legacy/pages/check。 */
export type PageChecker = (input: {
  readonly stage: StageLabel;
  readonly pageDate: string;
  readonly data: unknown;
}) => Promise<Result<{ readonly block: readonly Issue[] }, ErrorBody>>;

/** 迁移对照里的文件名：2026-09-20/think-27.json 写成 2026-09-20_think-27.json。 */
const pageFileName = (path: string) =>
  `${path.replace(/\.(?:json|html)$/u, "").replaceAll("/", "_")}.json`;

const reportName = (name: string) => name.replace(/\.json$/u, ".报错.md");

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** 阶段的写法：日期文件夹加前缀和次数，和迁移检查归阶段的相同。 */
function roundOf(pages: PagesFinding, path: string): string {
  return pages.rounds.find((round) => round.pages.includes(path))?.key ?? path;
}

const pageText = (entries: readonly (readonly [string, unknown])[]) =>
  `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;

/** 写出还没有的几页，返回写了几份。已经有的不动，AI 改过的内容以它为准。 */
export async function writeMigratePages(
  dir: string,
  walkDir: string,
  pages: PagesFinding,
  context: LegacyPageContext,
): Promise<number> {
  let written = 0;
  for (const page of pages.pages) {
    const common = [
      [key.legacyId, page.legacyId],
      [key.file, page.path],
      [key.round, roundOf(pages, page.path)],
    ] as const;
    let entries: (readonly [string, unknown])[];
    const old = (await readText(join(walkDir, page.path))) ?? "";
    let parsed: unknown;
    let reason: string | undefined;
    try {
      parsed = JSON.parse(old);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
    const converted = reason === undefined ? convertLegacyPage(parsed, context) : undefined;
    if (converted?.ok === true) {
      const { value } = converted;
      entries = [
        ...common,
        [key.stage, stage.label(value.stage)],
        [key.date, value.date ?? page.folder],
        [key.data, value.page],
      ];
    } else {
      const guess = page.round.stage;
      entries = [
        ...common,
        [key.stage, guess === undefined ? "" : stage.label(guess)],
        [key.date, page.folder],
        [key.data, null],
        [key.reason, converted === undefined ? reason : converted.error.message],
      ];
    }
    if (await writeOnce(join(dir, pageFileName(page.path)), pageText(entries))) written++;
  }
  for (const page of pages.htmlOnly) {
    const name = page.path.slice(page.folder.length + 1).replace(/\.html$/u, "");
    const entries = [
      [key.legacyId, name],
      [key.file, page.path],
      [key.round, roundOf(pages, page.path)],
      [key.stage, page.stage === undefined ? "" : stage.label(page.stage)],
      [key.date, page.folder],
      [key.snapshot, true],
    ] as const;
    if (await writeOnce(join(dir, pageFileName(page.path)), pageText(entries))) written++;
  }
  return written;
}

/** 页面数据里的截图：img 一格，不是网址的，路径相对日期文件夹。 */
export function pageImages(value: unknown, field = ""): string[] {
  if (typeof value === "string") {
    const path = value.trim();
    return field === "img" && imagePattern.test(path) && !/^https?:/u.test(path) ? [path] : [];
  }
  if (Array.isArray(value)) return [...new Set(value.flatMap((item) => pageImages(item, field)))];
  if (typeof value === "object" && value !== null) {
    return [...new Set(Object.entries(value).flatMap(([name, item]) => pageImages(item, name)))];
  }
  return [];
}

type ReadOne = { readonly page?: MigratedPage; readonly confirm: readonly string[] };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readOne(
  dir: string,
  name: string,
  walkDir: string,
  check: PageChecker,
): Promise<Result<ReadOne, ErrorBody>> {
  const shown = `${pagesDirName}/${name}`;
  const content = (await readText(join(dir, name))) ?? "";
  let doc: unknown;
  try {
    doc = JSON.parse(content);
  } catch {
    const at = jsonSyntaxError(content);
    const said =
      at === undefined
        ? renderCopy(text.syntaxNoAt, { file: shown })
        : renderCopy(text.syntax, { file: shown, ...at });
    return ok({ confirm: [said] });
  }
  const field = (name: string) => (isRecord(doc) ? doc[name] : undefined);
  /** 键写新的，没有时再看早先的键。 */
  const textOf = (name: string, old?: string) => {
    const value = field(name) ?? (old === undefined ? undefined : field(old));
    return typeof value === "string" ? value : "";
  };
  const stageKey = stage.key(textOf(key.stage, oldKey.stage));
  const date = textOf(key.date);
  const file = textOf(key.file);
  const legacyId = textOf(key.legacyId, oldKey.legacyId);
  const round = textOf(key.round, oldKey.round);
  const missing = (
    [
      [key.legacyId, legacyId],
      [key.file, file],
      [key.round, round],
    ] as const
  ).find(([, value]) => value === "")?.[0];
  const bad =
    missing ??
    (stageKey === undefined ? key.stage : undefined) ??
    (datePattern.test(date) ? undefined : key.date);
  if (bad !== undefined || stageKey === undefined) {
    return ok({ confirm: [renderCopy(text.shape, { file: shown, field: bad ?? key.stage })] });
  }
  const base = {
    legacyId,
    file,
    folder: file.split("/")[0] ?? "",
    round,
    stage: stageKey,
    date,
  };
  if (field(key.snapshot) === true) return ok({ page: base, confirm: [] });
  const data = field(key.data);
  if (!isRecord(data)) {
    const reason = textOf(key.reason);
    return ok({ confirm: [renderCopy(text.noData, { file: shown, reason })] });
  }
  const confirm: string[] = [];
  const report = join(dir, reportName(name));
  const checked = await check({ stage: stage.label(stageKey), pageDate: date, data });
  if (!checked.ok) return checked;
  const { block } = checked.value;
  if (block.length > 0) {
    const t = doctorCopy.migrate;
    const lines = block.map((issue) =>
      renderCopy(t.reportLine, { where: issue.where ?? "", message: issue.message }),
    );
    const head = `# ${renderCopy(t.reportHead, { file: name })}`;
    await writeFile(report, [head, "", ...lines.map((line) => `- ${line}`), ""].join("\n"));
    const reportShown = `${pagesDirName}/${reportName(name)}`;
    confirm.push(
      renderCopy(text.blocked, { file: shown, count: block.length, report: reportShown }),
    );
  } else await rm(report, { force: true });
  const missingImages: string[] = [];
  for (const image of pageImages(data)) {
    if (!(await isFile(join(walkDir, base.folder, image)))) missingImages.push(image);
  }
  if (missingImages.length > 0) {
    confirm.push(renderCopy(text.images, { file: shown, images: missingImages.join("、") }));
  }
  return ok({ page: { ...base, data }, confirm });
}

/**
 * 读回 pages/ 下的每一页，逐页校验。expected 是迁移检查在 walk/ 下找到的页，少了的要确认。
 * 后端校验失败时整个返回失败。
 */
export async function readMigratePages(
  dir: string,
  walkDir: string,
  expected: readonly string[],
  check: PageChecker,
): Promise<Result<{ pages: MigratedPage[]; confirm: string[] }, ErrorBody>> {
  let names: string[];
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    names = [];
  }
  const pages: MigratedPage[] = [];
  const confirm: string[] = [];
  for (const name of names) {
    const read = await readOne(dir, name, walkDir, check);
    if (!read.ok) return read;
    if (read.value.page !== undefined) pages.push(read.value.page);
    confirm.push(...read.value.confirm);
  }
  const present = new Set(names);
  const missing = expected.map(pageFileName).filter((name) => !present.has(name));
  if (missing.length > 0) {
    const files = missing.map((name) => `${pagesDirName}/${name}`).join("、");
    confirm.push(renderCopy(text.missing, { files }));
  }
  const stages = new Map<string, Set<Stage>>();
  for (const page of pages) {
    stages.set(page.round, (stages.get(page.round) ?? new Set()).add(page.stage));
  }
  for (const [round, set] of stages) {
    if (set.size > 1) confirm.push(renderCopy(text.mixed, { round }));
  }
  return ok({ pages, confirm });
}

/** 阶段在同一天里的先后：迁移前的文件名里的次数，看不出时排在后面。 */
export function roundNumber(round: string): number {
  const name = round.split("/").at(-1) ?? "";
  const parsed = parseLegacyRoundId(name);
  return parsed.ok ? parsed.value.n : Number.MAX_SAFE_INTEGER;
}
