import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { backendFiles, instanceHolder, processAlive, readRunInfo } from "./files.ts";
import { tempDir } from "./testing.ts";

// 命令行在集中存储里碰的几个文件，见「01 架构」第六节和第八节。

describe("集中存储里的文件", () => {
  it("名字取自共用定义", () => {
    expect(backendFiles("/h")).toEqual({
      home: "/h",
      runDir: "/h/run",
      runInfo: "/h/run/backend.json",
      instanceLock: "/h/run/backend.lock",
      startLock: "/h/run/start.lock",
      log: "/h/logs/backend.log",
    });
  });

  it("readRunInfo：合定义的读出来，不在、不是 JSON、不合定义的都是 undefined", () => {
    const dir = tempDir("ploop-files-");
    const file = join(dir, "backend.json");
    expect(readRunInfo(file)).toBeUndefined();
    writeFileSync(file, "{");
    expect(readRunInfo(file)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ pid: 1 }));
    expect(readRunInfo(file)).toBeUndefined();
    const info = {
      pid: 51234,
      port: 4731,
      build: "dev",
      schemaVersion: 1,
      startedAt: "2026-09-28T03:00:00.000Z",
      home: dir,
      node: "v24.20.0",
      entry: "/a/backend.mjs",
    };
    writeFileSync(file, JSON.stringify(info));
    expect(readRunInfo(file)).toEqual(info);
  });
});

describe("实例锁的文件头", () => {
  it("读出后端写进 user_version 的进程号", () => {
    const file = join(tempDir("ploop-files-"), "backend.lock");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA user_version = 51234");
    db.close();
    expect(instanceHolder(file)).toBe(51234);
  });

  it("没写进程号、不是 SQLite 文件、文件不在，都是 undefined", () => {
    const dir = tempDir("ploop-files-");
    const empty = join(dir, "empty.lock");
    const db = new DatabaseSync(empty);
    db.exec("CREATE TABLE t (x)");
    db.close();
    expect(instanceHolder(empty)).toBeUndefined();
    const text = join(dir, "text.lock");
    writeFileSync(text, "x".repeat(100));
    expect(instanceHolder(text)).toBeUndefined();
    expect(instanceHolder(join(dir, "missing.lock"))).toBeUndefined();
  });
});

describe("进程在不在", () => {
  it("自己在，没有的进程号不在", () => {
    expect(processAlive(process.pid)).toBe(true);
    expect(processAlive(2 ** 22 + 12_345)).toBe(false);
  });
});
