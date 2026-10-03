import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { pageCopy } from "../copy/page.ts";
import { locateInput } from "../project/input-path.ts";
import { jsonSyntaxError } from "../project/json-error.ts";
import { readFailure } from "../project/read-error.ts";

// 读页面数据，见「03 数据模型」第五节：这个阶段的工作区里写 page.json，
// 或者几个子代理各写一份 cards/*.json，给出信息时合并。两样都有时一起合并，page.json 在前。
// 合并按区块把列表接起来。报错里的位置按合并前的文件写，AI 才知道去改哪一个。

const text = pageCopy.errors;

/** JSON 写坏了的规矩编号：数据定义这一层，和 page.field.root 同一类。 */
const pageJsonRule = "page.json.syntax";

/** 合并以后的一个列表项来自哪个文件、在那个文件里的第几项。 */
type Origin = { readonly file: string; readonly index: number };

export type PageData = {
  /** 合并以后的页面数据。 */
  readonly data: unknown;
  /** 页面数据所在的工作区：截图的路径相对它来写。 */
  readonly dir: string;
  /** 读了哪几个文件，按合并的先后。 */
  readonly files: readonly string[];
  /** 把页面数据里的位置写成「文件 → 字段」，例如 rounds/v2-检查-1/cards/S3.json → asks[0]。 */
  readonly locate: (where: string) => string;
};

export type Shown = (file: string) => string;

/** 一个文件读出来的 JSON。写坏了报到行和列。 */
async function readJson(
  file: string,
  show: Shown,
  tried: readonly string[] = [],
): Promise<Result<unknown, ErrorBody>> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    const { kind, reason } = readFailure(error);
    // 命令后面写的路径不存在时，写明先后找过哪几个位置，不说成文件权限的事。
    const missing = kind === "missing" && tried.length > 0;
    const issue = missing
      ? {
          message: renderCopy(text.missingFile.message),
          hint: renderCopy(text.missingFile.hint, { tried: tried.map(show).join("、") }),
          where: show(file),
        }
      : {
          message: renderCopy(text.unreadable.message, { reason }),
          hint: renderCopy(text.unreadable.hint),
          where: show(file),
        };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  try {
    return ok(JSON.parse(source));
  } catch {
    const position = jsonSyntaxError(source);
    const where =
      position === undefined
        ? show(file)
        : renderCopy(text.atLine, { file: show(file), ...position });
    const issue = {
      rule: pageJsonRule,
      message: renderCopy(text.syntax.message),
      hint: renderCopy(text.syntax.hint),
      where,
    };
    return err(errorBody("RULE_BLOCKED", [issue]));
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** 工作区里要合并的文件：page.json 在前，cards/*.json 按文件名排。 */
async function workspaceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  const page = join(dir, "page.json");
  if (await isFile(page)) files.push(page);
  const cards = join(dir, "cards");
  if (await isDirectory(cards)) {
    const names = (await readdir(cards)).filter((name) => name.endsWith(".json")).sort();
    files.push(...names.map((name) => join(cards, name)));
  }
  return files;
}

