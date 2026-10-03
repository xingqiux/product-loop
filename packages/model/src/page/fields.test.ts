import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionKeySchema } from "./card.ts";
import { cardIdSchema, isCardId } from "./card-id.ts";
import {
  hexColorSchema,
  isRelativePath,
  lineRangeSchema,
  parseLineRange,
  queueRefSchema,
  sceneRefSchema,
} from "./fields.ts";
import { type Source, sourceForm } from "./source.ts";

describe("行号", () => {
  it.each([
    ["12-20", { start: 12, end: 20 }],
    ["12", { start: 12, end: 12 }],
    ["3-3", { start: 3, end: 3 }],
  ])("解析 %j", (text, range) => {
    expect(parseLineRange(text)).toEqual({ ok: true, value: range });
  });

  it.each(["", "0", "0-3", "20-12", "012-20", "12-", "-12", "12 - 20", "12~20", "一-三"])(
    "拒绝 %j",
    (text) => {
      expect(parseLineRange(text)).toEqual({ ok: false, error: "shape" });
    },
  );
});

describe("相对路径", () => {
  it.each(["img/a.png", "a.png", "./img/a.png", "../use/7/s3-2.png", "skill/SKILL.md", "主线.md"])(
    "收 %j",
    (path) => {
      expect(isRelativePath(path)).toBe(true);
    },
  );

  it.each([
    "",
    "/abs/a.png",
    "~/a.png",
    "C:\\a.png",
    "c:/a.png",
    "file:///a.png",
    "https://x/a.png",
    "data:image/png;base64,AAAA",
    "img//a.png",
    "img/",
    " img/a.png",
    "img\\a.png",
  ])("拒绝 %j", (path) => {
    expect(isRelativePath(path)).toBe(false);
  });
});

describe("来源的写法", () => {
  const base = { name: "来源" };
  it.each<[Source, ReturnType<typeof sourceForm>]>([
    [{ ...base, img: "img/a.png" }, "img"],
    [{ ...base, file: "a.md", lines: "1-2" }, "text"],
    [{ ...base, saw: "原话", quote: true }, "quote"],
    [{ ...base, saw: "只写了看到什么" }, undefined],
  ])("%j 是 %s", (source, form) => {
    expect(sourceForm(source)).toBe(form);
  });
});

type StringJson = { readonly pattern?: string; readonly maxLength?: number };
type RootJson = StringJson & {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, StringJson>>;
};

/** 导出一个字段的 JSON Schema。带 id 的字段放在 $defs 里，根上是引用。 */
function fieldJson(schema: z.ZodType): StringJson {
  const json = z.toJSONSchema(schema, { io: "input" }) as RootJson;
  const name = json.$ref?.replace("#/$defs/", "");
  return name === undefined ? json : (json.$defs?.[name] ?? {});
}

/** JSON Schema 里的 pattern 和定义自己的检查要一致，编辑器提示的和校验的才是同一回事。 */
describe("JSON Schema 里的写法和定义一致", () => {
  const cases = [
    {
      name: "卡片编号",
      schema: cardIdSchema,
      texts: ["spec-twelve", "a", "a1-b2", "Spec", "a--b", "a-", "1a", "卡片"],
    },
    {
      name: "队列事项",
      schema: queueRefSchema,
      texts: ["Q1", "Q12", "Q0", "Q012", "q1", "Q", "S1"],
    },
    { name: "场景", schema: sceneRefSchema, texts: ["S1", "S14", "S0", "S01", "s1", "Q1"] },
    {
      name: "行号",
      schema: lineRangeSchema,
      texts: ["1", "12-20", "0", "01-2", "1-", "a"],
    },
    {
      name: "色值",
      schema: hexColorSchema,
      texts: ["#fff", "#ffff", "#ffffff", "#ffffffff", "#ff", "#fffff", "fff", "#ggg"],
    },
    { name: "选项的 key", schema: optionKeySchema, texts: ["a", "z", "A", "ab", "1", "", "同"] },
  ];

  it.each(cases)("$name", ({ schema, texts }) => {
    const json = fieldJson(schema);
    const pattern = new RegExp(json.pattern ?? "", "u");
    for (const text of texts) {
      expect(pattern.test(text), text).toBe(schema.safeParse(text).success);
    }
  });

  it("行号的 pattern 管不到前后大小，大小由定义查", () => {
    expect(lineRangeSchema.safeParse("20-12").success).toBe(false);
  });

  it("卡片编号的长度也写进 JSON Schema", () => {
    const json = fieldJson(cardIdSchema);
    expect(json.maxLength).toBe(48);
    expect(isCardId("a".repeat(48))).toBe(true);
    expect(isCardId("a".repeat(49))).toBe(false);
  });
});
