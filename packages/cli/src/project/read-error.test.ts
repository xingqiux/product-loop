import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errnoOf, programFailure, readFailure } from "./read-error.ts";
import { tempRoot } from "./testing.ts";

// 读文件失败写成给人看的话，不露出系统错误码，见审查报告 P27。

async function failureOf(path: string) {
  try {
    await readFile(path, "utf8");
  } catch (error) {
    return readFailure(error);
  }
  throw new Error("应当读不出来");
}

describe("readFailure", () => {
  it("文件不存在：说文件不存在，不写 ENOENT", async () => {
    const root = tempRoot();
    const failure = await failureOf(join(root, "没有这个.json"));
    expect(failure).toEqual({ kind: "missing", reason: "文件不存在" });
  });

  it("读的是文件夹：说是文件夹", async () => {
    const root = tempRoot();
    mkdirSync(join(root, "d"));
    expect(await failureOf(join(root, "d"))).toEqual({
      kind: "other",
      reason: "这是一个文件夹，不是文件",
    });
  });

  it("路径里有一段是文件：说不是文件夹", async () => {
    const root = tempRoot();
    writeFileSync(join(root, "f"), "");
    expect(await failureOf(join(root, "f", "x.json"))).toEqual({
      kind: "missing",
      reason: "路径里有一段不是文件夹",
    });
  });

  it("没有权限、别的错误，各有说法，都不露出错误码", () => {
    const denied = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    expect(readFailure(denied)).toEqual({ kind: "denied", reason: "没有读它的权限" });
    const other = Object.assign(new Error("boom"), { code: "EIO" });
    expect(readFailure(other)).toEqual({ kind: "other", reason: "boom" });
    expect(readFailure("字符串")).toEqual({ kind: "other", reason: "字符串" });
  });
});

describe("programFailure", () => {
  it("找不到程序、没有权限、别的", () => {
    expect(programFailure("ENOENT").reason).toBe("找不到这个程序，确认名字写对了、已经装好");
    expect(programFailure("EACCES")).toEqual({ kind: "denied", reason: "没有运行它的权限" });
    expect(programFailure("EMFILE")).toEqual({ kind: "other", reason: "EMFILE" });
  });
});

describe("errnoOf", () => {
  it("取系统错误的错误码，别的错误没有", () => {
    expect(errnoOf(Object.assign(new Error("x"), { code: "EEXIST" }))).toBe("EEXIST");
    expect(errnoOf(new Error("x"))).toBeUndefined();
    expect(errnoOf("x")).toBeUndefined();
  });
});
