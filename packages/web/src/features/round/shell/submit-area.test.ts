import { describe, expect, it } from "vitest";
import { confirmLines, draftNoteOf, stateHint, stateTitle } from "./submit-area.tsx";

// 提交区状态词下面那一行：有值才写，没有值不补一句「没有」。

const withdrawn = (reason: string | null) => ({ submission: null, withdrawal: { reason } });

describe("撤回的页", () => {
  it("有原因，写原因", () => {
    expect(stateHint("withdrawn", withdrawn("补一个问题"))).toBe("补一个问题");
  });

  it("没有原因，只有状态词，下面不写字", () => {
    expect(stateTitle.withdrawn).toBe("这一页已撤回");
    expect(stateHint("withdrawn", withdrawn(null))).toBeUndefined();
  });

  it("原因只有空白，和没有原因一样", () => {
    expect(stateHint("withdrawn", withdrawn("  \n"))).toBeUndefined();
  });

  it("原因前后的空白去掉", () => {
    expect(stateHint("withdrawn", withdrawn("  补一个问题\n"))).toBe("补一个问题");
  });
});

describe("状态词写清指的是这一页还是阶段", () => {
  it("页头的徽章写阶段的状态，提交区写这一页的状态", () => {
    expect(stateTitle.replied).toBe("这一页已回复");
    expect(stateTitle.withdrawn).toBe("这一页已撤回");
    expect(stateTitle.closed).toBe("阶段已收尾");
  });

  it("状态词都是名字，不超过八个字，不写成句子", () => {
    for (const title of Object.values(stateTitle)) {
      expect(title.replace(/[\s，。：、]/gu, "").length).toBeLessThanOrEqual(8);
      expect(title).not.toMatch(/[，。？]/u);
    }
  });
});

describe("等 AI 取走和 AI 已收到", () => {
  const submitted = {
    submission: { submittedAt: "2026-05-01T02:30:00.000Z", takenAt: "2026-05-01T02:31:00.000Z" },
    withdrawal: null,
  };

  it("写提交和取走的时间", () => {
    expect(stateHint("waiting", submitted)).toMatch(/ 提交$/u);
    expect(stateHint("received", submitted)).toMatch(/ 取走$/u);
  });

  it("已回复和阶段已收尾，状态词下面不写字", () => {
    expect(stateHint("replied", submitted)).toBeUndefined();
    expect(stateHint("closed", submitted)).toBeUndefined();
  });
});

describe("确认框", () => {
  it("两行：几条回复、几条没点；提交后不能改", () => {
    expect(confirmLines(1, 11)).toEqual(["1 条回复，11 条没点", "提交后不能改"]);
  });

  it("都点完了，不写没点", () => {
    expect(confirmLines(12, 0)).toEqual(["12 条回复", "提交后不能改"]);
  });

  it("每一行是短语，不带句号", () => {
    for (const line of confirmLines(3, 2)) expect(line).not.toMatch(/[。？]/u);
  });
});

describe("连不上时提交区和确认框说同一件事", () => {
  it("草稿存下了，确认框写已存下", () => {
    expect(draftNoteOf("saved")).toBe("草稿已存下");
  });

  it("没存下，确认框写存不上，和提交区一样，不写英文码", () => {
    for (const save of ["pending", "saving", "failed"] as const) {
      expect(draftNoteOf(save)).toBe("草稿存不上");
    }
  });
});
