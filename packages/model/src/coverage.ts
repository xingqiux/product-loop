import { parseSceneId } from "./ids.ts";
import type { RepoKind } from "./names.ts";
import { projectCacheDirName } from "./project-cache.ts";

// 覆盖表的解析，见「09 skill 与软件」第四节和约定 0001 第 18 条。
// 覆盖表是项目里的一份 Markdown，默认在使用代码的文件夹里，见 useCodeDir。每一行写产品里的一样东西：
// 页面、入口、操作、状态或接缝，再写被哪个场景用到，场景按主线的编号写，例如 S3、S14。
// 设计文档没写表格的样子，这里按两种写法认：
// - 表头有一列的名字里带「场景」，这一格里写的 S 编号就是用到它的场景。
// - 没有这样的一列时，表头里写成 S 编号的列是场景，格子里写了东西就算用到。
// 一行一个 S 编号都没有，就是缺口。表头和分隔行不算行，第一列是这一行写的东西。

/** 覆盖表的文件名。 */
export const coverageFileName = "覆盖表.md";

/**
 * 使用代码放的文件夹，相对根目录，见决定 107。
 * 自己的仓库放 scripts/use，和产品代码一起提交。
 * 共用的仓库放 .product-loop/use-code，只在本机，仓库里一个字节都不变。
 */
export function useCodeDir(repo: RepoKind): string {
  return repo === "own" ? "scripts/use" : `${projectCacheDirName}/use-code`;
}

/** 覆盖表的默认位置，相对根目录：在使用代码的文件夹里，跟着仓库是谁的走。 */
export function defaultCoveragePath(repo: RepoKind): string {
  return `${useCodeDir(repo)}/${coverageFileName}`;
}

/** 覆盖表的一行。 */
export type CoverageRow = {
  /** 在文件里的行号，从 1 数。 */
  readonly line: number;
  /** 第一列：产品里的哪样东西。 */
  readonly item: string;
  /** 用到它的场景，写成 S14，按出现的先后，不重复。 */
  readonly scenes: readonly string[];
};

export type Coverage = {
  readonly rows: readonly CoverageRow[];
  /** 没有场景用到的行，就是覆盖的缺口。 */
  readonly gaps: readonly CoverageRow[];
};

/** 表格的一行拆成格，去掉首尾的竖线。转义的竖线不算分隔。 */
function cellsOf(line: string): string[] {
  const body = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  return body.split(/(?<!\\)\|/u).map((cell) => cell.trim());
}

const isTableLine = (line: string) => line.trim().startsWith("|");
/** 分隔行只有竖线、连字符、冒号和空格，和计划的解析相同。 */
const isDivider = (line: string) => /^[\s|:-]+$/u.test(line) && line.includes("-");

/** 一格里写的 S 编号，写法不对的不算。 */
function sceneIdsIn(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(/S\d+/gu)) {
    const id = match[0];
    if (parseSceneId(id).ok && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** 解析覆盖表。不是表格的行不看，一份文件里有几张表时逐张解析。 */
export function parseCoverage(markdown: string): Coverage {
  const rows: CoverageRow[] = [];
  const lines = markdown.split(/\r?\n/u);
  let header: string[] | undefined;
  for (const [i, line] of lines.entries()) {
    if (!isTableLine(line)) {
      header = undefined;
      continue;
    }
    if (isDivider(line)) continue;
    const cells = cellsOf(line);
    if (header === undefined) {
      header = cells;
      continue;
    }
    const sceneColumn = header.findIndex((name) => name.includes("场景"));
    let scenes: string[];
    if (sceneColumn > 0) {
      scenes = sceneIdsIn(cells[sceneColumn] ?? "");
    } else {
      scenes = header.flatMap((name, column) =>
        column > 0 && parseSceneId(name).ok && (cells[column] ?? "") !== "" ? [name] : [],
      );
    }
    rows.push({ line: i + 1, item: cells[0] ?? "", scenes });
  }
  return { rows, gaps: rows.filter((row) => row.scenes.length === 0) };
}
