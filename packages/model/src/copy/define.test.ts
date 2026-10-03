import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type CopyEntry,
  copy,
  flattenCopy,
  type ParamNames,
  type Params,
  type ParamValue,
  renderCopy,
} from "./define.ts";

describe("文案的参数", () => {
  it("从文字里的 {名字} 推出参数", () => {
    expectTypeOf<Params<"还有 {count} 行没有处理：{lines}。">>().toEqualTypeOf<{
      readonly count: ParamValue;
      readonly lines: ParamValue;
    }>();
    expectTypeOf<ParamNames<"{a}{b}">>().toEqualTypeOf<"a" | "b">();
  });

  it("同一个参数出现几次都只算一个", () => {
    expectTypeOf<ParamNames<"{text} 和 {text}">>().toEqualTypeOf<"text">();
  });

  it("没有 {名字} 的文字没有参数", () => {
    expectTypeOf<ParamNames<"成功">>().toBeNever();
    expectTypeOf<ParamNames<"写成 Q12 这样">>().toBeNever();
  });

  it("少传参数时类型检查报错", () => {
    const entry = copy("还有 {count} 行没有处理：{lines}。", { count: 2, lines: "第 3 行" });
    // @ts-expect-error 少了 lines
    renderCopy(entry, { count: 2 });
    // @ts-expect-error 一个参数也没传
    renderCopy(entry);
    // @ts-expect-error 样例少了 lines
    copy("还有 {count} 行没有处理：{lines}。", { count: 2 });
    // @ts-expect-error 有参数的文案要给样例
    copy("还有 {count} 行。");
  });

  it("多传参数、参数的取值不对时类型检查报错", () => {
    const entry = copy("还有 {count} 行。", { count: 2 });
    // @ts-expect-error 文字里没有 lines
    renderCopy(entry, { count: 2, lines: "第 3 行" });
    // @ts-expect-error 参数只收文字和数字
    renderCopy(entry, { count: true });
  });
});

describe("渲染", () => {
  it("按名字把参数填进去，数字照原样写出", () => {
    const entry = copy("还有 {count} 行没有处理：{lines}。", { count: 2, lines: "第 3 行" });
    expect(renderCopy(entry, { count: 2, lines: "第 3 行、第 5 行" })).toBe(
      "还有 2 行没有处理：第 3 行、第 5 行。",
    );
  });

  it("同一个参数出现几次就填几次", () => {
    const entry = copy("「{old}」现在叫「{now}」，不再收「{old}」。", { old: "修复", now: "落地" });
    expect(renderCopy(entry, entry.sample)).toBe("「修复」现在叫「落地」，不再收「修复」。");
  });

  it("没有参数的文案不用传参数，样例是空的", () => {
    const entry = copy("成功");
    expect(entry.sample).toEqual({});
    expect(renderCopy(entry)).toBe("成功");
  });

  it("绕过类型检查少传了参数时，那个参数原样留在文字里", () => {
    const entry: CopyEntry = copy("还有 {count} 行。", { count: 2 });
    expect(renderCopy(entry, {})).toBe("还有 {count} 行。");
  });

  it("参数只按自己的键取，不取对象原型上的名字", () => {
    const entry: CopyEntry = { text: "{constructor} 和 {toString}", sample: {} };
    expect(renderCopy(entry, {})).toBe("{constructor} 和 {toString}");
  });

  it("花括号里不是英文名字的不当参数", () => {
    const entry: CopyEntry = { text: "{名字} 和 { a } 和 {1a}", sample: {} };
    expect(renderCopy(entry)).toBe("{名字} 和 { a } 和 {1a}");
  });
});

describe("摊平文案表", () => {
  it("键是各层的名字用点连起来，顺序和写的顺序相同", () => {
    const tree = { a: { b: copy("一"), c: { d: copy("二") } }, e: copy("三") };
    expect(flattenCopy("x", tree).map((item) => item.key)).toEqual(["x.a.b", "x.a.c.d", "x.e"]);
  });

  it("一条文案摊平以后就是它自己", () => {
    const entry = copy("一");
    expect(flattenCopy("x", entry)).toEqual([{ key: "x", entry }]);
  });
});
