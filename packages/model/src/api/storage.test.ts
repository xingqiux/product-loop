import { describe, expect, it } from "vitest";
import { storageUsageSchema } from "./storage.ts";

// 集中存储的占用：每个项目的附件，附件库和数据库的合计。

const usage = {
  projects: [{ project: "app", name: "工作台", blobs: { count: 2, bytes: 2048 } }],
  blobs: { count: 3, bytes: 4096 },
  unreferenced: { count: 1, bytes: 2048 },
  database: { bytes: 65536 },
};

describe("集中存储的占用", () => {
  it("按定义解析，内容不变", () => {
    expect(storageUsageSchema.parse(usage)).toEqual(usage);
  });

  it("字节数是负数、项目编号写法不对、多出字段，都拒绝", () => {
    const rejected = [
      { ...usage, blobs: { count: 3, bytes: -1 } },
      { ...usage, projects: [{ ...usage.projects[0], project: "App" }] },
      { ...usage, archives: { bytes: 0 } },
    ];
    for (const value of rejected) {
      expect(storageUsageSchema.safeParse(value).success).toBe(false);
    }
  });
});
