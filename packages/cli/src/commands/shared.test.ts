import { describe, expect, it } from "vitest";
import { withoutDatePatterns } from "./shared.ts";

describe("JSON Schema 里日期时间字段的正则", () => {
  const long = "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26])-02-29)$";
  const schema = {
    type: "object",
    properties: {
      startedAt: { type: "string", format: "date-time", pattern: long },
      day: { type: "string", format: "date", pattern: long },
      scene: { type: "string", pattern: "^S[1-9][0-9]*$" },
      steps: { type: "array", items: { type: "string", format: "date-time", pattern: long } },
    },
  };

  it("日期、时间字段只留 format，去掉正则，嵌在数组里的也去掉", () => {
    expect(withoutDatePatterns(schema)).toEqual({
      type: "object",
      properties: {
        startedAt: { type: "string", format: "date-time" },
        day: { type: "string", format: "date" },
        scene: { type: "string", pattern: "^S[1-9][0-9]*$" },
        steps: { type: "array", items: { type: "string", format: "date-time" } },
      },
    });
  });

  it("别的字段的正则不动，传进来的对象也不改", () => {
    const before = JSON.stringify(schema);
    withoutDatePatterns(schema);
    expect(JSON.stringify(schema)).toBe(before);
    expect(withoutDatePatterns("文字")).toBe("文字");
    expect(withoutDatePatterns(null)).toBeNull();
  });
});
