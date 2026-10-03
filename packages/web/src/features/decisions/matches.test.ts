import { describe, expect, it } from "vitest";
import { matches } from "./matches.ts";

const one = {
  id: 203,
  decision: "七个项目都装上会话开始时运行的钩子",
  reason: "AI 开工时要先读到状态",
  case: "落地阶段的验收页",
};

describe("决定页的搜索", () => {
  it("什么都不写就都符合", () => {
    expect(matches(one, "")).toBe(true);
    expect(matches(one, "   ")).toBe(true);
  });

  it("决定、原因、案例和编号里出现都算", () => {
    expect(matches(one, "钩子")).toBe(true);
    expect(matches(one, "读到状态")).toBe(true);
    expect(matches(one, "验收页")).toBe(true);
    expect(matches(one, "203")).toBe(true);
  });

  it("几个词要都出现，不分先后和大小写", () => {
    expect(matches(one, "钩子 ai")).toBe(true);
    expect(matches(one, "钩子 队列")).toBe(false);
  });
});
