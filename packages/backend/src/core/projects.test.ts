import { projectIdSchema } from "@product-loop/model";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { events, productVersions, projectRoots, projects } from "../store/schema/index.ts";
import {
  appSkillVersion,
  findProjectByPath,
  getProject,
  listProjects,
  projectIdBase,
  type ReservedDirs,
  registerProject,
  requireWritable,
  type SkillState,
  skillState,
  updateProject,
} from "./projects.ts";
import { addProject, emptyCore, reservedDirs, startAt, type TestCore } from "./testing.ts";

const later = (ms: number) => new Date(startAt.getTime() + ms);

const eventKinds = (core: TestCore) =>
  core.ctx.db
    .select({ kind: events.kind })
    .from(events)
    .all()
    .map((row) => row.kind);

const projectIds = (core: TestCore) =>
  core.ctx.db
    .select({ id: projects.id })
    .from(projects)
    .all()
    .map((row) => row.id);

/** 把项目的 skill 版本改成别的，模拟迁移没完成或停在旧版本的项目。 */
function setSkillVersion(core: TestCore, id: string, version: string | null): void {
  core.ctx.db.update(projects).set({ skillVersion: version }).where(eq(projects.id, id)).run();
}

describe("项目编号", () => {
  it.each([
    ["product-loop", "product-loop"],
    ["Sketch Board", "sketch-board"],
    ["quality_engineering.origin", "quality-engineering-origin"],
    ["café--2.0", "cafe-2-0"],
    ["ＡＢＣ", "abc"],
    ["-app-", "app"],
    ["鹿鸣", "project"],
    ["skill自己的产品文档", "skill"],
    ["", "project"],
    ["a".repeat(40), "a".repeat(32)],
    [`${"a".repeat(31)}-b`, "a".repeat(31)],
  ])("根目录名「%s」转成 %s，合编号的写法", (name, id) => {
    expect(projectIdBase(name)).toBe(id);
    expect(projectIdSchema.safeParse(id).success).toBe(true);
  });

  it("重名时加数字，从 2 起，加了数字仍合编号的写法", async () => {
    const core = await emptyCore();
    const ids = ["/work/a/app", "/work/b/app", "/work/c/App"].map(
      (root) => addProject(core, root).id,
    );
    expect(ids).toEqual(["app", "app-2", "app-3"]);
    for (const id of ids) expect(projectIdSchema.safeParse(id).success).toBe(true);
  });
});

