import { errorBody, issuesOf } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { checkEntries, entriesOf, readableError } from "./reply-entries.ts";

describe("--file 写的东西", () => {
  it("数组照收，一个对象当作只处理一行", () => {
    const one = { line: 1, to: "不处理", reason: "x" };
    expect(entriesOf([one], "d.json")).toEqual({ ok: true, value: [one] });
    expect(entriesOf(one, "d.json")).toEqual({ ok: true, value: [one] });
  });

  it("别的写法拦下，说明要写数组或一个对象", () => {
    for (const text of ["x", 3, null]) {
      const result = entriesOf(text, "d.json");
      expect(result.ok ? undefined : result.error.message).toBe(
        "d.json 里要写一个数组，每项处理一行；只处理一行时也可以写一个对象。",
      );
    }
  });
});

describe("发出去以前查一遍", () => {
  it("决定三项缺了：按规矩 decision.fields 拦截，一次报齐，写明是哪几个选项", () => {
    const error = checkEntries([{ line: 1, to: "决定" }], true);
    expect(error?.code).toBe("RULE_BLOCKED");
    const issues = error === undefined ? [] : issuesOf(error);
    expect(issues.map((issue) => [issue.rule, issue.where])).toEqual([
      ["decision.fields", "第 1 行的 --decision"],
      ["decision.fields", "第 1 行的 --reason"],
      ["decision.fields", "第 1 行的 --case"],
    ]);
    expect(issues[0]?.hint).toContain("--decision、--reason、--case");
    expect(JSON.stringify(issues)).not.toMatch(/\[\d\]/u);
  });

  it("用文件处理时位置写字段名，没写行号的按第几项", () => {
    const error = checkEntries(
      [{ to: "不处理" }, { to: "决定", decision: "x", reason: "y" }],
      false,
    );
    expect(error && issuesOf(error).map((issue) => issue.where)).toEqual(["文件里第 2 项的 case"]);
  });

  it("队列里放进新的一件没写阶段：写明加 --stage，不留 {value}", () => {
    const entry = { line: 2, to: "队列", item: { content: "导出功能", proposer: "用户" } };
    const error = checkEntries([entry], true);
    expect(error?.code).toBe("BAD_REQUEST");
    expect(error && issuesOf(error)).toEqual([
      {
        message: "第 2 行要放进队列的是新的一件事，没写要做它的阶段。",
        hint: expect.stringContaining("加 --stage <阶段名>"),
        where: "第 2 行的 --stage",
      },
    ]);
  });

  it("都齐了什么都不说", () => {
    const entries = [
      { line: 1, to: "决定", decision: "a", reason: "b", case: "c" },
      { line: 2, to: "队列", item: { content: "x", stage: "落地" } },
      { line: 3, to: "队列", id: "Q1" },
    ];
    expect(checkEntries(entries, true)).toBeUndefined();
  });
});

describe("后端回来的报错", () => {
  const generic = "对照这条命令的 --help，检查参数和取值。";

  it("数组下标换成第几行，字段换成命令里的选项，泛泛的怎么改换成这个字段的写法", () => {
    const back = errorBody("BAD_REQUEST", [
      { message: "[0].reason 要写成文字。", hint: generic, where: "[0].reason" },
    ]);
    const entries = [{ line: 4, to: "不处理" }];
    const error = readableError(back, entries, true);
    expect(error).toEqual({
      code: "BAD_REQUEST",
      message: "第 4 行的 说明 要写成文字。",
      hint: "不处理写原因，例如 已经在第一屏。",
      where: "第 4 行的 说明",
    });
  });

  it("用文件时字段名照写，别的字段给通用的说明", () => {
    const back = errorBody("BAD_REQUEST", [
      { message: "[1].line 要写成数字。", hint: generic, where: "[1].line" },
    ]);
    const error = readableError(back, [{ line: 1 }, { to: "不处理" }], false);
    expect(error.where).toBe("文件里第 2 项的 line");
    expect(error.message).toBe("文件里第 2 项的 line 要写成数字。");
    expect(error.hint).toBe("运行 ploop reply handle --help，查看每种去处要写哪几项。");
  });

  it("后端自己写了怎么改的，不动；不是数组下标的位置也不动", () => {
    const own = errorBody("CONFLICT", [
      {
        message: "第 3 行已经处理过了。",
        hint: "运行 ploop reply show。",
        where: "[0].line",
      },
    ]);
    expect(readableError(own, [{ line: 3 }], true)).toMatchObject({
      hint: "运行 ploop reply show。",
      where: "第 3 行",
    });
    const plain = errorBody("BAD_REQUEST", [{ message: "x", hint: generic, where: "summary" }]);
    expect(readableError(plain, [], true)).toEqual(plain);
  });
});
