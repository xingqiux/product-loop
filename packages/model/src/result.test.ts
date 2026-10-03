import { describe, expect, it } from "vitest";
import { err, ok } from "./result.ts";

describe("带错误码的结果", () => {
  it("成功带值，失败带错误码", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("shape")).toEqual({ ok: false, error: "shape" });
  });
});
