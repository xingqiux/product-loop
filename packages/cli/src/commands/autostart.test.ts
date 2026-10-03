import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tempRoot } from "../project/testing.ts";
import {
  type AutostartDeps,
  agentFile,
  agentLabelFor,
  autostartOff,
  autostartOn,
  autostartStatus,
  type LaunchctlRun,
  renderPlist,
} from "./autostart.ts";

// 登录启动项：家目录是临时的，launchctl 是假的，只记下参数，不碰真实的 launchd。

/** 一个临时家目录，集中存储在它下面的 store/，可选装好 app/current/backend.mjs。 */
function setup(options: { readonly installed?: boolean } = {}) {
  const userHome = tempRoot();
  const store = join(userHome, "store");
  const entry = join(store, "app", "current", "backend.mjs");
  if (options.installed ?? true) {
    mkdirSync(join(store, "app", "current"), { recursive: true });
    writeFileSync(entry, "");
  }
  const calls: string[][] = [];
  const results: Record<string, LaunchctlRun> = {};
  const deps: AutostartDeps = {
    launchctl: async (args) => {
      calls.push([...args]);
      return results[args[0] ?? ""] ?? { code: 0, output: "" };
    },
    uid: 501,
    platform: "darwin",
    node: "/opt/node/bin/node",
  };
  const ctx = { cwd: userHome, env: { PLOOP_HOME: store }, userHome, notice: () => {} };
  return { userHome, store, entry, calls, results, deps, ctx, label: agentLabelFor(ctx) };
}

describe("renderPlist", () => {
  it("登录时运行、只在异常退出时重启，路径里的特殊字符转义", () => {
    const text = renderPlist({
      node: "/opt/node/bin/node",
      entry: "/Users/a&b/.product-loop/app/current/backend.mjs",
      home: "/Users/a&b/.product-loop",
      logFile: "/Users/a&b/.product-loop/logs/launchd.log",
    });
    expect(text).toContain("<key>Label</key>\n  <string>com.product-loop.backend</string>");
    expect(
      renderPlist({
        label: "com.product-loop.backend.0a1b2c3d",
        node: "/n",
        entry: "/e",
        home: "/h",
        logFile: "/l",
      }),
    ).toContain("<key>Label</key>\n  <string>com.product-loop.backend.0a1b2c3d</string>");
    expect(text).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(text).toContain("<key>SuccessfulExit</key>\n    <false/>");
    expect(text).toContain("<string>/Users/a&amp;b/.product-loop/app/current/backend.mjs</string>");
    expect(text).toContain(
      "<key>PLOOP_HOME</key>\n    <string>/Users/a&amp;b/.product-loop</string>",
    );
  });
});

describe("启动项的标签", () => {
  it("集中存储在默认位置：用基本的标签；PLOOP_HOME 指到别处：标签带上路径的哈希，各装各的", () => {
    const userHome = tempRoot();
    const at = (env: Record<string, string>) => ({ cwd: userHome, env, userHome });
    expect(agentLabelFor(at({}))).toBe("com.product-loop.backend");
    expect(agentLabelFor(at({ PLOOP_HOME: join(userHome, ".product-loop") }))).toBe(
      "com.product-loop.backend",
    );
    const one = agentLabelFor(at({ PLOOP_HOME: join(userHome, "store-a") }));
    const two = agentLabelFor(at({ PLOOP_HOME: join(userHome, "store-b") }));
    expect(one).toMatch(/^com\.product-loop\.backend\.[0-9a-f]{8}$/u);
    expect(two).toMatch(/^com\.product-loop\.backend\.[0-9a-f]{8}$/u);
    expect(one).not.toBe(two);
    expect(agentFile(userHome, one)).not.toBe(agentFile(userHome, two));
  });

  it("两份集中存储装启动项：文件和卸载的目标互不相同，装一个不会卸掉另一个", async () => {
    const a = setup();
    const b = setup();
    // 同一个家目录、两份集中存储。
    const shared = { ...b.ctx, userHome: a.userHome, env: { PLOOP_HOME: b.store } };
    await autostartOn(a.ctx, a.deps);
    await autostartOn(shared, b.deps);
    expect(a.calls[0]?.[1]).toBe(`gui/501/${a.label}`);
    expect(b.calls[0]?.[1]).toBe(`gui/501/${agentLabelFor(shared)}`);
    expect(a.calls[0]?.[1]).not.toBe(b.calls[0]?.[1]);
    expect(existsSync(agentFile(a.userHome, a.label))).toBe(true);
    expect(existsSync(agentFile(a.userHome, agentLabelFor(shared)))).toBe(true);
  });
});

