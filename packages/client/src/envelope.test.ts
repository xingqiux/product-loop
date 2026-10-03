import { describe, expect, it } from "vitest";
import { parseEnvelope } from "./envelope.ts";

// 外壳用共用定义校验，见「05 接口」第一节。

describe("解析响应外壳", () => {
  it("成功和失败的外壳原样收下", () => {
    const success = { ok: true, data: { pid: 1 }, warnings: [], next: ["ploop status"] };
    expect(parseEnvelope(202, JSON.stringify(success))).toEqual({ ok: true, value: success });
    const failure = { ok: false, error: { code: "NOT_FOUND", message: "没有这个项目：app。" } };
    expect(parseEnvelope(404, JSON.stringify(failure))).toEqual({ ok: true, value: failure });
  });

  it.each([
    ["空的正文", ""],
    ["网页", "<html></html>"],
    ["不是对象", "42"],
    ["缺 ok", JSON.stringify({ data: 1, warnings: [], next: [] })],
    ["多出字段", JSON.stringify({ ok: true, data: 1, warnings: [], next: [], extra: 1 })],
    ["没有的错误码", JSON.stringify({ ok: false, error: { code: "GONE", message: "没了。" } })],
  ])("%s算没有拿到外壳，带上状态和正文的开头", (_name, body) => {
    expect(parseEnvelope(502, body)).toEqual({
      ok: false,
      error: { unreachable: "badResponse", status: 502, detail: body },
    });
  });
});