/** 把几份页面数据合并成一份。列表按区块接起来，别的字段只能写在一个文件里。 */
function merge(
  parts: readonly { readonly file: string; readonly value: unknown }[],
  show: Shown,
): Result<{ data: unknown; origins: Map<string, Origin[]> }, ErrorBody> {
  const origins = new Map<string, Origin[]>();
  const [only] = parts;
  if (parts.length === 1 && only !== undefined && !isRecord(only.value)) {
    // 只有一个文件时原样交给后端，最外层写错了由数据定义报。
    return ok({ data: only.value, origins });
  }
  const data: Record<string, unknown> = {};
  const owner = new Map<string, string>();
  const issues: Issue[] = [];
  for (const { file, value } of parts) {
    if (!isRecord(value)) {
      issues.push({
        rule: "page.field.root",
        message: renderCopy(text.notObject.message),
        hint: renderCopy(text.notObject.hint),
        where: show(file),
      });
      continue;
    }
    for (const [key, inner] of Object.entries(value)) {
      const before = data[key];
      if (Array.isArray(inner) && (before === undefined || Array.isArray(before))) {
        const list = (before ?? []) as unknown[];
        const from = origins.get(key) ?? [];
        for (const [index, item] of inner.entries()) {
          list.push(item);
          from.push({ file, index });
        }
        data[key] = list;
        origins.set(key, from);
        owner.set(key, owner.get(key) ?? file);
        continue;
      }
      const first = owner.get(key);
      if (first !== undefined) {
        issues.push({
          rule: "page.field.root",
          message: renderCopy(text.mergeClash.message, {
            field: key,
            first: show(first),
            second: show(file),
          }),
          hint: renderCopy(text.mergeClash.hint),
          where: show(file),
        });
        continue;
      }
      data[key] = inner;
      owner.set(key, file);
    }
  }
  const [first, ...rest] = issues;
  if (first !== undefined) return err(errorBody("RULE_BLOCKED", [first, ...rest]));
  return ok({ data, origins });
}

/** 字段的路径开头是「区块[下标]」时，拆出区块、下标和后面的部分。 */
const leadingItem = /^(?<section>[A-Za-z]+)\[(?<index>\d+)\](?<rest>.*)$/u;

/**
 * 读页面数据。path 不写时读工作区；写了目录就读那个目录，写了文件就只读它。
 * show 把绝对路径写成报错里给人看的样子。
 */
export async function readPageData(input: {
  readonly workspace: string;
  readonly path: string | undefined;
  readonly cwd: string;
  /** 项目缓存。写了路径时先按当前目录找，找不到再按它找。 */
  readonly cache?: string;
  readonly show: Shown;
  /** 工作区里一份页面数据都没有时，就当这一份写的：使用阶段的页面数据可以什么都不写。 */
  readonly whenMissing?: unknown;
}): Promise<Result<PageData, ErrorBody>> {
  const { show } = input;
  const located =
    input.path === undefined ? undefined : await locateInput(input.cwd, input.cache, input.path);
  const target = located === undefined ? input.workspace : located.path;
  const directory = input.path === undefined || (await isDirectory(target));
  const files = directory ? await workspaceFiles(target) : [target];
  if (files.length === 0 && directory && input.whenMissing !== undefined) {
    const locate = (where: string) =>
      renderCopy(text.atField, { file: show(target), field: where });
    return ok({ data: input.whenMissing, dir: target, files: [], locate });
  }
  if (files.length === 0) {
    const shown = `${show(target)}/`;
    const issue = {
      message: renderCopy(text.notFound.message, { path: shown }),
      hint: renderCopy(text.notFound.hint, { path: shown }),
      where: shown,
    };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  const parts: { file: string; value: unknown }[] = [];
  for (const file of files) {
    const value = await readJson(file, show, directory ? [] : (located?.tried ?? []));
    if (!value.ok) return value;
    parts.push({ file, value: value.value });
  }
  const merged = merge(parts, show);
  if (!merged.ok) return merged;
  const { data, origins } = merged.value;
  const [firstFile = target] = files;
  const locate = (where: string) => {
    const match = leadingItem.exec(where);
    const origin = match?.groups
      ? origins.get(match.groups.section ?? "")?.[Number(match.groups.index)]
      : undefined;
    if (origin === undefined || match?.groups === undefined) {
      return renderCopy(text.atField, { file: show(firstFile), field: where });
    }
    const field = `${match.groups.section}[${origin.index}]${match.groups.rest}`;
    return renderCopy(text.atField, { file: show(origin.file), field });
  };
  return ok({ data, dir: directory ? target : dirname(target), files, locate });
}

/** 报错里给人看的路径：在 base 下面的写相对路径，不在的写绝对路径。 */
export function shownFrom(base: string): Shown {
  return (file: string) => {
    const rel = relative(base, file);
    return rel === "" || rel.startsWith("..") ? file : rel;
  };
}
