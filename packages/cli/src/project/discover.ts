import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type ProjectIdentity,
  projectCacheDirName,
  projectIdentityFileName,
  projectIdSchema,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { projectCopy } from "../copy/project.ts";
import { readProjectIdentity } from "./identity.ts";
import { findOldLayouts, type OldLayout } from "./old-layout.ts";

// 命令行按目录找项目，见「03 数据模型」第五节和「04 命令行」第二节。
// 从当前目录往上找 .product-loop/project.json，最近的一个就是当前项目。
// 在 git 仓库里找到仓库的根目录为止，不在仓库里找到家目录为止。
// 家目录不能当项目根目录，因为集中存储就是家目录下的 .product-loop/。
// 一路上没有 project.json、却有旧 skill 的文件时，要先做迁移检查，退出码 6（「08 版本与迁移」第四节）。
// 命令行不碰集中存储（「01 架构」第二节）。按编号找项目、查登记过的根目录，都由调用的地方问后端。

export type DiscoverOptions = {
  /** 当前目录。 */
  readonly cwd: string;
  /** 家目录。 */
  readonly home: string;
  /** --project 的取值：路径或者项目名。不写就从当前目录往上找。 */
  readonly projectOption?: string;
  /**
   * 这个目录是不是这个项目登记过的根目录，由后端回答。
   * 不写就不查：迁移检查要在还没登记的目录里运行。
   */
  readonly isRegisteredRoot?: (
    root: string,
    projectId: string,
  ) => Promise<Result<boolean, ErrorBody>>;
  /**
   * 迁移检查用：旧布局不报「要先做迁移检查」，照常往上找到根目录。
   * project.json 写坏了也不报，它所在的目录就是根目录，交给迁移检查的身份一项。
   */
  readonly forDoctor?: boolean;
  /**
   * 在家目录里运行：默认报找不到，和别的没有项目的目录一样，退出码 4。
   * ploop init 写 true，在家目录开工是用法错误，退出码 2。
   */
  readonly homeIsUsage?: boolean;
  /**
   * 不在项目里也能用的命令写 true：在家目录里运行就当没有项目，不报错，例如 ploop lint text。
   */
  readonly homeIsNone?: boolean;
};

/** 找到了项目。root 是 .product-loop/ 所在的目录，符号链接已经解开。 */
type FoundProject = {
  readonly kind: "found";
  readonly root: string;
  readonly identity: ProjectIdentity;
};

/** --project 写的是项目名。名字只有后端认得，由调用的地方去问。 */
type ProjectById = { readonly kind: "byId"; readonly projectId: string };

/** 往上找到边界也没有项目。ploop init 就在这时开工，别的命令提示运行 ploop init。 */
export type NoProject = {
  readonly kind: "none";
  /** 从哪个目录开始找。 */
  readonly from: string;
  /** 找到哪个目录为止。 */
  readonly to: string;
  /** 在 git 仓库里时，仓库的根目录。 */
  readonly gitRoot?: string;
};

/** 找的结果：找到了项目、写的是项目名、没有项目。按 kind 区分。 */
export type Discovery = FoundProject | ProjectById | NoProject;

