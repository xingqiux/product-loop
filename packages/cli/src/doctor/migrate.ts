import { join } from "node:path";
import {
  type ErrorBody,
  type LegacyImportBody,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { doctorCopy } from "../copy/doctor.ts";
import { readText } from "./files.ts";
import { checkOf, type DoctorCheck, type DoctorItem } from "./items.ts";
import {
  decisionsFileText,
  type MigrateRead,
  migrateDirOf,
  migrateFile,
  queueFileText,
  readDecisionsFile,
  readQueueFile,
  syncAcks,
  writeOnce,
} from "./migrate-files.ts";
import {
  type MigratedPage,
  type PageChecker,
  pagesDirName,
  readMigratePages,
  roundNumber,
  writeMigratePages,
} from "./migrate-pages.ts";
import type { DoctorScan } from "./scan.ts";

// 迁移检查的第 1、2 步：写迁移对照，再读回来，按它列出要确认的地方，见「08 版本与迁移」第四节。
// 还没迁移、找到了旧文件时才写。决定、队列、旧页面三项要确认的地方改由迁移对照给出：
// AI 改好对照，这三项就不再列出。别的检查项要确认的地方写进其他确认.md，勾上就不再列出。
// 忽略规则看不出仓库类别时，要问用户，由 --repo 给出，不进清单。

type ImportQueueItem = LegacyImportBody["queue"][number];
type ImportDecision = LegacyImportBody["decisions"][number];

export type MigrateState = {
  readonly dir: string;
  /** 这次新写的文件。 */
  readonly written: readonly string[];
  readonly queue?: MigrateRead<ImportQueueItem>;
  readonly decisions?: MigrateRead<ImportDecision>;
  readonly pages: { readonly pages: readonly MigratedPage[]; readonly confirm: readonly string[] };
};

/**
 * 这次要不要迁移：找到了旧文件，project.json 还没写好。
 * project.json 写好了但 migrate/ 还在，是上次 --fix 在清理前停下了，也要接着做。
 */
const needsMigration = (scan: DoctorScan) =>
  scan.location.source !== undefined && (scan.identity.kind !== "valid" || scan.cache.migrate);

/** 写出还没有的迁移对照，再全部读回来。不用迁移时返回 undefined。 */
export async function prepareMigrate(
  scan: DoctorScan,
  check: PageChecker,
): Promise<Result<MigrateState | undefined, ErrorBody>> {
  const source = scan.location.source;
  if (source === undefined || !needsMigration(scan)) return ok(undefined);
  const dir = migrateDirOf(scan.root);
  const written: string[] = [];
  const { queue, decisions } = scan;
  const queueFile = join(dir, migrateFile.queue);
  const queueRows = queue.kind === "found" && queue.syntax === undefined ? queue.table.rows : [];
  if (queue.kind === "found" && queue.syntax === undefined) {
    if (await writeOnce(queueFile, queueFileText(queueRows))) written.push(migrateFile.queue);
  }
  const decisionsFile = join(dir, migrateFile.decisions);
  if (
    decisions.kind === "found" &&
    (await writeOnce(decisionsFile, decisionsFileText(decisions.file)))
  ) {
    written.push(migrateFile.decisions);
  }
  const walkDir = join(source.dir, "walk");
  const pagesDir = join(dir, pagesDirName);
  const count = await writeMigratePages(pagesDir, walkDir, scan.pages, scan.pageContext);
  if (count > 0) written.push(renderCopy(doctorCopy.migrate.pagesWritten, { count }));

  const queueText = await readText(queueFile);
  const decisionsText = await readText(decisionsFile);
  const expected = [...scan.pages.pages, ...scan.pages.htmlOnly].map((page) => page.path);
  const pages = await readMigratePages(pagesDir, walkDir, expected, check);
  if (!pages.ok) return pages;
  return ok({
    dir,
    written,
    ...(queueText === undefined ? {} : { queue: readQueueFile(queueText, queueRows) }),
    ...(decisionsText === undefined ? {} : { decisions: readDecisionsFile(decisionsText) }),
    pages: pages.value,
  });
}

/** 由迁移对照接管要确认的地方的三项。 */
const tableItems: ReadonlySet<DoctorItem> = new Set(["decisions", "queue", "pages"]);

/** 页面数据以外的截图挂到哪一轮时，没有轮可挂的要确认。 */
function pagesConfirm(scan: DoctorScan, state: MigrateState): string[] {
  const lines = [...state.pages.confirm];
  if (state.pages.pages.length === 0 && scan.pages.images > 0) {
    lines.push(renderCopy(doctorCopy.migrate.noImageRound, { count: scan.pages.images }));
  }
  return lines;
}

/** 按迁移对照改写各项要确认的地方，别的写进其他确认.md。 */
export async function applyMigrate(
  scan: DoctorScan,
  checks: readonly DoctorCheck[],
  state: MigrateState,
): Promise<DoctorCheck[]> {
  const others = checks
    .filter((check) => !tableItems.has(check.item) && check.item !== "ignore")
    .flatMap((check) => check.confirm);
  const acks = await syncAcks(state.dir, others);
  const open = new Set(acks.open);
  return checks.map((check) => {
    let confirm: readonly string[];
    if (check.item === "decisions" && state.decisions !== undefined) {
      confirm = state.decisions.confirm;
    } else if (check.item === "queue" && state.queue !== undefined) {
      confirm = state.queue.confirm;
    } else if (check.item === "pages") {
      confirm = pagesConfirm(scan, state);
    } else if (tableItems.has(check.item) || check.item === "ignore") {
      confirm = check.confirm;
    } else confirm = check.confirm.filter((line) => open.has(line));
    if (confirm === check.confirm) return check;
    return checkOf(check.item, { found: check.found, fix: check.fix, confirm }, quietOf(check));
  });
}

/** 没有要确认、要迁移的行时原来的结论。 */
const quietOf = (check: DoctorCheck) =>
  check.status === "confirm" || check.status === "fix" ? "ok" : check.status;

// ---- 导入的轮次

/** 一轮：阶段、日期和几页，按导入的先后排好。 */
export type PlannedRound = {
  readonly legacyId: string;
  readonly key: string;
  readonly stage: MigratedPage["stage"];
  readonly date: string;
  /** 所在的日期文件夹。 */
  readonly folder: string;
  readonly pages: readonly MigratedPage[];
};

/**
 * 把读回来的页按「轮」归在一起，按日期、同一天按旧轮号排先后，见第五节。
 * 迁移前的文件名去掉日期文件夹。几轮去掉以后重名，或者页的迁移前的文件名带着文件夹时，保留文件夹。
 */
export function planRounds(pages: readonly MigratedPage[]): PlannedRound[] {
  const groups = new Map<string, MigratedPage[]>();
  for (const page of pages) groups.set(page.round, [...(groups.get(page.round) ?? []), page]);
  const bare = (key: string) => key.split("/").slice(1).join("/") || key;
  const names = [...groups.keys()].map(bare);
  const rounds = [...groups].map(([key, list]) => {
    const [first] = list;
    if (first === undefined) throw new Error("一轮里没有页。");
    const date = list.map((page) => page.date).sort()[0] ?? first.date;
    const name = bare(key);
    const keepFolder =
      names.filter((other) => other === name).length > 1 ||
      list.some((page) => page.legacyId.includes("/")) ||
      !key.includes("/");
    return {
      legacyId: keepFolder ? key : name,
      key,
      stage: first.stage,
      date,
      folder: first.folder,
      pages: list,
    };
  });
  return rounds.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      roundNumber(a.key) - roundNumber(b.key) ||
      a.key.localeCompare(b.key),
  );
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * walk/ 下的截图和事实文件挂到哪一轮，见第五节。
 * - 页面引用的，挂在那一页的轮上。
 * - 日期文件夹里的，挂在这个文件夹最后一轮上。文件夹里没有轮的，挂在之前最近的一轮，没有就是第一轮。
 * - 不在日期文件夹里的，挂在最后一轮。
 * 返回每一轮的文件，路径相对 walk/。没有轮时是空的。
 */
export function assignRoundFiles(
  rounds: readonly PlannedRound[],
  files: readonly string[],
  referenced: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const out = new Map<string, string[]>(rounds.map((round) => [round.key, []]));
  const last = rounds.at(-1);
  if (last === undefined) return out;
  const byFolder = new Map<string, string>();
  for (const round of rounds) byFolder.set(round.folder, round.key);
  for (const file of files) {
    const folder = file.split("/")[0] ?? "";
    let key = referenced.get(file) ?? byFolder.get(folder);
    if (key === undefined && datePattern.test(folder) && file.includes("/")) {
      const before = rounds.filter((round) => round.date <= folder).at(-1);
      key = (before ?? rounds[0] ?? last).key;
    }
    out.get(key ?? last.key)?.push(file);
  }
  return out;
}
