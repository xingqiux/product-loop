import { join } from "node:path";
import {
  convertLegacyPage,
  type LegacyPageContext,
  type LegacyRoundId,
  parseLegacyRoundId,
  type Stage,
} from "@product-loop/model";
import { jsonSyntaxError, type TextPosition } from "../project/json-error.ts";
import { imagePattern, isDir, isFile, listFiles, readText } from "./files.ts";

// 迁移检查的旧页面一项，见「08 版本与迁移」第四节和第五节。
// walk/<日期>/ 下每一轮一份页面数据，文件名就是迁移前的文件名，例如 think-27.json、land-15-plan.json。
// 每一页先用转换函数转一遍，数出能直接导入的和还有要改的。
// 只有网页、没有数据的存成快照。页面里引用的截图要在，使用阶段的事实文件随截图进附件库。
// walk/ 里别的文件，例如探测脚本和生成脚本，只进归档。

/** 一页页面数据转换的结果。 */
type PageResult =
  | {
      readonly kind: "converted";
      readonly stage: Stage;
      /** 数据里原样写的阶段，例如「修复」。 */
      readonly oldStage: string;
      /** 数据里的日期和轮号，没写或写法不对时没有。 */
      readonly date?: string;
      readonly round?: number;
      /** 转换以后还要改的地方有几处，0 表示可以直接导入。 */
      readonly problems: number;
    }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "syntax"; readonly at?: TextPosition };

/** walk/ 下的一页页面数据。 */
export type PageScan = {
  /** 相对 walk/ 的路径，例如 2026-09-20/think-27.json。 */
  readonly path: string;
  /** 所在的日期文件夹。 */
  readonly folder: string;
  /** 迁移前的文件名。数据里的日期和文件夹对不上时带上文件夹，例如 2026-09-21/report-11。 */
  readonly legacyId: string;
  readonly round: LegacyRoundId;
  /** 同一个文件夹里有同名的网页。 */
  readonly html: boolean;
  readonly result: PageResult;
  /** 页面引用的截图：引用了几张，找不到的是哪几张。 */
  readonly images: { readonly referenced: number; readonly missing: readonly string[] };
};

/** 只有网页、没有页面数据的一页，迁移时存成快照。 */
type HtmlOnlyPage = {
  readonly path: string;
  readonly folder: string;
  /** 文件名是迁移前的文件名的写法时有。 */
  readonly round?: LegacyRoundId;
  /** 从迁移前的文件名看得出的阶段。report 开头的看不出。 */
  readonly stage?: Stage;
  /** 网页里嵌着页面数据，旧模板的 report-data。 */
  readonly embedsData: boolean;
};

/** 同一轮的几页，例如 land-15-plan 和 land-15。按日期文件夹、前缀和轮号归在一起。 */
type RoundGroup = {
  readonly key: string;
  /** 这一轮几页写的阶段，去掉重复。空的表示看不出。 */
  readonly stages: readonly Stage[];
  readonly pages: readonly string[];
};

