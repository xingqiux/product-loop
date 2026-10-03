import { hc, type InferRequestType, type InferResponseType } from "hono/client";
import { describe, expectTypeOf, it } from "vitest";
import type { AppType } from "./index.ts";

// 客户端从 AppType 拿到的类型，由类型检查核对，见「02 技术选型」第六节。
// 第 10 步在客户端里照搬验证代码的七条断言，这里先守住接口一侧。

const client = hc<AppType>("http://127.0.0.1:4731");
type Register = typeof client.api.v1.projects.$post;
type Project = (typeof client.api.v1.projects)[":pid"]["$get"];
type Health = typeof client.api.v1.health.$get;

describe("接口的类型", () => {
  it("请求里的枚举是中文，路径参数有类型", () => {
    type Kind = InferRequestType<Register>["json"]["repoKind"];
    expectTypeOf<Kind>().toEqualTypeOf<"自己的" | "共用的">();
    expectTypeOf<InferRequestType<Project>["param"]>().toEqualTypeOf<{ pid: string }>();
  });

  it("响应按状态码收窄：成功的外壳，和每个状态码对应的错误码", () => {
    expectTypeOf<InferResponseType<Register, 201>["ok"]>().toEqualTypeOf<true>();
    expectTypeOf<
      InferResponseType<Register, 400>["error"]["code"]
    >().toEqualTypeOf<"BAD_REQUEST">();
    expectTypeOf<InferResponseType<Register, 409>["error"]["code"]>().toEqualTypeOf<"CONFLICT">();
    expectTypeOf<InferResponseType<Project, 404>["error"]["code"]>().toEqualTypeOf<"NOT_FOUND">();
  });

  it("子应用合进来以后仍有类型", () => {
    expectTypeOf<InferResponseType<Health>>().not.toBeAny();
    expectTypeOf<InferResponseType<Health>["data"]["status"]>().toEqualTypeOf<"正常">();
  });
});