/** 解开符号链接以后的目录。不存在或者不是目录时返回 undefined。 */
async function realDir(path: string): Promise<string | undefined> {
  try {
    const real = await realpath(path);
    return (await stat(real)).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** git 仓库的根目录下有 .git：普通的仓库是文件夹，git 的工作目录和子模块是文件。 */
async function isGitRoot(dir: string): Promise<boolean> {
  try {
    await lstat(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** --project 的取值：含 / 的，以及 .、..、~，都是路径。其余的按项目名认。 */
function readProjectOption(
  value: string,
  cwd: string,
  home: string,
): Result<{ readonly path: string } | { readonly projectId: string }, ErrorBody<"BAD_REQUEST">> {
  if (value === "~" || value.startsWith("~/")) return ok({ path: join(home, value.slice(1)) });
  if (value.includes("/") || value === "." || value === "..") {
    return ok({ path: resolve(cwd, value) });
  }
  if (projectIdSchema.safeParse(value).success) return ok({ projectId: value });
  const { message, hint } = projectCopy.option;
  return err(
    errorBody("BAD_REQUEST", [{ message: renderCopy(message, { value }), hint: renderCopy(hint) }]),
  );
}

function oldLayoutIssue({ kind, dir, entries }: OldLayout): Issue {
  const files = entries.join("、");
  const { oldLayout } = projectCopy;
  switch (kind) {
    case "projectCache":
    case "docs":
      return {
        message: renderCopy(oldLayout[kind].message, { files }),
        hint: renderCopy(oldLayout[kind].hint),
        where: dir,
      };
    case "folder":
      return {
        message: renderCopy(oldLayout.folder.message, { files }),
        hint: renderCopy(oldLayout.folder.hint, { dir }),
        where: dir,
      };
  }
}

/** 找到 project.json 以后：读出来校验，再问后端这个目录登记过没有。 */
async function foundAt(
  root: string,
  file: string,
  isRegisteredRoot: DiscoverOptions["isRegisteredRoot"],
): Promise<Result<Discovery, ErrorBody>> {
  const identity = await readProjectIdentity(file);
  if (!identity.ok) return identity;
  if (isRegisteredRoot !== undefined) {
    const { projectId } = identity.value;
    const registered = await isRegisteredRoot(root, projectId);
    if (!registered.ok) return registered;
    if (!registered.value) {
      const { message, hint } = projectCopy.unregistered;
      const issue = {
        message: renderCopy(message, { projectId }),
        hint: renderCopy(hint),
        where: file,
      };
      return err(errorBody("NEEDS_DOCTOR", [issue]));
    }
  }
  return ok({ kind: "found", root, identity: identity.value });
}

/**
 * 从 start 往上找。最近的 project.json 就是当前项目，比它近的旧布局不管。
 * 一路上没有 project.json 时，报离 start 最近的那一层旧布局。
 */
async function walkUp(
  start: string,
  home: string,
  isRegisteredRoot: DiscoverOptions["isRegisteredRoot"],
  forDoctor: boolean,
): Promise<Result<Discovery, ErrorBody>> {
  let nearest: readonly OldLayout[] = [];
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, projectCacheDirName, projectIdentityFileName);
    if (await isFile(file)) {
      const found = await foundAt(dir, file, isRegisteredRoot);
      return found.ok || !forDoctor ? found : ok({ kind: "none", from: dir, to: dir });
    }
    if (nearest.length === 0 && !forDoctor) nearest = await findOldLayouts(dir);
    const gitRoot = await isGitRoot(dir);
    const parent = dirname(dir);
    // 到了仓库的根目录、文件系统的根目录，或者再往上就是家目录，都停下。家目录本身不看。
    if (gitRoot || parent === dir || parent === home) {
      const [first, ...rest] = nearest.map(oldLayoutIssue);
      if (first !== undefined) return err(errorBody("NEEDS_DOCTOR", [first, ...rest]));
      return ok({ kind: "none", from: start, to: dir, ...(gitRoot ? { gitRoot: dir } : {}) });
    }
  }
}

/** 按 --project 或当前目录找项目。 */
export async function discoverProject(
  options: DiscoverOptions,
): Promise<Result<Discovery, ErrorBody>> {
  const home = (await realDir(options.home)) ?? resolve(options.home);
  let path = options.cwd;
  if (options.projectOption !== undefined) {
    const target = readProjectOption(options.projectOption, options.cwd, home);
    if (!target.ok) return target;
    if ("projectId" in target.value) return ok({ kind: "byId", projectId: target.value.projectId });
    path = target.value.path;
  }
  const start = await realDir(path);
  if (start === undefined) {
    const { message, hint } = projectCopy.missingDir;
    return err(
      errorBody("NOT_FOUND", [{ message: renderCopy(message, { path }), hint: renderCopy(hint) }]),
    );
  }
  if (start === home && options.homeIsNone === true) {
    return ok({ kind: "none", from: home, to: home });
  }
  if (start === home) {
    const { message, hint } = projectCopy.home;
    const body = { message: renderCopy(message), hint: renderCopy(hint), where: home };
    return err(errorBody(options.homeIsUsage === true ? "BAD_REQUEST" : "NOT_FOUND", [body]));
  }
  return walkUp(start, home, options.isRegisteredRoot, options.forDoctor === true);
}

/** 没有找到项目时的报错：找不到，提示在项目根目录运行 ploop init。 */
export function noProjectError({ from, to }: NoProject): ErrorBody<"NOT_FOUND"> {
  const { message, here, hint } = projectCopy.none;
  return errorBody("NOT_FOUND", [
    {
      message: from === to ? renderCopy(here, { dir: from }) : renderCopy(message, { from, to }),
      hint: renderCopy(hint),
    },
  ]);
}
