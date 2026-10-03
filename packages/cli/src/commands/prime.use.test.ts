// biome-ignore-all lint/style/useNamingConvention: SessionStart 是 Claude Code 定的键名。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { primeCommandLineOf } from "../project/session-hook.ts";
import { sandbox } from "./testing.ts";

// ploop prime 对着真的后端跑，和 ploop init 写会话开始钩子的整个过程，见「13 待定」第 8 项和决定 197。

describe("ploop prime", { timeout: 60_000 }, () => {
  it("在项目里：十行以内的状态和下一步；不在项目里、后端没开时什么都不输出", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "no");
    s.ploop("proj/app", "round", "start", "构思");

    const prime = s.ploop("proj/app", "prime");
    const lines = prime.stdout.trimEnd().split("\n");
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines[0]).toBe("这个项目用产品循环，下面是现在的状态，完整的运行 ploop status。");
    // 钩子指到 skill：压缩或新会话以后 AI 不一定读过它。
    expect(lines[1]).toBe("做法和规矩在 product-loop skill 里，没读过先读它，再照下一步做。");
    expect(lines[2]).toBe("项目 app：第 1 版的构思阶段，进行中");
    expect(lines[3]).toBe("在等的页：没有");
    expect(lines[4]).toBe("队列里没做完的事：没有");
    expect(lines).toContain("下一步：");
    expect(prime.stderr).toBe("");
    expect(prime.code).toBe(0);

    // 子目录里也是这个项目。
    expect(s.ploop("proj/app/src", "prime").stdout).toBe(prime.stdout);
    // 不在项目里：没有输出。
    expect(s.ploop("proj/other", "prime")).toEqual({ code: 0, stdout: "", stderr: "" });

    // 后端停了：写一行怎么启动，退出码仍是 0，也不把它拉起来。
    expect(s.ploop("proj/app", "backend", "stop").code).toBe(0);
    const down = s.ploop("proj/app", "prime");
    expect(down.stdout).toBe("这个项目用产品循环，后端没有在运行。运行 ploop status 拉起它。\n");
    expect(down.stderr).toBe("");
    expect(down.code).toBe(0);
    expect(s.runInfo()).toBeUndefined();
    // 不在项目里，后端没开也一样没有输出。
    expect(s.ploop("proj/other", "prime")).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  it("后端在运行但三秒内没有应答状态：写一行说明，退出码 0", async () => {
    const s = sandbox();
    // 一个认得出来、却不回话的假后端：只应答 /health，别的请求一直挂着。
    const server = createServer((req, res) => {
      if (req.url?.startsWith("/api/v1/health") !== true) return;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            status: "running",
            build: "dev",
            apiVersion: 1,
            schemaVersion: 1,
            pid: process.pid,
            home: s.store,
          },
          warnings: [],
          next: [],
        }),
      );
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    onTestFinished(() => {
      server.closeAllConnections();
      server.close();
    });
    const { port } = server.address() as AddressInfo;
    mkdirSync(join(s.store, "run"), { recursive: true });
    writeFileSync(
      join(s.store, "run", "backend.json"),
      JSON.stringify({
        pid: process.pid,
        port,
        build: "dev",
        schemaVersion: 1,
        startedAt: new Date().toISOString(),
        home: s.store,
        node: process.version,
        entry: "fake",
      }),
    );
    mkdirSync(s.at("proj/app/.product-loop"), { recursive: true });
    writeFileSync(
      s.at("proj/app/.product-loop/project.json"),
      JSON.stringify({ schemaVersion: 1, projectId: "app", skillVersion: "0.0.1" }),
    );
    const { done } = s.launch("proj/app", "prime");
    const stuck = await done;
    expect(stuck.stdout).toBe(
      "这个项目用产品循环，后端 3 秒内没有应答。运行 ploop status 看状态。一直没有应答，运行 ploop backend logs。\n",
    );
    expect(stuck.code).toBe(0);
  });

  it("--json：一个 JSON 对象，带项目状态", () => {
    const s = sandbox();
    s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "no");
    const { stdout } = s.ploop("proj/app", "prime", "--json");
    expect(JSON.parse(stdout)).toMatchObject({
      ok: true,
      kind: "prime.state",
      data: { project: { id: "app" } },
    });
  });
});

