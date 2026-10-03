import { describe, expect, it } from "vitest";
import { backendIdentitySchema } from "./backend.ts";
import {
  clientHeader,
  idempotencyHeader,
  ifMatchHeader,
  retryAfterHeader,
  sessionHeader,
} from "./headers.ts";

// 两边共用的请求头和认后端的办法，后端和客户端都从这里取。

describe("请求头", () => {
  it("名字和「05 接口」第三节相同，BUSY 另带 Retry-After", () => {
    expect([clientHeader, idempotencyHeader, sessionHeader, ifMatchHeader]).toEqual([
      "X-Ploop-Client",
      "Idempotency-Key",
      "X-Ploop-Session",
      "If-Match",
    ]);
    expect(retryAfterHeader).toBe("Retry-After");
  });
});

describe("从 health 的结果认后端", () => {
  const health = {
    status: "正常",
    build: "dev",
    apiVersion: 1,
    schemaVersion: 1790000000000,
    pid: 51234,
    home: "/tmp/ploop-home",
  };

  it("只取进程号、目录和构建号", () => {
    expect(backendIdentitySchema.parse(health)).toEqual({
      pid: 51234,
      home: "/tmp/ploop-home",
      build: "dev",
    });
  });

  it("别的字段变了也认得出，缺了这三样之一就认不出", () => {
    expect(backendIdentitySchema.safeParse({ ...health, status: "新的状态" }).success).toBe(true);
    const { build: _build, ...noBuild } = health;
    expect(backendIdentitySchema.safeParse(noBuild).success).toBe(false);
  });
});
