import { describe, expect, it } from "vitest";
import { backupWarningsOf } from "./queries.ts";

// 顶上一行的备份警告：列表外壳里先是各项目要体检的警告，再是备份的。

type Reply = Parameters<typeof backupWarningsOf>[0];

const status = (doctor: string | null) => ({ skill: { doctor } }) as Reply["data"][number];

describe("备份警告", () => {
  it("跳过要体检的项目各一条，剩下的是备份的", () => {
    const reply = {
      data: [status("要迁移"), status(null), status("版本太旧")],
      warnings: [{ message: "app 要体检" }, { message: "web 要体检" }, { message: "七天没备份" }],
      next: [],
    } as unknown as Reply;
    expect(backupWarningsOf(reply)).toEqual([{ message: "七天没备份" }]);
  });

  it("没有警告时是空的", () => {
    const reply = { data: [status(null)], warnings: [], next: [] } as unknown as Reply;
    expect(backupWarningsOf(reply)).toEqual([]);
  });
});
