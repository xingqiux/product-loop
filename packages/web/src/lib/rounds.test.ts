import { describe, expect, it } from "vitest";
import {
  parseRoundLabel,
  roundName,
  roundNameOf,
  roundStateText,
  stageName,
  stageNameOf,
  versionIdleText,
} from "./rounds.ts";

describe("对用户写的阶段名", () => {
  it("第一次不写次数，第二次起写在括号里", () => {
    expect(roundName({ version: 2, stage: "落地", seq: 1 })).toBe("第 2 版的落地阶段");
    expect(roundName({ version: 2, stage: "落地", seq: 2 })).toBe("第 2 版的落地阶段（第 2 次）");
    expect(roundName({ version: 1, stage: "构思", seq: 13 })).toBe("第 1 版的构思阶段（第 13 次）");
  });

  it("不出现「轮」和 v2-落地-1 这类写法", () => {
    for (const seq of [1, 2]) {
      const name = roundNameOf(`v2-落地-${seq}`);
      expect(name).not.toMatch(/轮|v\d/u);
    }
  });

  it("从阶段标识的写法转过来，认不出的原样交回", () => {
    expect(parseRoundLabel("v3-提升-2")).toEqual({ version: 3, stage: "提升", seq: 2 });
    expect(roundNameOf("v3-提升-2")).toBe("第 3 版的提升阶段（第 2 次）");
    expect(roundNameOf("improve-1")).toBe("improve-1");
  });
});

describe("上下文已经说清是哪一版时", () => {
  it("只写阶段，第二次起写次数", () => {
    expect(stageName({ stage: "落地", seq: 1 })).toBe("落地阶段");
    expect(stageName({ stage: "落地", seq: 2 })).toBe("落地阶段（第 2 次）");
    expect(stageNameOf("v2-构思-3")).toBe("构思阶段（第 3 次）");
    expect(stageNameOf("fix-13")).toBe("fix-13");
  });
});

describe("还没开始阶段的一版", () => {
  it("写清是第几版还没开始阶段，不让人以为整个项目没开始", () => {
    expect(versionIdleText(2)).toBe("第 2 版，还没开始阶段");
    expect(versionIdleText(1)).toBe("第 1 版，还没开始阶段");
    expect(versionIdleText(2)).not.toBe("未开始");
  });
});

describe("状态词照术语表", () => {
  it("等用户回复、进行中、已收尾，不称呼你，不写 AI 在做", () => {
    expect(Object.values(roundStateText)).toEqual(["等用户回复", "进行中", "已收尾"]);
  });
});
