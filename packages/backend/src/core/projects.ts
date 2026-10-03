import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  type Err,
  type ErrorBody,
  type ErrorCode,
  err,
  errorBody,
  type Issue,
  ok,
  projectCacheDirName,
  type RepoKind,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { asc, eq, inArray } from "drizzle-orm";
import { projectsCopy } from "../copy/projects.ts";
import type { Db } from "../store/db.ts";
import { productVersions, projectRoots, projects } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { type Tx, type WriteContext, writeTx } from "./tx.ts";

// 项目的用例：登记、修改、按路径找项目、列出项目，字段见「03 数据模型」第二节。
// 另有会改数据的操作共用的检查：项目要先体检时返回 NEEDS_DOCTOR，见「08 版本与迁移」第三、四节。
// 后端不读项目文件夹，见「01 架构」第二节。路径只按字面整理，不展开符号链接。
// 所以命令行交来的根目录要是展开过的真实路径。

/** 读数据用的数据库。写事务里传 w.tx，事务外面传 db。 */
export type Reader = Db | Tx;

/** 项目表的一行。 */
export type ProjectRow = typeof projects.$inferSelect;

/** 接口和命令行看到的项目。时间写成 ISO 8601 字符串，写事务的结果要能存成 JSON。 */
export type ProjectView = {
  readonly id: string;
  /** 页头上的系统名。 */
  readonly name: string;
  readonly repoKind: RepoKind;
  /** 忽略规则写在哪个文件，由命令行写好以后交来。 */
  readonly ignoreFile: string | null;
  /** 停在哪一版 skill。迁移完成以前为空。 */
  readonly skillVersion: string | null;
  /** 迁移前的旧数据在哪里。新建的项目为空。 */
  readonly legacySource: string | null;
  /** 登记过的根目录，按登记的先后排。 */
  readonly roots: readonly string[];
  readonly createdAt: string;
};

/**
 * 这一版软件连同 skill 正文的版本，见「08 版本与迁移」第三节。
 * 新登记的项目记下它。第 15 步打包时改成注入的版本号。
 */
export const appSkillVersion = "0.0.1";

/** 用错误码和一条问题拼出失败的结果。 */
export function fail<C extends ErrorCode>(code: C, issue: Issue): Err<ErrorBody<C>> {
  return err(errorBody(code, [issue]));
}

export const iso = (at: Date): string => at.toISOString();
export const isoOrNull = (at: Date | null): string | null => (at === null ? null : iso(at));

// ── 编号 ──

/** 编号最长几个字符，不算重名时加的数字。 */
const idMaxLength = 32;

/**
 * 根目录名转成的 ASCII 短名，见第一期计划第三节。写法合 model 的 projectIdSchema。
 * 去掉重音符号，转成小写，字母和数字以外的连续字符换成一个短横。
 * 转完一个字母和数字都不剩的，例如全是汉字，用 project。
 */
export function projectIdBase(dirName: string): string {
  const ascii = dirName.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const slug = ascii.replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "");
  const short = slug.slice(0, idMaxLength).replace(/-$/u, "");
  return short === "" ? "project" : short;
}

