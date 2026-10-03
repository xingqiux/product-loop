import { describe, expect, it } from "vitest";
import { jsonSyntaxError } from "./json-error.ts";

const identityText = `{
  "schemaVersion": 1,
  "projectId": "app"
  "skillVersion": "2.0.0"
}`;

describe("JSON 写坏时的行和列", () => {
  it.each([
    ["空文件", 1, 1, ""],
    ["只有空白", 2, 3, "  \n  "],
    ["只写了左括号", 1, 2, "{"],
    ["字段名没加引号", 1, 2, "{x}"],
    ["最后一项后面多了逗号", 1, 8, '{"a":1,}'],
    ["两项之间少了逗号", 4, 3, identityText],
    ["数组里连着两个逗号", 2, 3, "[1,\n2,,3]"],
    ["true 没写完", 1, 10, '{"a": tru}'],
    ["字符串没写完", 1, 5, '"abc'],
    ["字符串里有换行", 1, 8, '{"a":"b\nc"}'],
    ["不认识的转义", 1, 4, '"a\\x"'],
    ["\\u 后面不是四位十六进制", 1, 6, '"\\u12G4"'],
    ["数字以 0 开头", 1, 2, "01"],
    ["负号后面没有数字", 1, 2, "-x"],
    ["小数点后面没有数字", 1, 3, "1."],
    ["指数后面没有数字", 1, 4, "1e+"],
    ["冒号写成等号", 1, 5, '{"a"=1}'],
    ["值后面多了东西", 2, 1, '{"a":1}\n}'],
    ["单引号", 1, 2, "{'a':1}"],
    ["汉字按一列算", 1, 11, '{"名字":"值",}'],
    ["开头的 BOM", 1, 1, "\uFEFF{}"],
  ])("%s：第 %i 行第 %i 列", (_name, line, column, text) => {
    expect(() => JSON.parse(text)).toThrow(SyntaxError);
    expect(jsonSyntaxError(text)).toEqual({ line, column });
  });

  it.each([
    "{}",
    "[]",
    '  {"a": [1, -2.5e+3, 0, true, false, null, "\\"\\\\\\/\\b\\f\\n\\r\\t\\u00e9"]}  \n',
    '{"名字": "值", "嵌套": {"数组": [[], {}]}}',
    "0",
    '"只有一个字符串"',
    identityText.replace('"app"', '"app",'),
  ])("合法的 JSON 返回 undefined：%j", (text) => {
    expect(() => JSON.parse(text)).not.toThrow();
    expect(jsonSyntaxError(text)).toBeUndefined();
  });
});
