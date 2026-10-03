import { backendCopy, checkWriting, renderCopy } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { type EnsureFailure, failureIssue, isEnsureFailure } from "./failure.ts";

// 后端起不来的原因写成报错，见「01 架构」第八节：什么不对、怎么改，拉起过的写明日志在哪。

const started = {
  kind: "startFailed",
  logFile: "/Users/someone/.product-loop/logs/backend.log",
  node: "/usr/local/bin/node",
  entry: "/Users/someone/.product-loop/app/current/backend.mjs",
} as const;

const tail = [
  "2026-09-28 11:00:01 错误：数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
  "  怎么改：运行 ploop setup 安装新版本。",
];

const failures = {
  nodeTooOld: {
    kind: "nodeTooOld",
    node: "/usr/bin/node",
    current: "22.11.0",
    required: "24.12.0",
  },
  exited: { ...started, reason: "exited", exitCode: 3, waitedMs: 400, logTail: tail },
  killed: { ...started, reason: "exited", signal: "SIGKILL", waitedMs: 400, logTail: [] },
  quick: { ...started, reason: "timeout", waitedMs: 8_000, logTail: [] },
  slow: { ...started, reason: "timeout", waitedMs: 60_000, logTail: tail },
  spawnFailed: {
    ...started,
    reason: "spawnFailed",
    detail: "spawn ENOENT",
    waitedMs: 0,
    logTail: [],
  },
  entryMissing: { ...started, reason: "entryMissing", waitedMs: 0, logTail: [] },
  buildMismatch: {
    kind: "buildMismatch",
    expected: "dev",
    actual: "old",
    pid: 70001,
    entry: "/a.mjs",
  },
  refused: {
    kind: "replaceFailed",
    reason: "refused",
    pid: 70001,
    build: "old",
    error: { code: "BUSY", message: "后端正在做今天的数据库快照。", hint: "稍后重跑这条命令。" },
  },
  stillRunning: {
    kind: "replaceFailed",
    reason: "stillRunning",
    pid: 70001,
    build: "old",
    waitedMs: 10_000,
  },
} satisfies Record<string, EnsureFailure>;

describe("起不来的原因写成报错", () => {
  it.each(Object.entries(failures))(
    "%s：有说明和怎么改，没有残留的参数，写作校验不拦",
    (_, failure) => {
      const issue = failureIssue(failure);
      expect(issue.message).not.toBe("");
      expect(issue.hint).not.toBe("");
      expect(`${issue.message}${issue.hint}`).not.toMatch(/\{[A-Za-z]+\}/u);
      expect(checkWriting(issue.message).block).toEqual([]);
      expect(checkWriting(issue.hint ?? "").block).toEqual([]);
    },
  );

  it("Node 版本不够：写明当前版本和需要的版本", () => {
    expect(failureIssue(failures.nodeTooOld).message).toBe(
      renderCopy(backendCopy.nodeTooOld.message, { current: "22.11.0", required: "24.12.0" }),
    );
  });

  it("以退出码结束：写出退出码和日志的最后几行，位置是日志文件", () => {
    const issue = failureIssue(failures.exited);
    expect(issue.message).toContain("退出码 3");
    expect(issue.message).toContain(tail.join("\n"));
    expect(issue.where).toBe(started.logFile);
  });

  it("被信号结束：写出信号，日志里没有这一次的记录时写明", () => {
    const { message } = failureIssue(failures.killed);
    expect(message).toContain("SIGKILL");
    expect(message).toContain("日志里没有这一次启动的记录。");
  });

  it("八秒内没有就绪用共用定义的说法，等得更久的写明秒数", () => {
    expect(failureIssue(failures.quick).hint).toBe(renderCopy(backendCopy.startFailed.hint));
    expect(failureIssue(failures.slow).message).toContain("等了 60 秒");
  });

  it("旧后端没有答应退出：写出它的回答", () => {
    expect(failureIssue(failures.refused).message).toContain("后端正在做今天的数据库快照。");
  });

  it("旧后端一直没有结束：写明进程号", () => {
    const issue = failureIssue(failures.stillRunning);
    expect(issue.message).toContain("进程号 70001");
    expect(issue.hint).toContain("70001");
  });

  it("isEnsureFailure 分得清起不来和别的失败", () => {
    for (const failure of Object.values(failures)) expect(isEnsureFailure(failure)).toBe(true);
    expect(isEnsureFailure({ code: "BUSY", message: "忙", hint: "等" })).toBe(false);
    expect(isEnsureFailure({ unreachable: "refused", detail: "ECONNREFUSED" })).toBe(false);
  });
});
