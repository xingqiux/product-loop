import { describe, expect, it } from "vitest";
import { ploop } from "../fixture.ts";
import { buildProgram } from "../program.ts";
import { beijingTime as local } from "./shared.ts";
import { versionLines } from "./version.ts";

// 版本的文字输出和不用碰后端就能报的错。换版的整个过程写在使用测试里。

type Detail = Parameters<typeof versionLines>[0];

const at = "2026-09-28T08:05:00.000Z";

const detail: Detail = {
  version: 2,
  status: "进行中",
  startedAt: at,
  endedAt: null,
  summary: null,
  endReason: null,
  rounds: [],
};

const roundAt = (label: string, status: "进行中" | "已收尾") => ({
  label,
  version: 2,
  stage: "构思" as const,
  seq: 1,
  status,
  startedAt: at,
  closedAt: null,
  legacyId: null,
  summary: null,
});

describe("ploop version show 的文字", () => {
  it("进行中的一版：第几版、开始的时间，阶段的名字按最宽的一项对齐", () => {
    const rounds = [roundAt("v2-构思-1", "已收尾"), roundAt("v2-构思-12", "进行中")];
    expect(versionLines({ ...detail, rounds })).toEqual([
      `第 2 版：进行中，${local(at)} 开始`,
      "这一版的阶段：",
      "  第 2 版的构思阶段              已收尾",
      "  第 2 版的构思阶段（第 12 次）  进行中",
    ]);
  });

  it("结束了的一版写结束的时间和原因；没有阶段时写一句", () => {
    const ended = { ...detail, status: "已结束" as const, endedAt: at, endReason: "跳过提升" };
    expect(versionLines(ended)).toEqual([
      `第 2 版：已结束，${local(at)} 开始`,
      `结束：${local(at)}`,
      "结束的原因：跳过提升",
      "这一版还没有阶段。",
    ]);
  });
});

describe("不用碰后端就能报的错", () => {
  it("next 不写 --reason：用法错误，退出码 2", async () => {
    const { code, stderr } = await ploop(["version", "next"], { build: buildProgram });
    expect(stderr).toContain("用法错误：ploop version next 缺少必填的选项 --reason <原因>。");
    expect(code).toBe(2);
  });
});