/** 重名时加数字：app 已有就用 app-2，再有就用 app-3。 */
function uniqueProjectId(tx: Reader, base: string): string {
  const taken = new Set(
    tx
      .select({ id: projects.id })
      .from(projects)
      .all()
      .map((row) => row.id),
  );
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

// ── 根目录 ──

/** 不能当项目根目录的地方。由后端按自己的环境取，不取自请求。 */
export type ReservedDirs = {
  /** 用户的家目录。 */
  readonly userHome: string;
  /** 集中存储的目录，见 store/home.ts。 */
  readonly home: string;
};

/** 整理命令行交来的路径：要是绝对路径，去掉末尾的斜杠和 .、.. 这样的段。 */
function normalizePath(path: string): Result<string, ErrorBody<"BAD_REQUEST">> {
  if (!isAbsolute(path)) {
    const text = projectsCopy.root.notAbsolute;
    return fail("BAD_REQUEST", {
      message: renderCopy(text.message, { path }),
      hint: renderCopy(text.hint),
      where: path,
    });
  }
  return ok(resolve(path));
}

/**
 * 能不能当项目根目录，见「03 数据模型」第五节。
 * - 家目录不能当，否则项目缓存和集中存储是同一个文件夹。
 * - 家目录的上级也不能当，例如 / 和 /Users。命令行往上找项目时最远找到家目录，
 *   找不到它们。按路径找项目时，家目录下的每个路径却都会算进这个项目。
 * - PLOOP_HOME 指到别处时，按第一条的道理查集中存储的上一级。
 */
function checkRoot(path: string, reserved: ReservedDirs): Result<string, ErrorBody<"BAD_REQUEST">> {
  const normalized = normalizePath(path);
  if (!normalized.ok) return normalized;
  const root = normalized.value;
  const userHome = resolve(reserved.userHome);
  const text =
    root === userHome
      ? projectsCopy.root.userHome
      : selfAndAncestors(userHome).includes(root)
        ? projectsCopy.root.aboveHome
        : join(root, projectCacheDirName) === resolve(reserved.home)
          ? projectsCopy.root.storeParent
          : undefined;
  if (text === undefined) return ok(root);
  return fail("BAD_REQUEST", {
    message: renderCopy(text.message, { path: root }),
    hint: renderCopy(text.hint),
    where: root,
  });
}

/** 一组根目录逐个检查，遇到第一个不合要求的就返回它的报错。重复的只留一个。 */
function checkRoots(
  paths: readonly string[],
  check: (path: string) => Result<string, ErrorBody<"BAD_REQUEST">>,
): Result<string[], ErrorBody<"BAD_REQUEST">> {
  const checked: string[] = [];
  for (const path of paths) {
    const root = check(path);
    if (!root.ok) return root;
    if (!checked.includes(root.value)) checked.push(root.value);
  }
  return ok(checked);
}

/** 这个目录登记给了哪个项目。 */
function rootOwner(tx: Reader, path: string): string | undefined {
  return tx
    .select({ projectId: projectRoots.projectId })
    .from(projectRoots)
    .where(eq(projectRoots.path, path))
    .get()?.projectId;
}

function rootTaken(path: string, owner: string): Err<ErrorBody<"CONFLICT">> {
  const text = projectsCopy.root.taken;
  return fail("CONFLICT", {
    message: renderCopy(text.message, { path, project: owner }),
    hint: renderCopy(text.hint),
    where: path,
  });
}

function rootsOf(tx: Reader, projectId: string): string[] {
  return tx
    .select({ path: projectRoots.path })
    .from(projectRoots)
    .where(eq(projectRoots.projectId, projectId))
    .orderBy(asc(projectRoots.id))
    .all()
    .map((row) => row.path);
}

function toView(tx: Reader, row: ProjectRow): ProjectView {
  return {
    id: row.id,
    name: row.name,
    repoKind: row.repoKind,
    ignoreFile: row.ignoreFile,
    skillVersion: row.skillVersion,
    legacySource: row.legacySource,
    roots: rootsOf(tx, row.id),
    createdAt: iso(row.createdAt),
  };
}

// ── 查找 ──

/** 按编号找项目。 */
export function findProject(
  tx: Reader,
  projectId: string,
): Result<ProjectRow, ErrorBody<"NOT_FOUND">> {
  const row = tx.select().from(projects).where(eq(projects.id, projectId)).get();
  if (row !== undefined) return ok(row);
  const text = projectsCopy.project.notFound;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { id: projectId }),
    hint: renderCopy(text.hint),
  });
}

/** 项目的详情，接口 GET /projects/:pid 用。 */
export function getProject(
  db: Reader,
  projectId: string,
): Result<ProjectView, ErrorBody<"NOT_FOUND">> {
  const row = findProject(db, projectId);
  return row.ok ? ok(toView(db, row.value)) : row;
}

/** 全部项目，按登记的先后排。 */
export function listProjects(db: Reader): ProjectView[] {
  return db
    .select()
    .from(projects)
    .orderBy(asc(projects.createdAt), asc(projects.id))
    .all()
    .map((row) => toView(db, row));
}

