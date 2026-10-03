import type { InferRequestType, InferResponseType } from "hono/client";
import type { Api, DataOf } from "../client.ts";

// 照搬验证代码的七条类型断言，改成对着真正的 AppType。
// 原样见 spikes/backend/packages/client/src/type-assertions.ts。
// 后端的类型穿过了包的边界，并且是精确的类型，不是 any。任何一条不成立，类型检查就报错。
// 浏览器的配置和测试的配置都检查这个文件。前者证明从 d.ts 取的 AppType 在浏览器一侧也完整。

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;

type Register = Api["api"]["v1"]["projects"]["$post"];
type NextVersion = Api["api"]["v1"]["projects"][":pid"]["versions"]["next"]["$post"];
type Health = Api["api"]["v1"]["health"]["$get"];

export type Assertions = [
  // 请求：仓库类别只能写两个中文取值之一，来自共用定义的 Zod 定义
  Expect<Equal<InferRequestType<Register>["json"]["repoKind"], "自己的" | "共用的">>,
  Expect<Equal<InferRequestType<NextVersion>["param"], { pid: string }>>,
  // 响应：201 的外壳和数据，数据里的枚举也是中文
  Expect<Equal<InferResponseType<NextVersion, 201>["ok"], true>>,
  Expect<
    Equal<InferResponseType<NextVersion, 201>["data"]["started"]["status"], "进行中" | "已结束">
  >,
  // 响应：校验失败的 400 也有类型
  Expect<Equal<InferResponseType<NextVersion, 400>["error"]["code"], "BAD_REQUEST">>,
  // 子应用经 .route() 合进来以后仍有类型
  Expect<Equal<IsAny<InferResponseType<Health>>, false>>,
  Expect<Equal<InferResponseType<Health>["data"]["status"], "正常">>,
];

/** 客户端解包以后，data 仍是那个接口成功时的类型。失败的几种不在其中。 */
export type CallAssertions = [
  Expect<Equal<DataOf<Awaited<ReturnType<Health>>>, InferResponseType<Health, 200>["data"]>>,
  Expect<
    Equal<DataOf<Awaited<ReturnType<NextVersion>>>, InferResponseType<NextVersion, 201>["data"]>
  >,
];
