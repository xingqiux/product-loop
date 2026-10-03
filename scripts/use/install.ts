import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join, relative } from "node:path";
import { type CommandNote, type Run, repoRoot, type World } from "./lib.ts";

// 安装、升级和后端的场景（S26 到 S28）共用的做法。全部在沙盒里做：
// 家目录是临时的，~/.local/bin、~/.claude 和 ~/.product-loop 都在它下面，绝不碰真实的。
// pnpm 要用真实的下载缓存才能离线装好，缓存的位置用选项交给它，它不往缓存里写东西。

const noteLength = 300;

/** 把一条不是 ploop 的命令记进这一步的命令记录：命令行的场景没有屏，记命令、退出码和输出的开头。 */
export function note(w: World, command: string, run: Run): void {
  const output = `${run.stdout}${run.stderr}`.trim();
  const entry: CommandNote = {
    command,
    exit: run.code,
    output: output.length > noteLength ? `${output.slice(0, noteLength)}…` : output,
  };
  w.commands.push(entry);
}

/** 沙盒里装好的命令：~/.local/bin/ploop。 */
function launcherOf(w: World): string {
  return join(w.home, ".local", "bin", "ploop");
}

/**
 * 用装出来的 ploop 敲一条命令，像新开的终端那样。
 * env 里的变量盖过沙盒的环境，值写 undefined 表示去掉。
 */
export function installedPloop(
  w: World,
  argv: readonly string[],
  options: { readonly cwd?: string; readonly env?: Record<string, string | undefined> } = {},
): Run {
  const env = { ...w.env, ...options.env };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  const result = spawnSync(launcherOf(w), argv, {
    cwd: options.cwd ?? w.root,
    env,
    encoding: "utf8",
  });
  const run = { code: result.status, stdout: result.stdout, stderr: result.stderr };
  note(w, ["ploop", ...argv].join(" "), run);
  return run;
}

/** 用装出来的 ploop 摆状态时敲的命令：摆状态的命令不记进使用记录。 */
export function installedWorld(w: World): World {
  return {
    ...w,
    ploop: (argv, cwd) => {
      const before = w.commands.length;
      const run = installedPloop(w, argv, cwd === undefined ? {} : { cwd });
      w.commands.length = before;
      return run;
    },
  };
}

/** 真实的家目录：pnpm 的下载缓存在它下面，只读。取自系统的用户记录，外面把 HOME 换成沙盒时也是真的。 */
const realHome = userInfo().homedir;

function pnpmOptions(): string[] {
  const store = spawnSync("pnpm", ["store", "path"], {
    encoding: "utf8",
    env: { ...process.env, HOME: realHome },
  }).stdout.trim();
  const cache =
    process.platform === "darwin"
      ? join(realHome, "Library", "Caches", "pnpm")
      : join(process.env.XDG_CACHE_HOME ?? join(realHome, ".cache"), "pnpm");
  return [
    "--frozen-lockfile",
    "--offline",
    ...(store === "" ? [] : ["--store-dir", store]),
    ...(existsSync(cache) ? ["--cache-dir", cache] : []),
  ];
}

/**
 * 在仓库的副本里敲 pnpm，家目录是沙盒的。corepack 的目录用真实的，不然它要重新下载 pnpm。
 * shown 是记进命令记录的写法，args 是真正敲的。
 */
export function pnpm(
  w: World,
  repo: string,
  shown: string,
  args: readonly string[],
  env: Record<string, string> = {},
): Run {
  const result = spawnSync("pnpm", args, {
    cwd: repo,
    env: {
      ...w.env,
      COREPACK_HOME: process.env.COREPACK_HOME ?? join(realHome, ".cache", "node", "corepack"),
      ...env,
    },
    encoding: "utf8",
  });
  const run = { code: result.status, stdout: result.stdout, stderr: result.stderr };
  note(w, shown, run);
  return run;
}

/** pnpm install 的选项：锁文件不变，只用本机缓存里已有的包。 */
export function pnpmInstall(w: World, repo: string, env: Record<string, string> = {}): Run {
  return pnpm(w, repo, "pnpm install", ["install", ...pnpmOptions()], env);
}

/** 仓库的一份副本，放在临时目录里，从当前提交克隆。所有构建和安装都在副本里做，不动真实的仓库。 */
export function cloneRepo(w: World): string {
  const dest = join(w.home, "..", "repo");
  const result = spawnSync("git", ["clone", "--quiet", "--local", repoRoot, dest], {
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`克隆仓库失败：${result.stderr}`);
  return dest;
}

/** 在副本里改一个文件里的一段字。找不到就报错，改动没有生效不能算升级。 */
function replaceIn(repo: string, file: string, from: string, to: string): void {
  const path = join(repo, file);
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`${file} 里找不到「${from}」`);
  writeFileSync(path, text.replace(from, to));
}

/** 更新代码：把副本的命令行版本号和 skill 版本号改成 version，它们打进构建号和后端。 */
export function setVersion(repo: string, from: string, to: string): void {
  replaceIn(repo, "packages/cli/package.json", `"version": "${from}"`, `"version": "${to}"`);
  replaceIn(
    repo,
    "packages/backend/src/core/projects.ts",
    `appSkillVersion = "${from}"`,
    `appSkillVersion = "${to}"`,
  );
}

/** 更新代码：给数据库加一条迁移，新的后端第一次开库时要迁移，先留「迁移前」的快照。 */
export function addMigration(repo: string): void {
  const dir = join(repo, "packages", "backend", "drizzle");
  writeFileSync(
    join(dir, "0018_upgrade.sql"),
    "ALTER TABLE `queue_items` ADD `upgrade_demo` text;\n",
  );
  const journalFile = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalFile, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const last = journal.entries.at(-1);
  if (last === undefined) throw new Error("迁移的记录是空的");
  journal.entries.push({
    idx: last.idx + 1,
    version: last.version,
    when: last.when + 86_400_000,
    tag: "0018_upgrade",
    breakpoints: true,
  });
  writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
}

/** 沙盒里的 skill 目录：~/.claude/skills/product-loop。 */
export function skillTarget(w: World): string {
  return join(w.home, ".claude", "skills", "product-loop");
}

/** 把仓库里 skill 文件夹里的内容复制过去。repo 不写就是真实的仓库，写了是仓库的副本。 */
export function copySkill(w: World, repo: string = repoRoot): void {
  cpSync(join(repo, "skill"), skillTarget(w), { recursive: true });
}

/** 目录下的每个文件，路径相对这个目录，按名字排。 */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** 两个目录里的文件对不上的地方：少了、多了，或者内容不同。 */
export function differences(left: string, right: string): string[] {
  const a = filesUnder(left);
  const b = filesUnder(right);
  const problems: string[] = [];
  for (const file of a) {
    if (!b.includes(file)) problems.push(`${file} 只在 ${left} 里`);
    else if (!readFileSync(join(left, file)).equals(readFileSync(join(right, file)))) {
      problems.push(`${file} 的内容不同`);
    }
  }
  for (const file of b) if (!a.includes(file)) problems.push(`${file} 只在 ${right} 里`);
  return problems;
}
