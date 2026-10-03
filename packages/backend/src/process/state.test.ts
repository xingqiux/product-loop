import { describe, expect, it } from "vitest";
import { createProcessState } from "./state.ts";

// 后端进程的状态：开始退出时叫醒在等的一方，长轮询据此提前返回。

describe("开始退出", () => {
  it("叫一次订阅的一方，取消订阅的不叫；已经在退出时订阅立即叫", () => {
    const state = createProcessState({ now: () => new Date(0) });
    const heard: string[] = [];
    state.onStopping(() => heard.push("甲"));
    const off = state.onStopping(() => heard.push("乙"));
    off();
    expect(state.stopping()).toBe(false);
    state.markStopping();
    expect(state.stopping()).toBe(true);
    expect(heard).toEqual(["甲"]);
    state.onStopping(() => heard.push("丙"));
    expect(heard).toEqual(["甲", "丙"]);
  });
});