/** 按路径找到的项目，和路径所在的那个根目录。 */
export type FoundProject = { readonly project: ProjectView; readonly root: string };

/**
 * 按路径找项目：从这个路径往上一级一级找，只认登记过的根目录，见「03 数据模型」第五节。
 * 路径是某个根目录本身或在它下面才算，按目录逐级比，不按字符串的开头比，所以 app-2 不算在 app 下面。
 * 几个项目的根目录套在一起时，离路径最近的那个根目录算数。
 */
export function findProjectByPath(
  db: Reader,
  path: string,
): Result<FoundProject, ErrorBody<"BAD_REQUEST" | "NOT_FOUND">> {
  const normalized = normalizePath(path);
  if (!normalized.ok) return normalized;
  const candidates = selfAndAncestors(normalized.value);
  const owners = new Map(
    db
      .select({ path: projectRoots.path, projectId: projectRoots.projectId })
      .from(projectRoots)
      .where(inArray(projectRoots.path, candidates))
      .all()
      .map((row) => [row.path, row.projectId]),
  );
  for (const root of candidates) {
    const owner = owners.get(root);
    if (owner === undefined) continue;
    const row = findProject(db, owner);
    if (!row.ok) return row;
    return ok({ project: toView(db, row.value), root });
  }
  const text = projectsCopy.project.notRegistered;
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { path: normalized.value }),
    hint: renderCopy(text.hint),
    where: normalized.value,
  });
}

/** 路径本身和它的每一级上级目录，从深到浅，最后是 /。 */
function selfAndAncestors(path: string): string[] {
  const list = [path];
  for (let dir = dirname(path); dir !== list.at(-1); dir = dirname(dir)) list.push(dir);
  return list;
}

// ── 要先体检的项目 ──

/**
 * 项目要先体检的两种原因，见「08 版本与迁移」第三、四节。
 * - migrationIncomplete：迁移还没完成。项目表里的 skill 版本为空，迁移完成时由第 61 步写入。
 * - skillOutdated：项目停在的 skill 版本，第一段比这一版软件的小，或者认不出来。
 */
export type DoctorReason = "migrationIncomplete" | "skillOutdated";

/** 项目停在的 skill 版本和这一版软件比较的结果。 */
export type SkillState = {
  /** 项目停在哪一版 skill。迁移完成以前为空。 */
  readonly version: string | null;
  /** 这一版软件自带的 skill 版本，看板上比较时写出来。 */
  readonly current: string;
  /** 要先体检的原因。不用体检时为空。 */
  readonly doctor: DoctorReason | null;
  /** 版本号的第二段比项目的大，有项目还没用上的规则，ploop status 要写一句。 */
  readonly newerRules: boolean;
};

