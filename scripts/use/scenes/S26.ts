import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, show } from "../browser.ts";
import {
  cloneRepo,
  copySkill,
  differences,
  installedPloop,
  note,
  pnpm,
  pnpmInstall,
  skillTarget,
} from "../install.ts";
import { check, expectRun, pause, repoRoot, type Scene } from "../lib.ts";

// S26 第一次安装。用户，在一台没装过产品循环的电脑上。要让 AI 能在自己的项目里用它。
// 装法写不清或装错，用户第一天就用不了，所以要修。
// 全部在沙盒里做：家目录、集中存储和端口都是临时的，~/.local/bin、~/.claude 和 ~/.product-loop
// 都在临时家目录下面，不碰真实的。仓库的一份副本（git clone --local）放在临时目录里，
// pnpm install 和 pnpm ploop:setup 在副本里敲，副本没有 node_modules，从头装起。
// ploop open 起的「浏览器」换成一个只记地址的小脚本（PLOOP_BROWSER），页由 Playwright 照地址打开。
// 使用代码没有办法新开 Claude Code 会话，第 1 步的后半句只能核对到：目录里的 SKILL.md 头部写着
// name: product-loop，Claude Code 靠它认出技能。

const opened = (w: { home: string }) => join(w.home, "opened-url.txt");

/** ploop open 起的浏览器写下的地址。等它写出来，再删掉，下一次才看得出新的。 */
async function openedUrl(w: { home: string }): Promise<URL> {
  const file = opened(w);
  for (let i = 0; i < 100 && !existsSync(file); i++) await pause(100);
  check(existsSync(file), "ploop open 没有起浏览器");
  const url = new URL(readFileSync(file, "utf8").trim());
  rmSync(file);
  return url;
}

const backendRunFile = (w: { store: string }) => join(w.store, "run", "backend.json");

