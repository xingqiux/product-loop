import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// S13 在一个项目里开工，照第一期计划第 14 步的抄录：干净目录和临时 PLOOP_HOME 下
// ploop init --repo 自己的，建好项目缓存，写好 .gitignore；共用的仓库写 .git/info/exclude。
// 后端没开时自动拉起，输出不多一行。再敲 ploop，写出第 1 版、还没开始任何阶段、下一步。

describe("S13 在一个项目里开工", { timeout: 60_000 }, () => {
  it("干净目录：init 拉起后端、建项目缓存、写 .gitignore，再敲 ploop 看到第 1 版", () => {
    const s = sandbox();
    const root = s.at("proj/app");
    expect(s.runInfo()).toBeUndefined();

    const init = s.ploop("proj/app", "init", "--repo", "自己的");
    expect(init.stdout).toBe(
      [
        "开工了：项目 app，第 1 版",
        `根目录：${root}`,
        "项目缓存：.product-loop/",
        "仓库：自己的，忽略规则写进了 .gitignore",
        "主线：写好了模板 .product-loop/主线.md，只有标题。",
        "会话开始钩子：没写。请先问用户，要不要在会话开始时自动运行 ploop prime。同意就运行 ploop init --hook 是。",
        "",
        "下一步：",
        "  1. ploop round start 构思",
        "",
      ].join("\n"),
    );
    // 后端是自动拉起的，没有多打印一行。
    expect(init.stderr).toBe("");
    expect(init.code).toBe(0);
    expect(s.runInfo()?.home).toBe(s.store);

    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(".product-loop/\n");
    expect(JSON.parse(readFileSync(join(root, ".product-loop", "project.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      projectId: "app",
      skillVersion: "0.0.1",
      // 主线模板当场交成了第 1 版。
      mainlineBase: { revision: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/u) },
    });
    expect(existsSync(join(root, ".product-loop", "README.md"))).toBe(true);
    expect(readFileSync(join(root, ".product-loop", "主线.md"), "utf8")).toContain(
      "## 10 设计规范",
    );

    const status = s.ploop("proj/app");
    expect(status.stdout.split("\n")).toEqual([
      "项目 app：第 1 版，还没开始任何阶段",
      "在等的页：没有",
      "队列里没做完的事：没有",
      "主线缺 10 个部分",
      "其中设计规范缺 12 个部分",
      "",
      "下一步：",
      "  1. ploop round start 构思",
      "",
    ]);
    expect(status.stderr).toBe("");
    expect(status.code).toBe(0);
  });

  it("不在项目里：别的命令说找不到，退出码 4，当前目录就是边界时不写「找到」自己；init 在家目录里是用法错误", () => {
    const s = sandbox();
    const deep = s.ploop("notes/a/b", "status");
    expect(deep.stderr).toContain(
      `找不到：从 ${s.at("notes/a/b")} 找到 ${s.at("notes")}，都没有项目缓存。`,
    );
    expect(deep.code).toBe(4);
    const top = s.ploop("notes", "status");
    expect(top.stderr).toContain(`找不到：${s.at("notes")} 里没有 .product-loop/project.json。`);
    expect(top.code).toBe(4);

    const home = s.ploop(".", "status");
    expect(home.stderr).toContain("找不到：家目录不能当项目根目录");
    expect(home.stderr).toContain("要开工就到项目的根目录运行 ploop init，");
    expect(home.code).toBe(4);

    const init = s.ploop(".", "init", "--repo", "自己的");
    expect(init.stderr).toContain("用法错误：家目录不能当项目根目录");
    expect(init.code).toBe(2);
  });

  it("第一次开工没写 --repo：退出码 2，写出要问用户的话和两条完整的命令，不写任何文件", () => {
    const s = sandbox();
    const { code, stdout, stderr } = s.ploop("proj/app", "init");
    expect(stdout).toBe("");
    expect(stderr).toBe(
      [
        "用法错误：第一次开工要写 --repo。请先问用户：这个仓库是自己的，还是和别人共用的？",
        "怎么改：用户说自己的，运行 ploop init --repo 自己的。说共用的，运行 ploop init --repo 共用的。",
        "",
      ].join("\n"),
    );
    expect(code).toBe(2);
    expect(existsSync(s.at("proj/app/.product-loop"))).toBe(false);
    expect(existsSync(s.at("proj/app/.gitignore"))).toBe(false);
  });

  it("共用的仓库：在子目录里开工，根目录取仓库的根目录，规则写进 .git/info/exclude", () => {
    const s = sandbox();
    s.gitInit("proj/shared");
    const root = s.at("proj/shared");
    const { code, stdout } = s.ploop("proj/shared/src", "init", "--repo", "共用的");
    expect(stdout).toContain(`根目录：${root}\n`);
    expect(stdout).toContain("仓库：共用的，忽略规则写进了 .git/info/exclude\n");
    expect(code).toBe(0);
    expect(readFileSync(join(root, ".git", "info", "exclude"), "utf8")).toMatch(
      /\n\.product-loop\/\n$/u,
    );
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
    expect(existsSync(join(root, ".product-loop", "project.json"))).toBe(true);
  });

  it("共用的仓库却不在 git 里：退出码 2，提示改写 --repo 自己的", () => {
    const s = sandbox();
    const { code, stderr } = s.ploop("proj/plain", "init", "--repo", "共用的");
    expect(stderr).toContain("用法错误：当前目录不在 git 仓库里，找不到 .git/info/exclude。");
    expect(stderr).toContain(`位置：${s.at("proj/plain")}`);
    expect(stderr).toContain("怎么改：不用 git 时改写 --repo 自己的");
    expect(code).toBe(2);
  });

  it("重跑：不用再写 --repo，不重复写规则；project.json 被删了也能找回", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的");
    const again = s.ploop("proj/app", "init");
    expect(again.stdout.split("\n")[0]).toBe("已经开工过：项目 app");
    expect(again.stdout).toContain("下一步：\n  1. ploop status\n");
    expect(again.code).toBe(0);
    expect(readFileSync(s.at("proj/app/.gitignore"), "utf8")).toBe(".product-loop/\n");

    rmSync(s.at("proj/app/.product-loop"), { recursive: true });
    const restored = s.ploop("proj/app", "init", "--json");
    expect(cliEnvelopeSchema.parse(JSON.parse(restored.stdout))).toMatchObject({
      kind: "project.initialized",
      data: { created: false, project: { id: "app", repoKind: "自己的" } },
    });
    expect(existsSync(s.at("proj/app/.product-loop/project.json"))).toBe(true);
  });

  it("重跑时改写 --repo：登记的仓库类别跟着改，规则写进新的位置", () => {
    const s = sandbox();
    s.gitInit("proj/app");
    s.ploop("proj/app", "init", "--repo", "自己的");
    const { code, stdout } = s.ploop("proj/app", "init", "--repo", "共用的");
    expect(stdout).toContain("仓库由自己的改成了共用的\n");
    expect(code).toBe(0);
    expect(readFileSync(s.at("proj/app/.git/info/exclude"), "utf8")).toContain(".product-loop/\n");
  });

  it("project.json 写的项目和这个目录登记的不同：集中存储是准的，按它改回来，不用做迁移检查", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的");
    const file = s.at("proj/app/.product-loop/project.json");
    writeFileSync(
      file,
      JSON.stringify({ schemaVersion: 1, projectId: "other", skillVersion: "0.0.1" }),
    );
    const blocked = s.ploop("proj/app", "status");
    expect(blocked.stderr).toContain(
      "要先做迁移检查：项目缓存里记着项目 other，集中存储里没有登记它。",
    );
    expect(blocked.stderr).toContain("怎么改：运行 ploop init 重新登记");
    expect(blocked.code).toBe(6);
    const { code, stdout } = s.ploop("proj/app", "init");
    expect(stdout.split("\n")[0]).toBe("项目缓存里的 other 改成了 app，这个目录登记给了它。");
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ projectId: "app" });
    expect(s.ploop("proj/app", "status").code).toBe(0);
  });
});

