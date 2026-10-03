import { designSpecItem, mainlinePart } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { makeTree, tempRoot } from "../project/testing.ts";
import {
  listLines,
  mainlineCounts,
  mainlineLines,
  type ProjectStatus,
  projectName,
  statusLines,
} from "./status.ts";

/** 刚开工的项目：第 1 版，还没开始任何阶段，主线的十个部分和设计规范的十二个部分都缺，见 S13 第 3 步。 */
function fresh(): ProjectStatus {
  return {
    project: {
      id: "app",
      name: "app",
      repoKind: "自己的",
      ignoreFile: "/Users/me/proj/app/.gitignore",
      skillVersion: "2.0.0",
      legacySource: null,
      roots: ["/Users/me/proj/app"],
      createdAt: "2026-09-28T03:00:00.000Z",
    },
    version: {
      version: 1,
      status: "进行中",
      startedAt: "2026-09-28T03:00:00.000Z",
      endedAt: null,
      summary: null,
      endReason: null,
    },
    round: null,
    waitingPages: [],
    queue: [
      { stage: "构思", count: 0, stale: 0 },
      { stage: "使用", count: 0, stale: 0 },
      { stage: "检查", count: 0, stale: 0 },
      { stage: "落地", count: 0, stale: 0 },
      { stage: "提升", count: 0, stale: 0 },
    ],
    skill: { version: "2.0.0", current: "2.1.0", doctor: null, newerRules: false },
    mainline: {
      revision: null,
      missingParts: [...mainlinePart.labels],
      missingDesignSpec: [...designSpecItem.labels],
    },
    lastChangedAt: "2026-09-28T03:00:00.000Z",
    idleDays: 0,
  };
}

/** 做到一半的项目：第 2 版的检查阶段在等用户回复，队列里还有事，主线只缺两个部分。 */
function busy(): ProjectStatus {
  const status = fresh();
  return {
    ...status,
    project: { ...status.project, id: "sketch-board", name: "Sketch Board" },
    version: { ...status.version, version: 2 },
    round: {
      label: "v2-检查-1",
      version: 2,
      stage: "检查",
      seq: 1,
      status: "等用户回复",
      startedAt: "2026-09-28T03:00:00.000Z",
      closedAt: null,
      legacyId: null,
      summary: null,
    },
    waitingPages: [
      {
        id: 12,
        seq: 2,
        round: "v2-检查-1",
        purpose: "要用户点",
        presentedAt: "2026-09-28T03:00:00.000Z",
      },
    ],
    queue: [
      { stage: "构思", count: 2, stale: 0 },
      { stage: "使用", count: 0, stale: 0 },
      { stage: "检查", count: 0, stale: 0 },
      { stage: "落地", count: 1, stale: 0 },
      { stage: "提升", count: 0, stale: 0 },
    ],
    skill: { version: "2.1.0", current: "2.1.0", doctor: null, newerRules: true },
    mainline: { revision: 4, missingParts: ["给谁用", "四个风险"], missingDesignSpec: [] },
    idleDays: 3,
  };
}

type Mainline = Pick<ProjectStatus["mainline"], "missingParts" | "missingDesignSpec">;

/** 做到一半的项目，这一阶段换成别的阶段或状态。 */
function inRound(patch: Partial<NonNullable<ProjectStatus["round"]>>): ProjectStatus {
  const status = busy();
  return {
    ...status,
    round: { ...(status.round as NonNullable<ProjectStatus["round"]>), ...patch },
  };
}