describe("ploop init 写会话开始钩子", { timeout: 60_000 }, () => {
  const settings = (s: ReturnType<typeof sandbox>) => s.at("proj/app/.claude/settings.local.json");
  /** 钩子写绝对路径：~/.local/bin 不在 PATH 里的机器上，写 ploop prime 什么也运行不了。 */
  const primeGroup = (s: ReturnType<typeof sandbox>, command = primeCommandLineOf(s.home)) => ({
    matcher: "startup|resume|clear|compact",
    hooks: [{ type: "command", command, timeout: 10 }],
  });

  it("--hook 是：合并进已有的设置，别的键不丢；重跑不重复；英文的 yes、no 也认", () => {
    const s = sandbox();
    mkdirSync(s.at("proj/app/.claude"), { recursive: true });
    writeFileSync(
      settings(s),
      JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }),
    );

    const first = s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "是");
    // 路径写相对项目根目录的，根目录只在「根目录」一行写全。
    expect(first.stdout).toContain(
      "会话开始钩子：写进了 .claude/settings.local.json。以后每次会话开始运行 ploop prime。\n",
    );
    expect(first.code).toBe(0);
    const expected = {
      model: "opus",
      permissions: { allow: ["Bash(ls)"] },
      hooks: { SessionStart: [primeGroup(s)] },
    };
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual(expected);

    const again = s.ploop("proj/app", "init", "--hook", "yes");
    expect(again.stdout).toContain("会话开始钩子：.claude/settings.local.json 里已有。\n");
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual(expected);
    // 不问也一样：已经有了就不再提。
    expect(s.ploop("proj/app", "init").stdout).not.toContain("没写");
  });

  it("--hook 是：设置文件也进忽略文件，git 不把它当成没提交的文件；共用的仓库写进 .git/info/exclude", () => {
    const untracked = (s: ReturnType<typeof sandbox>, dir: string) =>
      execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: s.at(dir),
        env: s.env,
        encoding: "utf8",
      });

    const s = sandbox();
    s.gitInit("proj/app");
    const first = s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "是");
    expect(first.stdout).toContain(
      "会话开始钩子的设置文件 .claude/settings.local.json 不进仓库，忽略规则写进了 .gitignore。\n",
    );
    expect(readFileSync(s.at("proj/app/.gitignore"), "utf8")).toBe(
      ".product-loop/\n**/.claude/settings.local.json\n",
    );
    // 设置文件在，却不出现在没提交的文件里。
    expect(existsSync(settings(s))).toBe(true);
    expect(untracked(s, "proj/app")).toBe("?? .gitignore\n");

    // 重跑不重复写。
    const again = s.ploop("proj/app", "init", "--hook", "是");
    expect(again.stdout).not.toContain("不进仓库");
    expect(JSON.parse(s.ploop("proj/app", "init", "--json").stdout).data.settingsRuleAdded).toBe(
      false,
    );
    expect(readFileSync(s.at("proj/app/.gitignore"), "utf8")).toBe(
      ".product-loop/\n**/.claude/settings.local.json\n",
    );

    const t = sandbox();
    t.gitInit("proj/shared");
    expect(t.ploop("proj/shared", "init", "--repo", "共用的", "--hook", "是").stdout).toContain(
      "忽略规则写进了 .git/info/exclude。",
    );
    expect(existsSync(t.at("proj/shared/.gitignore"))).toBe(false);
    expect(untracked(t, "proj/shared")).toBe("");
  });

  it("已经开工过的项目再写或撤钩子：第一行写这次做的事，「已经开工过」排在后面（F19）", () => {
    const s = sandbox();
    expect(s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "否").code).toBe(0);
    const wrote = s.ploop("proj/app", "init", "--hook", "是");
    const lines = wrote.stdout.split("\n");
    expect(lines[0]).toBe(
      "会话开始钩子：写进了 .claude/settings.local.json。以后每次会话开始运行 ploop prime。",
    );
    expect(lines[1]).toBe("已经开工过：项目 app");
    expect(wrote.code).toBe(0);
    const removed = s.ploop("proj/app", "init", "--hook", "否");
    expect(removed.stdout.split("\n").slice(0, 2)).toEqual([
      "会话开始钩子：从 .claude/settings.local.json 里删掉了。别的设置原样保留。",
      "已经开工过：项目 app",
    ]);
    // 没有可做的：第一行仍是「已经开工过」。
    expect(s.ploop("proj/app", "init").stdout.split("\n")[0]).toBe("已经开工过：项目 app");
  });

  it("早先写的是 ploop prime：重跑不带 --hook 不动它，写 --hook 是 才换成绝对路径", () => {
    const s = sandbox();
    expect(s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "否").code).toBe(0);
    mkdirSync(s.at("proj/app/.claude"), { recursive: true });
    const legacy = { hooks: { SessionStart: [primeGroup(s, "ploop prime")] } };
    writeFileSync(settings(s), JSON.stringify(legacy));

    const kept = s.ploop("proj/app", "init");
    expect(kept.stdout).not.toContain("会话开始钩子：换成");
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual(legacy);

    const updated = s.ploop("proj/app", "init", "--hook", "是");
    expect(updated.stdout).toContain("会话开始钩子：换成了绝对路径的命令。\n");
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual({
      hooks: { SessionStart: [primeGroup(s)] },
    });
    expect(updated.code).toBe(0);
  });

  it("--hook 否（也认 no）：撤掉写过的钩子，别的设置原样保留；重跑写明没有可撤的", () => {
    const s = sandbox();
    mkdirSync(s.at("proj/app/.claude"), { recursive: true });
    writeFileSync(settings(s), JSON.stringify({ model: "opus" }));
    expect(s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "是").code).toBe(0);
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toHaveProperty("hooks");

    const removed = s.ploop("proj/app", "init", "--hook", "否");
    expect(removed.stdout).toContain(
      "会话开始钩子：从 .claude/settings.local.json 里删掉了。别的设置原样保留。\n",
    );
    expect(removed.code).toBe(0);
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual({ model: "opus" });

    const nothing = s.ploop("proj/app", "init", "--hook", "no");
    expect(nothing.stdout).toContain(
      "会话开始钩子：不写，.claude/settings.local.json 里也没有。\n",
    );
    expect(JSON.parse(readFileSync(settings(s), "utf8"))).toEqual({ model: "opus" });
    const bad = s.ploop("proj/app", "init", "--hook", "也许");
    expect(bad.stderr).toContain("取值只能写下面之一：是、否");
    expect(bad.code).toBe(2);
  });

  it("没写 --hook 又不能问：第一次开工提醒一次，重跑不再提醒", () => {
    const s = sandbox();
    const first = s.ploop("proj/app", "init", "--repo", "自己的");
    expect(first.stdout).toContain("会话开始钩子：没写。请先问用户");
    expect(first.stdout).toContain("ploop init --hook 是");
    const again = s.ploop("proj/app", "init");
    expect(again.stdout).not.toContain("会话开始钩子");
    expect(JSON.parse(s.ploop("proj/app", "init", "--json").stdout).data.hook).toBe("undecided");
  });

  it("--hook 否：不写，也不提醒", () => {
    const s = sandbox();
    const { stdout, code } = s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "否");
    expect(stdout).not.toContain("会话开始钩子");
    expect(code).toBe(0);
    expect(existsSync(s.at("proj/app/.claude"))).toBe(false);
  });

  it("--hook 写别的：用法错误，列出「是」「否」", () => {
    const s = sandbox();
    const { stderr, code } = s.ploop("proj/app", "init", "--repo", "自己的", "--hook", "也许");
    expect(stderr.split("\n")[0]).toBe(
      "用法错误：选项 --hook <是|否> 的取值「也许」不对。取值只能写下面之一：是、否。",
    );
    expect(code).toBe(2);
  });

  it("不在终端里又没写 --hook：不写，请 AI 去问用户；--json 里说明状态", () => {
    const s = sandbox();
    const { stdout } = s.ploop("proj/app", "init", "--repo", "自己的");
    expect(stdout).toContain(
      "会话开始钩子：没写。请先问用户，要不要在会话开始时自动运行 ploop prime。同意就运行 ploop init --hook 是。\n",
    );
    expect(existsSync(s.at("proj/app/.claude"))).toBe(false);
    const json = JSON.parse(s.ploop("proj/app", "init", "--json").stdout);
    expect(json.data.hook).toBe("undecided");
  });

  it("设置文件写坏了：开工照常完成，给警告，不动文件", () => {
    const s = sandbox();
    mkdirSync(s.at("proj/app/.claude"), { recursive: true });
    writeFileSync(settings(s), "{ 坏了");
    const { stdout, stderr, code } = s.ploop(
      "proj/app",
      "init",
      "--repo",
      "自己的",
      "--hook",
      "yes",
    );
    expect(stdout).toContain("开工了：项目 app");
    expect(stderr).toContain("警告：设置文件不是合法的 JSON，没有写会话开始钩子。");
    expect(stderr).toContain("位置：.claude/settings.local.json");
    expect(code).toBe(0);
    expect(readFileSync(settings(s), "utf8")).toBe("{ 坏了");
    expect(join(s.at("proj/app"), ".product-loop", "project.json")).toSatisfy(existsSync);
  });
});
