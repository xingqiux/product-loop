import { basename, matchesGlob } from "node:path";
import type { ReviewDiffSize } from "../../store/schema/index.ts";

// 评审界线，见「04 命令行」第十一节（决定 173，「13 待定」第 7 项选 a）：
// 这一批的改动不超过六十行、三个文件，并且不改数据格式、不加依赖，才能跳过评审。
// 数字写在 config.json 的 reviewThreshold 里，可以调。后端不跑 git，改动由命令行交来。
// 怎样算加依赖、怎样算改数据格式，见约定 0001 第 12 条：
// 依赖清单或锁文件有改动就算加依赖，改动命中 config.json 里配置的路径就算改数据格式。

/** config.json 里的评审界线，和 store/config.ts 的 reviewThreshold 同形。 */
export type ReviewThreshold = {
  readonly lines: number;
  readonly files: number;
  /** 数据格式的路径，每条是 glob，对着文件在根目录下的相对路径匹配。 */
  readonly dataFormatPaths: readonly string[];
};

/**
 * 这一批改到的一个文件：命令行在各个根目录里，从这一轮开始时的提交算到现在，
 * 用 git diff --numstat 取到的一行。二进制文件的行数记 0。
 */
export type ChangedFile = {
  /** 登记过的根目录。 */
  readonly root: string;
  /** 文件在根目录下的相对路径。 */
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
};

/** 依赖清单和锁文件的文件名。改到其中之一，就算加了依赖。 */
const dependencyFileNames: ReadonlySet<string> = new Set([
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "requirements.txt",
  "pyproject.toml",
  "poetry.lock",
  "uv.lock",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "Gemfile",
  "Gemfile.lock",
  "composer.json",
  "composer.lock",
  "Podfile",
  "Podfile.lock",
  "Package.swift",
  "Package.resolved",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
]);

/** 是不是依赖清单或锁文件，requirements-dev.txt 这样的也算。 */
export function isDependencyFile(path: string): boolean {
  const name = basename(path);
  return dependencyFileNames.has(name) || /^requirements[-.\w]*\.txt$/u.test(name);
}

/** 文件写成「根目录/相对路径」，报错和记录里用。 */
const shownPath = (file: ChangedFile): string => `${file.root.replace(/\/+$/u, "")}/${file.path}`;

/**
 * 按改动和界线算出这一批的规模，以及能不能跳过评审。
 * 行数是每个文件增加和删除的行数之和。同一个根目录里的同一个文件交了几次，只算一次。
 */
export function measureDiff(
  changed: readonly ChangedFile[],
  threshold: ReviewThreshold,
): ReviewDiffSize {
  const files = new Map<string, ChangedFile>();
  for (const file of changed) files.set(shownPath(file), file);
  const all = [...files.values()];
  const lines = all.reduce((sum, file) => sum + file.added + file.deleted, 0);
  const dependencyFiles = all.filter((file) => isDependencyFile(file.path)).map(shownPath);
  const dataFormatFiles = all
    .filter((file) => threshold.dataFormatPaths.some((glob) => matchesGlob(file.path, glob)))
    .map(shownPath);
  const within =
    lines <= threshold.lines &&
    all.length <= threshold.files &&
    dependencyFiles.length === 0 &&
    dataFormatFiles.length === 0;
  return {
    lines,
    files: all.length,
    dependencyFiles,
    dataFormatFiles,
    maxLines: threshold.lines,
    maxFiles: threshold.files,
    within,
  };
}
