import { describe, expect, it } from "vitest";
import { stage } from "./names.ts";
import {
  formatPageName,
  formatRoundName,
  formatStageName,
  parseRoundName,
  stageWordOf,
} from "./round-name.ts";

describe("一个阶段在文字里的叫法", () => {
  it("写成第几版的什么阶段，不用「轮」，也不写 v2-落地-1 这样的编号", () => {
    expect(formatRoundName({ version: 2, stage: "land", seq: 1 })).toBe("第 2 版的落地阶段");
    expect(formatRoundName({ version: 1, stage: "think", seq: 1 })).toBe("第 1 版的构思阶段");
  });

  it("同一版里同一阶段做了第二次，写明第几次", () => {
    expect(formatRoundName({ version: 2, stage: "land", seq: 2 })).toBe(
      "第 2 版的落地阶段（第 2 次）",
    );
  });

  it("上下文已经说清是哪一版时，只写阶段", () => {
    expect(formatStageName({ stage: "land", seq: 1 })).toBe("落地阶段");
    expect(formatStageName({ stage: "land", seq: 2 })).toBe("落地阶段（第 2 次）");
  });

  it("一页写成阶段的叫法加第几页，页只用这一种号", () => {
    expect(formatPageName({ version: 2, stage: "check", seq: 1 }, 2)).toBe(
      "第 2 版的检查阶段的第 2 页",
    );
    expect(formatPageName({ version: 2, stage: "check", seq: 3 }, 1)).toBe(
      "第 2 版的检查阶段（第 3 次）的第 1 页",
    );
  });
});

describe("读出对用户写的叫法", () => {
  it("显示的写法读得回来：版本 1 到 12、五个阶段、第 1 到 30 次", () => {
    for (let version = 1; version <= 12; version++) {
      for (const key of stage.keys) {
        for (let seq = 1; seq <= 30; seq++) {
          const text = formatRoundName({ version, stage: key, seq });
          expect(parseRoundName(text)).toEqual({ ok: true, value: { version, stage: key, seq } });
        }
      }
    }
  });

  it.each([
    ["第 2 版的落地阶段", { version: 2, stage: "land", seq: 1 }],
    ["第2版落地阶段", { version: 2, stage: "land", seq: 1 }],
    ["第 2 版落地阶段", { version: 2, stage: "land", seq: 1 }],
    ["第2版的落地阶段", { version: 2, stage: "land", seq: 1 }],
    ["第 2 版的落地阶段（第 2 次）", { version: 2, stage: "land", seq: 2 }],
    ["第 2 版的落地阶段(第 2 次)", { version: 2, stage: "land", seq: 2 }],
    ["第2版落地阶段第2次", { version: 2, stage: "land", seq: 2 }],
    ["第2版落地阶段（第2次）", { version: 2, stage: "land", seq: 2 }],
    ["  第 10 版的提升阶段  ", { version: 10, stage: "improve", seq: 1 }],
  ])("命令里可以写成 %j", (text, value) => {
    expect(parseRoundName(text)).toEqual({ ok: true, value });
  });

  it.each([
    ["第 2 版的落地", "shape"],
    ["落地阶段", "shape"],
    ["第 2 版的落地阶段第", "shape"],
    ["第 02 版的落地阶段", "shape"],
    ["第 2 版的落地阶段（第 02 次）", "shape"],
    ["第 2 版的落地中阶段", "stage"],
    ["第 2 版的 land 阶段", "stage"],
    ["第 2 版的修复阶段", "renamedStage"],
    ["第 0 版的构思阶段", "zero"],
    ["第 2 版的构思阶段（第 0 次）", "zero"],
    ["", "shape"],
  ])("拒绝 %j，原因是 %s", (text, error) => {
    expect(parseRoundName(text)).toEqual({ ok: false, error });
  });

  it("写错的阶段里取出阶段名，标识和叫法两种写法都行", () => {
    expect(stageWordOf("v2-修复-3")).toBe("修复");
    expect(stageWordOf("第 2 版的修复阶段")).toBe("修复");
    expect(stageWordOf("落地阶段")).toBe("");
  });
});