describe("ploop backend autostart", () => {
  it("on：写启动项，先卸后装，指向 app/current/backend.mjs 和运行命令行的 Node", async () => {
    const t = setup();
    const outcome = await autostartOn(t.ctx, t.deps);
    const file = agentFile(t.userHome, t.label);
    expect(file).toBe(join(t.userHome, "Library", "LaunchAgents", `${t.label}.plist`));
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        kind: "backend.autostart.on",
        lines: [
          "装好了：登录时自动启动后端",
          `启动项：${file}`,
          `运行：/opt/node/bin/node ${t.entry}`,
          "崩溃了会自动重启。",
          "ploop backend stop 停下后，启动项不再拉起它。",
          "下一条命令仍会拉起它。",
        ],
        next: ["ploop backend autostart status"],
      },
    });
    const plist = readFileSync(file, "utf8");
    expect(plist).toContain(`<string>/opt/node/bin/node</string>\n    <string>${t.entry}</string>`);
    expect(plist).toContain(`<string>${t.store}</string>`);
    expect(t.calls).toEqual([
      ["bootout", `gui/501/${t.label}`],
      ["bootstrap", "gui/501", file],
    ]);
  });

  it("on：还没有 ploop setup 装好的后端：找不到入口，不写文件，不调 launchctl", async () => {
    const t = setup({ installed: false });
    const outcome = await autostartOn(t.ctx, t.deps);
    expect(outcome).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(JSON.stringify(outcome)).toContain("pnpm ploop:setup");
    expect(existsSync(agentFile(t.userHome, t.label))).toBe(false);
    expect(t.calls).toEqual([]);
  });

  it("on：launchctl 加载失败：报错，文件留着，下次登录会加载", async () => {
    const t = setup();
    t.results.bootstrap = { code: 5, output: "Bootstrap failed: 5: Input/output error" };
    const outcome = await autostartOn(t.ctx, t.deps);
    expect(outcome).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(outcome)).toContain("Bootstrap failed: 5");
    expect(existsSync(agentFile(t.userHome, t.label))).toBe(true);
  });

  it("off：卸载并删除；没装过就什么都不做，不调 launchctl", async () => {
    const t = setup();
    await autostartOn(t.ctx, t.deps);
    t.calls.length = 0;
    const off = await autostartOff(t.ctx, t.deps);
    expect(off).toMatchObject({
      ok: true,
      value: {
        kind: "backend.autostart.off",
        lines: [
          "卸掉了：登录时自动启动后端",
          `已删除启动项：${agentFile(t.userHome, t.label)}`,
          "由启动项拉起的后端已随之退出，下一条命令会重新拉起它",
        ],
      },
    });
    expect(existsSync(agentFile(t.userHome, t.label))).toBe(false);
    expect(t.calls).toEqual([["bootout", `gui/501/${t.label}`]]);

    t.calls.length = 0;
    const again = await autostartOff(t.ctx, t.deps);
    expect(again).toMatchObject({ ok: true, value: { lines: ["本来就没有装，什么都没做"] } });
    expect(t.calls).toEqual([]);
  });

  it("off：启动项没加载时卸载失败也照删文件，不说后端退出了", async () => {
    const t = setup();
    await autostartOn(t.ctx, t.deps);
    t.results.bootout = { code: 3, output: "No such process" };
    const off = await autostartOff(t.ctx, t.deps);
    expect(off).toMatchObject({
      ok: true,
      value: {
        lines: ["卸掉了：登录时自动启动后端", `已删除启动项：${agentFile(t.userHome, t.label)}`],
      },
    });
    expect(existsSync(agentFile(t.userHome, t.label))).toBe(false);
  });

  it("status：没装、已装已加载、已装没加载", async () => {
    const t = setup();
    const none = await autostartStatus(t.ctx, t.deps);
    expect(none).toMatchObject({
      ok: true,
      value: { lines: ["登录时自动启动后端：没装"], next: ["ploop backend autostart on"] },
    });
    expect(t.calls).toEqual([]);

    await autostartOn(t.ctx, t.deps);
    t.calls.length = 0;
    const loaded = await autostartStatus(t.ctx, t.deps);
    expect(loaded).toMatchObject({
      ok: true,
      value: {
        data: { installed: true, loaded: true },
        lines: [
          "登录时自动启动后端：已装",
          `启动项：${agentFile(t.userHome, t.label)}`,
          "已加载：是",
        ],
      },
    });
    expect(t.calls).toEqual([["print", `gui/501/${t.label}`]]);

    t.results.print = { code: 113, output: "Could not find service" };
    const notLoaded = await autostartStatus(t.ctx, t.deps);
    expect(notLoaded).toMatchObject({
      ok: true,
      value: { data: { installed: true, loaded: false } },
    });
  });

  it("不是 macOS：三条都用法错误，什么都不写", async () => {
    const t = setup();
    const linux = { ...t.deps, platform: "linux" as const };
    for (const run of [autostartOn, autostartOff, autostartStatus]) {
      expect(await run(t.ctx, linux)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    }
    expect(t.calls).toEqual([]);
    expect(existsSync(join(t.userHome, "Library"))).toBe(false);
  });
});
