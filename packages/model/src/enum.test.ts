import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { defineEnum } from "./enum.ts";

describe("defineEnum", () => {
  const color = defineEnum({ red: "红", green: "绿" });

  it("键和标签按写的顺序排", () => {
    expect(color.keys).toEqual(["red", "green"]);
    expect(color.labels).toEqual(["红", "绿"]);
  });

  it("按标签找键，按键取标签", () => {
    expect(color.key("绿")).toBe("green");
    expect(color.label("red")).toBe("红");
    expect(color.key("蓝")).toBeUndefined();
  });

  it("按某个键取标签，类型就是那一个标签", () => {
    expectTypeOf(color.label("red")).toEqualTypeOf<"红">();
    expect(color.label("red")).toBe("红");
  });

  it("对象原型上的名字不算键", () => {
    expect(color.isKey("constructor")).toBe(false);
    expect(color.key("constructor")).toBeUndefined();
  });
});

describe("接口上的写法", () => {
  const color = defineEnum({ red: "红", green: "绿" });

  it("解码时中文换成键，编码时键换回中文", () => {
    expect(z.decode(color.codec, "绿")).toBe("green");
    expect(z.encode(color.codec, "red")).toBe("红");
  });

  it("只收中文标签，不收英文键", () => {
    expect(color.codec.safeParse("红").success).toBe(true);
    expect(color.codec.safeParse("red").success).toBe(false);
  });

  it("导出给 AI 看的 JSON Schema 列的是中文", () => {
    expect(z.toJSONSchema(color.codec, { io: "input" })).toMatchObject({ enum: ["红", "绿"] });
  });
});
