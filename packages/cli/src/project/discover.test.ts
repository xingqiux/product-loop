import { readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { type ErrorBody, err, errorBody, ok, type Result } from "@product-loop/model";
import { describe, expect, it, vi } from "vitest";
import { exitCodeOf, render } from "../output.ts";
import { type DiscoverOptions, discoverProject, noProjectError } from "./discover.ts";
import { identity, makeTree, projectJson, type TreeItem, tempRoot } from "./testing.ts";

const doctorHint = "运行 ploop doctor，按它的报告迁移。";

/** 临时目录下建好家目录和目录树。at 把树里的相对路径换成绝对路径。 */
function setup(items: readonly TreeItem[]) {
  const base = tempRoot();
  makeTree(base, ["home/", ...items]);
  return { base, home: join(base, "home"), at: (path: string) => join(base, path) };
}

/** 结果对应的退出码。 */
function exitOf(result: Result<unknown, ErrorBody>) {
  return result.ok ? 0 : exitCodeOf(err(result.error));
}

describe("往上找 project.json", () => {
  it("在项目根目录运行时，找到这个项目", async () => {
    const { home, at } = setup(["home/app/.git/", projectJson("home/app")]);
    expect(await discoverProject({ cwd: at("home/app"), home })).toEqual(
      ok({ kind: "found", root: at("home/app"), identity }),
    );
  });

  it("在子目录里运行时，往上找到项目根目录", async () => {
    const { home, at } = setup(["home/app/.git/", projectJson("home/app"), "home/app/src/a/b/"]);
    expect(await discoverProject({ cwd: at("home/app/src/a/b"), home })).toEqual(
      ok({ kind: "found", root: at("home/app"), identity }),
    );
  });

  it("项目根目录可以在仓库的子目录里", async () => {
    const { home, at } = setup([
      "home/mono/.git/",
      projectJson("home/mono/apps/web"),
      "home/mono/apps/web/src/",
    ]);
    expect(await discoverProject({ cwd: at("home/mono/apps/web/src"), home })).toEqual(
      ok({ kind: "found", root: at("home/mono/apps/web"), identity }),
    );
  });

  it("最近的 project.json 就是当前项目", async () => {
    const inner = { ...identity, projectId: "lib" };
    const { home, at } = setup([
      projectJson("home/app"),
      projectJson("home/app/packages/lib", JSON.stringify(inner)),
      "home/app/packages/lib/src/",
    ]);
    expect(await discoverProject({ cwd: at("home/app/packages/lib/src"), home })).toEqual(
      ok({ kind: "found", root: at("home/app/packages/lib"), identity: inner }),
    );
  });

  it("当前目录经过符号链接时，根目录写解开以后的路径", async () => {
    const { home, at } = setup([projectJson("home/app"), "home/app/src/"]);
    symlinkSync(at("home/app"), at("home/link"));
    expect(await discoverProject({ cwd: at("home/link/src"), home })).toEqual(
      ok({ kind: "found", root: at("home/app"), identity }),
    );
  });
});

describe("git 仓库的边界", () => {
  it("在仓库里找到仓库的根目录为止，仓库外面的 project.json 不算", async () => {
    const { home, at } = setup([
      projectJson("home/outer"),
      "home/outer/repo/.git/",
      "home/outer/repo/src/",
    ]);
    expect(await discoverProject({ cwd: at("home/outer/repo/src"), home })).toEqual(
      ok({
        kind: "none",
        from: at("home/outer/repo/src"),
        to: at("home/outer/repo"),
        gitRoot: at("home/outer/repo"),
      }),
    );
  });

  it("git 的工作目录和子模块里 .git 是文件，也按仓库的根目录认", async () => {
    const { home, at } = setup([
      projectJson("home/outer"),
      ["home/outer/wt/.git", "gitdir: /Users/me/proj/app/.git/worktrees/wt\n"],
      "home/outer/wt/src/",
    ]);
    expect(await discoverProject({ cwd: at("home/outer/wt/src"), home })).toEqual(
      ok({
        kind: "none",
        from: at("home/outer/wt/src"),
        to: at("home/outer/wt"),
        gitRoot: at("home/outer/wt"),
      }),
    );
  });
});

describe("家目录", () => {
  it("不在仓库里时找到家目录为止，家目录下的 .product-loop/ 是集中存储，不看", async () => {
    const { home, at } = setup([
      projectJson("home"),
      "home/.product-loop/主线.md",
      "home/.product-loop/队列.md",
      "home/docs/主线.md",
      "home/notes/drafts/",
    ]);
    expect(await discoverProject({ cwd: at("home/notes/drafts"), home })).toEqual(
      ok({ kind: "none", from: at("home/notes/drafts"), to: at("home/notes") }),
    );
  });

  it("家目录外面的 project.json 也不算", async () => {
    const { home, at } = setup([projectJson("."), "home/notes/"]);
    expect(await discoverProject({ cwd: at("home/notes"), home })).toEqual(
      ok({ kind: "none", from: at("home/notes"), to: at("home/notes") }),
    );
  });

  it("不在家目录下时没有家目录这一道边界，一直往上找", async () => {
    const { home, at } = setup([projectJson("."), "elsewhere/deep/"]);
    expect(await discoverProject({ cwd: at("elsewhere/deep"), home })).toEqual(
      ok({ kind: "found", root: at("."), identity }),
    );
  });

  it("在家目录运行时和别的没有项目的目录一样报找不到，退出码 4，提示到项目根目录运行 ploop init", async () => {
    const { home } = setup([projectJson("home")]);
    const result = await discoverProject({ cwd: home, home });
    expect(result).toEqual(
      err({
        code: "NOT_FOUND",
        message: "家目录不能当项目根目录，否则项目缓存和集中存储会是同一个文件夹。",
        hint: "要开工就到项目的根目录运行 ploop init，或者用 --project 指定项目。",
        where: home,
      }),
    );
    expect(exitOf(result)).toBe(4);
  });

  it("不在项目里也能用的命令在家目录里运行：当没有项目，不报错", async () => {
    const { home } = setup([projectJson("home")]);
    expect(await discoverProject({ cwd: home, home, homeIsNone: true })).toEqual(
      ok({ kind: "none", from: home, to: home }),
    );
  });

  it("ploop init 在家目录开工是用法错误，退出码 2", async () => {
    const { home } = setup([projectJson("home")]);
    const result = await discoverProject({ cwd: home, home, homeIsUsage: true });
    expect(result).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(exitOf(result)).toBe(2);
  });

  it("--project 指到家目录也一样；家目录写成符号链接时照样认得出", async () => {
    const { home, at } = setup(["work/"]);
    symlinkSync(home, at("home-link"));
    for (const options of [
      { cwd: at("work"), home, projectOption: "~" },
      { cwd: at("work"), home, projectOption: home },
      { cwd: at("work"), home, projectOption: "../home" },
      { cwd: home, home: at("home-link") },
      { cwd: at("home-link"), home },
    ] satisfies DiscoverOptions[]) {
      const result = await discoverProject(options);
      expect(result.ok ? result.value : result.error.code).toBe("NOT_FOUND");
    }
  });
});

describe("project.json 写坏了", () => {
  it("要先做迁移检查，退出码 6，位置写到文件里的行和列", async () => {
    const { home, at } = setup([projectJson("home/app", '{"schemaVersion": 1,,}')]);
    const result = await discoverProject({ cwd: at("home/app"), home });
    expect(result).toEqual(
      err({
        code: "NEEDS_DOCTOR",
        message: "project.json 不是合法的 JSON。",
        hint: "project.json 只由命令写，不要手改。运行 ploop doctor 做迁移检查。",
        where: `${at("home/app/.product-loop/project.json")} 第 1 行第 21 列`,
      }),
    );
    expect(exitOf(result)).toBe(6);
  });

  it("格式不对时也是要先做迁移检查，位置写到字段", async () => {
    const { home, at } = setup([
      projectJson("home/app", JSON.stringify({ ...identity, projectId: "App" })),
    ]);
    const result = await discoverProject({ cwd: at("home/app"), home });
    expect(result.ok ? result.value : [result.error.code, result.error.where]).toEqual([
      "NEEDS_DOCTOR",
      `${at("home/app/.product-loop/project.json")} → projectId`,
    ]);
  });

  it("写坏的不往上接着找", async () => {
    const { home, at } = setup([projectJson("home/app"), projectJson("home/app/sub", "{")]);
    const result = await discoverProject({ cwd: at("home/app/sub"), home });
    expect(result.ok ? result.value : result.error.code).toBe("NEEDS_DOCTOR");
  });
});

describe("旧布局", () => {
  it("项目缓存是旧 skill 的样子：要先做迁移检查，退出码 6（鹿鸣）", async () => {
    const { home, at } = setup([
      "home/luminary/.git/",
      "home/luminary/.product-loop/队列.md",
      "home/luminary/.product-loop/决定.md",
      "home/luminary/.product-loop/主线.md",
      "home/luminary/.product-loop/walk/2026-09-18/",
      "home/luminary/.product-loop/land/6/",
      "home/luminary/src/",
    ]);
    const result = await discoverProject({ cwd: at("home/luminary/src"), home });
    expect(result).toEqual(
      err({
        code: "NEEDS_DOCTOR",
        message:
          "项目缓存里有 主线.md、决定.md、队列.md、walk/、land/，没有 project.json，迁移还没有完成。",
        hint: doctorHint,
        where: at("home/luminary/.product-loop"),
      }),
    );
    expect(exitOf(result)).toBe(6);
  });

  it("docs 下的旧文件：要先做迁移检查（Sketch Board 插件）", async () => {
    const { home, at } = setup([
      "home/sketch-board/.git/",
      "home/sketch-board/docs/队列.md",
      "home/sketch-board/docs/主线.md",
      "home/sketch-board/docs/决定.md",
      "home/sketch-board/docs/walk/2026-09-20/",
      "home/sketch-board/docs/cases/",
    ]);
    const result = await discoverProject({ cwd: at("home/sketch-board"), home });
    expect(result).toEqual(
      err({
        code: "NEEDS_DOCTOR",
        message: "产品循环的旧文件还在 docs/ 下，有 主线.md、决定.md、队列.md、walk/。",
        hint: doctorHint,
        where: at("home/sketch-board/docs"),
      }),
    );
  });

  it("旧文件夹：提示到项目根目录用 --from 指明它（skill 自己的产品文档）", async () => {
    const folder = "home/Documents/产品循环/skill自己的产品文档";
    const { home, at } = setup([
      `${folder}/队列.json`,
      `${folder}/决定.md`,
      `${folder}/主线.md`,
      `${folder}/land/`,
      `${folder}/walk/2026-09-20/`,
    ]);
    const result = await discoverProject({ cwd: at(`${folder}/walk/2026-09-20`), home });
    expect(result).toEqual(
      err({
        code: "NEEDS_DOCTOR",
        message:
          "这是旧 skill 的产品文档文件夹，里面有 主线.md、决定.md、队列.json、walk/、land/。",
        hint: `到项目根目录运行 ploop doctor --from ${at(folder)}。`,
        where: at(folder),
      }),
    );
  });

  it("迁移做了一半：只有 migrate/、没有 project.json，也要先做迁移检查", async () => {
    const { home, at } = setup(["home/pl/.git/", "home/pl/.product-loop/migrate/队列迁移对照.md"]);
    const result = await discoverProject({ cwd: at("home/pl"), home });
    expect(result.ok ? result.value : [result.error.code, result.error.message]).toEqual([
      "NEEDS_DOCTOR",
      "项目缓存里有 migrate/，没有 project.json，迁移还没有完成。",
    ]);
  });

  it("在旧的 .product-loop/ 里面运行时，按项目缓存报，不按旧文件夹报", async () => {
    const { home, at } = setup([
      "home/luminary/.product-loop/队列.md",
      "home/luminary/.product-loop/主线.md",
      "home/luminary/.product-loop/walk/2026-09-18/",
    ]);
    const result = await discoverProject({
      cwd: at("home/luminary/.product-loop/walk/2026-09-18"),
      home,
    });
    expect(result.ok ? result.value : result.error.where).toBe(at("home/luminary/.product-loop"));
  });

  it("同一层有几种旧布局时逐条列出", async () => {
    const { home, at } = setup(["home/app/.product-loop/队列.md", "home/app/docs/主线.md"]);
    const result = await discoverProject({ cwd: at("home/app"), home });
    expect(result.ok ? result.value : result.error.issues?.map((issue) => issue.where)).toEqual([
      at("home/app/.product-loop"),
      at("home/app/docs"),
    ]);
  });

  it("报离当前目录最近的那一层", async () => {
    const { home, at } = setup([
      "home/a/docs/主线.md",
      "home/a/b/.product-loop/队列.md",
      "home/a/b/c/",
    ]);
    const result = await discoverProject({ cwd: at("home/a/b/c"), home });
    expect(result.ok ? result.value : [result.error.where, result.error.total]).toEqual([
      at("home/a/b/.product-loop"),
      undefined,
    ]);
  });

  it("更远的一层有 project.json 时，用那个项目，比它近的旧文件不管", async () => {
    const { home, at } = setup([
      "home/mono/.git/",
      projectJson("home/mono"),
      "home/mono/apps/web/docs/决定.md",
      "home/mono/apps/web/src/",
    ]);
    expect(await discoverProject({ cwd: at("home/mono/apps/web/src"), home })).toEqual(
      ok({ kind: "found", root: at("home/mono"), identity }),
    );
  });

  it("只看不改：找之前和找之后，目录树里的每个文件都没变", async () => {
    const { base, home, at } = setup([
      "home/sketch-board/.git/",
      ["home/sketch-board/docs/队列.md", "| 内容 | 阶段 |\n"],
      ["home/sketch-board/docs/主线.md", "# 主线\n"],
      "home/sketch-board/docs/walk/2026-09-20/",
    ]);
    const snapshot = () =>
      readdirSync(base, { recursive: true, encoding: "utf8" })
        .sort()
        .map((path) => {
          const full = join(base, path);
          const stats = statSync(full);
          return [path, stats.mtimeMs, stats.isFile() ? readFileSync(full, "utf8") : "/"];
        });
    const before = snapshot();
    await discoverProject({ cwd: at("home/sketch-board/docs/walk/2026-09-20"), home });
    expect(snapshot()).toEqual(before);
  });
});

describe("登记过的根目录", () => {
  it("问后端时带上根目录和项目编号，登记过就找到项目", async () => {
    const { home, at } = setup([projectJson("home/app"), "home/app/src/"]);
    const isRegisteredRoot = vi.fn(async () => ok(true));
    expect(await discoverProject({ cwd: at("home/app/src"), home, isRegisteredRoot })).toEqual(
      ok({ kind: "found", root: at("home/app"), identity }),
    );
    expect(isRegisteredRoot.mock.calls).toEqual([[at("home/app"), "app"]]);
  });

  it("没登记过：要先做迁移检查，退出码 6", async () => {
    const { home, at } = setup([projectJson("home/copy")]);
    const result = await discoverProject({
      cwd: at("home/copy"),
      home,
      isRegisteredRoot: async () => ok(false),
    });
    expect(result).toEqual(
      err({
        code: "NEEDS_DOCTOR",
        message: "项目缓存里记着项目 app，集中存储里没有登记它。",
        hint: "运行 ploop init 重新登记，项目缓存里的主线.md 和各阶段的文件保留。数据库恢复过较早的备份时常有这种情况。",
        where: at("home/copy/.product-loop/project.json"),
      }),
    );
    expect(exitOf(result)).toBe(6);
  });

  it("问后端出错时，原样交回后端的报错", async () => {
    const { home, at } = setup([projectJson("home/app")]);
    const busy = errorBody("BUSY", [{ message: "后端正在迁移或恢复数据，暂时不能写入。" }]);
    const result = await discoverProject({
      cwd: at("home/app"),
      home,
      isRegisteredRoot: async () => err(busy),
    });
    expect(result).toEqual(err(busy));
  });

  it("没找到项目、写的是编号、project.json 写坏了，都不问后端", async () => {
    const { home, at } = setup(["home/empty/", projectJson("home/bad", "{")]);
    const isRegisteredRoot = vi.fn(async () => ok(true));
    await discoverProject({ cwd: at("home/empty"), home, isRegisteredRoot });
    await discoverProject({ cwd: at("home/empty"), home, projectOption: "app", isRegisteredRoot });
    await discoverProject({ cwd: at("home/bad"), home, isRegisteredRoot });
    expect(isRegisteredRoot).not.toHaveBeenCalled();
  });
});

describe("--project", () => {
  it("写项目编号时交回编号，由调用的地方问后端；当前目录在哪里都行", async () => {
    const { home } = setup([]);
    for (const projectId of ["sketch-board", "app", "abei2"]) {
      expect(await discoverProject({ cwd: home, home, projectOption: projectId })).toEqual(
        ok({ kind: "byId", projectId }),
      );
    }
  });

  it.each([
    ["相对路径按当前目录展开", "../app/src"],
    ["写 ./ 开头的相对路径", "./../app"],
    ["~ 开头的按家目录展开", "~/app/src"],
  ])("%s，从那里往上找", async (_name, projectOption) => {
    const { home, at } = setup([projectJson("home/app"), "home/app/src/", "home/work/"]);
    expect(await discoverProject({ cwd: at("home/work"), home, projectOption })).toEqual(
      ok({ kind: "found", root: at("home/app"), identity }),
    );
  });

  it("写绝对路径；写 . 等于不写", async () => {
    const { home, at } = setup([projectJson("home/app"), "home/app/src/"]);
    const found = ok({ kind: "found", root: at("home/app"), identity });
    expect(await discoverProject({ cwd: home, home, projectOption: at("home/app/src") })).toEqual(
      found,
    );
    expect(await discoverProject({ cwd: at("home/app/src"), home, projectOption: "." })).toEqual(
      found,
    );
  });

  it.each([
    ["路径不存在", "./nope"],
    ["写的是文件", "./app/README.md"],
  ])("%s：找不到，退出码 4", async (_name, projectOption) => {
    const { home } = setup([projectJson("home/app"), "home/app/README.md"]);
    const result = await discoverProject({ cwd: home, home, projectOption });
    const path = join(home, projectOption);
    expect(result).toEqual(
      err({
        code: "NOT_FOUND",
        message: `目录 ${path} 不存在。`,
        hint: "--project 写项目里任何一个目录的路径，或者写项目名。",
      }),
    );
    expect(exitOf(result)).toBe(4);
  });

  it.each(["Sketch_Board", "app-", "产品循环", ""])(
    "既不是路径也不是项目名（%j）：用法错误，退出码 2",
    async (projectOption) => {
      const { home } = setup([]);
      const result = await discoverProject({ cwd: home, home, projectOption });
      expect(result).toEqual(
        err({
          code: "BAD_REQUEST",
          message: `--project 的取值「${projectOption}」既不是路径，也不是项目名。`,
          hint: "路径要含有 /，例如 ./app。项目名只用小写字母、数字和短横，例如 sketch-board。",
        }),
      );
      expect(exitOf(result)).toBe(2);
    },
  );
});

describe("没有找到项目", () => {
  it("报找不到，退出码 4，提示在项目根目录运行 ploop init", () => {
    const body = noProjectError({
      kind: "none",
      from: "/Users/me/proj/app/src",
      to: "/Users/me/proj/app",
    });
    expect(exitCodeOf(err(body))).toBe(4);
    expect(render(err(body), false).stderr).toBe(
      [
        "找不到：从 /Users/me/proj/app/src 找到 /Users/me/proj/app，都没有项目缓存。",
        "怎么改：要开工就到项目根目录运行 ploop init，或者用 --project 指定项目。",
        "",
      ].join("\n"),
    );
  });

  it("起点就是边界时不写「一直找到」，只说这个目录里没有", () => {
    const body = noProjectError({
      kind: "none",
      from: "/Users/me/proj/app",
      to: "/Users/me/proj/app",
    });
    expect(render(err(body), false).stderr).toBe(
      [
        "找不到：/Users/me/proj/app 里没有 .product-loop/project.json。",
        "怎么改：要开工就到项目根目录运行 ploop init，或者用 --project 指定项目。",
        "",
      ].join("\n"),
    );
  });

  it("当前目录就是找到的边界时，只说这一个目录，不写「找到」自己", () => {
    const body = noProjectError({ kind: "none", from: "/tmp/notes", to: "/tmp/notes" });
    expect(render(err(body), false).stderr).toContain(
      "找不到：/tmp/notes 里没有 .product-loop/project.json。",
    );
  });
});

it("旧布局的报错按「04 命令行」第六节的写法输出：第一行是要先做迁移检查，再写位置和怎么改", async () => {
  const { home, at } = setup(["home/abei/.git/", "home/abei/docs/决定.md"]);
  const result = await discoverProject({ cwd: at("home/abei"), home });
  if (result.ok) throw new Error("应当报要先做迁移检查");
  expect(render(err(result.error), false).stderr).toBe(
    [
      "要先做迁移检查：产品循环的旧文件还在 docs/ 下，有 决定.md。",
      `位置：${at("home/abei/docs")}`,
      `怎么改：${doctorHint}`,
      "",
    ].join("\n"),
  );
});
