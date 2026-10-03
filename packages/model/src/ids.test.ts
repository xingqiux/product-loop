import { describe, expect, it } from "vitest";
import {
  formatQueueId,
  formatSceneId,
  parseQueueId,
  parseQueueIdList,
  parseSceneId,
} from "./ids.ts";

describe("队列事项的编号", () => {
  it("写成 Q 加数字，读回来是数字", () => {
    expect(formatQueueId(12)).toBe("Q12");
    expect(parseQueueId("Q12")).toEqual({ ok: true, value: 12 });
    expect(parseQueueId("Q1")).toEqual({ ok: true, value: 1 });
  });

  it.each([
    ["q12", "shape"],
    ["Q0", "zero"],
    ["Q012", "shape"],
    ["Q", "shape"],
    ["12", "shape"],
    ["Q12 ", "shape"],
    ["Q-1", "shape"],
    ["Q1.5", "shape"],
    ["S12", "shape"],
    ["Q99999999999999999999", "shape"],
  ])("拒绝 %j，原因是 %s", (text, error) => {
    expect(parseQueueId(text)).toEqual({ ok: false, error });
  });
});

describe("队列事项的编号列表", () => {
  it("逗号、顿号和空白都算分隔，重复的只留第一个", () => {
    expect(parseQueueIdList("Q12,Q15")).toEqual({ ok: true, value: [12, 15] });
    expect(parseQueueIdList("Q12， Q15、Q3 Q12")).toEqual({ ok: true, value: [12, 15, 3] });
  });

  it("空列表照常返回", () => {
    expect(parseQueueIdList("")).toEqual({ ok: true, value: [] });
    expect(parseQueueIdList(" , ")).toEqual({ ok: true, value: [] });
  });

  it("有写错的，一次报出写错的全部几个", () => {
    expect(parseQueueIdList("Q12,q15,Q0,Q3,12")).toEqual({
      ok: false,
      error: { bad: ["q15", "Q0", "12"] },
    });
  });
});

describe("场景的编号", () => {
  it("写成 S 加数字，读回来是数字", () => {
    expect(formatSceneId(14)).toBe("S14");
    expect(parseSceneId("S14")).toEqual({ ok: true, value: 14 });
  });

  it.each([
    ["s14", "shape"],
    ["S0", "zero"],
    ["S014", "shape"],
    ["S", "shape"],
    ["Q14", "shape"],
  ])("拒绝 %j，原因是 %s", (text, error) => {
    expect(parseSceneId(text)).toEqual({ ok: false, error });
  });
});
