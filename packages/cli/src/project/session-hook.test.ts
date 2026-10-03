// biome-ignore-all lint/style/useNamingConvention: SessionStart、PreToolUse 是 Claude Code 定的键名。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  inspectSessionHook,
  installSessionHook,
  legacyPrimeCommandLine,
  mergeSessionHook,
  primeCommandLineOf,
  removeSessionHook,
  settingsFile,
  uninstallSessionHook,
} from "./session-hook.ts";
import { tempRoot } from "./testing.ts";

// 会话开始钩子的合并：别的键原样留着，已经有就不再写，结构不对时不动文件。

const primeGroup = {
  matcher: "startup|resume|clear|compact",
  hooks: [{ type: "command", command: legacyPrimeCommandLine, timeout: 10 }],
};

/** 在临时项目里写一份设置文件。 */
function projectWith(content: string | undefined): string {
  const root = tempRoot();
  if (content !== undefined) {
    mkdirSync(join(root, ".claude"));
    writeFileSync(settingsFile(root), content);
  }
  return root;
}

describe("mergeSessionHook", () => {
  it("空设置：只加会话开始的钩子", () => {
    expect(mergeSessionHook({})).toEqual({
      kind: "merged",
      settings: { hooks: { SessionStart: [primeGroup] } },
    });
  });

  it("别的键、别的事件和别的会话开始钩子原样留着，新的加在最后", () => {
    const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    const settings = {
      permissions: { allow: ["Bash(ls)"] },
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }], SessionStart: [other] },
    };
    const merged = mergeSessionHook(settings);
    expect(merged).toEqual({
      kind: "merged",
      settings: {
        permissions: { allow: ["Bash(ls)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [] }], SessionStart: [other, primeGroup] },
      },
    });
    // 不改传进来的对象。
    expect(settings.hooks.SessionStart).toEqual([other]);
  });

  it("已经有运行 ploop prime 的钩子：不重复写，带路径的也认", () => {
    const group = { hooks: [{ type: "command", command: "/Users/me/.local/bin/ploop prime" }] };
    expect(mergeSessionHook({ hooks: { SessionStart: [group] } })).toEqual({ kind: "present" });
    expect(mergeSessionHook({ hooks: { SessionStart: [primeGroup] } })).toEqual({
      kind: "present",
    });
  });

  it("名字像但不是同一条命令的不算已有", () => {
    const group = { hooks: [{ type: "command", command: "ploop primer" }] };
    expect(mergeSessionHook({ hooks: { SessionStart: [group] } }).kind).toBe("merged");
  });

  it("结构合不进去时说明原因，不改", () => {
    expect(mergeSessionHook([])).toEqual({ kind: "unusable", reason: "notObject" });
    expect(mergeSessionHook({ hooks: [] })).toEqual({ kind: "unusable", reason: "hooksNotObject" });
    expect(mergeSessionHook({ hooks: { SessionStart: {} } })).toEqual({
      kind: "unusable",
      reason: "sessionStartNotArray",
    });
  });
});

describe("installSessionHook", () => {
  it("没有设置文件：建 .claude/ 和文件；再写一次不重复", async () => {
    const root = projectWith(undefined);
    expect(await inspectSessionHook(root)).toEqual({ kind: "absent" });
    expect(await installSessionHook(root)).toEqual({ kind: "written" });
    const first = readFileSync(settingsFile(root), "utf8");
    expect(JSON.parse(first)).toEqual({ hooks: { SessionStart: [primeGroup] } });
    expect(first.endsWith("\n")).toBe(true);
    expect(await installSessionHook(root)).toEqual({ kind: "present" });
    expect(await inspectSessionHook(root)).toEqual({ kind: "present" });
    expect(readFileSync(settingsFile(root), "utf8")).toBe(first);
    // 不留临时文件。
    expect(existsSync(`${settingsFile(root)}.${process.pid}.tmp`)).toBe(false);
  });

  it("合并进已有的设置，别的键不丢", async () => {
    const root = projectWith(JSON.stringify({ model: "opus", env: { A: "1" } }));
    expect(await installSessionHook(root)).toEqual({ kind: "written" });
    expect(JSON.parse(readFileSync(settingsFile(root), "utf8"))).toEqual({
      model: "opus",
      env: { A: "1" },
      hooks: { SessionStart: [primeGroup] },
    });
  });

  it("文件不是合法的 JSON：不动它", async () => {
    const root = projectWith("{ 坏了");
    expect(await installSessionHook(root)).toEqual({ kind: "unusable", reason: "notJson" });
    expect(await inspectSessionHook(root)).toEqual({ kind: "unusable", reason: "notJson" });
    expect(readFileSync(settingsFile(root), "utf8")).toBe("{ 坏了");
  });

  it("空文件当成空设置", async () => {
    const root = projectWith("");
    expect(await installSessionHook(root)).toEqual({ kind: "written" });
  });
});

