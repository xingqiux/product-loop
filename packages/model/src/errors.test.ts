import { describe, expect, expectTypeOf, it } from "vitest";
import { renderCopy } from "./copy/define.ts";
import { exitCodeCopy } from "./copy/errors.ts";
import {
  type ErrorCode,
  type ExitName,
  errorCodeInfo,
  errorCodeSchema,
  errorCodes,
  exitCode,
} from "./errors.ts";

describe("「05 接口」第九节的错误码表", () => {
  // 原表一行一行照抄：错误码、HTTP 状态、命令行退出码。
  const table: [ErrorCode, number, number][] = [
    ["RULE_BLOCKED", 422, 1],
    ["BAD_REQUEST", 400, 2],
    ["CONFLICT", 409, 3],
    ["NOT_FOUND", 404, 4],
    ["BUSY", 503, 5],
    ["NEEDS_DOCTOR", 412, 6],
    ["PAGE_GONE", 410, 8],
    ["CLIENT_TOO_OLD", 426, 2],
    ["INTERNAL", 500, 5],
  ];

  it("错误码的个数和顺序和原表相同", () => {
    expect(errorCodes.map((row) => row.code)).toEqual(table.map(([code]) => code));
  });

  it.each(table)("%s 对应 HTTP %i、退出码 %i", (code, http, exit) => {
    expect(errorCodeInfo(code).http).toBe(http);
    expect(errorCodeInfo(code).exit).toBe(exit);
  });

  it("含义一列写明的：RULE_BLOCKED 要写 rule，INTERNAL 要写 hint，BUSY 带 Retry-After", () => {
    const notes = errorCodes.map((row) => [
      row.code,
      "requires" in row ? row.requires : undefined,
      "retryAfter" in row,
    ]);
    expect(notes).toEqual([
      ["RULE_BLOCKED", "rule", false],
      ["BAD_REQUEST", undefined, false],
      ["CONFLICT", undefined, false],
      ["NOT_FOUND", undefined, false],
      ["BUSY", undefined, true],
      ["NEEDS_DOCTOR", undefined, false],
      ["PAGE_GONE", undefined, false],
      ["CLIENT_TOO_OLD", undefined, false],
      ["INTERNAL", "hint", false],
    ]);
  });

  it("HTTP 状态各不相同，从状态也能认出错误码", () => {
    const statuses = errorCodes.map((row) => row.http);
    expect(new Set(statuses).size).toBe(statuses.length);
  });

  it("按错误码取到的就是表里那一行", () => {
    for (const row of errorCodes) expect(errorCodeInfo(row.code)).toBe(row);
  });

  it("错误码是字面量时，取到的 HTTP 状态和退出码也是字面量", () => {
    expectTypeOf(errorCodeInfo("RULE_BLOCKED").http).toEqualTypeOf<422>();
    expectTypeOf(errorCodeInfo("PAGE_GONE").exit).toEqualTypeOf<8>();
  });

  it("错误码的 schema 只收表里的写法", () => {
    for (const { code } of errorCodes) expect(errorCodeSchema.safeParse(code).success).toBe(true);
    for (const wrong of ["rule_blocked", "RuleBlocked", "OK", ""]) {
      expect(errorCodeSchema.safeParse(wrong).success).toBe(false);
    }
  });
});

describe("「04 命令行」第七节的退出码表", () => {
  // 原表一行一行照抄：退出码、含义、AI 通常怎么做。照抄时去掉了命令两边的反引号，
  // 5 的做法去掉了「见「01 架构」第八节」，理由写在 copy/errors.ts 的 exitCodeCopy 上。
  const table: [number, string, string][] = [
    [0, "成功", "看「下一步」"],
    [1, "拦截：数据或状态不合规矩", "按「怎么改」修改后重跑"],
    [2, "用法错误：参数缺失或取值不对", "看 --help"],
    [3, "冲突：状态不允许，例如另一页在等、别的会话改过主线", "按报错里的命令先处理冲突"],
    [4, "找不到：项目、阶段、事项、文件不存在", "检查编号和路径"],
    [5, "后端连不上或起不来", "按报错里的步骤排查"],
    [6, "要先做迁移检查：项目停在旧版本的 skill", "运行 ploop doctor"],
    [7, "还在等：到了时限，用户还没提交", "再运行一次同样的命令"],
    [8, "等的那一页已撤回或已被新的一页代替", "运行 ploop status"],
    [130, "被中断", "无"],
  ];
  const names = Object.keys(exitCode) as ExitName[];

  it("退出码的个数和顺序和原表相同", () => {
    expect(Object.values(exitCode)).toEqual(table.map(([code]) => code));
  });

  it.each(table)("退出码 %i：%s；%s", (code, meaning, action) => {
    const name = names.find((n) => exitCode[n] === code);
    if (name === undefined) throw new Error(`没有退出码 ${code}`);
    expect(renderCopy(exitCodeCopy[name].meaning)).toBe(meaning);
    expect(renderCopy(exitCodeCopy[name].action)).toBe(action);
  });

  it("每个错误码的退出码都在退出码表里", () => {
    const codes = new Set<number>(Object.values(exitCode));
    for (const row of errorCodes) expect(codes.has(row.exit)).toBe(true);
  });

  it("7 和 130 没有对应的错误码", () => {
    const fromErrors = new Set<number>(errorCodes.map((row) => row.exit));
    expect(fromErrors.has(exitCode.stillWaiting)).toBe(false);
    expect(fromErrors.has(exitCode.interrupted)).toBe(false);
  });
});