describe("登记项目", () => {
  it("生成编号，记下根目录，并在同一个事务里建好第 1 版", async () => {
    const core = await emptyCore();
    const result = registerProject(core.ctx, reservedDirs, {
      root: "/Users/someone/proj/product-loop",
      name: "产品循环",
      repoKind: "own",
      ignoreFile: "/Users/someone/proj/product-loop/.gitignore",
    });
    const project = {
      id: "product-loop",
      name: "产品循环",
      repoKind: "own",
      ignoreFile: "/Users/someone/proj/product-loop/.gitignore",
      skillVersion: appSkillVersion,
      legacySource: null,
      roots: ["/Users/someone/proj/product-loop"],
      createdAt: startAt.toISOString(),
    };
    expect(result).toEqual({ ok: true, value: { project, version: 1 } });
    expect(core.ctx.db.select().from(productVersions).all()).toEqual([
      {
        projectId: "product-loop",
        version: 1,
        status: "open",
        startedAt: startAt,
        endedAt: null,
        summary: null,
        endReason: null,
      },
    ]);
    expect(core.received.map((event) => [event.kind, event.objectType, event.objectId])).toEqual([
      ["project.registered", "project", "product-loop"],
      ["version.started", "productVersion", "1"],
    ]);
    expect(core.received[0]?.detail).toEqual({
      name: "产品循环",
      root: "/Users/someone/proj/product-loop",
      repoKind: "own",
      legacySource: null,
    });
    expect(getProject(core.ctx.db, "product-loop")).toEqual({ ok: true, value: project });
  });

  it("名称不写时用根目录的名字，写了去掉首尾的空白", async () => {
    const core = await emptyCore();
    expect(addProject(core, "/work/luminary").name).toBe("luminary");
    expect(addProject(core, "/work/鹿鸣", { name: "  鹿鸣  " }).name).toBe("鹿鸣");
  });

  it("名称写成空白时返回 BAD_REQUEST，什么都不写", async () => {
    const core = await emptyCore();
    const result = registerProject(core.ctx, reservedDirs, {
      root: "/work/app",
      name: "  ",
      repoKind: "own",
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "项目的名称不能是空的。" },
    });
    expect(projectIds(core)).toEqual([]);
  });

  it("新项目记下这一版的 skill 版本，登记完就能改数据", async () => {
    const core = await emptyCore();
    const project = addProject(core, "/work/app", { repoKind: "shared" });
    expect(project).toMatchObject({ skillVersion: appSkillVersion, repoKind: "shared" });
    expect(requireWritable(core.ctx.db, project.id).ok).toBe(true);
  });

  it("迁移检查登记的旧项目不记 skill 版本，迁移完成以前改数据返回 NEEDS_DOCTOR", async () => {
    const core = await emptyCore();
    const project = addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    expect(project).toMatchObject({ skillVersion: null, legacySource: "/work/abei/docs" });
    expect(requireWritable(core.ctx.db, project.id)).toEqual({
      ok: false,
      error: {
        code: "NEEDS_DOCTOR",
        message: "项目「abei」的迁移还没完成，要先做迁移检查。",
        hint: "运行 ploop doctor，按报告做完迁移。迁移完成以前，这个项目的旧文件仍可以用旧的脚本处理。",
      },
    });
  });

  it.each(["/Users/someone", "/Users/someone/", "/Users/someone/proj/.."])(
    "家目录 %s 不能当根目录，什么都不写",
    async (root) => {
      const core = await emptyCore();
      const result = registerProject(core.ctx, reservedDirs, { root, repoKind: "own" });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: "「/Users/someone」是家目录，不能当项目根目录。",
          hint: "换成项目自己的文件夹，例如 ~/proj/<项目名>。",
          where: "/Users/someone",
        },
      });
      expect(projectIds(core)).toEqual([]);
      expect(eventKinds(core)).toEqual([]);
    },
  );

  it.each(["/", "/Users"])("包含家目录的 %s 也不能当根目录", async (root) => {
    const core = await emptyCore();
    const result = registerProject(core.ctx, reservedDirs, { root, repoKind: "own" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: `「${root}」包含家目录，不能当项目根目录。` },
    });
    expect(projectIds(core)).toEqual([]);
  });

  it.each(["/Users/someone/proj/app", "/Users/someone-else", "/Volumes/work/app"])(
    "家目录下面和家目录以外的 %s 可以当根目录",
    async (root) => {
      const core = await emptyCore();
      expect(addProject(core, root).roots).toEqual([root]);
    },
  );

  it("集中存储的上一级不能当根目录，项目缓存会和集中存储是同一个文件夹", async () => {
    const core = await emptyCore();
    const reserved: ReservedDirs = { userHome: "/Users/someone", home: "/tmp/dev/.product-loop" };
    const result = registerProject(core.ctx, reserved, { root: "/tmp/dev", repoKind: "own" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "BAD_REQUEST",
        message: "「/tmp/dev」下的 .product-loop 是集中存储，不能当项目根目录。",
      },
    });
    expect(projectIds(core)).toEqual([]);
  });

  it("根目录要是绝对路径", async () => {
    const core = await emptyCore();
    const result = registerProject(core.ctx, reservedDirs, { root: "proj/app", repoKind: "own" });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST", message: "根目录「proj/app」不是绝对路径。" },
    });
  });

  it("根目录已经登记给别的项目时返回 CONFLICT，写明是哪个项目，路径先整理再比", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app/");
    const result = registerProject(core.ctx, reservedDirs, {
      root: "/work/other/../app",
      repoKind: "own",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "根目录「/work/app」已经登记给项目「app」。",
        hint: "在那个项目里接着用。要改登记，先从那个项目删掉这个根目录。",
        where: "/work/app",
      },
    });
    expect(projectIds(core)).toEqual(["app"]);
  });
});

