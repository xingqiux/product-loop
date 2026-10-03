import { describe, expect, it } from "vitest";
import { stage } from "../names.ts";
import { checkPageData } from "./check-page.ts";
import { pageExample } from "./example.ts";
import { stageSections } from "./stages.ts";

// ploop page example 打印的例子：每个阶段一份，过得了数据定义，只写这个阶段能写的区块。

describe("页面数据的最小例子", () => {
  it.each(stage.keys)("%s 阶段的例子过得了数据定义", (key) => {
    const checked = checkPageData(key, pageExample(key));
    expect(checked.ok, JSON.stringify(checked.ok ? "" : checked.error)).toBe(true);
  });

  it.each(stage.keys)("%s 阶段的例子只写这个阶段能写的区块，而且至少有一张疑问或别的卡", (key) => {
    const sections = Object.keys(pageExample(key));
    const allowed: readonly string[] = stageSections[key];
    expect(sections.every((section) => allowed.includes(section))).toBe(true);
    expect(sections.length).toBeGreaterThan(0);
  });

  it("每次给一份新的：改了返回值不影响下一次", () => {
    const first = pageExample("use");
    Reflect.set(first, "asks", []);
    expect(Reflect.get(pageExample("use"), "asks")).toHaveLength(1);
  });

  it("不带图片路径，也不带本机的文件来源：拿来就能过截图和文字来源的检查", () => {
    for (const key of stage.keys) {
      const text = JSON.stringify(pageExample(key));
      expect(text).not.toContain('"img"');
      expect(text).not.toContain('"file"');
    }
  });
});
