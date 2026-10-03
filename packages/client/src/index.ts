// 客户端：接口的类型化客户端，命令行和工作台都用它调用后端，见「01 架构」第二、三节。
// 这个入口浏览器和 Node 都能用。只给 Node 用的入口在 @product-loop/client/node，负责拉起后端。

export type {
  Api,
  CallError,
  CallOptions,
  CallResult,
  Client,
  ClientOptions,
  DataOf,
  Fetch,
  RawResult,
  Reply,
} from "./client.ts";
export { createClient, isUnreachable } from "./client.ts";
export type { Unreachable, UnreachableReason } from "./unreachable.ts";
