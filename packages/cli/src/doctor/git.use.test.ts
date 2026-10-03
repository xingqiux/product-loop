import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeTree, tempRoot } from "../project/testing.ts";
import { gitProbe, removeTracked } from "./git.ts";

// 迁移检查问 git 的三件事，对着临时目录里新建的仓库跑。要起子进程，所以归到 pnpm use。
// 提交时用 -c 临时给出作者，不改本机的 git 设置。

function git(dir: string, ...args: string[]): void {
  execFileSync(
    "git",
    ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@example.com", ...args],
    { stdio: "ignore" },
  );
}

function repoWith(items: Parameters<typeof makeTree>[1]): string {
  const root = tempRoot();
  git(root, "init", "-q");
  makeTree(root, items);
  return root;
}

describe("本机的 git", () => {
  it("不在仓库里：没有仓库，也没有忽略规则", async () => {
    const dir = tempRoot();
    expect(await gitProbe.repoOf(dir)).toBeUndefined();
    expect(await gitProbe.ignoredBy(dir, ".product-loop/")).toBeUndefined();
    expect(await gitProbe.tracked(dir, ["主线.md"])).toEqual([]);
  });

  it("在子目录里也找到仓库的根，不算附加工作目录", async () => {
    const root = repoWith(["docs/a.md"]);
    expect(await gitProbe.repoOf(join(root, "docs"))).toEqual({ root, worktree: false });
  });

  it("附加工作目录：算作附加工作目录", async () => {
    const root = repoWith([["a.md", "a"]]);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "a");
    const other = join(tempRoot(), "wt");
    git(root, "worktree", "add", "-q", other);
    expect(await gitProbe.repoOf(other)).toEqual({ root: other, worktree: true });
  });

  it("写出忽略的规则和来源；以 ! 开头的规则匹配上时算没被忽略", async () => {
    const root = repoWith([[".gitignore", "node_modules/\n.product-loop/\n"]]);
    expect(await gitProbe.ignoredBy(root, ".product-loop/")).toEqual({
      source: ".gitignore",
      pattern: ".product-loop/",
    });
    const negated = repoWith([[".gitignore", ".product-loop/\n!.product-loop/\n"]]);
    expect(await gitProbe.ignoredBy(negated, ".product-loop/")).toBeUndefined();
    const plain = repoWith([]);
    expect(await gitProbe.ignoredBy(plain, ".product-loop/")).toBeUndefined();
  });

  it("只列出已提交的旧文件，路径相对查的目录", async () => {
    const root = repoWith([
      ["docs/主线.md", "主线"],
      ["docs/决定.md", "决定"],
      ["docs/walk/2026-09-20/think-1.json", "{}"],
    ]);
    git(root, "add", "docs/主线.md", "docs/walk");
    git(root, "commit", "-q", "-m", "a");
    const docs = join(root, "docs");
    // 按 git 的顺序列出，路径按字节排
    expect(await gitProbe.tracked(docs, ["主线.md", "决定.md", "walk/"])).toEqual([
      "walk/2026-09-20/think-1.json",
      "主线.md",
    ]);
  });
});

describe("用 git 删除旧文件", () => {
  const author = () => {
    vi.stubEnv("GIT_AUTHOR_NAME", "test");
    vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
    vi.stubEnv("GIT_COMMITTER_NAME", "test");
    vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
  };

  it("docs/ 里只有旧文件：删空以后目录没了，提交照样成功（N19）", async () => {
    author();
    const root = repoWith([
      ["docs/主线.md", "主线"],
      ["docs/决定.md", "决定"],
      ["README.md", "读我"],
    ]);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "a");
    const docs = join(root, "docs");
    expect(await removeTracked(docs, ["主线.md", "决定.md"], "chore: 删旧文件")).toBeUndefined();
    expect(existsSync(docs)).toBe(false);
    const log = execFileSync("git", ["-C", root, "log", "--format=%s", "-1"], { encoding: "utf8" });
    expect(log.trim()).toBe("chore: 删旧文件");
    const status = execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" });
    expect(status).toBe("");
  });

  it("提交没成功：告诉调用方文件已经从 git 删了，只是还没提交", async () => {
    author();
    const root = repoWith([["docs/主线.md", "主线"]]);
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "a");
    const hook = join(root, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const failed = await removeTracked(join(root, "docs"), ["主线.md"], "chore: 删旧文件");
    expect(failed?.step).toBe("commit");
    const status = execFileSync("git", ["-C", root, "status", "--porcelain", "-z"], {
      encoding: "utf8",
    });
    expect(status).toContain("D  docs/主线.md");
  });

  it("不在仓库里：一个都没删，停在 rm 这一步", async () => {
    const dir = tempRoot();
    const failed = await removeTracked(dir, ["主线.md"], "chore: 删旧文件");
    expect(failed?.step).toBe("rm");
  });
});
