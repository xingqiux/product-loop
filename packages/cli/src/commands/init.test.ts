// biome-ignore-all lint/style/useNamingConvention: SessionStart 是 Claude Code 定的键名。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { settingsFile } from "../project/session-hook.ts";
import { makeTree, tempRoot } from "../project/testing.ts";
import { setupHook } from "./init.ts";

// 这里只测不用碰后端的几种。登记项目、写文件的整个过程要真的后端，写在使用测试里。

describe("ploop init 不碰后端就能报的错", () => {
  it("--project 写项目名：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["init", "--repo", "自己的", "--project", "sketch-board"]);
    expect(stderr).toBe(
      [
        "用法错误：ploop init 的 --project 要写路径，「sketch-board」是项目名。",
        "怎么改：到项目根目录下运行，或者写 --project ./app 这样的路径。",
        "",
      ].join("\n"),
    );
    expect(code).toBe(2);
  });

  it("--repo 只收自己的、共用的", async () => {
    const { code, stderr } = await ploop(["init", "--repo", "别人的"]);
    expect(stderr).toContain(
      "用法错误：选项 --repo <仓库> 的取值「别人的」不对。取值只能写下面之一：自己的、共用的。",
    );
    expect(code).toBe(2);
  });

  it("在家目录下运行：用法错误，退出码 2", async () => {
    const home = tempRoot();
    const { code, stderr } = await ploop(["init", "--repo", "自己的"], {
      cwd: home,
      userHome: home,
    });
    expect(stderr).toContain("家目录不能当项目根目录");
    expect(code).toBe(2);
  });

  it("这里有旧 skill 的文件：要先做迁移检查，退出码 6", async () => {
    const home = tempRoot();
    makeTree(home, ["proj/app/docs/主线.md", "proj/app/docs/队列.md"]);
    const cwd = join(home, "proj", "app");
    const { code, stderr } = await ploop(["init", "--repo", "自己的"], { cwd, userHome: home });
    expect(stderr).toContain("要先做迁移检查：产品循环的旧文件还在 docs/ 下");
    expect(code).toBe(6);
  });
});

describe("ploop init 要不要写会话开始的钩子", () => {
  const asked: string[] = [];
  const answer = (reply: string | undefined) => async (question: string) => {
    asked.push(question);
    return reply;
  };

  it("--hook no：不问也不写", async () => {
    const root = tempRoot();
    expect(await setupHook(root, "no", answer("y"))).toEqual({ kind: "declined" });
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  it("--hook no：之前写过的撤掉，别的设置原样保留", async () => {
    const root = tempRoot();
    makeTree(root, [[".claude/settings.local.json", JSON.stringify({ model: "opus" })]]);
    expect(await setupHook(root, "yes", undefined)).toEqual({ kind: "written" });
    expect(await setupHook(root, "no", answer("y"))).toEqual({ kind: "removed" });
    expect(JSON.parse(readFileSync(settingsFile(root), "utf8"))).toEqual({ model: "opus" });
    // 再撤一次：没有可撤的。
    expect(await setupHook(root, "no", undefined)).toEqual({ kind: "declined" });
  });

  it("--hook no：用户自己写的 ploop prime 不动，说明不是 ploop 写的样子", async () => {
    const root = tempRoot();
    const own = { hooks: { SessionStart: [{ hooks: [{ command: "ploop prime --json" }] }] } };
    makeTree(root, [[".claude/settings.local.json", JSON.stringify(own)]]);
    expect(await setupHook(root, "no", undefined)).toEqual({ kind: "foreign" });
    expect(JSON.parse(readFileSync(settingsFile(root), "utf8"))).toEqual(own);
  });

  it("重跑 init（不是第一次开工）又没写 --hook：不问、不提醒，也不写", async () => {
    const root = tempRoot();
    asked.length = 0;
    expect(await setupHook(root, undefined, answer("y"), false)).toEqual({ kind: "undecided" });
    expect(asked).toEqual([]);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    // 已经有钩子时照旧说明已有。
    expect(await setupHook(root, "yes", undefined)).toEqual({ kind: "written" });
    expect(await setupHook(root, undefined, undefined, false)).toEqual({ kind: "present" });
  });

  it("不能问又没写 --hook：不写，等 AI 去问用户", async () => {
    const root = tempRoot();
    expect(await setupHook(root, undefined, undefined)).toEqual({ kind: "undecided" });
    expect(existsSync(join(root, ".claude"))).toBe(false);
  });

  it("用户回答同意才写，别的回答（包括空）都不写", async () => {
    for (const yes of ["y", "Yes", " 是 ", "同意"]) {
      const root = tempRoot();
      expect(await setupHook(root, undefined, answer(yes))).toEqual({ kind: "written" });
      expect(existsSync(settingsFile(root))).toBe(true);
    }
    for (const no of ["", "n", "不要", "yep", undefined]) {
      const root = tempRoot();
      expect(await setupHook(root, undefined, answer(no))).toEqual({ kind: "declined" });
      expect(existsSync(join(root, ".claude"))).toBe(false);
    }
    expect(asked[0]).toContain("ploop prime");
    expect(asked[0]).toContain("settings.local.json");
  });

  it("--hook yes 就是同意，不再问；已经有时不问也不重复写", async () => {
    const root = tempRoot();
    asked.length = 0;
    expect(await setupHook(root, "yes", answer("n"))).toEqual({ kind: "written" });
    expect(await setupHook(root, undefined, answer("n"))).toEqual({ kind: "present" });
    expect(await setupHook(root, "yes", undefined)).toEqual({ kind: "present" });
    expect(asked).toEqual([]);
  });

  it("设置文件不能合并：报原因，不动文件", async () => {
    const root = tempRoot();
    makeTree(root, [[".claude/settings.local.json", "[]"]]);
    expect(await setupHook(root, "yes", undefined)).toEqual({
      kind: "unusable",
      reason: "notObject",
    });
    expect(readFileSync(settingsFile(root), "utf8")).toBe("[]");
  });
});
