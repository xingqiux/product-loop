import { describe, expect, it } from "vitest";
import { stage } from "./names.ts";
import {
  formatRoundLabel,
  parseLegacyRoundId,
  parseRoundLabel,
  parseRoundRef,
  roundNameOfLabel,
} from "./round-label.ts";

describe("阶段的标识", () => {
  it("写成版本、阶段名、次数，用短横连起来", () => {
    expect(formatRoundLabel({ version: 2, stage: "land", seq: 3 })).toBe("v2-落地-3");
  });

  it("版本 1 到 12、五个阶段、轮号 1 到 30 都能写出再读回来", () => {
    for (let version = 1; version <= 12; version++) {
      for (const key of stage.keys) {
        for (let seq = 1; seq <= 30; seq++) {
          const text = formatRoundLabel({ version, stage: key, seq });
          expect(parseRoundLabel(text)).toEqual({ ok: true, value: { version, stage: key, seq } });
        }
      }
    }
  });

  it.each([
    ["v2-修复-3", "renamedStage"],
    ["v0-构思-1", "zero"],
    ["v2-构思-0", "zero"],
    ["v02-构思-1", "shape"],
    ["v2-构思-01", "shape"],
    ["v2-land-3", "stage"],
    ["v2-落地", "shape"],
    ["2-落地-3", "shape"],
    ["V2-落地-3", "shape"],
    ["v2－落地－3", "shape"],
    ["v2—落地—3", "shape"],
    [" v2-落地-3", "shape"],
    ["v2-落地-3 ", "shape"],
    ["v2-落地-3-4", "shape"],
    ["v2--3", "shape"],
    ["", "shape"],
    ["v99999999999999999999-落地-3", "shape"],
  ])("拒绝 %j，原因是 %s", (text, error) => {
    expect(parseRoundLabel(text)).toEqual({ ok: false, error });
  });
});

describe("迁移前的文件名", () => {
  it("land-15-plan 认得出前缀、数字、后缀和阶段", () => {
    expect(parseLegacyRoundId("land-15-plan")).toEqual({
      ok: true,
      value: { id: "land-15-plan", prefix: "land", n: 15, suffix: "plan", stage: "land" },
    });
  });

  it("fix 开头的文件名归到落地", () => {
    const r = parseLegacyRoundId("fix-13");
    expect(r.ok && r.value.stage).toBe("land");
  });

  it("重做的一版带后缀", () => {
    expect(parseLegacyRoundId("think-2-v2")).toEqual({
      ok: true,
      value: { id: "think-2-v2", prefix: "think", n: 2, suffix: "v2", stage: "think" },
    });
  });

  it("report 的阶段不定，要看页面数据", () => {
    const r = parseLegacyRoundId("report-6");
    expect(r.ok).toBe(true);
    expect(r.ok && "stage" in r.value).toBe(false);
  });

  it.each([
    ["think-29", "think"],
    ["use-1", "use"],
    ["check-1", "check"],
    ["land-5", "land"],
    ["improve-1", "improve"],
  ])("%s 对应阶段 %s", (text, key) => {
    const r = parseLegacyRoundId(text);
    expect(r.ok && r.value.stage).toBe(key);
  });

  it("日期文件夹写在前面时一起记下", () => {
    expect(parseLegacyRoundId("2026-09-20/think-29")).toEqual({
      ok: true,
      value: {
        id: "2026-09-20/think-29",
        prefix: "think",
        n: 29,
        folder: "2026-09-20",
        stage: "think",
      },
    });
  });

  it.each([
    "v2-落地-3",
    "gate-fix",
    "facts-1",
    "think",
    "think-",
    "Think-1",
    "think-1.json",
    "think-1-",
  ])("%j 不是迁移前的文件名", (text) => {
    expect(parseLegacyRoundId(text)).toEqual({ ok: false, error: "shape" });
  });
});

describe("命令的参数里指一个阶段", () => {
  it("阶段的标识、对用户写的叫法和迁移前的文件名都收", () => {
    const label = { version: 2, stage: "land", seq: 3 } as const;
    const expected = { ok: true, value: { kind: "label", label } };
    expect(parseRoundRef("v2-落地-3")).toEqual(expected);
    expect(parseRoundRef("第 2 版的落地阶段（第 3 次）")).toEqual(expected);
    expect(parseRoundRef("第2版落地阶段第3次")).toEqual(expected);
    const legacy = parseRoundRef("fix-13");
    expect(legacy.ok && legacy.value.kind).toBe("legacy");
  });

  it("N13 只写阶段名指这一版里最近一次的那个阶段，落地和落地阶段都收", () => {
    const expected = { ok: true, value: { kind: "stage", stage: "land" } };
    expect(parseRoundRef("落地")).toEqual(expected);
    expect(parseRoundRef(" 落地阶段 ")).toEqual(expected);
    expect(parseRoundRef("构思")).toEqual({ ok: true, value: { kind: "stage", stage: "think" } });
  });

  it("以 v 加数字开头的按标识报具体的错，以「第」开头的按叫法报", () => {
    expect(parseRoundRef("v2-修复-3")).toEqual({ ok: false, error: "renamedStage" });
    expect(parseRoundRef("v2-land-3")).toEqual({ ok: false, error: "stage" });
    expect(parseRoundRef("第 2 版的修复阶段")).toEqual({ ok: false, error: "renamedStage" });
    expect(parseRoundRef("第 0 版的构思阶段")).toEqual({ ok: false, error: "zero" });
    expect(parseRoundRef("第 2 版的落地")).toEqual({ ok: false, error: "shape" });
  });

  it("几种都不是的报认不出", () => {
    expect(parseRoundRef("落地第三次")).toEqual({ ok: false, error: "unknown" });
  });
});

describe("阶段的标识转成叫法", () => {
  it("v2-落地-3 写成第 2 版的落地阶段（第 3 次），读不出的原样交回", () => {
    expect(roundNameOfLabel("v2-落地-3")).toBe("第 2 版的落地阶段（第 3 次）");
    expect(roundNameOfLabel("v1-构思-1")).toBe("第 1 版的构思阶段");
    expect(roundNameOfLabel("fix-13")).toBe("fix-13");
  });
});
