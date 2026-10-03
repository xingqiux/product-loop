import { describe, expect, it } from "vitest";
import { stageCellOf } from "./stage-cell.ts";

const nth = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

describe("进度格子里的方块", () => {
  it("不超过五次：全画出来，次数写成字", () => {
    const cell = stageCellOf(nth(5));
    expect(cell.shown).toEqual([1, 2, 3, 4, 5]);
    expect(cell.many).toBe(false);
    expect(cell.countText).toBe("5 次");
  });

  it("超过五次：只画最近的五次，次数写成「全部 N 次」", () => {
    const cell = stageCellOf(nth(31));
    expect(cell.shown).toEqual([27, 28, 29, 30, 31]);
    expect(cell.many).toBe(true);
    expect(cell.countText).toBe("全部 31 次");
  });

  it("正在看的那次不在最近五次里：换掉最早的那个方块，仍画在条上", () => {
    const cell = stageCellOf(nth(31), (n) => n === 2);
    expect(cell.shown).toEqual([2, 28, 29, 30, 31]);
    expect(cell.many).toBe(true);
  });

  it("正在看的那次已在最近五次里：照旧", () => {
    expect(stageCellOf(nth(31), (n) => n === 30).shown).toEqual([27, 28, 29, 30, 31]);
  });

  it("只有一次", () => {
    expect(stageCellOf(nth(1)).countText).toBe("1 次");
  });
});