export type PagesFinding = {
  /** 有 walk/ 文件夹。 */
  readonly exists: boolean;
  readonly pages: readonly PageScan[];
  readonly htmlOnly: readonly HtmlOnlyPage[];
  readonly rounds: readonly RoundGroup[];
  /** walk/ 下的截图和图片的张数。 */
  readonly images: number;
  /** 日期文件夹里不是页面数据的 JSON，例如 facts.json、use.json，随截图进附件库。 */
  readonly facts: readonly string[];
  /** 别的文件，例如探测脚本、生成脚本、评审的文字，只进归档。 */
  readonly others: readonly string[];
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/u;

/** 旧模板把页面数据嵌在网页里的写法。 */
const embeddedData = '<script id="report-data"';

type JsonRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 页面数据里写的截图路径：src 一格，不是网址的。 */
function imageRefs(value: unknown, key = ""): string[] {
  if (typeof value === "string") {
    const text = value.trim();
    return key === "src" && imagePattern.test(text) && !/^https?:/u.test(text) ? [text] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => imageRefs(item, key));
  if (isRecord(value))
    return Object.entries(value).flatMap(([name, item]) => imageRefs(item, name));
  return [];
}

async function scanImages(dir: string, old: unknown): Promise<PageScan["images"]> {
  const refs = [...new Set(imageRefs(old))];
  const missing: string[] = [];
  for (const ref of refs) if (!(await isFile(join(dir, ref)))) missing.push(ref);
  return { referenced: refs.length, missing };
}

async function scanPage(
  walkDir: string,
  folder: string,
  name: string,
  round: LegacyRoundId,
  html: boolean,
  context: LegacyPageContext,
): Promise<PageScan> {
  const path = `${folder}/${name}.json`;
  const base = { path, folder, round, html };
  const text = (await readText(join(walkDir, path))) ?? "";
  let old: unknown;
  try {
    old = JSON.parse(text);
  } catch {
    const at = jsonSyntaxError(text);
    const result: PageResult = at === undefined ? { kind: "syntax" } : { kind: "syntax", at };
    return { ...base, legacyId: name, result, images: { referenced: 0, missing: [] } };
  }
  const images = await scanImages(join(walkDir, folder), old);
  const converted = convertLegacyPage(old, context);
  if (!converted.ok) {
    const result: PageResult = { kind: "failed", message: converted.error.message };
    return { ...base, legacyId: name, result, images };
  }
  const { stage, date, round: seq, problems } = converted.value;
  const oldStage = isRecord(old) && typeof old.stage === "string" ? old.stage : "";
  const result: PageResult = {
    kind: "converted",
    stage,
    oldStage,
    ...(date === undefined ? {} : { date }),
    ...(seq === undefined ? {} : { round: seq }),
    problems: problems.length,
  };
  // 数据里的日期和文件夹对不上时，以数据为准，文件夹记进迁移前的文件名（第五节）
  const legacyId = date !== undefined && date !== folder ? `${folder}/${name}` : name;
  return { ...base, legacyId, result, images };
}

async function scanHtml(walkDir: string, folder: string, name: string): Promise<HtmlOnlyPage> {
  const path = `${folder}/${name}.html`;
  const round = parseLegacyRoundId(name);
  const text = (await readText(join(walkDir, path))) ?? "";
  const stage = round.ok ? round.value.stage : undefined;
  return {
    path,
    folder,
    ...(round.ok ? { round: round.value } : {}),
    ...(stage === undefined ? {} : { stage }),
    embedsData: text.includes(embeddedData),
  };
}

/** 页面归到的轮：同一个日期文件夹、同一个前缀和轮号。文件名不是迁移前的文件名的，单独算一轮。 */
function roundKey(folder: string, name: string, round: LegacyRoundId | undefined): string {
  return round === undefined ? `${folder}/${name}` : `${folder}/${round.prefix}-${round.n}`;
}

function groupRounds(pages: readonly PageScan[], htmlOnly: readonly HtmlOnlyPage[]): RoundGroup[] {
  const groups = new Map<string, { stages: Stage[]; pages: string[] }>();
  const add = (key: string, stage: Stage | undefined, page: string) => {
    const group = groups.get(key) ?? { stages: [], pages: [] };
    if (stage !== undefined && !group.stages.includes(stage)) group.stages.push(stage);
    group.pages.push(page);
    groups.set(key, group);
  };
  for (const page of pages) {
    const stage = page.result.kind === "converted" ? page.result.stage : page.round.stage;
    add(roundKey(page.folder, "", page.round), stage, page.path);
  }
  for (const page of htmlOnly) {
    const name = page.path.slice(page.folder.length + 1).replace(/\.html$/u, "");
    add(roundKey(page.folder, name, page.round), page.stage, page.path);
  }
  return [...groups].map(([key, group]) => ({ key, ...group }));
}

/** 看 walk/ 下的全部文件。context 是转换旧页面时用的队列和场景对照。 */
export async function scanPages(
  walkDir: string,
  context: LegacyPageContext,
): Promise<PagesFinding> {
  if (!(await isDir(walkDir))) {
    return { exists: false, pages: [], htmlOnly: [], rounds: [], images: 0, facts: [], others: [] };
  }
  const files = await listFiles(walkDir);
  const all = new Set(files);
  const pages: PageScan[] = [];
  const htmlOnly: HtmlOnlyPage[] = [];
  const facts: string[] = [];
  const others: string[] = [];
  let images = 0;
  for (const path of files) {
    if (imagePattern.test(path)) {
      images++;
      continue;
    }
    const [folder = "", ...rest] = path.split("/");
    const inDateFolder = datePattern.test(folder) && rest.length > 0;
    const file = rest.join("/");
    const json = /^(.*)\.json$/u.exec(file);
    const html = /^(.*)\.html$/u.exec(file);
    // 页面数据和网页直接放在日期文件夹里，文件名是迁移前的文件名
    const round = rest.length === 1 ? parseLegacyRoundId(json?.[1] ?? html?.[1] ?? "") : undefined;
    if (inDateFolder && json !== null && round?.ok === true) {
      const name = json[1] ?? "";
      const hasHtml = all.has(`${folder}/${name}.html`);
      pages.push(await scanPage(walkDir, folder, name, round.value, hasHtml, context));
    } else if (inDateFolder && html !== null && rest.length === 1) {
      const name = html[1] ?? "";
      if (!all.has(`${folder}/${name}.json`)) htmlOnly.push(await scanHtml(walkDir, folder, name));
    } else if (inDateFolder && json !== null && rest.length === 1) facts.push(path);
    else others.push(path);
  }
  return {
    exists: true,
    pages,
    htmlOnly,
    rounds: groupRounds(pages, htmlOnly),
    images,
    facts,
    others,
  };
}
