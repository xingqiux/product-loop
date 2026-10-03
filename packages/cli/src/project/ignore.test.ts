import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureIgnoreRule, ignoreFileFor, ignoreRule, settingsIgnoreRule } from "./ignore.ts";
import { makeTree, tempRoot } from "./testing.ts";

// 共用的仓库要问 git，起子进程，那几种写在命令的使用测试里。这里测不用 git 的部分。

describe("忽略规则", () => {
  it("自己的仓库写进根目录的 .gitignore", async () => {
    expect(await ignoreFileFor("/Users/me/proj/app", "own")).toEqual({
      ok: true,
      value: "/Users/me/proj/app/.gitignore",
    });
  });

  it("文件不在就新建，只写一行 .product-loop/", async () => {
    const file = join(tempRoot(), "sub", ".gitignore");
    expect(await ensureIgnoreRule(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(".product-loop/\n");
    expect(ignoreRule).toBe(".product-loop/");
  });

  it("文件末尾没有换行时先补一个，已有的内容不动", async () => {
    const root = tempRoot();
    makeTree(root, [[".gitignore", "node_modules/\ndist"]]);
    expect(await ensureIgnoreRule(join(root, ".gitignore"))).toBe(true);
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
      "node_modules/\ndist\n.product-loop/\n",
    );
  });

  it("再跑一次不重复写", async () => {
    const file = join(tempRoot(), ".gitignore");
    await ensureIgnoreRule(file);
    expect(await ensureIgnoreRule(file)).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(".product-loop/\n");
  });

  it.each([".product-loop", "/.product-loop/", "**/.product-loop", "  .product-loop/  "])(
    "已有 %j 这样的写法就不再写",
    async (line) => {
      const root = tempRoot();
      makeTree(root, [[".gitignore", `a\r\n${line}\r\n`]]);
      expect(await ensureIgnoreRule(join(root, ".gitignore"))).toBe(false);
    },
  );

  it("写在注释里、或者只是开头相同的不算", async () => {
    const root = tempRoot();
    makeTree(root, [[".gitignore", "# .product-loop/\n.product-loop-old/\n"]]);
    expect(await ensureIgnoreRule(join(root, ".gitignore"))).toBe(true);
  });

  it("会话开始钩子的设置文件也是一行规则，和项目缓存的互不影响", async () => {
    const file = join(tempRoot(), ".gitignore");
    expect(await ensureIgnoreRule(file, settingsIgnoreRule)).toBe(true);
    expect(await ensureIgnoreRule(file, settingsIgnoreRule)).toBe(false);
    expect(await ensureIgnoreRule(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("**/.claude/settings.local.json\n.product-loop/\n");
  });

  it.each([
    ".claude/settings.local.json",
    "/.claude/settings.local.json",
    "**/.claude/settings.local.json",
  ])("设置文件已有 %j 这样的写法就不再写", async (line) => {
    const root = tempRoot();
    makeTree(root, [[".gitignore", `${line}\n`]]);
    expect(await ensureIgnoreRule(join(root, ".gitignore"), settingsIgnoreRule)).toBe(false);
  });
});
