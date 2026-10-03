// 客户端只给 Node 用的入口，命令行从 @product-loop/client/node 引入，见「01 架构」第三节和第六节。
// 调用接口之前确认后端在运行、构建号对得上，不在就拉起。它用到 Node 的模块，浏览器不能用。

export type {
  EnsuredBackend,
  EnsureOptions,
  EnsureTiming,
  FindOptions,
  SlowStart,
} from "./ensure.ts";
export { ensureBackend, findBackend } from "./ensure.ts";
export type {
  BuildMismatch,
  EnsureFailure,
  NodeTooOld,
  ReplaceFailed,
  StartFailed,
  StartFailedReason,
} from "./failure.ts";
export { failureIssue, isEnsureFailure } from "./failure.ts";
export { type BackendFiles, backendFiles, processAlive, readRunInfo } from "./files.ts";
export { formatLogLine, readLogTail } from "./log-tail.ts";
export type { NodeClient, NodeClientOptions } from "./node-client.ts";
export { createNodeClient } from "./node-client.ts";
export type { EnsureSystem, SpawnExit, Spawned, SpawnOptions } from "./system.ts";