export const scene: Scene = {
  scene: "S26",
  setup: (w) => {
    // 一台没装过的电脑：项目目录是个空的 git 仓库，浏览器换成只记地址的脚本。
    w.git("init", "--quiet");
    const browser = join(w.home, "fake-browser.sh");
    writeFileSync(browser, `#!/bin/sh\nprintf '%s\\n' "$1" > '${opened(w)}'\n`);
    chmodSync(browser, 0o755);
    w.env.PLOOP_BROWSER = browser;
  },
  steps: [
    {
      do: "把仓库里 skill 文件夹里的内容复制到 ~/.claude/skills/product-loop",
      expect: "那里有 SKILL.md 和 references。新开会话，技能里有 product-loop。",
      run: (w) => {
        const target = skillTarget(w);
        check(!existsSync(target), "装以前 skill 目录就在了");
        copySkill(w);
        note(w, "cp -R skill/. ~/.claude/skills/product-loop", {
          code: 0,
          stdout: "SKILL.md、references/",
          stderr: "",
        });
        check(existsSync(join(target, "SKILL.md")), "那里没有 SKILL.md");
        check(existsSync(join(target, "references")), "那里没有 references");
        check(
          differences(join(repoRoot, "skill"), target).length === 0,
          "复制过去的文件和仓库里的不一致",
        );
        // Claude Code 靠 SKILL.md 头部的 name 认出技能：新开会话，技能里有这个名字。
        const head = readFileSync(join(target, "SKILL.md"), "utf8").split("\n").slice(0, 3);
        check(head.includes("name: product-loop"), `SKILL.md 头部没有 name: product-loop：${head}`);
      },
    },
    {
      do: "在仓库根目录敲 pnpm install",
      expect: "依赖装好，没有报错。Node 低于 24.12 时直接失败，写明版本要求。",
      run: (w) => {
        // 仓库根目录是副本，从当前提交克隆，没有 node_modules。
        const repo = cloneRepo(w);
        w.memo.set("repo", repo);
        check(!existsSync(join(repo, "node_modules")), "副本里已经有 node_modules");
        // 先看 Node 太低时的样子：pnpm 用 --config.node-version 假装是 Node 20，
        // 不用为此装别的 Node。engineStrict 是 true，装不下去。
        const old = pnpm(w, repo, "pnpm install（Node 20.0.0）", [
          "install",
          "--frozen-lockfile",
          "--offline",
          "--config.node-version=20.0.0",
        ]);
        check(old.code !== 0, "Node 20 也装上了，没有直接失败");
        const refusal = `${old.stdout}${old.stderr}`;
        check(
          refusal.includes(">=24.12.0"),
          `Node 太低时没有写明版本要求：${refusal.slice(0, 300)}`,
        );
        const run = pnpmInstall(w, repo);
        expectRun(run, 0);
        check(existsSync(join(repo, "node_modules")), "依赖没有装好");
        check(!/ERR_PNPM|ERROR/u.test(run.stdout + run.stderr), "安装的输出里有报错");
      },
    },
    {
      do: "敲 pnpm ploop:setup",
      expect:
        "写「装好了」、版本号、构建号、安装位置和命令的位置。~/.local/bin 不在 PATH 里时多一条警告，写明怎么加。",
      run: (w) => {
        const repo = w.memo.get("repo") as string;
        const run = pnpm(w, repo, "pnpm ploop:setup", ["ploop:setup"]);
        expectRun(run, 0);
        const text = `${run.stdout}\n${run.stderr}`;
        const built = JSON.parse(readFileSync(join(repo, "dist", "app", "build.json"), "utf8")) as {
          build: string;
          version: string;
        };
        w.memo.set("build", built);
        check(
          text.includes(`装好了：${built.version}（构建号 ${built.build}）`),
          `没有写「装好了」、版本号和构建号：${text.slice(-600)}`,
        );
        const place = join(w.store, "app", built.version);
        check(text.includes(`位置：${place}/`), `没有写安装位置 ${place}/`);
        const launcher = join(w.home, ".local", "bin", "ploop");
        check(text.includes(`命令：${launcher}`), `没有写命令的位置 ${launcher}`);
        check(existsSync(launcher), "命令没有写到 ~/.local/bin");
        // 沙盒的 PATH 里没有 ~/.local/bin，多一条警告，写明怎么加。
        const bin = join(w.home, ".local", "bin");
        check(text.includes(`警告：${bin} 不在 PATH 里`), "PATH 里没有 ~/.local/bin 却没有警告");
        check(
          text.includes('export PATH="$HOME/.local/bin:$PATH"'),
          "警告里没有写怎么把它加进 PATH",
        );
      },
    },
    {
      do: "新开一个终端，敲 ploop --version",
      expect: "写版本号和构建号。",
      run: (w) => {
        const built = w.memo.get("build") as { build: string; version: string };
        // 新开的终端：登录配置把 ~/.local/bin 加进了 PATH，ploop 就是装出来的那一个。
        const bin = join(w.home, ".local", "bin");
        const result = spawnSync("/bin/sh", ["-c", "ploop --version"], {
          cwd: w.root,
          env: { ...w.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
          encoding: "utf8",
        });
        const run = { code: result.status, stdout: result.stdout, stderr: result.stderr };
        note(w, "ploop --version", run);
        expectRun(run, 0, built.version, `构建号：${built.build}`);
        check(
          run.stdout.split("\n")[0]?.trim() === built.version,
          `第一行不是版本号：${run.stdout}`,
        );
      },
    },
    {
      do: "敲 ploop open --all",
      expect: "命令拉起后端，浏览器打开工作台首页，首页写「没有项目」。",
      run: async (w) => {
        check(!existsSync(backendRunFile(w)), "敲命令以前后端已经在运行了");
        const run = installedPloop(w, ["open", "--all"]);
        expectRun(run, 0, "打开了：");
        check(existsSync(backendRunFile(w)), "命令没有拉起后端");
        const url = await openedUrl(w);
        check(url.pathname === "/", `浏览器打开的不是首页：${url}`);
        const page = await openPage(w, url.pathname);
        w.memo.set("page", page);
        await page.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        await page.getByText("没有项目", { exact: true }).waitFor();
        check((await page.locator("tbody tr").count()) === 0, "首页不该有项目的行");
      },
    },
    {
      do: "在项目根目录敲 ploop init --repo 自己的",
      expect: "写「开工了」，建好项目缓存，写好忽略规则。下一步写 ploop round start 构思。",
      run: (w) => {
        const run = installedPloop(w, ["init", "--repo", "自己的"]);
        expectRun(
          run,
          0,
          "开工了：项目 app，第 1 版",
          "项目缓存：.product-loop/",
          "忽略规则写进了 .gitignore",
        );
        check(run.stdout.includes("ploop round start 构思"), "下一步没有写 ploop round start 构思");
        check(existsSync(join(w.root, ".product-loop", "project.json")), "项目缓存没有建好");
        check(w.read(".gitignore").includes(".product-loop"), ".gitignore 里没有忽略规则");
      },
    },
    {
      do: "在项目里敲 ploop open",
      expect:
        "浏览器打开这个项目的项目页，写「第 1 版，还没开始阶段」。刷新首页，多了这个项目一行。",
      run: async (w) => {
        const run = installedPloop(w, ["open"]);
        expectRun(run, 0, "打开了：");
        const url = await openedUrl(w);
        check(url.pathname === "/p/app", `浏览器打开的不是项目页：${url.pathname}`);
        const page = await openPage(w, url.pathname);
        await page.getByText("第 1 版，还没开始阶段").first().waitFor();
        // 刷新首页，多了这个项目一行。
        const home = w.memo.get("page") as Page;
        await home.reload();
        await home.getByRole("heading", { name: "所有项目", exact: true }).waitFor();
        const row = home.locator("tbody tr");
        await row.first().waitFor();
        check((await row.count()) === 1, `首页有 ${await row.count()} 个项目，应当是 1 个`);
        check((await row.first().innerText()).includes("app"), "这一行没有写项目名");
        show(w, home);
      },
    },
    {
      do: "让 AI 敲 ploop round start 构思",
      expect: "写「开始了：第 1 版的构思阶段」，写出工作区和先做什么。",
      run: (w) => {
        const run = installedPloop(w, ["round", "start", "构思"]);
        expectRun(run, 0, "开始了：第 1 版的构思阶段");
        const output = run.stdout;
        check(output.includes("工作区"), `没有写工作区：${output}`);
        check(output.includes("下一步"), `没有写先做什么：${output}`);
        check(existsSync(join(w.root, ".product-loop", "rounds", "v1-构思-1")), "工作区没有建好");
      },
    },
  ],
};
