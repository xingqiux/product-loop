import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { projectCacheDirName, projectIdentityFileName } from "@product-loop/model";

// 旧 skill 在项目里留下的文件，见「08 版本与迁移」第四节和第六节。这里只看，不改任何文件。
// 旧布局有三种：
// - 项目缓存：.product-loop/ 里有旧文件，没有 project.json。
// - docs：旧文件放在 docs/ 里。docs/ 里另有项目自己的文档，所以只认主线、决定和队列四个文件。
// - 旧文件夹：旧文件直接放在一个文件夹里，例如 skill 自己放在 iCloud 里的产品文档。
//   迁移时用 --from 指明它。旧 skill 的模板文件夹也有主线、决定和队列，但没有 walk/ 和 land/。

/** 三种旧布局。 */
export type OldLayoutKind = "projectCache" | "docs" | "folder";

/** 在一个目录下找到的一种旧布局。 */
export type OldLayout = {
  readonly kind: OldLayoutKind;
  /** 放旧文件的文件夹：<目录>/.product-loop、<目录>/docs，或者这个目录本身。 */
  readonly dir: string;
  /** 找到的旧文件，文件夹的名字后面带 /。 */
  readonly entries: readonly string[];
};

/** 主线、决定和队列。队列有旧的表格和队列.json 两种写法。 */
const recordFiles = ["主线.md", "决定.md", "队列.md", "队列.json"] as const;
const queueFiles = ["队列.md", "队列.json"] as const;
/** 每一个阶段的记录：walk/ 下是页面和截图，land/ 下是落地记录。 */
const roundDirs = ["walk", "land"] as const;
/** 迁移检查写给 AI 确认的文件夹。有它、没有 project.json，说明迁移还没做完。 */
const migrateDir = "migrate";
const docsDirName = "docs";

/** 一个文件夹里的文件和文件夹。符号链接两边都算。读不出来的文件夹当作空的。 */
type Listing = { readonly files: ReadonlySet<string>; readonly dirs: ReadonlySet<string> };

async function list(dir: string): Promise<Listing> {
  const files = new Set<string>();
  const dirs = new Set<string>();
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const link = entry.isSymbolicLink();
      if (entry.isFile() || link) files.add(entry.name);
      if (entry.isDirectory() || link) dirs.add(entry.name);
    }
  } catch {
    // 不存在或者不是文件夹，都当作空的。
  }
  return { files, dirs };
}

/** 按固定的顺序列出找到的旧文件：先文件，后文件夹。 */
function pick(
  listing: Listing,
  files: readonly string[],
  dirs: readonly string[],
): readonly string[] {
  return [
    ...files.filter((name) => listing.files.has(name)),
    ...dirs.filter((name) => listing.dirs.has(name)).map((name) => `${name}/`),
  ];
}

/** 一个目录下的旧布局，没有就返回空数组。几种都有时全部列出。 */
export async function findOldLayouts(dir: string): Promise<OldLayout[]> {
  const layouts: OldLayout[] = [];

  const cacheDir = join(dir, projectCacheDirName);
  const cache = await list(cacheDir);
  if (!cache.files.has(projectIdentityFileName)) {
    const entries = pick(cache, recordFiles, [...roundDirs, migrateDir]);
    if (entries.length > 0) layouts.push({ kind: "projectCache", dir: cacheDir, entries });
  }

  const docsDir = join(dir, docsDirName);
  const docs = await list(docsDir);
  if (recordFiles.some((name) => docs.files.has(name))) {
    layouts.push({ kind: "docs", dir: docsDir, entries: pick(docs, recordFiles, roundDirs) });
  }

  // .product-loop/ 和 docs/ 本身由上一级按前两种认，不算旧文件夹。
  const name = basename(dir);
  if (name !== projectCacheDirName && name !== docsDirName) {
    const here = await list(dir);
    const isFolder =
      here.files.has("主线.md") &&
      queueFiles.some((file) => here.files.has(file)) &&
      roundDirs.some((sub) => here.dirs.has(sub));
    if (isFolder) {
      layouts.push({ kind: "folder", dir, entries: pick(here, recordFiles, roundDirs) });
    }
  }

  return layouts;
}
