import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseMainline } from "../mainline/parse.ts";
import { textDiff } from "../text-diff.ts";
import {
  mainlineDiffSchema,
  mainlineParseSchema,
  mainlinePushSchema,
  mainlineRevisionSchema,
  sceneQuerySchema,
} from "./mainline.ts";

// 主线接口的定义：解析结果里的十样和十二样写中文，场景编号写成 S14，交一版只收全文和基准。

const text = [
  "# 主线",
  "",
  "## 1 一句话新闻稿",
  "给用 AI 写软件的人用的产品循环。",
  "",
  "## 场景清单",
  "",
  "### S14 会话中途接手（换了会话）",
  "谁在什么时候用：AI，会话被压缩时。",
  "1. 敲 ploop → 看到当前第几版。",
  "",
  "### 看队列",
  "1. 点队列 → 看到五列看板。",
  "",
  "## 设计规范",
  "",
  "### 配色",
  "主色是深蓝。",
  "",
  "### 动效",
  "无，这是命令行产品。",
  "",
  "### 字体排版",
  "",
  "## 写作规范",
  "",
  "| 停用的说法 | 改成什么 |",
  "| --- | --- |",
  "| 工作流 | 流程 |",
  "",
].join("\n");

/** 接口上的解析结果：去掉查出的问题。 */
function parsedWithoutProblems() {
  const { problems: _problems, ...parsed } = parseMainline(text);
  return parsed;
}

describe("交一版的请求", () => {
  it("只收全文和基准，还没交过主线时基准写 null", () => {
    expect(mainlinePushSchema.parse({ text, baseRevision: null })).toEqual({
      text,
      baseRevision: null,
    });
    expect(mainlinePushSchema.parse({ text, baseRevision: 3 }).baseRevision).toBe(3);
  });

  it("不写基准、写了来源或阶段，都拒绝", () => {
    const rejected = [
      { text },
      { text, baseRevision: null, source: "迁移" },
      { text, baseRevision: 1, round: "v1-构思-1" },
    ];
    for (const body of rejected) {
      expect(mainlinePushSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe("解析结果", () => {
  it("十个部分、十二个部分和它们的写法编码成中文，场景编号写成 S14", () => {
    const wire = z.encode(mainlineParseSchema, parsedWithoutProblems());
    expect(wire.parts.slice(0, 5).map((part) => [part.part, part.present])).toEqual([
      ["一句话新闻稿", true],
      ["给谁用", false],
      ["要完成的任务", false],
      ["场景清单", true],
      ["不做什么和胃口", false],
    ]);
    expect(wire.scenes.map((scene) => [scene.id, scene.name, scene.note])).toEqual([
      ["S14", "会话中途接手", "换了会话"],
      [undefined, "看队列", undefined],
    ]);
    const spec = wire.designSpec.map((entry) => [entry.item, entry.status]);
    expect(spec.slice(0, 3)).toEqual([
      ["信息结构", "没有标题"],
      ["配色", "写了内容"],
      ["字体排版", "只有标题"],
    ]);
    expect(wire.designSpec.find((entry) => entry.item === "动效")).toMatchObject({
      status: "写了「无」",
      reason: "这是命令行产品。",
    });
    expect(wire.writingSpec).toEqual({
      banned: [{ phrase: "工作流", replacement: "流程" }],
      exceptions: [],
    });
  });

  it("接口上的写法再解析回来不变", () => {
    const parsed = parsedWithoutProblems();
    expect(mainlineParseSchema.parse(z.encode(mainlineParseSchema, parsed))).toEqual(parsed);
  });

  it("带着查出的问题时拒绝，问题由接口层写成警告", () => {
    const parsed = parseMainline(text);
    expect(parsed.problems.length).toBeGreaterThan(0);
    expect(mainlineParseSchema.safeParse(parsed).success).toBe(false);
  });

  it("一版主线：来源写中文，阶段写成 v1-构思-1", () => {
    const revision = {
      revision: 2,
      hash: "a".repeat(64),
      source: "cache" as const,
      round: "v1-构思-1",
      createdAt: "2026-09-28T08:00:00.000Z",
      text,
      parsed: parsedWithoutProblems(),
    };
    const wire = z.encode(mainlineRevisionSchema, revision);
    expect([wire.source, wire.round]).toEqual(["项目缓存", "v1-构思-1"]);
    expect(mainlineRevisionSchema.parse(wire)).toEqual(revision);
  });
});

describe("比较两版和列出场景", () => {
  it("逐行比较的每一行照 textDiff 的写法", () => {
    const rows = textDiff("配色\n主色是深蓝。", "配色\n主色是墨绿。");
    const diff = { from: 1, to: 2, rows };
    expect(z.encode(mainlineDiffSchema, diff)).toEqual(diff);
  });

  it("includeRemoved 只收 true 和 false", () => {
    expect(sceneQuerySchema.parse({ includeRemoved: "true" })).toEqual({ includeRemoved: true });
    expect(sceneQuerySchema.safeParse({ includeRemoved: "yes" }).success).toBe(false);
  });
});
