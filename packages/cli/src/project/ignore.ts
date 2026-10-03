import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  type ErrorBody,
  err,
  errorBody,
  ok,
  projectCacheDirName,
  type RepoKind,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { initCopy } from "../copy/init.ts";

// 项目缓存不进仓库，ploop init 按仓库是谁的写忽略规则，见「03 数据模型」第五节。
// 自己的仓库写进根目录的 .gitignore。共用的仓库不该改大家都用的 .gitignore，
// 写进只在本机生效的 .git/info/exclude。

const run = promisify(execFile);

/** 写进去的一行。不带开头的斜杠，根目录在仓库的子目录里时也管用。 */
export const ignoreRule = `${projectCacheDirName}/`;

/**
 * 会话开始钩子写进的设置文件。它只在本机用，不该进仓库；没有全局忽略规则的机器上，
 * 它会被「代码全部提交」的检查当成没提交的文件。带 **\/，根目录在仓库的子目录里时也管用。
 */
export const settingsIgnoreRule = "**/.claude/settings.local.json";

/** 已经写过的规则认这几种写法，有一种就不再写。 */
function acceptedRules(rule: string): Set<string> {
  const name = rule.replace(/^\*\*\//u, "").replace(/\/$/u, "");
  return new Set(["", "/", "**/"].flatMap((prefix) => [`${prefix}${name}`, `${prefix}${name}/`]));
}

const existingRules = acceptedRules(ignoreRule);

/** 问 git 这个目录所在仓库的 info/exclude。git 的工作目录共用主仓库的这个文件，所以要问 git。 */
async function gitExcludeFile(root: string): Promise<string | undefined> {
  try {
    const args = ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"];
    const { stdout } = await run("git", args, { cwd: root, timeout: 10_000 });
    const file = stdout.trim();
    return file === "" ? undefined : file;
  } catch {
    return undefined;
  }
}

/** 忽略规则写在哪个文件。共用的仓库不在 git 里时报用法错误，提示改写 --repo 自己的。 */
export async function ignoreFileFor(
  root: string,
  repo: RepoKind,
): Promise<Result<string, ErrorBody<"BAD_REQUEST">>> {
  if (repo === "own") return ok(join(root, ".gitignore"));
  const file = await gitExcludeFile(root);
  if (file !== undefined) return ok(file);
  const { message, hint } = initCopy.errors.notGit;
  return err(
    errorBody("BAD_REQUEST", [
      { message: renderCopy(message, { root }), hint: renderCopy(hint), where: root },
    ]),
  );
}

async function readIfExists(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (Reflect.get(Object(error), "code") === "ENOENT") return "";
    throw error;
  }
}

/**
 * 项目缓存的忽略规则写在哪里，就能看出仓库是谁的：根目录的 .gitignore 里有是自己的，
 * 只在本机生效的 .git/info/exclude 里有是共用的。都没有时返回 undefined。
 * 集中存储丢了登记要重新登记时用它，不用再问用户。
 */
export async function inferRepoKind(root: string): Promise<RepoKind | undefined> {
  const has = async (file: string | undefined) =>
    file !== undefined &&
    (await readIfExists(file)).split(/\r?\n/u).some((line) => existingRules.has(line.trim()));
  if (await has(join(root, ".gitignore"))) return "own";
  if (await has(await gitExcludeFile(root))) return "shared";
  return undefined;
}

/** 文件里没有规则（默认是项目缓存的）就在末尾加上一行，返回加了没有。文件不在就新建。 */
export async function ensureIgnoreRule(file: string, rule = ignoreRule): Promise<boolean> {
  const text = await readIfExists(file);
  const accepted = rule === ignoreRule ? existingRules : acceptedRules(rule);
  if (text.split(/\r?\n/u).some((line) => accepted.has(line.trim()))) return false;
  await mkdir(dirname(file), { recursive: true });
  const newline = text === "" || text.endsWith("\n") ? "" : "\n";
  await appendFile(file, `${newline}${rule}\n`);
  return true;
}
