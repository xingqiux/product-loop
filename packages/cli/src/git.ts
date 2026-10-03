import { execFile } from "node:child_process";

// 命令行在项目的根目录里用到的几条 git 命令，见「04 命令行」第十一节和约定 0001 第 12 条。
// 后端不碰 git：提交号、没提交的文件、改动的规模都由命令行查出来交给后端。
// git 不在、目录不是仓库、还没有提交，都按查不到处理，不报错，由用到它的规矩判断。

type GitRun = { readonly ok: boolean; readonly stdout: string };

/** 在 dir 里运行一次 git。 */
function git(dir: string, args: readonly string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, ...args],
      { encoding: "utf8", timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) => resolve({ ok: error === null, stdout }),
    );
  });
}

/** 一个目录现在的提交。不是 git 仓库、还没有提交、目录不在，都返回 undefined。 */
export async function headCommit(dir: string): Promise<string | undefined> {
  const run = await git(dir, ["rev-parse", "--verify", "HEAD"]);
  return run.ok ? run.stdout.trim() : undefined;
}

/**
 * 没提交的文件，相对根目录，按 git status 的顺序。改名的写新名字。
 * 不是 git 仓库时返回 undefined。
 */
export async function uncommittedFiles(root: string): Promise<string[] | undefined> {
  const run = await git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (!run.ok) return undefined;
  const entries = run.stdout.split("\0").filter((entry) => entry !== "");
  const files: string[] = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] ?? "";
    files.push(entry.slice(3));
    // 改名和复制的一项后面另跟一段旧名字，跳过它。
    if (entry[0] === "R" || entry[0] === "C") i += 1;
  }
  return files;
}

/**
 * 一个文件有没有没提交的改动，包括还没加进 git 的新文件。file 相对 root。
 * 不是 git 仓库时返回 undefined。
 */
export async function hasUncommittedChange(
  root: string,
  file: string,
): Promise<boolean | undefined> {
  const run = await git(root, ["status", "--porcelain=v1", "--", file]);
  return run.ok ? run.stdout.trim() !== "" : undefined;
}

/**
 * 失败时的提交以后到通过时的提交为止的提交，通过时的提交在内，从新到旧。
 * 通过时的提交不在失败时的之后，返回空列表，由后端的 land.green.later 拦截。
 */
export async function commitsBetween(root: string, from: string, to: string): Promise<string[]> {
  const run = await git(root, ["rev-list", "--ancestry-path", `${from}..${to}`]);
  if (!run.ok) return [];
  return run.stdout.split("\n").filter((line) => line.trim() !== "");
}

/** 提交说明末尾的「队列: Q12」，见「10 工程规范与流程」第三节。 */
const queueTrailer = /^队列[:：]\s*(.+)$/gmu;

/** 几个提交的说明里写的队列编号，按出现的先后，不重复。 */
export async function queueIdsInCommits(
  root: string,
  commits: readonly string[],
): Promise<string[]> {
  if (commits.length === 0) return [];
  const run = await git(root, ["show", "-s", "--format=%B%x00", ...commits]);
  if (!run.ok) return [];
  const ids: string[] = [];
  for (const match of run.stdout.matchAll(queueTrailer)) {
    for (const id of (match[1] ?? "").split(/[\s,，、]+/u)) {
      if (id !== "" && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** 从这个阶段开始时的提交算起改到的一个文件。二进制文件的行数记 0。 */
export type ChangedFile = {
  readonly root: string;
  readonly path: string;
  readonly added: number;
  readonly deleted: number;
};

/**
 * 从 base 到现在的工作区改到的文件，包括还没提交的改动。git diff --numstat 的每一行。
 * 新建、还没加进 git 的文件不在其中，收尾时由 land.commit.clean 拦下。
 */
export async function changedFiles(root: string, base: string): Promise<ChangedFile[]> {
  const run = await git(root, ["diff", "--numstat", "-z", base]);
  if (!run.ok) return [];
  const files: ChangedFile[] = [];
  const parts = run.stdout.split("\0");
  for (let i = 0; i < parts.length; i += 1) {
    const line = parts[i] ?? "";
    const match = /^(-|\d+)\t(-|\d+)\t(.*)$/u.exec(line);
    if (match === null) continue;
    const [, added = "-", deleted = "-", rest = ""] = match;
    let path = rest;
    // 改名时路径是空的，后面跟旧名字和新名字两段。
    if (path === "") {
      path = parts[i + 2] ?? "";
      i += 2;
    }
    const count = (text: string) => (text === "-" ? 0 : Number(text));
    files.push({ root, path, added: count(added), deleted: count(deleted) });
  }
  return files;
}

/** 从 base 到现在的工作区的差异全文。 */
export async function diffText(root: string, base: string): Promise<string> {
  const run = await git(root, ["diff", base]);
  return run.ok ? run.stdout : "";
}
