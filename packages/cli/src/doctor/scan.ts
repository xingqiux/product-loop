import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import {
  coverageFileName,
  type Issue,
  issuesOf,
  type LegacyDecisionFile,
  type LegacyPageContext,
  type LegacyQueueTable,
  type ProjectIdentity,
  parseLegacyDecisions,
  parseLegacyQueueTable,
  projectCacheDirName,
  projectIdentityFileName,
  type RepoKind,
  readLegacyQueueJson,
  useCodeDir,
} from "@product-loop/model";
import packageJson from "../../package.json" with { type: "json" };
import { readProjectIdentity } from "../project/identity.ts";
import { jsonSyntaxError, type TextPosition } from "../project/json-error.ts";
import { findOldLayouts, type OldLayout } from "../project/old-layout.ts";
import { isDir, isFile, listDir, listFiles, readText } from "./files.ts";
import { type GitProbe, type GitRepo, gitProbe, type IgnoreRule } from "./git.ts";
import { type LandFinding, scanLand } from "./land.ts";
import { type MainlineFinding, scanMainline } from "./mainline.ts";
import { type PagesFinding, scanPages } from "./pages.ts";

// 迁移检查的扫描：对一个项目根目录，按「08 版本与迁移」第四节的十二个检查项逐项看，收成一份结果。
// 只读，不改项目里原有的文件，也不碰集中存储。项目登记了没有、缓存和集中存储是否一致，
// 要问后端的部分由以后接上命令的一步补上（第一期计划第 60 到 62 步）。
// 旧文件在项目根以外时用 --from 指明，例如 skill 自己放在 iCloud 里的产品文档。

export type ScanOptions = {
  /** --from 指明的旧文件夹，绝对路径。 */
  readonly from?: string;
  /** 回答 git 的问题。默认用本机的 git。 */
  readonly git?: GitProbe;
  /** 这一版软件的版本，默认取命令行的版本号。 */
  readonly currentVersion?: string;
};

type IdentityFinding =
  | { readonly kind: "missing" }
  | { readonly kind: "valid"; readonly identity: ProjectIdentity }
  | { readonly kind: "invalid"; readonly issues: readonly Issue[] };

/** 这次要迁移的旧文件在哪里。 */
type LegacySource = OldLayout & {
  /** 由 --from 指明。 */
  readonly viaFrom: boolean;
};

type LocationFinding = {
  /** 这次要迁移的旧文件。没有找到时没有。 */
  readonly source?: LegacySource;
  /** 另外找到的旧文件，和这一处不是同一份。 */
  readonly others: readonly OldLayout[];
  /** 项目根本身像旧 skill 的产品文档文件夹，应当到项目根目录用 --from 指明它。 */
  readonly rootIsFolder: boolean;
  /** --from 指的目录里没有旧文件。 */
  readonly fromEmpty: boolean;
  /** docs 布局时，docs/ 里项目自己的文档，不动。 */
  readonly ownDocs: readonly string[];
  /** 已提交进 git 的旧文件，路径相对旧文件的位置。 */
  readonly tracked: readonly string[];
  /** 旧文件里另一份旧 skill 的产品文档，路径相对旧文件的位置。 */
  readonly nested: readonly string[];
  /** 归档包要收的旧文件，路径相对旧文件的位置。 */
  readonly files: readonly string[];
};

type IgnoreFinding =
  | { readonly kind: "noRepo" }
  | { readonly kind: "ignored"; readonly repo: GitRepo; readonly rule: IgnoreRule }
  | { readonly kind: "notIgnored"; readonly repo: GitRepo; readonly repoKind?: RepoKind };

type DecisionsFinding =
  | { readonly kind: "missing" }
  | { readonly kind: "found"; readonly file: LegacyDecisionFile };

type QueueFinding =
  | { readonly kind: "missing" }
  | {
      readonly kind: "found";
      readonly format: "table" | "json";
      readonly table: LegacyQueueTable;
      /** 有 队列.json，另有一份旧的 队列.md。 */
      readonly alsoTable: boolean;
      /** 队列.json 不是合法的 JSON。知道位置时写行和列。 */
      readonly syntax?: { readonly at?: TextPosition };
    };

type UseCodeFinding = {
  /** 使用代码的文件夹，相对项目根。没有找到时没有。 */
  readonly dir?: string;
  readonly files: number;
  /** 覆盖表，相对项目根。 */
  readonly coverage?: string;
};

