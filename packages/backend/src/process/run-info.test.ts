import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunInfo } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { tempDir } from "../store/testing.ts";
import {
  clearStaleRunInfo,
  readRunInfo,
  removeRunInfo,
  runInfoFile,
  writeRunInfo,
} from "./run-info.ts";

// run/backend.json，见「01 架构」第六节。命令行读它找后端，后端退出时删掉它。

const info: RunInfo = {
  pid: 51234,
  port: 4731,
  build: "dev",
  schemaVersion: 1790000000000,
  startedAt: "2026-09-28T08:00:00.000Z",
  home: "/tmp/ploop-home",
  node: "v24.20.0",
  entry: "/work/product-loop/packages/backend/src/main.ts",
};

describe("写和读 backend.json", () => {
  it("写好以后读得回来，目录里不留临时文件", () => {
    const dir = tempDir("ploop-run-");
    writeRunInfo(dir, info);
    expect(readRunInfo(dir)).toEqual(info);
    expect(JSON.parse(readFileSync(runInfoFile(dir), "utf8"))).toEqual(info);
    expect(readdirSync(dir)).toEqual(["backend.json"]);
  });

  it("再写一次时整个换掉", () => {
    const dir = tempDir("ploop-run-");
    writeRunInfo(dir, info);
    writeRunInfo(dir, { ...info, pid: 60001, port: 50123 });
    expect(readRunInfo(dir)).toMatchObject({ pid: 60001, port: 50123 });
  });

  it("文件不在、不是 JSON、缺了字段，都读成没有", () => {
    const dir = tempDir("ploop-run-");
    expect(readRunInfo(dir)).toBeUndefined();
    writeFileSync(runInfoFile(dir), "{");
    expect(readRunInfo(dir)).toBeUndefined();
    const { port: _port, ...noPort } = info;
    writeFileSync(runInfoFile(dir), JSON.stringify(noPort));
    expect(readRunInfo(dir)).toBeUndefined();
  });

  it("多出来的字段不管，新版本加了字段，旧版本照样能读", () => {
    const dir = tempDir("ploop-run-");
    writeFileSync(runInfoFile(dir), JSON.stringify({ ...info, extra: "新版本的字段" }));
    expect(readRunInfo(dir)).toEqual(info);
  });
});

describe("删掉 backend.json", () => {
  it("只删自己写的：进程号对不上时不动", () => {
    const dir = tempDir("ploop-run-");
    writeRunInfo(dir, info);
    expect(removeRunInfo(dir, 60001)).toBe(false);
    expect(readRunInfo(dir)).toEqual(info);
    expect(removeRunInfo(dir, info.pid)).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("上一个实例留下的文件和没写完的临时文件，拿到锁以后一起删掉，别的文件不动", () => {
    const dir = tempDir("ploop-run-");
    writeRunInfo(dir, info);
    writeFileSync(join(dir, "backend.json.777.partial"), "{");
    writeFileSync(join(dir, "start.lock"), "");
    clearStaleRunInfo(dir);
    expect(readdirSync(dir)).toEqual(["start.lock"]);
  });
});
