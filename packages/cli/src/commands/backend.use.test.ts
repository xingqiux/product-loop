import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { processAlive } from "@product-loop/client/node";
import { cliEnvelopeSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { sandbox, testBuild } from "./testing.ts";

// ploop backend start|stop|status|logs 对着真的后端跑，见「01 架构」第六到第八节。

describe("ploop backend", { timeout: 60_000 }, () => {
  it("status、start、logs、stop 走一遍：查看和停下都不拉起后端", () => {
    const s = sandbox();
    const log = join(s.store, "logs", "backend.log");

    const idle = s.ploop(".", "backend", "status");
    expect(idle.stdout).toBe(
      [
        "后端没有在运行",
        `集中存储：${s.store}`,
        `日志：${log}`,
        "",
        "下一步：",
        "  1. ploop backend start",
        "",
      ].join("\n"),
    );
    expect(idle.code).toBe(0);
    expect(s.runInfo()).toBeUndefined();

    const start = s.ploop(".", "backend", "start");
    const info = s.runInfo();
    expect(start.stdout.split("\n")[0]).toBe(`启动了：后端，进程 ${info?.pid}，端口 ${info?.port}`);
    expect(start.code).toBe(0);
    expect(s.ploop(".", "backend", "start").stdout.split("\n")[0]).toBe(
      `后端已在运行：进程 ${info?.pid}，端口 ${info?.port}`,
    );

    const running = s.ploop(".", "backend", "status");
    const lines = running.stdout.split("\n");
    expect(lines[0]).toBe(`在运行：后端，进程 ${info?.pid}，端口 ${info?.port}`);
    // 工作台的首页地址，用户和 AI 不用自己记端口。
    expect(lines[1]).toBe(`工作台：http://127.0.0.1:${info?.port}/`);
    expect(lines[2]).toBe(`构建号：${testBuild}`);
    expect(lines[3]).toMatch(/^运行了：\d+ 秒$/u);
    // 数据结构版本写成读得懂的时间，不写毫秒数。
    expect(lines.find((line) => line.startsWith("数据结构："))).toMatch(
      /^数据结构：最后一次迁移生成于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u,
    );
    expect(lines).toContain(`集中存储：${s.store}`);
    expect(running.code).toBe(0);

    const logs = s.ploop(".", "backend", "logs", "--lines", "2");
    const logLines = logs.stdout.trimEnd().split("\n");
    expect(logLines[0]).toBe(`日志的最后 2 条：${log}`);
    expect(
      logLines.slice(1).every((line) => /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d 信息：/u.test(line)),
    ).toBe(true);

    const stop = s.ploop(".", "backend", "stop");
    expect(stop.stdout).toBe(`停下了：后端，进程 ${info?.pid}\n`);
    expect(stop.code).toBe(0);
    expect(processAlive(info?.pid ?? 0)).toBe(false);
    expect(s.runInfo()).toBeUndefined();

    const again = s.ploop(".", "backend", "stop");
    expect(again.stdout).toBe("后端没有在运行\n");
    expect(again.code).toBe(0);
  });

  it("已在后台运行时不能再在前台启动：冲突，退出码 3", () => {
    const s = sandbox();
    s.ploop(".", "backend", "start");
    const info = s.runInfo();
    const { code, stderr } = s.ploop(".", "backend", "start", "--foreground");
    expect(stderr).toBe(
      [
        `冲突：后端已在后台运行，进程 ${info?.pid}，端口 ${info?.port}。`,
        "怎么改：先运行 ploop backend stop，再在前台启动。",
        "",
      ].join("\n"),
    );
    expect(code).toBe(3);
  });
});

describe("在前台运行", { timeout: 60_000 }, () => {
  it("后端收到 Ctrl-C 的信号以后收尾退出，命令行跟着以 0 结束", async () => {
    const s = sandbox();
    const { done } = s.launch(".", "backend", "start", "--foreground");
    let info = s.runInfo();
    for (let i = 0; i < 200 && info === undefined; i++) {
      await sleep(50);
      info = s.runInfo();
    }
    if (info === undefined) throw new Error("前台的后端没有写 backend.json");
    process.kill(info.pid, "SIGINT");
    expect(await done).toEqual({ code: 0, stdout: "后端已退出\n", stderr: "" });
    expect(s.runInfo()).toBeUndefined();
  });
});

describe("后端起不来", { timeout: 60_000 }, () => {
  /** config.json 写错，后端以退出码 2 结束，日志写明哪里错了。 */
  function broken() {
    const s = sandbox();
    mkdirSync(s.store, { recursive: true });
    writeFileSync(join(s.store, "config.json"), JSON.stringify({ port: "abc" }));
    return s;
  }

  it("backend start：退出码 5，报出日志的最后几行和日志的位置", () => {
    const s = broken();
    const { code, stdout, stderr } = s.ploop(".", "backend", "start");
    expect(stdout).toBe("");
    expect(stderr).toMatch(
      /^后端出错：后端没有启动成功，进程以退出码 2 结束。日志的最后几行：\n\d{4}-\d\d-\d\d \d\d:\d\d:\d\d 错误：.*config\.json/u,
    );
    expect(stderr).toContain(`位置：${join(s.store, "logs", "backend.log")}\n`);
    expect(stderr).toContain("怎么改：按日志里写的「怎么改」处理，再重跑这条命令。\n");
    expect(code).toBe(5);
  });

  it("init 时自动拉起失败：一样以退出码 5 结束，--json 时只有一个 JSON 对象", () => {
    const s = broken();
    const { code, stdout, stderr } = s.ploop("proj/app", "init", "--repo", "自己的", "--json");
    expect(stdout.trimEnd().split("\n")).toHaveLength(1);
    const envelope = cliEnvelopeSchema.parse(JSON.parse(stdout));
    expect(envelope).toMatchObject({ kind: "error", ok: false, error: { code: "INTERNAL" } });
    if (envelope.ok) throw new Error("应当失败");
    expect(envelope.error.message).toContain("config.json");
    expect(stderr).toBe("");
    expect(code).toBe(5);
  });
});
