import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { beijingSecond, type LogLine, rotatedLogFileName } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { formatLogLine, readLogTail } from "./log-tail.ts";
import { tempDir } from "./testing.ts";

// 后端起不来时报出日志的最后几行，见「01 架构」第八节。

const base = Date.parse("2026-09-28T03:00:00Z");

function line(seconds: number, message: string, extra: Partial<LogLine> = {}): LogLine {
  const time = new Date(base + seconds * 1000).toISOString();
  return { time, level: "info", pid: 51234, event: "note", message, ...extra };
}

function setup() {
  const dir = join(tempDir("ploop-log-"), "logs");
  mkdirSync(dir);
  const file = join(dir, "backend.log");
  const write = (target: string, ...lines: (LogLine | string)[]) => {
    const text = lines.map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
    appendFileSync(target, `${text.join("\n")}\n`);
  };
  return { dir, file, write };
}

/** 北京时间的写法，和 log-tail.ts 的相同。 */
function beijing(seconds: number): string {
  return beijingSecond(new Date(base + seconds * 1000));
}

describe("日志的一行写成中文", () => {
  it("时间、级别和说明", () => {
    expect(formatLogLine(line(1, "后端已启动。"))).toBe(`${beijing(1)} 信息：后端已启动。`);
  });

  it("出错的行另写报错的原文和怎么改，调用栈不报", () => {
    const error = { name: "SqliteError", message: "database is locked", stack: "at x\nat y" };
    const text = formatLogLine(
      line(2, "打不开数据库。", { level: "error", error, hint: "结束占着数据库的程序。" }),
    );
    expect(text).toBe(
      [
        `${beijing(2)} 错误：打不开数据库。`,
        "  报错的原文：SqliteError: database is locked",
        "  怎么改：结束占着数据库的程序。",
      ].join("\n"),
    );
  });

  it("写了是哪个请求出的错，就在报错的原文前面写出来", () => {
    const text = formatLogLine(
      line(2, "处理请求时出了错。", {
        level: "error",
        request: "GET /api/v1/projects/app/queue/Q1",
        error: "ZodError",
      }),
    );
    expect(text).toBe(
      [
        `${beijing(2)} 错误：处理请求时出了错。`,
        "  请求：GET /api/v1/projects/app/queue/Q1",
        "  报错的原文：ZodError",
      ].join("\n"),
    );
  });

  it("报错的原文是字符串时照写，太长的截断", () => {
    const text = formatLogLine(line(3, "出错了。", { level: "warn", error: "x".repeat(400) }));
    expect(text).toContain(`警告：出错了。\n  报错的原文：${"x".repeat(300)}…`);
  });
});

describe("日志的最后几行", () => {
  it("没有日志文件时是空的", () => {
    expect(readLogTail(setup().file, { lines: 5 })).toEqual([]);
  });

  it("只取最后几行", () => {
    const s = setup();
    s.write(s.file, ...[1, 2, 3, 4].map((n) => line(n, `第 ${n} 行。`)));
    expect(readLogTail(s.file, { lines: 2 })).toEqual([
      `${beijing(3)} 信息：第 3 行。`,
      `${beijing(4)} 信息：第 4 行。`,
    ]);
  });

  it("只取拉起以后写的行，以前各次启动写的不报", () => {
    const s = setup();
    s.write(s.file, line(1, "上一次。"), line(10, "这一次。"));
    expect(readLogTail(s.file, { lines: 5, since: base + 5_000 })).toEqual([
      `${beijing(10)} 信息：这一次。`,
    ]);
  });

  it("写坏了的行照原样报出，它前面的行过了拉起时间才算", () => {
    const s = setup();
    s.write(s.file, "坏的一行 A", line(10, "这一次。"), `坏的一行 B${"y".repeat(300)}`);
    expect(readLogTail(s.file, { lines: 5, since: base + 5_000 })).toEqual([
      `${beijing(10)} 信息：这一次。`,
      `坏的一行 B${"y".repeat(194)}…`,
    ]);
  });

  it("刚轮转过时连同 backend.log.1 一起读", () => {
    const s = setup();
    s.write(join(s.dir, rotatedLogFileName(1)), line(1, "旧的。"), line(2, "轮转前。"));
    s.write(s.file, line(3, "轮转后。"));
    expect(readLogTail(s.file, { lines: 2 })).toEqual([
      `${beijing(2)} 信息：轮转前。`,
      `${beijing(3)} 信息：轮转后。`,
    ]);
  });
});