describe("修改项目和根目录", () => {
  it("一个项目可以有多个根目录，按登记的先后列出，按哪个都找得到", async () => {
    const core = await emptyCore();
    addProject(core, "/work/atlas");
    const result = updateProject(core.ctx, reservedDirs, "atlas", {
      addRoots: ["/work/atlas-ui-scale", "/work/atlas-ui-scale/"],
    });
    expect(result).toMatchObject({
      ok: true,
      value: { roots: ["/work/atlas", "/work/atlas-ui-scale"] },
    });
    for (const path of ["/work/atlas/src", "/work/atlas-ui-scale/src"]) {
      expect(findProjectByPath(core.ctx.db, path)).toMatchObject({
        ok: true,
        value: { project: { id: "atlas" } },
      });
    }
    expect(core.received.at(-1)).toMatchObject({
      kind: "project.edited",
      objectId: "atlas",
      detail: { rootsAdded: ["/work/atlas-ui-scale"] },
    });
  });

  it("加上已经是这个项目的根目录时不重复加，也不记事件", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const before = core.received.length;
    const result = updateProject(core.ctx, reservedDirs, "app", { addRoots: ["/work/app"] });
    expect(result).toMatchObject({ ok: true, value: { roots: ["/work/app"] } });
    expect(core.received).toHaveLength(before);
  });

  it("加上别的项目的根目录时返回 CONFLICT，同一次要改的名称也不改", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addProject(core, "/work/site");
    const result = updateProject(core.ctx, reservedDirs, "site", {
      name: "个人网站",
      addRoots: ["/work/app"],
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "根目录「/work/app」已经登记给项目「app」。" },
    });
    expect(getProject(core.ctx.db, "site")).toMatchObject({
      ok: true,
      value: { name: "site", roots: ["/work/site"] },
    });
  });

  it("家目录不能加成根目录", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const result = updateProject(core.ctx, reservedDirs, "app", { addRoots: ["/Users/someone"] });
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(core.ctx.db.select().from(projectRoots).all()).toHaveLength(1);
  });

  it("删掉一个根目录以后，按它找不到这个项目", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    updateProject(core.ctx, reservedDirs, "app", { addRoots: ["/work/app-wt"] });
    const result = updateProject(core.ctx, reservedDirs, "app", { removeRoots: ["/work/app"] });
    expect(result).toMatchObject({ ok: true, value: { roots: ["/work/app-wt"] } });
    expect(findProjectByPath(core.ctx.db, "/work/app")).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(core.received.at(-1)?.detail).toEqual({ rootsRemoved: ["/work/app"] });
  });

  it("删掉没登记给这个项目的根目录时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    addProject(core, "/work/site");
    const result = updateProject(core.ctx, reservedDirs, "app", { removeRoots: ["/work/site"] });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "项目「app」没有登记根目录「/work/site」。",
        hint: "运行 ploop status，查看这个项目登记了哪些根目录。",
        where: "/work/site",
      },
    });
    expect(getProject(core.ctx.db, "site")).toMatchObject({ value: { roots: ["/work/site"] } });
  });

  it("根目录不能全部删掉，至少留一个", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    updateProject(core.ctx, reservedDirs, "app", { addRoots: ["/work/app-wt"] });
    const result = updateProject(core.ctx, reservedDirs, "app", {
      removeRoots: ["/work/app", "/work/app-wt"],
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "项目「app」至少要留一个根目录。",
        hint: "先加上新的根目录，再删旧的。",
      },
    });
    expect(getProject(core.ctx.db, "app")).toMatchObject({
      value: { roots: ["/work/app", "/work/app-wt"] },
    });
  });

  it("改名称、仓库类别和忽略规则的位置，记一条事件；没有变化时不记", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    core.setNow(later(1000));
    const patch = {
      name: "阿贝记账",
      repoKind: "shared",
      ignoreFile: "/work/.git/info/exclude",
    } as const;
    const result = updateProject(core.ctx, reservedDirs, "app", patch);
    expect(result).toMatchObject({ ok: true, value: patch });
    expect(core.received.at(-1)).toMatchObject({
      kind: "project.edited",
      createdAt: later(1000),
      detail: patch,
    });
    const before = core.received.length;
    expect(updateProject(core.ctx, reservedDirs, "app", patch).ok).toBe(true);
    expect(updateProject(core.ctx, reservedDirs, "app", {}).ok).toBe(true);
    expect(core.received).toHaveLength(before);
  });

  it("名称写成空白时返回 BAD_REQUEST", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const result = updateProject(core.ctx, reservedDirs, "app", { name: "" });
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(getProject(core.ctx.db, "app")).toMatchObject({ value: { name: "app" } });
  });

  it("项目不存在时返回 NOT_FOUND", async () => {
    const core = await emptyCore();
    expect(updateProject(core.ctx, reservedDirs, "ghost", { name: "甲" })).toEqual({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "没有叫「ghost」的项目。",
        hint: "运行 ploop status --all，查看已登记的项目。",
      },
    });
    expect(getProject(core.ctx.db, "ghost")).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});