describe("ploop status 的文字", () => {
  it("刚开工：第 1 版、还没开始任何阶段、主线缺哪几样", () => {
    expect(statusLines(fresh())).toEqual([
      "项目 app：第 1 版，还没开始任何阶段",
      "在等的页：没有",
      "队列里没做完的事：没有",
      "主线缺 10 个部分",
      "其中设计规范缺 12 个部分",
    ]);
  });

  it("F18 主线缺得少时直接写名字；设计规范是十个部分之一，缺的写成「其中」", () => {
    const few: Mainline = {
      missingParts: ["给谁用", "设计规范"],
      missingDesignSpec: [...designSpecItem.labels],
    };
    expect(mainlineCounts(few)).toEqual([
      "主线缺 2 个部分：给谁用、设计规范",
      "其中设计规范缺 12 个部分",
    ]);
    const four: Mainline = {
      missingParts: ["给谁用", "要完成的任务", "交付线", "四个风险"],
      missingDesignSpec: [],
    };
    expect(mainlineCounts(four)[0]).toBe("主线缺 4 个部分");
  });

  it("N08 status 只写缺几个部分，名单只在 mainline check 里写一次，每个名字一行", () => {
    const missing: Pick<ProjectStatus["mainline"], "missingParts" | "missingDesignSpec"> = {
      missingParts: ["给谁用", "四个风险"],
      missingDesignSpec: ["配色"],
    };
    expect(mainlineCounts(missing)).toEqual([
      "主线缺 2 个部分：给谁用、四个风险",
      "设计规范缺 1 个部分",
    ]);
    expect(mainlineLines(missing)).toEqual([
      "主线缺 2 个部分：",
      "  给谁用",
      "  四个风险",
      "设计规范缺 1 个部分：",
      "  配色",
    ]);
    const full: Pick<ProjectStatus["mainline"], "missingParts" | "missingDesignSpec"> = {
      missingParts: [],
      missingDesignSpec: [],
    };
    expect(mainlineLines(full)).toEqual(mainlineCounts(full));
    expect(mainlineCounts(full)).toEqual(["主线：10 个部分齐全", "设计规范：12 个部分齐全"]);
  });

  it("N27 status 不写根目录", () => {
    expect(statusLines(fresh()).join("\n")).not.toContain("根目录");
  });

  it("P17 下一步是收尾时，列出还在进行中的事，收尾要给它们各写一个结果", () => {
    const lines = statusLines(busy(), ["ploop round close"], ["Q12", "Q15"]);
    expect(lines).toEqual(
      expect.arrayContaining([
        "进行中的事：Q12、Q15，收尾时各写一个结果。",
        "做完的运行 ploop round close --done Q12=<证据>。",
        "退回的运行 ploop round close --return Q12=<原因>。",
      ]),
    );
  });

  it("R02 落地阶段退回要写退回哪个阶段，完整的写法第一次就给出", () => {
    expect(statusLines(inRound({ stage: "落地" }), ["ploop round close"], ["Q3"])).toContain(
      "退回的运行 ploop round close --return Q3:落地=<原因>。",
    );
  });

  it("F05 回复还有行没处理：写明，下一步是 ploop reply show", () => {
    expect(statusLines(inRound({ status: "已回复" }), ["ploop reply show"])).toContain(
      "回复还有行没有处理，先运行 ploop reply show 看，再给每一行定去处。",
    );
  });

  it("R03 回复处理完、事都有结果：下一步直接开下一个阶段，写明会自动收尾", () => {
    const status = inRound({ status: "已回复" });
    expect(statusLines(status, ["ploop round start 使用"])).toContain(
      "开始下一个阶段时，会自动给这个阶段收尾。",
    );
    expect(statusLines(status, ["ploop round close"])).not.toContain(
      "开始下一个阶段时，会自动给这个阶段收尾。",
    );
  });

  it("R02 已收尾的阶段：写明为什么下一步是这一条", () => {
    const closed = (stage: "检查" | "提升") => inRound({ stage, status: "已收尾" });
    expect(statusLines(closed("检查"), ["ploop round start 提升"])).toContain(
      "落地队列里没有待办的事，不用开落地阶段。",
    );
    const improve = statusLines(closed("提升"), ["ploop round start 使用"]);
    expect(improve).toEqual(
      expect.arrayContaining([
        "提升阶段已经收尾。开始下一个阶段时，会进入第 3 版。",
        "构思队列里没有待办的事，主线也齐全，从使用开始。",
      ]),
    );
    const noRound = statusLines(fresh(), ["ploop round start 使用"]);
    expect(noRound).toContain("构思队列里没有待办的事，主线也齐全，从使用开始。");
  });

  it("做到一半：这个阶段、在等的页、队列的件数、新规则和停了几天", () => {
    expect(statusLines(busy())).toEqual([
      "项目 Sketch Board（sketch-board）：第 2 版的检查阶段，等用户回复",
      "在等的页：第 2 版的检查阶段的第 2 页，要用户点",
      "队列里没做完的事：构思 2 件、落地 1 件",
      "主线缺 2 个部分：给谁用、四个风险",
      "设计规范：12 个部分齐全",
      "skill 有这个项目还没用上的新规则。",
      "停了 3 天没有改动",
    ]);
  });

  it("这一版已结束时第一行写已结束，主线齐全时写齐全", () => {
    const status = fresh();
    const closed: ProjectStatus = {
      ...status,
      version: { ...status.version, status: "已结束" },
      mainline: { revision: 9, missingParts: [], missingDesignSpec: [] },
    };
    const lines = statusLines(closed);
    expect(lines[0]).toBe("项目 app：第 1 版已结束");
    expect(lines).toContain("主线：10 个部分齐全");
  });

  it("名称和编号相同时只写一个", () => {
    expect(projectName("app", "app")).toBe("app");
    expect(projectName("产品循环", "project")).toBe("产品循环（project）");
  });

  it("--all 每个项目一行，编号对齐", () => {
    expect(listLines([busy(), fresh()])).toEqual([
      "  sketch-board  第 2 版的检查阶段，等用户回复，1 页在等，队列 3 件没做完，停了 3 天，/Users/me/proj/app",
      "  app           第 1 版，还没开始任何阶段，/Users/me/proj/app",
    ]);
  });
});

describe("找不到项目时不碰后端", () => {
  it("往上找不到 project.json：退出码 4，提示运行 ploop init", async () => {
    const home = tempRoot();
    makeTree(home, ["proj/app/src/"]);
    const { code, stdout, stderr } = await ploop(["status"], {
      cwd: `${home}/proj/app/src`,
      userHome: home,
    });
    expect(stdout).toBe("");
    expect(stderr).toBe(
      [
        `找不到：从 ${home}/proj/app/src 找到 ${home}/proj，都没有项目缓存。`,
        "怎么改：要开工就到项目根目录运行 ploop init，或者用 --project 指定项目。",
        "",
      ].join("\n"),
    );
    expect(code).toBe(4);
  });
});