/** 版本号的三段数字。后面带的预发布标记不影响比较，例如 2.0.0-dev.0 按 2.0.0 算。 */
function versionParts(text: string): readonly [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/u.exec(text);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * 比较项目停在的 skill 版本和这一版软件，见「08 版本与迁移」第三节：
 * 第一段加一要体检，第二段加一只提示有新版本的规则，第三段加一什么都不用做。
 */
export function skillState(version: string | null, app: string = appSkillVersion): SkillState {
  if (version === null)
    return { version, current: app, doctor: "migrationIncomplete", newerRules: false };
  const project = versionParts(version);
  const current = versionParts(app);
  if (current === undefined) throw new Error(`这一版软件的版本号写错了：${app}`);
  if (project === undefined || project[0] < current[0]) {
    return { version, current: app, doctor: "skillOutdated", newerRules: false };
  }
  const newerRules = project[0] === current[0] && project[1] < current[1];
  return { version, current: app, doctor: null, newerRules };
}

/**
 * 这一版软件要求项目至少停在哪一版 skill：第一段相同，后两段是 0。
 * 第一段是 0 的时候，写这一版本身，避免说成「要求 0.0.0 以上」。
 */
const minimumSkillVersion = appSkillVersion.startsWith("0.")
  ? appSkillVersion
  : `${appSkillVersion.split(".")[0]}.0.0`;

/**
 * 会改数据的用例在写事务里先调用它：项目要存在，并且不用先体检。
 * 读数据的用例不调用它，所以要先体检的项目照常能查状态。
 * 迁移自己的归档、导入、核对、完成（第 61 步）不调用它，它们正是在迁移完成以前做的。
 * 第 61 步加了迁移状态表以后，可以在 doctorIssue 里写明迁移停在哪一步。
 */
export function requireWritable(
  tx: Reader,
  projectId: string,
): Result<ProjectRow, ErrorBody<"NOT_FOUND" | "NEEDS_DOCTOR">> {
  const row = findProject(tx, projectId);
  if (!row.ok) return row;
  const { skillVersion } = row.value;
  const { doctor } = skillState(skillVersion);
  return doctor === null ? row : fail("NEEDS_DOCTOR", doctorIssue(projectId, skillVersion, doctor));
}

/** 要先体检时报给 AI 的话。改数据的操作把它当报错返回，状态把它当警告列出。 */
export function doctorIssue(
  projectId: string,
  skillVersion: string | null,
  reason: DoctorReason,
): Issue {
  const message =
    reason === "migrationIncomplete"
      ? renderCopy(projectsCopy.doctor.migrationIncomplete.message, { project: projectId })
      : renderCopy(projectsCopy.doctor.skillOutdated.message, {
          project: projectId,
          version: skillVersion ?? "",
          minimum: minimumSkillVersion,
        });
  return { message, hint: renderCopy(projectsCopy.doctor[reason].hint) };
}

// ── 登记和修改 ──

export type RegisterProjectInput = {
  /** 项目根目录，命令行交来的绝对路径。 */
  readonly root: string;
  /** 页头上的系统名。不写时用根目录的名字。 */
  readonly name?: string | undefined;
  readonly repoKind: RepoKind;
  /** 命令行把忽略规则写在了哪个文件。 */
  readonly ignoreFile?: string | undefined;
  /** 迁移前的旧数据在哪里。体检登记旧项目时写，写了就要等迁移完成才能改数据。 */
  readonly legacySource?: string | undefined;
};

export type RegisteredProject = {
  readonly project: ProjectView;
  /** 登记时建好的版本，总是 1。 */
  readonly version: number;
};

/**
 * 登记一个项目：生成编号，记下根目录，并在同一个事务里建好第 1 版，见「04 命令行」第二节的 ploop init。
 * 新项目记下这一版的 skill 版本，可以直接用。旧项目的 skill 版本留空，迁移完成以前要先体检。
 */
export function registerProject(
  ctx: WriteContext,
  reserved: ReservedDirs,
  input: RegisterProjectInput,
): Result<RegisteredProject, ErrorBody<"BAD_REQUEST" | "CONFLICT">> {
  const root = checkRoot(input.root, reserved);
  if (!root.ok) return root;
  const name = checkName(input.name);
  if (!name.ok) return name;
  return writeTx(ctx, (w) => {
    const owner = rootOwner(w.tx, root.value);
    if (owner !== undefined) return rootTaken(root.value, owner);
    const id = uniqueProjectId(w.tx, projectIdBase(basename(root.value)));
    const legacySource = input.legacySource ?? null;
    const row = w.tx
      .insert(projects)
      .values({
        id,
        name: name.value ?? (basename(root.value) || id),
        repoKind: input.repoKind,
        ignoreFile: input.ignoreFile ?? null,
        skillVersion: legacySource === null ? appSkillVersion : null,
        legacySource,
        createdAt: w.now,
      })
      .returning()
      .get();
    w.tx.insert(projectRoots).values({ projectId: id, path: root.value, addedAt: w.now }).run();
    w.tx
      .insert(productVersions)
      .values({ projectId: id, version: 1, status: "open", startedAt: w.now })
      .run();
    appendEvent(w, {
      projectId: id,
      kind: "project.registered",
      objectType: "project",
      objectId: id,
      detail: { name: row.name, root: root.value, repoKind: row.repoKind, legacySource },
    });
    appendEvent(w, {
      projectId: id,
      kind: "version.started",
      objectType: "productVersion",
      objectId: "1",
    });
    return ok({ project: toView(w.tx, row), version: 1 });
  });
}

/** 名称去掉首尾的空白。没写时返回 undefined，写了却是空的就报错。 */
function checkName(name: string | undefined): Result<string | undefined, ErrorBody<"BAD_REQUEST">> {
  const trimmed = name?.trim();
  if (trimmed !== "") return ok(trimmed);
  const text = projectsCopy.name.empty;
  return fail("BAD_REQUEST", { message: renderCopy(text.message), hint: renderCopy(text.hint) });
}

/** 要改的几项，没写的不改。对应接口 PATCH /projects/:pid，见「05 接口」第四节。 */
export type ProjectPatch = {
  readonly name?: string | undefined;
  readonly repoKind?: RepoKind | undefined;
  /** 写 null 表示不再记忽略规则的位置。 */
  readonly ignoreFile?: string | null | undefined;
  /** 加上的根目录，例如 git 的另一个工作目录。已经登记给这个项目的不重复加。 */
  readonly addRoots?: readonly string[] | undefined;
  /** 删掉的根目录。项目至少要留一个。 */
  readonly removeRoots?: readonly string[] | undefined;
};

/**
 * 在一个事务里改项目的名称、仓库类别、忽略规则的位置和根目录。ploop init 重跑时用。
 * 一个项目可以有多个根目录，一个根目录只能属于一个项目。
 */
export function updateProject(
  ctx: WriteContext,
  reserved: ReservedDirs,
  projectId: string,
  patch: ProjectPatch,
): Result<ProjectView, ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  const name = checkName(patch.name);
  if (!name.ok) return name;
  const adds = checkRoots(patch.addRoots ?? [], (path) => checkRoot(path, reserved));
  if (!adds.ok) return adds;
  const removes = checkRoots(patch.removeRoots ?? [], normalizePath);
  if (!removes.ok) return removes;
  type Failure = ErrorBody<"CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<ProjectView, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const row = project.value;
    const current = rootsOf(w.tx, projectId);
    const added = adds.value.filter((path) => !current.includes(path));
    for (const path of added) {
      const owner = rootOwner(w.tx, path);
      if (owner !== undefined) return rootTaken(path, owner);
    }
    const missing = removes.value.find((path) => !current.includes(path));
    if (missing !== undefined) {
      const text = projectsCopy.root.notInProject;
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, path: missing }),
        hint: renderCopy(text.hint),
        where: missing,
      });
    }
    const removed = removes.value;
    if ([...current, ...added].every((path) => removed.includes(path))) {
      const text = projectsCopy.root.none;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { project: projectId }),
        hint: renderCopy(text.hint),
      });
    }
    const changes = {
      ...(name.value === undefined || name.value === row.name ? {} : { name: name.value }),
      ...(patch.repoKind === undefined || patch.repoKind === row.repoKind
        ? {}
        : { repoKind: patch.repoKind }),
      ...(patch.ignoreFile === undefined || patch.ignoreFile === row.ignoreFile
        ? {}
        : { ignoreFile: patch.ignoreFile }),
    };
    if (Object.keys(changes).length > 0) {
      w.tx.update(projects).set(changes).where(eq(projects.id, projectId)).run();
    }
    for (const path of added) {
      w.tx.insert(projectRoots).values({ projectId, path, addedAt: w.now }).run();
    }
    if (removed.length > 0) {
      w.tx.delete(projectRoots).where(inArray(projectRoots.path, removed)).run();
    }
    const rootChanges = {
      ...(added.length === 0 ? {} : { rootsAdded: added }),
      ...(removed.length === 0 ? {} : { rootsRemoved: removed }),
    };
    if (Object.keys(changes).length + Object.keys(rootChanges).length > 0) {
      appendEvent(w, {
        projectId,
        kind: "project.edited",
        objectType: "project",
        objectId: projectId,
        detail: { ...changes, ...rootChanges },
      });
    }
    const updated = findProject(w.tx, projectId);
    return updated.ok ? ok(toView(w.tx, updated.value)) : updated;
  });
}
