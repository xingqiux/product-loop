import { describe, expect, it } from "vitest";
import { z } from "zod";
import { healthSchema } from "./backend.ts";
import {
  doctorReason,
  projectRegisterSchema,
  projectStatusSchema,
  projectUpdateSchema,
  projectViewSchema,
} from "./projects.ts";

// 接口的定义：请求里的中文解码成英文键，响应里的英文键编码回中文，见「05 接口」第一节。

const project = {
  id: "app",
  name: "演示",
  repoKind: "shared" as const,
  ignoreFile: null,
  skillVersion: "2.0.0",
  legacySource: null,
  roots: ["/work/app"],
  createdAt: "2026-09-28T08:00:00.000Z",
};

const version = {
  version: 1,
  status: "open" as const,
  startedAt: "2026-09-28T08:00:00.000Z",
  endedAt: null,
  summary: null,
  endReason: null,
};

describe("请求", () => {
  it("登记项目：仓库类别写中文，解析以后是英文键", () => {
    const parsed = projectRegisterSchema.parse({ root: "/work/app", repoKind: "共用的" });
    expect(parsed).toEqual({ root: "/work/app", repoKind: "shared" });
  });

  it("登记项目：写英文键或不认识的字段，拒绝", () => {
    expect(projectRegisterSchema.safeParse({ root: "/a", repoKind: "shared" }).success).toBe(false);
    const extra = { root: "/a", repoKind: "自己的", stage: "构思" };
    expect(projectRegisterSchema.safeParse(extra).success).toBe(false);
  });

  it("改项目：都可以不写，忽略规则的位置可以写 null", () => {
    expect(projectUpdateSchema.parse({})).toEqual({});
    expect(projectUpdateSchema.parse({ ignoreFile: null, repoKind: "自己的" })).toEqual({
      ignoreFile: null,
      repoKind: "own",
    });
  });
});

describe("响应", () => {
  it("项目：英文键编码回中文，接口上的写法再解析回来不变", () => {
    const wire = z.encode(projectViewSchema, project);
    expect(wire).toEqual({ ...project, repoKind: "共用的" });
    expect(projectViewSchema.parse(wire)).toEqual(project);
  });

  it("状态：阶段名、阶段的状态、页面的用途、迁移检查的原因都写中文", () => {
    const status = {
      project,
      version,
      round: {
        label: "v1-检查-2",
        version: 1,
        stage: "check" as const,
        seq: 2,
        status: "waiting" as const,
        startedAt: "2026-09-28T08:00:00.000Z",
        closedAt: null,
        legacyId: "check-7",
        summary: null,
      },
      waitingPages: [
        {
          id: 12,
          seq: 2,
          round: "v1-检查-2",
          purpose: "ask" as const,
          presentedAt: version.startedAt,
        },
      ],
      queue: [{ stage: "land" as const, count: 3, stale: 1 }],
      skill: {
        version: null,
        current: "0.0.1",
        doctor: "migrationIncomplete" as const,
        newerRules: false,
      },
      mainline: {
        revision: 3,
        missingParts: ["deliveryLine" as const],
        missingDesignSpec: [],
      },
      lastChangedAt: "2026-09-28T08:00:00.000Z",
      idleDays: 0,
    };
    const wire = z.encode(projectStatusSchema, status);
    expect(wire.round).toMatchObject({ stage: "检查", status: "等用户回复" });
    expect(wire.waitingPages[0]?.purpose).toBe("要用户点");
    expect(wire.queue).toEqual([{ stage: "落地", count: 3, stale: 1 }]);
    expect(wire.skill.doctor).toBe("迁移未完成");
    expect(wire.mainline.missingParts).toEqual(["交付线"]);
    expect(projectStatusSchema.parse(wire)).toEqual(status);
  });

  it("状态里不带下一步和警告，它们在响应外壳里", () => {
    expect(Object.keys(projectStatusSchema.shape)).not.toContain("next");
    expect(Object.keys(projectStatusSchema.shape)).not.toContain("warnings");
  });

  it("迁移检查的两种原因各有中文", () => {
    expect(doctorReason.table).toEqual({
      migrationIncomplete: "迁移未完成",
      skillOutdated: "停在旧版本",
    });
  });

  it("health：运行状态写中文，接口版本是 1", () => {
    const health = {
      status: "running" as const,
      build: "dev",
      apiVersion: 1 as const,
      schemaVersion: 1790000000000,
      pid: 4321,
      home: "/Users/someone/.product-loop",
    };
    expect(z.encode(healthSchema, health)).toEqual({ ...health, status: "正常" });
    expect(healthSchema.safeParse({ ...health, status: "正常", apiVersion: 2 }).success).toBe(
      false,
    );
  });
});