type SkillVersionFinding =
  /** 没有 project.json，也没有旧文件：还没有开工。 */
  | { readonly kind: "none" }
  /** 没有 project.json，有旧 skill 的文件：停在 1.x，旧 skill 没有版本号。 */
  | { readonly kind: "legacy" }
  /** project.json 写坏了，看不出版本。 */
  | { readonly kind: "unreadable" }
  | { readonly kind: "recorded"; readonly version: string; readonly old: boolean };

type CacheFinding =
  | { readonly kind: "notMigrated"; readonly migrate: boolean }
  | {
      readonly kind: "checked";
      /** 主线.md 和 project.json 记的基准比：一致、改过、没有文件、没有基准。 */
      readonly mainline: "same" | "changed" | "missing" | "noBase";
      /** 有 主线.远端.md，上次同步的冲突还没合并。 */
      readonly remote: boolean;
      /** rounds/ 下的工作区。 */
      readonly rounds: readonly string[];
      /** use/ 下的运行。 */
      readonly useRuns: readonly string[];
      readonly migrate: boolean;
    };

/** 一次迁移检查看到的全部情况，按第四节的检查项分。 */
export type DoctorScan = {
  readonly root: string;
  readonly from?: string;
  /** 这一版软件的版本。 */
  readonly currentVersion: string;
  readonly identity: IdentityFinding;
  readonly location: LocationFinding;
  readonly ignore: IgnoreFinding;
  readonly mainline: MainlineFinding;
  readonly decisions: DecisionsFinding;
  readonly queue: QueueFinding;
  readonly pages: PagesFinding;
  readonly land: LandFinding;
  readonly useCode: UseCodeFinding;
  readonly skillVersion: SkillVersionFinding;
  readonly cache: CacheFinding;
  /** 转换旧页面时用的队列和场景对照，写迁移对照时再用一次。 */
  readonly pageContext: LegacyPageContext;
};

// ---- 文件名

const mainlineFile = "主线.md";
const remoteMainlineFile = "主线.远端.md";
const decisionsFile = "决定.md";
const queueTableFile = "队列.md";
const queueJsonFile = "队列.json";
const migrateDir = "migrate";
/** 旧 skill 的文件和新的项目缓存里本来就有的，不是另一份旧文件夹。 */
const knownEntries: ReadonlySet<string> = new Set([
  "walk",
  "land",
  "migrate",
  "rounds",
  "use",
  "use-code",
]);
/** docs 布局里属于产品循环的几样，别的是项目自己的文档。 */
const recordEntries: ReadonlySet<string> = new Set([
  mainlineFile,
  decisionsFile,
  queueTableFile,
  queueJsonFile,
  "walk",
  "land",
]);

// ---- 身份

async function scanIdentity(root: string): Promise<IdentityFinding> {
  const file = join(root, projectCacheDirName, projectIdentityFileName);
  if (!(await isFile(file))) return { kind: "missing" };
  const read = await readProjectIdentity(file);
  return read.ok
    ? { kind: "valid", identity: read.value }
    : { kind: "invalid", issues: issuesOf(read.error) };
}

// ---- 位置

/** --from 时先找旧文件夹，再找项目缓存和 docs；不写 --from 时找项目根的项目缓存和 docs。 */
const fromOrder = ["folder", "projectCache", "docs"] as const;
const rootOrder = ["projectCache", "docs"] as const;

/** 只有 migrate/ 的项目缓存是上一次迁移检查写的，不算另一份旧文件。 */
const onlyMigrate = (layout: OldLayout) =>
  layout.entries.length === 1 && layout.entries[0] === `${migrateDir}/`;

