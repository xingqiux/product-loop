import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { check, expectRun, type Scene } from "../lib.ts";

// S13 在一个项目里开工。AI，用户要在一个项目里第一次用产品循环时。
// 项目缓存和登记建不好，后面的命令找不到项目。第一步就卡住，用户会要求先修。
// 摆的状态：一个只做了 git init 的目录，后端没有开。共用的仓库在第 2 步里另开一个目录。

const backendFile = (store: string) => join(store, "run", "backend.json");

export const scene: Scene = {
  scene: "S13",
  setup: (w) => {
    w.git("init", "-q");
  },
  steps: [
    {
      do: "在项目根目录敲 ploop init，不写 --repo",
      expect: "退出码 2，写明先问用户仓库是自己的还是共用的。",
      run: (w) => {
        expectRun(
          w.ploop(["init"]),
          2,
          "请先问用户",
          "自己的",
          "共用的",
          "ploop init --repo 自己的",
          "ploop init --repo 共用的",
        );
        check(!w.exists(".product-loop"), "没有问用户就建了项目缓存");
      },
    },
    {
      do: "问过用户，敲 ploop init --repo 自己的",
      expect: "建好项目缓存。忽略规则写进 .gitignore，共用的写进 .git/info/exclude。",
      run: (w) => {
        const init = w.ploop(["init", "--repo", "自己的"]);
        expectRun(
          init,
          0,
          "开工了：项目 app，第 1 版",
          "项目缓存：.product-loop/",
          "写进了 .gitignore",
        );
        w.memo.set("init", init);
        check(w.exists(".product-loop/project.json"), "没有写 project.json");
        check(w.exists(".product-loop/主线.md"), "没有写主线的模板");
        check(w.read(".gitignore") === ".product-loop/\n", ".gitignore 里没有忽略规则");
        // 忽略规则真的生效：项目缓存不出现在 git 看到的改动里，只有 .gitignore 自己是新的。
        const status = w.git("status", "--porcelain", "--untracked-files=all");
        check(status.trim() === "?? .gitignore", `git 看到的改动是：${status}`);
        // 共用的仓库：忽略规则写进 .git/info/exclude，仓库里的文件一个字节都不多。
        const shared = join(w.root, "..", "shared");
        w.write("../shared/.keep", "");
        execFileSync("git", ["init", "-q"], { cwd: shared, env: w.env });
        expectRun(
          w.ploop(["init", "--repo", "共用的"], shared),
          0,
          "开工了：项目 shared，第 1 版",
          "写进了 .git/info/exclude",
        );
        check(
          w.read("../shared/.git/info/exclude").split("\n").includes(".product-loop/"),
          ".git/info/exclude 里没有忽略规则",
        );
        check(!w.exists("../shared/.gitignore"), "共用的仓库里多出了 .gitignore");
        const sharedStatus = execFileSync(
          "git",
          ["status", "--porcelain", "--untracked-files=all"],
          {
            cwd: shared,
            env: w.env,
            encoding: "utf8",
          },
        );
        check(
          sharedStatus.trim() === "?? .keep",
          `共用的仓库里，git 看到的改动是：${sharedStatus}`,
        );
      },
    },
    {
      do: "后端还没开",
      expect: "命令自己启动后端，输出和后端开着时一样，不多打印一行。",
      run: (w) => {
        // 上一步的 init 已经拉起过后端。先停掉，回到后端没开的样子。
        expectRun(w.ploop(["backend", "stop"]), 0, "停下了");
        check(!existsSync(backendFile(w.store)), "后端停了，运行记录还在");
        const cold = w.ploop([]);
        check(existsSync(backendFile(w.store)), "命令没有把后端拉起来");
        const warm = w.ploop([]);
        expectRun(cold, 0, "项目 app：第 1 版");
        check(cold.stderr === "" && warm.stderr === "", `拉起后端时多打印了：${cold.stderr}`);
        check(cold.stdout === warm.stdout, `后端没开时的输出和开着时不同：${cold.stdout}`);
        const init = w.memo.get("init") as { stderr: string };
        check(init.stderr === "", `第一次拉起后端时多打印了：${init.stderr}`);
      },
    },
    {
      do: "再敲 ploop",
      expect: "写第 1 版、还没开始任何阶段、主线缺几个部分。下一步写着 ploop round start 构思。",
      run: (w) => {
        expectRun(
          w.ploop([]),
          0,
          "项目 app：第 1 版，还没开始任何阶段",
          "主线缺 10 个部分",
          "下一步：",
          "ploop round start 构思",
        );
      },
    },
    {
      do: "用户同意会话开始的钩子，敲 ploop init --hook 是",
      expect: "写进 .claude/settings.local.json。以后每次会话开始运行 ploop prime。",
      run: (w) => {
        expectRun(
          w.ploop(["init", "--hook", "是"]),
          0,
          "写进了 .claude/settings.local.json",
          "ploop prime",
        );
        const settings = JSON.parse(w.read(".claude/settings.local.json")) as {
          hooks: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>;
        };
        const sessionStart = "SessionStart";
        const start = settings.hooks[sessionStart]?.[0];
        check(start?.matcher.includes("startup") === true, "钩子没有挂在会话开始上");
        const command = start?.hooks[0]?.command ?? "";
        check(command.endsWith("ploop prime"), `钩子运行的是「${command}」`);
        // 钩子每次会话开始运行的那条命令，说现在的状态，指向 skill，写下一步。
        expectRun(w.ploop(["prime"]), 0, "product-loop skill", "项目 app：第 1 版", "下一步：");
      },
    },
    {
      do: "再敲一次 ploop init",
      expect: "写「已经开工过」，不重建，下一步写 ploop status。",
      run: (w) => {
        const project = readFileSync(join(w.root, ".product-loop", "project.json"), "utf8");
        // 项目缓存里用户和 AI 写过的东西，再敲一次 init 不会被覆盖。
        w.write(".product-loop/主线.md", "# 主线\n\n已经写过的一行。\n");
        w.write(".product-loop/留着.txt", "别删");
        expectRun(w.ploop(["init"]), 0, "已经开工过：项目 app", "下一步：", "ploop status");
        check(
          readFileSync(join(w.root, ".product-loop", "project.json"), "utf8") === project,
          "再敲 init 改了 project.json",
        );
        check(w.read(".product-loop/主线.md").includes("已经写过的一行。"), "主线被重建了");
        check(w.exists(".product-loop/留着.txt"), "项目缓存被重建了");
      },
    },
  ],
};