describe("自己的仓库里 .gitignore 还没提交", { timeout: 60_000 }, () => {
  const reminder = "提醒：.gitignore 还没有提交。落地阶段收尾前要先提交它，不然会被拦住。";

  it("在 git 仓库里 init 以后提醒提交；提交以后不再提醒；不在 git 里、共用的仓库不提醒", () => {
    const s = sandbox();
    s.gitInit("proj/app");
    const first = s.ploop("proj/app", "init", "--repo", "自己的");
    expect(first.stdout).toContain(reminder);
    expect(first.code).toBe(0);

    execFileSync("git", ["add", ".gitignore"], { cwd: s.at("proj/app") });
    execFileSync("git", ["commit", "-q", "-m", "chore: 忽略产品循环的项目缓存"], {
      cwd: s.at("proj/app"),
      env: {
        ...s.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@example.com",
      },
    });
    expect(s.ploop("proj/app", "init").stdout).not.toContain("还没有提交");

    // 不在 git 里：没有提交这回事。
    expect(s.ploop("proj/plain", "init", "--repo", "自己的").stdout).not.toContain("还没有提交");
    // 共用的仓库写 .git/info/exclude，不改仓库里的文件。
    s.gitInit("proj/shared");
    expect(s.ploop("proj/shared", "init", "--repo", "共用的").stdout).not.toContain("还没有提交");
  });
});