function pick(
  layouts: readonly OldLayout[],
  order: readonly OldLayout["kind"][],
): OldLayout | undefined {
  for (const kind of order) {
    const found = layouts.find((layout) => layout.kind === kind);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 归档包收的旧文件。docs 布局只收产品循环的几样，别的整个文件夹都收，migrate/ 除外。 */
async function sourceFiles(source: OldLayout): Promise<string[]> {
  const files = await listFiles(source.dir);
  return files.filter((file) => {
    const [top = ""] = file.split("/");
    if (top === migrateDir) return false;
    return source.kind !== "docs" || recordEntries.has(top);
  });
}

/** 旧文件里另一份旧 skill 的产品文档，看两层，例如 Atlas 文档站的 archive/font-size-axes。 */
async function nestedFolders(source: OldLayout): Promise<string[]> {
  if (source.kind === "docs") return [];
  const nested: string[] = [];
  for (const entry of await listDir(source.dir)) {
    if (!entry.dir || knownEntries.has(entry.name)) continue;
    const dir = join(source.dir, entry.name);
    const here = await findOldLayouts(dir);
    if (here.some((layout) => layout.kind === "folder")) {
      nested.push(entry.name);
      continue;
    }
    for (const sub of await listDir(dir)) {
      if (!sub.dir) continue;
      const layouts = await findOldLayouts(join(dir, sub.name));
      if (layouts.some((layout) => layout.kind === "folder"))
        nested.push(`${entry.name}/${sub.name}`);
    }
  }
  return nested;
}

async function scanLocation(
  root: string,
  from: string | undefined,
  git: GitProbe,
): Promise<LocationFinding> {
  const atRoot = await findOldLayouts(root);
  const rootIsFolder = atRoot.some((layout) => layout.kind === "folder");
  const rootLayouts = atRoot.filter((layout) => layout.kind !== "folder" && !onlyMigrate(layout));
  let source: LegacySource | undefined;
  let others: OldLayout[];
  let fromEmpty = false;
  if (from === undefined) {
    const found = pick(rootLayouts, rootOrder);
    source = found === undefined ? undefined : { ...found, viaFrom: false };
    others = rootLayouts.filter((layout) => layout !== found);
  } else {
    const found = pick(await findOldLayouts(from), fromOrder);
    source = found === undefined ? undefined : { ...found, viaFrom: true };
    fromEmpty = found === undefined;
    others = rootLayouts;
  }
  if (source === undefined) {
    return {
      others,
      rootIsFolder,
      fromEmpty,
      ownDocs: [],
      tracked: [],
      nested: [],
      files: [],
    };
  }
  const ownDocs =
    source.kind === "docs"
      ? (await listDir(source.dir))
          .filter((entry) => !recordEntries.has(entry.name))
          .map((entry) => (entry.dir ? `${entry.name}/` : entry.name))
      : [];
  const repo = await git.repoOf(source.dir);
  const tracked = repo === undefined ? [] : await git.tracked(source.dir, source.entries);
  return {
    source,
    others,
    rootIsFolder,
    fromEmpty,
    ownDocs,
    tracked,
    nested: await nestedFolders(source),
    files: await sourceFiles(source),
  };
}

// ---- 忽略规则

async function scanIgnore(
  root: string,
  git: GitProbe,
  mainline: MainlineFinding,
): Promise<IgnoreFinding> {
  const repo = await git.repoOf(root);
  if (repo === undefined) return { kind: "noRepo" };
  const rule = await git.ignoredBy(root, `${projectCacheDirName}/`);
  if (rule !== undefined) return { kind: "ignored", repo, rule };
  const repoKind = mainline.kind === "found" ? mainline.repoKind : undefined;
  return { kind: "notIgnored", repo, ...(repoKind === undefined ? {} : { repoKind }) };
}

// ---- 决定和队列

async function scanDecisions(dir: string | undefined): Promise<DecisionsFinding> {
  const text = dir === undefined ? undefined : await readText(join(dir, decisionsFile));
  return text === undefined
    ? { kind: "missing" }
    : { kind: "found", file: parseLegacyDecisions(text) };
}

/** 队列.json 是现成的数据，以它为准。只有旧的表格时读表格。 */
async function scanQueue(dir: string | undefined): Promise<QueueFinding> {
  if (dir === undefined) return { kind: "missing" };
  const json = await readText(join(dir, queueJsonFile));
  const table = await readText(join(dir, queueTableFile));
  if (json !== undefined) {
    const alsoTable = table !== undefined;
    try {
      const doc: unknown = JSON.parse(json);
      return { kind: "found", format: "json", table: readLegacyQueueJson(doc), alsoTable };
    } catch {
      const at = jsonSyntaxError(json);
      const empty: LegacyQueueTable = { rows: [], problems: [] };
      const syntax = at === undefined ? {} : { at };
      return { kind: "found", format: "json", table: empty, alsoTable, syntax };
    }
  }
  if (table === undefined) return { kind: "missing" };
  return { kind: "found", format: "table", table: parseLegacyQueueTable(table), alsoTable: false };
}

// ---- 使用代码

/**
 * 使用代码自己的仓库放在 scripts/use/，共用的仓库放在 .product-loop/use-code/，见决定 107。
 * 这里两处都看，也看旧文件那里。
 */
async function scanUseCode(root: string, source: string | undefined): Promise<UseCodeFinding> {
  const candidates = [
    join(root, useCodeDir("own")),
    join(root, useCodeDir("shared")),
    ...(source === undefined ? [] : [join(source, useCodeDir("own"))]),
  ];
  for (const dir of candidates) {
    if (!(await isDir(dir))) continue;
    const files = await listFiles(dir);
    const coverage = join(dir, coverageFileName);
    return {
      dir: `${relative(root, dir)}/`,
      files: files.length,
      ...((await isFile(coverage)) ? { coverage: relative(root, coverage) } : {}),
    };
  }
  return { files: 0 };
}

// ---- skill 版本

/** 版本号的第一段。 */
function major(version: string): number {
  return Number(/^(\d+)\./u.exec(version)?.[1] ?? Number.NaN);
}

function scanSkillVersion(
  identity: IdentityFinding,
  location: LocationFinding,
  current: string,
): SkillVersionFinding {
  switch (identity.kind) {
    case "valid": {
      const { skillVersion } = identity.identity;
      return { kind: "recorded", version: skillVersion, old: major(skillVersion) < major(current) };
    }
    case "invalid":
      return { kind: "unreadable" };
    case "missing":
      return location.source === undefined ? { kind: "none" } : { kind: "legacy" };
  }
}

// ---- 缓存

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

async function dirNames(dir: string): Promise<string[]> {
  return (await listDir(dir)).filter((entry) => entry.dir).map((entry) => entry.name);
}

async function scanCache(root: string, identity: IdentityFinding): Promise<CacheFinding> {
  const cache = join(root, projectCacheDirName);
  const migrate = await isDir(join(cache, migrateDir));
  if (identity.kind !== "valid") return { kind: "notMigrated", migrate };
  const text = await readText(join(cache, mainlineFile));
  const base = identity.identity.mainlineBase;
  const mainline =
    text === undefined
      ? "missing"
      : base === undefined
        ? "noBase"
        : sha256(text) === base.hash
          ? "same"
          : "changed";
  return {
    kind: "checked",
    mainline,
    remote: await isFile(join(cache, remoteMainlineFile)),
    rounds: await dirNames(join(cache, "rounds")),
    useRuns: await dirNames(join(cache, "use")),
    migrate,
  };
}

// ---- 汇总

/**
 * 迁移检查一个项目根目录。root 和 from 都是绝对路径。只读，不改任何文件。
 * 旧页面的转换用这个项目自己的队列和主线：队列编号按先后从 Q1 起，场景按主线补上的编号。
 */
export async function scanProject(root: string, options: ScanOptions = {}): Promise<DoctorScan> {
  const git = options.git ?? gitProbe;
  const currentVersion = options.currentVersion ?? packageJson.version;
  const identity = await scanIdentity(root);
  const location = await scanLocation(root, options.from, git);
  const dir = location.source?.dir;
  const mainlineText = dir === undefined ? undefined : await readText(join(dir, mainlineFile));
  const { finding: mainline, context: scenes } = scanMainline(mainlineText);
  const queue = await scanQueue(dir);
  const queueRows = queue.kind === "found" ? queue.table.rows : [];
  const context: LegacyPageContext = {
    queue: queueRows.map((row) => ({ text: row.content, id: row.id })),
    scenes: scenes.scenes,
    sceneNumbers: scenes.sceneNumbers,
  };
  const pages =
    dir === undefined
      ? { exists: false, pages: [], htmlOnly: [], rounds: [], images: 0, facts: [], others: [] }
      : await scanPages(join(dir, "walk"), context);
  const land =
    dir === undefined
      ? { exists: false, records: [] }
      : await scanLand(join(dir, "land"), pages.pages);
  return {
    root,
    ...(options.from === undefined ? {} : { from: options.from }),
    currentVersion,
    identity,
    location,
    ignore: await scanIgnore(root, git, mainline),
    mainline,
    decisions: await scanDecisions(dir),
    queue,
    pages,
    land,
    useCode: await scanUseCode(root, dir),
    skillVersion: scanSkillVersion(identity, location, currentVersion),
    cache: await scanCache(root, identity),
    pageContext: context,
  };
}
