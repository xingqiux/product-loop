import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logFileName } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { tempDir } from "../store/testing.ts";
import { openLog } from "./log.ts";

// 后端的日志：一行一个 JSON 对象，按大小轮转，见「03 数据模型」第四节。

const at = new Date("2026-09-28T08:00:00Z");

/** 读出一个日志文件里的每一行。 */
function lines(file: string): Record<string, unknown>[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** 目录里的日志文件，按名字排好。 */
function logFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.startsWith(logFileName))
    .sort();
}

describe("日志的每一行", () => {
  it("一行一个 JSON 对象：时间、级别、进程号、事件、说明，再加事件自己的字段", () => {
    const dir = tempDir("ploop-log-");
    const log = openLog({ dir, now: () => at, pid: 4321 });
    log.info("started", { message: "后端已启动。", port: 4731 });
    log.warn("snapshotFailed", { message: "快照没有做成。", hint: "再试一次。" });
    log.close();
    expect(lines(join(dir, logFileName))).toEqual([
      {
        time: "2026-09-28T08:00:00.000Z",
        level: "info",
        pid: 4321,
        event: "started",
        message: "后端已启动。",
        port: 4731,
      },
      {
        time: "2026-09-28T08:00:00.000Z",
        level: "warn",
        pid: 4321,
        event: "snapshotFailed",
        message: "快照没有做成。",
        hint: "再试一次。",
      },
    ]);
  });

  it("错误对象写出名字、说明、code 和调用栈，调用栈里的换行不会拆成几行", () => {
    const dir = tempDir("ploop-log-");
    const log = openLog({ dir });
    const error = Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
    log.error("unexpected", { message: "出错了。", error });
    const [line] = lines(join(dir, logFileName));
    expect(line?.error).toMatchObject({
      name: "Error",
      message: "database is locked",
      code: "SQLITE_BUSY",
    });
    expect(String((line?.error as { stack?: string } | undefined)?.stack)).toContain("log.test.ts");
    expect(readFileSync(join(dir, logFileName), "utf8").trimEnd().split("\n")).toHaveLength(1);
  });

  it("错误级别的行另外交给 onError，别的级别不交", () => {
    const dir = tempDir("ploop-log-");
    const errors: string[] = [];
    const log = openLog({ dir, onError: (line) => errors.push(line) });
    log.info("started", { message: "后端已启动。" });
    log.error("dbNewer", { message: "数据库比程序新。" });
    expect(errors).toHaveLength(1);
    expect(JSON.parse(errors[0] ?? "")).toMatchObject({ event: "dbNewer", level: "error" });
  });

  it("字段写不成 JSON 时，只留时间、级别、进程号、事件和说明", () => {
    const dir = tempDir("ploop-log-");
    const log = openLog({ dir, now: () => at, pid: 7 });
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    log.warn("odd", { message: "有一个字段绕回了自己。", loop });
    expect(lines(join(dir, logFileName))).toEqual([
      {
        time: "2026-09-28T08:00:00.000Z",
        level: "warn",
        pid: 7,
        event: "odd",
        message: "有一个字段绕回了自己。",
      },
    ]);
  });
});

describe("日志按大小轮转", () => {
  /** 写 n 行，每行的说明带着序号。 */
  function writeMany(dir: string, n: number, maxBytes: number) {
    const log = openLog({ dir, maxBytes, keep: 3, now: () => at, pid: 1 });
    for (let i = 1; i <= n; i++) log.info("tick", { message: `第 ${i} 行。` });
    log.close();
  }

  it("超过上限就改名为 .1，旧的依次后移，只留三份，最旧的删掉", () => {
    const dir = tempDir("ploop-log-");
    // 一行是九十九到一百个字节。上限写成三百一十，每个文件放三行。
    writeMany(dir, 20, 310);
    expect(logFiles(dir)).toEqual([
      "backend.log",
      "backend.log.1",
      "backend.log.2",
      "backend.log.3",
    ]);
    const messages = (name: string) => lines(join(dir, name)).map((line) => line.message);
    expect(messages("backend.log")).toEqual(["第 19 行。", "第 20 行。"]);
    expect(messages("backend.log.1")).toEqual(["第 16 行。", "第 17 行。", "第 18 行。"]);
    expect(messages("backend.log.3")).toEqual(["第 10 行。", "第 11 行。", "第 12 行。"]);
    for (const name of logFiles(dir)) expect(statSync(join(dir, name)).size).toBeLessThan(310);
  });

  it("已有的文件超过上限时，第一行写入之前先轮转", () => {
    const dir = tempDir("ploop-log-");
    writeFileSync(join(dir, logFileName), `${"x".repeat(300)}\n`);
    const log = openLog({ dir, maxBytes: 260 });
    log.info("started", { message: "后端已启动。" });
    expect(statSync(join(dir, "backend.log.1")).size).toBe(301);
    expect(lines(join(dir, logFileName)).map((line) => line.event)).toEqual(["started"]);
  });

  it("一行比上限还长时照样写下，单独占一个文件", () => {
    const dir = tempDir("ploop-log-");
    const log = openLog({ dir, maxBytes: 100 });
    log.info("short", { message: "短的一行。" });
    log.error("long", { message: "长的一行。", detail: "y".repeat(500) });
    expect(lines(join(dir, logFileName)).map((line) => line.event)).toEqual(["long"]);
    expect(lines(join(dir, "backend.log.1")).map((line) => line.event)).toEqual(["short"]);
  });

  it("别的进程把文件改了名，下一行写进新的 backend.log", () => {
    const dir = tempDir("ploop-log-");
    const log = openLog({ dir });
    log.info("first", { message: "第一行。" });
    renameSync(join(dir, logFileName), join(dir, "backend.log.1"));
    log.info("second", { message: "第二行。" });
    expect(lines(join(dir, logFileName)).map((line) => line.event)).toEqual(["second"]);
    expect(lines(join(dir, "backend.log.1")).map((line) => line.event)).toEqual(["first"]);
  });
});
