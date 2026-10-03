import { execFile } from "node:child_process";

// 迁移检查要问 git 的三件事：项目根在不在仓库里、.product-loop/ 被哪条规则忽略、哪些旧文件已经提交。
// 迁移检查只运行只读的 git 命令：rev-parse、check-ignore、ls-files，见「08 版本与迁移」第四节。
// 只有 --fix 的清理会改仓库：已提交的旧文件用 git rm 删掉，只提交这几个文件（第七节）。
// 测试换成假的，要起子进程的测试放在 git.use.test.ts。

/** 项目根所在的 git 仓库。 */
export type GitRepo = {
  /** 工作目录的根目录。 */
  readonly root: string;
  /** 是仓库的一个附加的工作目录，忽略规则在共用的 info/exclude（「08 版本与迁移」第六节）。 */
  readonly worktree: boolean;
};

/** 忽略一个路径的那条规则。 */
export type IgnoreRule = {
  /** 规则写在哪个文件，例如 .gitignore、.git/info/exclude。 */
  readonly source: string;
  readonly pattern: string;
};

export type GitProbe = {
  /** dir 所在的仓库，不在仓库里时是 undefined。 */
  readonly repoOf: (dir: string) => Promise<GitRepo | undefined>;
  /** 在 dir 里查 path 被哪条规则忽略，没被忽略时是 undefined。path 相对 dir。 */
  readonly ignoredBy: (dir: string, path: string) => Promise<IgnoreRule | undefined>;
  /** 在 dir 里列出已提交的文件，只看 paths 下面的。路径相对 dir。 */
  readonly tracked: (dir: string, paths: readonly string[]) => Promise<string[]>;
};

type GitRun = { readonly code: number; readonly stdout: string };

function git(dir: string, args: readonly string[]): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, ...args],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30_000 },
      (error, stdout) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout });
      },
    );
  });
}

/** 用本机的 git 回答。 */
export const gitProbe: GitProbe = {
  repoOf: async (dir) => {
    // 写成绝对路径才能比较：在子目录里 --git-common-dir 默认给相对路径
    const run = await git(dir, [
      "rev-parse",
      "--path-format=absolute",
      "--show-toplevel",
      "--git-dir",
      "--git-common-dir",
    ]);
    if (run.code !== 0) return undefined;
    const [root = "", gitDir = "", commonDir = ""] = run.stdout.trim().split("\n");
    if (root === "") return undefined;
    return { root, worktree: gitDir !== commonDir };
  },
  ignoredBy: async (dir, path) => {
    const run = await git(dir, ["check-ignore", "-v", "--", path]);
    if (run.code !== 0) return undefined;
    // 输出是「来源:行号:规则<Tab>路径」
    const [rule = ""] = run.stdout.split("\t");
    const match = /^(.*):\d+:(.*)$/u.exec(rule);
    if (match === null) return undefined;
    const pattern = match[2] ?? "";
    // 以 ! 开头的规则匹配上了，说明这个路径不忽略
    if (pattern.startsWith("!")) return undefined;
    return { source: match[1] ?? "", pattern };
  },
  tracked: async (dir, paths) => {
    if (paths.length === 0) return [];
    const run = await git(dir, ["ls-files", "-z", "--", ...paths]);
    if (run.code !== 0) return [];
    return run.stdout.split("\0").filter((path) => path !== "");
  },
};

/** git 删除没做完：停在哪一步，和 git 的原话（英文，只放机读结果，不写进给人看的输出）。 */
export type RemoveFailure = {
  /** rm：一个都没删掉。commit：已经从 git 删了，还没提交。 */
  readonly step: "rm" | "commit";
  readonly reason: string;
};

/**
 * 用 git 删掉已提交的旧文件，单独提交一次，只含这几个文件的删除。paths 相对 dir。
 * 用 --only 提交，暂存区里别的改动不带进来。
 * 删空以后 dir 本身可能也没了，所以先量出 dir 在仓库里的位置，之后的命令都在仓库根运行（N19）。
 */
export async function removeTracked(
  dir: string,
  paths: readonly string[],
  message: string,
): Promise<RemoveFailure | undefined> {
  if (paths.length === 0) return undefined;
  const located = await gitRun(dir, ["rev-parse", "--show-toplevel", "--show-prefix"]);
  if (located.code !== 0) return { step: "rm", reason: located.stderr.trim() };
  const [top = "", prefix = ""] = located.stdout.trimEnd().split("\n");
  const specs = paths.map((path) => `${prefix}${path}`);
  const removed = await gitRun(top, ["rm", "-q", "--", ...specs]);
  if (removed.code !== 0) return { step: "rm", reason: removed.stderr.trim() };
  const committed = await gitRun(top, ["commit", "-q", "--only", "-m", message, "--", ...specs]);
  return committed.code === 0 ? undefined : { step: "commit", reason: committed.stderr.trim() };
}

function gitRun(dir: string, args: readonly string[]): Promise<GitRun & { stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", dir, ...args],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 60_000 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : -1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}
