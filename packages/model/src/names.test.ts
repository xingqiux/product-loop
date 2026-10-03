import { describe, expect, it } from "vitest";
import type { EnumDef } from "./enum.ts";
import { allEnums, renamedStages, stage } from "./names.ts";

// 逐个检查时按共同的形状看待每个名称表。
const enums: [string, EnumDef<string, string>][] = Object.entries(allEnums);

describe("名称表", () => {
  it.each(enums)("%s 的键都是 ASCII 小驼峰", (_name, e) => {
    for (const key of e.keys) expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it.each(enums)("%s 的标签不重复，也不是空的", (_name, e) => {
    expect(new Set(e.labels).size).toBe(e.labels.length);
    for (const label of e.labels) expect(label.trim()).not.toBe("");
  });

  it.each(enums)("%s 的键和标签能来回换", (_name, e) => {
    for (const key of e.keys) {
      const label = e.label(key);
      expect(e.key(label)).toBe(key);
      expect(e.isKey(key)).toBe(true);
    }
  });

  it.each(enums)("%s 的两种 schema 各收自己的取值，拒绝对方的取值", (_name, e) => {
    for (const key of e.keys) expect(e.keySchema.safeParse(key).success).toBe(true);
    for (const label of e.labels) expect(e.labelSchema.safeParse(label).success).toBe(true);
    for (const key of e.keys) {
      if (!(e.labels as readonly string[]).includes(key)) {
        expect(e.labelSchema.safeParse(key).success).toBe(false);
      }
    }
    for (const label of e.labels) {
      if (!(e.keys as readonly string[]).includes(label)) {
        expect(e.keySchema.safeParse(label).success).toBe(false);
      }
    }
  });

  it("标签不存在时按标签找键返回 undefined", () => {
    expect(stage.key("修复")).toBeUndefined();
    expect(stage.key("land")).toBeUndefined();
    expect(stage.isKey("构思")).toBe(false);
    expect(stage.isKey("toString")).toBe(false);
  });

  it("阶段按一版里走的顺序排：构思、使用、检查、落地、提升", () => {
    expect(stage.labels).toEqual(["构思", "使用", "检查", "落地", "提升"]);
    expect(stage.keys).toEqual(["think", "use", "check", "land", "improve"]);
  });

  it("改过名的阶段指向现在的名字", () => {
    expect(renamedStages.get("修复")).toBe("落地");
    for (const now of renamedStages.values()) expect(stage.key(now)).toBeDefined();
  });
});
