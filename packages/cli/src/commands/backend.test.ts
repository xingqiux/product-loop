import { join } from "node:path";
import { formatLogLine } from "@product-loop/client/node";
import type { LogLine } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { makeTree, tempRoot } from "../project/testing.ts";
import { durationText } from "./backend.ts";

// logs 只读日志文件，不碰后端，在进程里测。start、stop、status 要真的后端，写在使用测试里。

const line = (message: string, time: string): LogLine => ({
  time,
  level: "info",
  pid: 4321,
  event: "test",
  message,
});

/** 集中存储放在临时目录，按 PLOOP_HOME 找到它。 */
function store(items: Parameters<typeof makeTree>[1]) {
  const home = tempRoot();
  makeTree(home, items);
  const env = { PLOOP_HOME: home };
  return { home, env, log: join(home, "logs", "backend.log") };
}

describe("ploop backend logs", () => {
  it("日志写成中文，一条一行；这一份不够时连同轮转下来的 backend.log.1 一起读", async () => {
    const older = [
      line("较早的一条。", "2026-09-28T01:00:00.000Z"),
      line("第二条。", "2026-09-28T01:00:01.000Z"),
    ];
    const newer = line("最新的一条。", "2026-09-28T02:00:00.000Z");
    const jsonl = (lines: readonly LogLine[]) =>
      lines.map((l) => `${JSON.stringify(l)}\n`).join("");
    const s = store([
      ["logs/backend.log.1", jsonl(older)],
      ["logs/backend.log", jsonl([newer])],
    ]);
    const { code, stdout } = await ploop(["backend", "logs", "--lines", "2"], { env: s.env });
    expect(stdout).toBe(
      [
        `日志的最后 2 条：${s.log}`,
        formatLogLine(older[1] as LogLine),
        formatLogLine(newer),
        "",
      ].join("\n"),
    );
    expect(code).toBe(0);
  });

  it("没有日志时照实说，退出码 0", async () => {
    const s = store([]);
    const { code, stdout } = await ploop(["backend", "logs"], { env: s.env });
    expect(stdout).toBe(`日志里还没有记录：${s.log}\n`);
    expect(code).toBe(0);
  });

  it("--json 时每条是 entries 里的一项", async () => {
    const s = store([
      ["logs/backend.log", `${JSON.stringify(line("一条。", "2026-09-28T02:00:00.000Z"))}\n`],
    ]);
    const { stdout } = await ploop(["backend", "logs", "--json"], { env: s.env });
    expect(JSON.parse(stdout)).toMatchObject({
      kind: "backend.logs",
      data: { file: s.log, entries: [expect.stringContaining("信息：一条。")] },
    });
  });

  it.each(["0", "-3", "abc", "1.5"])("--lines 写 %s 是用法错误，退出码 2", async (value) => {
    const { code, stderr } = await ploop(["backend", "logs", "--lines", value], {
      env: { PLOOP_HOME: "/nonexistent" },
    });
    expect(stderr).toContain(`选项 --lines <条数> 的取值「${value}」不对。要写正整数，例如 20。`);
    expect(code).toBe(2);
  });
});

describe("运行了多久", () => {
  it.each([
    [12_345, "12 秒"],
    [5 * 60_000 + 3_000, "5 分钟"],
    [(2 * 60 + 5) * 60_000, "2 小时 5 分钟"],
    [(3 * 24 + 2) * 3_600_000 + 60_000, "3 天 2 小时"],
    [-5, "0 秒"],
  ])("%d 毫秒写成 %s", (ms, text) => {
    expect(durationText(ms)).toBe(text);
  });
});
