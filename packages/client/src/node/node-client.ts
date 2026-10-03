import { err, type Result } from "@product-loop/model";
import {
  type Api,
  type CallError,
  type CallOptions,
  type ClientOptions,
  createClient,
  type DataOf,
  isUnreachable,
  type Reply,
} from "../client.ts";
import type { Unreachable } from "../unreachable.ts";
import { type EnsuredBackend, type EnsureOptions, ensureBackend } from "./ensure.ts";
import type { EnsureFailure } from "./failure.ts";
import { backendFiles, readRunInfo } from "./files.ts";

// 命令行用的客户端：第一次调用接口之前确认后端在运行、构建号对得上，不在就拉起，见「01 架构」第六节。
// 每次发请求前按 run/backend.json 取地址，别的会话换了后端、端口变了也能跟上。
// 连不上时拉起后端，再重发一次，沿用同一个请求编号，见约定 0002 第 2 条。
// 等响应超时不拉起：后端在运行，只是没有及时应答，再拉起一个也占不到实例锁。

export type NodeClientOptions = EnsureOptions &
  Pick<ClientOptions, "session" | "timeoutMs" | "onBusy">;

export type NodeClient = {
  /** 确认后端在运行、构建号对得上，不在就拉起。第一次调用接口之前自动做一次。 */
  readonly ensure: () => Promise<Result<EnsuredBackend, EnsureFailure>>;
  /** 调一次接口，写法和 createClient 的相同。后端起不来时，失败的结果是起不来的原因。 */
  readonly call: <R>(
    send: (api: Api) => Promise<R>,
    options?: CallOptions,
  ) => Promise<Result<Reply<DataOf<R>>, CallError | EnsureFailure>>;
  /** 发一个不套外壳的请求，写法和 createClient 的 raw 相同。后端没开时先拉起。 */
  readonly raw: (
    path: string,
    init?: RequestInit,
    options?: CallOptions,
  ) => Promise<Result<Response, Unreachable | EnsureFailure>>;
};

export function createNodeClient(options: NodeClientOptions): NodeClient {
  const files = backendFiles(options.home);
  const { system, session, timeoutMs, onBusy } = options;
  let current: EnsuredBackend | undefined;
  let pending: Promise<Result<EnsuredBackend, EnsureFailure>> | undefined;
  /** 重发之前拉起失败的原因，按那一次没拿到外壳的结果记下，调用返回时换成它。 */
  const failures = new WeakMap<Unreachable, EnsureFailure>();

  /** 同时几个调用都要确认时，只确认一次。 */
  const ensure = () => {
    pending ??= ensureBackend(options).then((result) => {
      pending = undefined;
      if (result.ok) current = result.value;
      return result;
    });
    return pending;
  };

  const client = createClient({
    client: "cli",
    ...(session === undefined ? {} : { session }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(onBusy === undefined ? {} : { onBusy }),
    ...(system?.fetch === undefined ? {} : { fetch: system.fetch }),
    ...(system?.now === undefined ? {} : { now: system.now }),
    ...(system?.sleep === undefined ? {} : { sleep: system.sleep }),
    baseUrl: () => {
      const port = readRunInfo(files.runInfo)?.port ?? current?.port;
      return `http://127.0.0.1:${port}`;
    },
    onUnreachable: async (failure, count) => {
      if (count > 1 || failure.unreachable === "timeout") return false;
      const again = await ensure();
      if (!again.ok) failures.set(failure, again.error);
      return again.ok;
    },
  });

  return {
    ensure,
    call: async (send, callOptions) => {
      if (current === undefined) {
        const first = await ensure();
        if (!first.ok) return first;
      }
      const result = await client.call(send, callOptions);
      if (result.ok || !isUnreachable(result.error)) return result;
      return err(failures.get(result.error) ?? result.error);
    },
    raw: async (path, init, callOptions) => {
      if (current === undefined) {
        const first = await ensure();
        if (!first.ok) return first;
      }
      const result = await client.raw(path, init, callOptions);
      if (result.ok) return result;
      return err(failures.get(result.error) ?? result.error);
    },
  };
}