describe("按路径找项目", () => {
  it("根目录本身和它下面的路径都找得到，并写明在哪个根目录里", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    for (const path of ["/work/app", "/work/app/", "/work/app/src/deep/file.ts"]) {
      expect(findProjectByPath(core.ctx.db, path)).toMatchObject({
        ok: true,
        value: { project: { id: "app", roots: ["/work/app"] }, root: "/work/app" },
      });
    }
  });

  it.each(["/work", "/", "/work/app-2/src", "/work/ap", "/other/work/app"])(
    "只认登记过的根目录：%s 找不到",
    async (path) => {
      const core = await emptyCore();
      addProject(core, "/work/app");
      expect(findProjectByPath(core.ctx.db, path)).toEqual({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `「${path}」不在任何登记过的项目根目录里。`,
          hint: "新项目先在根目录运行 ploop init。已登记的项目运行 ploop doctor，检查根目录。",
          where: path,
        },
      });
    },
  );

  it("几个项目的根目录套在一起时，离得最近的根目录算数", async () => {
    const core = await emptyCore();
    addProject(core, "/work/atlas");
    addProject(core, "/work/atlas/.worktrees/ui-scale", { name: "Atlas 界面大小设置" });
    const found = (path: string) => {
      const result = findProjectByPath(core.ctx.db, path);
      return result.ok ? [result.value.project.id, result.value.root] : result.error.code;
    };
    expect(found("/work/atlas/.worktrees/ui-scale/src")).toEqual([
      "ui-scale",
      "/work/atlas/.worktrees/ui-scale",
    ]);
    expect(found("/work/atlas/.worktrees")).toEqual(["atlas", "/work/atlas"]);
  });

  it("路径要是绝对路径", async () => {
    const core = await emptyCore();
    expect(findProjectByPath(core.ctx.db, "work/app")).toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
  });
});

describe("要先做迁移检查的项目", () => {
  it.each<[string | null, string, Omit<SkillState, "version" | "current">]>([
    [null, "2.0.0", { doctor: "migrationIncomplete", newerRules: false }],
    ["v1-final", "2.0.0", { doctor: "skillOutdated", newerRules: false }],
    ["2.4.1", "3.0.0", { doctor: "skillOutdated", newerRules: false }],
    ["看不懂", "2.0.0", { doctor: "skillOutdated", newerRules: false }],
    ["2.0.0", "2.0.0", { doctor: null, newerRules: false }],
    ["2.0.0-dev.0", "2.0.0", { doctor: null, newerRules: false }],
    ["2.0.3", "2.0.0", { doctor: null, newerRules: false }],
    ["2.0.0", "2.1.0", { doctor: null, newerRules: true }],
  ])("项目停在 %s，这一版是 %s", (version, app, expected) => {
    expect(skillState(version, app)).toEqual({ version, current: app, ...expected });
  });

  it("停在旧版本 skill 的项目，改数据返回 NEEDS_DOCTOR，写明要求的版本", async () => {
    const core = await emptyCore();
    addProject(core, "/work/app");
    setSkillVersion(core, "app", "v1-final");
    const result = updateProject(core.ctx, reservedDirs, "app", { name: "新名字" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "NEEDS_DOCTOR",
        message: "项目「app」停在 skill v1-final，现在的软件要求 0.0.1 以上。",
        hint: "运行 ploop doctor，把这个项目的数据升级到现在的格式。",
      },
    });
    expect(getProject(core.ctx.db, "app")).toMatchObject({ value: { name: "app" } });
  });

  it("迁移没完成的项目，改数据返回 NEEDS_DOCTOR，读照常", async () => {
    const core = await emptyCore();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    const before = core.received.length;
    const result = updateProject(core.ctx, reservedDirs, "abei", { addRoots: ["/work/abei-2"] });
    expect(result).toMatchObject({ ok: false, error: { code: "NEEDS_DOCTOR" } });
    expect(core.received).toHaveLength(before);
    expect(getProject(core.ctx.db, "abei").ok).toBe(true);
    expect(findProjectByPath(core.ctx.db, "/work/abei/docs").ok).toBe(true);
    expect(listProjects(core.ctx.db).map((project) => project.id)).toEqual(["abei"]);
  });

  it("迁移完成、记下 skill 版本以后，就能改数据", async () => {
    const core = await emptyCore();
    addProject(core, "/work/abei", { legacySource: "/work/abei/docs" });
    setSkillVersion(core, "abei", appSkillVersion);
    expect(updateProject(core.ctx, reservedDirs, "abei", { name: "阿贝记账" }).ok).toBe(true);
  });
});

describe("列出项目", () => {
  it("按登记的先后排，每个带着根目录", async () => {
    const core = await emptyCore();
    addProject(core, "/work/site");
    core.setNow(later(1000));
    addProject(core, "/work/app");
    expect(listProjects(core.ctx.db).map((project) => [project.id, project.roots])).toEqual([
      ["site", ["/work/site"]],
      ["app", ["/work/app"]],
    ]);
  });

  it("没有项目时是空的", async () => {
    const core = await emptyCore();
    expect(listProjects(core.ctx.db)).toEqual([]);
  });
});
