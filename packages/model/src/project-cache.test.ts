import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  projectCacheDirName,
  projectIdentityFileName,
  projectIdentitySchema,
  projectIdentityVersion,
  projectIdSchema,
} from "./project-cache.ts";

const hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const identity = { schemaVersion: 1, projectId: "product-loop", skillVersion: "2.0.0" };

describe("项目缓存的位置", () => {
  it("在项目根目录下的 .product-loop/，身份写在 project.json", () => {
    expect(projectCacheDirName).toBe(".product-loop");
    expect(projectIdentityFileName).toBe("project.json");
  });
});

describe("project.json", () => {
  it("写项目编号、停在哪一版 skill，交过主线以后另写主线的基准", () => {
    expect(projectIdentitySchema.safeParse(identity).success).toBe(true);
    const synced = { ...identity, mainlineBase: { revision: 3, hash } };
    expect(projectIdentitySchema.parse(synced)).toEqual(synced);
  });

  it("格式版本不对时拒绝", () => {
    expect(projectIdentityVersion).toBe(1);
    for (const schemaVersion of [0, 2, "1", undefined]) {
      expect(projectIdentitySchema.safeParse({ ...identity, schemaVersion }).success).toBe(false);
    }
  });

  it("三项都要写，不认识的字段拒绝", () => {
    for (const field of ["schemaVersion", "projectId", "skillVersion"]) {
      expect(projectIdentitySchema.safeParse({ ...identity, [field]: undefined }).success).toBe(
        false,
      );
    }
    expect(projectIdentitySchema.safeParse({ ...identity, root: "/tmp/p" }).success).toBe(false);
  });

  it("主线的基准写版本号和全文的 SHA-256", () => {
    const base = (mainlineBase: object) => ({ ...identity, mainlineBase });
    expect(projectIdentitySchema.safeParse(base({ revision: 0, hash })).success).toBe(false);
    expect(projectIdentitySchema.safeParse(base({ revision: 3 })).success).toBe(false);
    const upper = base({ revision: 3, hash: hash.toUpperCase() });
    expect(projectIdentitySchema.safeParse(upper).success).toBe(false);
    const short = base({ revision: 3, hash: hash.slice(1) });
    expect(projectIdentitySchema.safeParse(short).success).toBe(false);
  });

  it.each(["2.0.0", "2.0.0-dev.0", "10.12.3", "0.1.0"])("skill 版本收 %s", (skillVersion) => {
    expect(projectIdentitySchema.safeParse({ ...identity, skillVersion }).success).toBe(true);
  });

  it.each(["2.0", "v2.0.0", "02.0.0", "2.0.0+build.5", "1.x", ""])(
    "skill 版本拒绝 %j",
    (skillVersion) => {
      expect(projectIdentitySchema.safeParse({ ...identity, skillVersion }).success).toBe(false);
    },
  );
});

describe("项目编号", () => {
  it.each(["product-loop", "sketch-board", "sketch-board-2", "abei", "wx-msg"])("收 %s", (id) => {
    expect(projectIdSchema.safeParse(id).success).toBe(true);
  });

  it.each(["Product-Loop", "product_loop", "-loop", "loop-", "atlas--design", "产品循环", ""])(
    "拒绝 %j",
    (id) => {
      expect(projectIdSchema.safeParse(id).success).toBe(false);
    },
  );
});

describe("JSON Schema", () => {
  it.each([
    ["projectId", projectIdSchema],
    ["projectIdentity", projectIdentitySchema],
  ] as const)("%s 能导出，结果和快照相同", (_name, schema) => {
    expect(z.toJSONSchema(schema, { io: "input" })).toMatchSnapshot();
  });
});
