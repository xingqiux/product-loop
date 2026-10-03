import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkWriting } from "../writing/check.ts";
import { parseMainline } from "./parse.ts";

// 这个软件自己的主线按新格式写，放在 design/主线.md，见第一期计划第 66 步。
// 迁移以后交成第 2 版的第一个主线版本。这里查它过得了解析器，写作校验没有拦截。

const text = readFileSync(new URL("../../../../design/主线.md", import.meta.url), "utf8");
const parsed = parseMainline(text);

describe("这个软件自己的主线", () => {
  it("十个部分和设计规范十二个部分都写了，解析没有问题", () => {
    expect(parsed.parts.filter((part) => !part.present).map((part) => part.part)).toEqual([]);
    expect(
      parsed.designSpec
        .filter((entry) => entry.status !== "written" && entry.status !== "none")
        .map((entry) => entry.item),
    ).toEqual([]);
    expect(parsed.otherSpecHeadings).toEqual([]);
    expect(parsed.problems).toEqual([]);
  });

  it("S1 到 S37 按编号排好，每个场景写了谁在什么时候用和步骤", () => {
    expect(parsed.scenes.map((scene) => scene.id)).toEqual(
      Array.from({ length: 37 }, (_, i) => i + 1),
    );
    for (const scene of parsed.scenes) {
      expect(scene.who).toBeTruthy();
      expect(scene.steps.length).toBeGreaterThan(0);
    }
    // S3、S4 步数固定：改了场景就要同步改这里
    const steps = (id: number) => parsed.scenes.find((scene) => scene.id === id)?.steps ?? [];
    expect(steps(3)).toHaveLength(8);
    expect(steps(4)).toHaveLength(5);
  });

  it("写作校验没有拦截", () => {
    expect(checkWriting(text).block).toEqual([]);
  });
});