describe("Q14 钩子写 ploop 的绝对路径", () => {
  const home = "/Users/me";
  const absolute = primeCommandLineOf(home);
  const group = (command: string) => ({
    matcher: "startup|resume|clear|compact",
    hooks: [{ type: "command", command, timeout: 10 }],
  });

  it("命令是 ~/.local/bin/ploop 的绝对路径加 prime，路径里有空格时加引号", () => {
    expect(absolute).toBe("/Users/me/.local/bin/ploop prime");
    expect(primeCommandLineOf("/Users/my name")).toBe("'/Users/my name/.local/bin/ploop' prime");
    expect(mergeSessionHook({}, absolute)).toEqual({
      kind: "merged",
      settings: { hooks: { SessionStart: [group(absolute)] } },
    });
  });

  it("早先写的 ploop prime 不会自己变：不写 --hook 是 时原样保留，写了才换成绝对路径", async () => {
    const root = projectWith(JSON.stringify({ hooks: { SessionStart: [group("ploop prime")] } }));
    expect(await inspectSessionHook(root, absolute)).toEqual({ kind: "legacy" });
    const before = readFileSync(settingsFile(root), "utf8");
    expect(await installSessionHook(root, absolute)).toEqual({ kind: "updated" });
    const after = JSON.parse(readFileSync(settingsFile(root), "utf8"));
    expect(after).toEqual({ hooks: { SessionStart: [group(absolute)] } });
    expect(before).not.toBe(readFileSync(settingsFile(root), "utf8"));
    // 换过以后再写一次：已经有了，不重复。
    expect(await installSessionHook(root, absolute)).toEqual({ kind: "present" });
  });

  it("撤掉时两种写法都认，是 ploop 写的", async () => {
    for (const command of [absolute, "ploop prime"]) {
      const root = projectWith(JSON.stringify({ hooks: { SessionStart: [group(command)] } }));
      expect(await uninstallSessionHook(root, absolute)).toEqual({ kind: "removed" });
    }
  });

  it("别人自己写的别的路径的 ploop prime 不动", () => {
    const own = { hooks: { SessionStart: [group("/opt/bin/ploop prime")] } };
    expect(mergeSessionHook(own, absolute)).toEqual({ kind: "present" });
    expect(removeSessionHook(own, absolute)).toEqual({ kind: "foreign" });
  });
});

describe("removeSessionHook：只去掉 ploop 自己写的那一条", () => {
  it("设置里只有这一条：钩子整个去掉，别的键留着", () => {
    const settings = { model: "opus", hooks: { SessionStart: [primeGroup] } };
    expect(removeSessionHook(settings)).toEqual({ kind: "removed", settings: { model: "opus" } });
    // 不改传进来的对象。
    expect(settings.hooks.SessionStart).toEqual([primeGroup]);
  });

  it("别的事件、别的会话开始钩子原样留着", () => {
    const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    const preTool = { matcher: "Bash", hooks: [] };
    const removed = removeSessionHook({
      hooks: { PreToolUse: [preTool], SessionStart: [other, primeGroup] },
    });
    expect(removed).toEqual({
      kind: "removed",
      settings: { hooks: { PreToolUse: [preTool], SessionStart: [other] } },
    });
  });

  it("同一组里别人的钩子留着，只去掉 ploop prime", () => {
    const group = {
      matcher: "startup",
      hooks: [
        { type: "command", command: "echo hi" },
        { type: "command", command: legacyPrimeCommandLine, timeout: 10 },
      ],
    };
    expect(removeSessionHook({ hooks: { SessionStart: [group] } })).toEqual({
      kind: "removed",
      settings: {
        hooks: {
          SessionStart: [{ matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] }],
        },
      },
    });
  });

  it("用户自己写的 ploop prime（带路径、带参数）不动，说明不是 ploop 写的样子", () => {
    for (const command of ["/Users/me/.local/bin/ploop prime", "ploop prime --json"]) {
      const settings = { hooks: { SessionStart: [{ hooks: [{ type: "command", command }] }] } };
      expect(removeSessionHook(settings)).toEqual({ kind: "foreign" });
    }
  });

  it("没有这条钩子：没有可去掉的；结构不对：说明原因", () => {
    expect(removeSessionHook({})).toEqual({ kind: "absent" });
    expect(removeSessionHook({ hooks: { SessionStart: [] } })).toEqual({ kind: "absent" });
    expect(removeSessionHook({ hooks: { PreToolUse: [] } })).toEqual({ kind: "absent" });
    expect(removeSessionHook([])).toEqual({ kind: "unusable", reason: "notObject" });
    expect(removeSessionHook({ hooks: { SessionStart: {} } })).toEqual({
      kind: "unusable",
      reason: "sessionStartNotArray",
    });
  });
});

describe("uninstallSessionHook", () => {
  it("ploop 建的文件：撤掉以后设置是空的，文件和空的 .claude/ 一起删掉", async () => {
    const root = projectWith(undefined);
    await installSessionHook(root);
    expect(await uninstallSessionHook(root)).toEqual({ kind: "removed" });
    expect(existsSync(settingsFile(root))).toBe(false);
    expect(existsSync(join(root, ".claude"))).toBe(false);
    expect(await uninstallSessionHook(root)).toEqual({ kind: "absent" });
  });

  it("文件里还有别的设置：只改钩子，别的原样，.claude/ 里别的文件不动", async () => {
    const root = projectWith(JSON.stringify({ model: "opus", env: { A: "1" } }));
    writeFileSync(join(root, ".claude", "notes.md"), "别的文件");
    await installSessionHook(root);
    expect(await uninstallSessionHook(root)).toEqual({ kind: "removed" });
    expect(JSON.parse(readFileSync(settingsFile(root), "utf8"))).toEqual({
      model: "opus",
      env: { A: "1" },
    });
    expect(readFileSync(join(root, ".claude", "notes.md"), "utf8")).toBe("别的文件");
  });

  it("没有文件：没有可去掉的，不建文件；文件不是合法的 JSON：不动它", async () => {
    const none = projectWith(undefined);
    expect(await uninstallSessionHook(none)).toEqual({ kind: "absent" });
    expect(existsSync(join(none, ".claude"))).toBe(false);
    const broken = projectWith("{ 坏了");
    expect(await uninstallSessionHook(broken)).toEqual({ kind: "unusable", reason: "notJson" });
    expect(readFileSync(settingsFile(broken), "utf8")).toBe("{ 坏了");
  });
});
