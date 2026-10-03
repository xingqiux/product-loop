import type { AppType } from "@product-loop/backend";
import {
  type ApiEnvelope,
  clientHeader,
  type ErrorBody,
  err,
  type Issue,
  idempotencyHeader,
  ok,
  type Result,
  retryAfterHeader,
  sessionHeader,
} from "@product-loop/model";
import { hc } from "hono/client";
import packageJson from "../package.json" with { type: "json" };
import { busyWaitMs } from "./busy.ts";
import { parseEnvelope } from "./envelope.ts";
import { isAbort, type Unreachable, unreachableOf } from "./unreachable.ts";

// 接口的类型化客户端，命令行和工作台都用它调用后端，见「01 架构」第二、三节。
// 类型只从后端生成的 d.ts 里取，用 import type 引入，运行时不加载后端的文件。
// 请求头按「05 接口」第三节，名字取自共用定义。外壳按第一节，错误码按第九节。
// 这里只用浏览器和 Node 都有的接口。拉起后端的 Node 入口另写，找后端和重发的做法由它传入。

/** 带类型的接口，路径和后端的路由相同，例如 api.api.v1.health.$get()。 */
export type Api = ReturnType<typeof hc<AppType>>;

/** 发请求的函数，写法和 fetch 相同。也可以直接返回响应，Hono 的 app.request 就是这样。 */
export type Fetch = (url: string, init: RequestInit) => Response | Promise<Response>;

/** 成功时外壳里的三样：数据、警告和下一步。 */
export type Reply<D> = {
  readonly data: D;
  readonly warnings: readonly Issue[];
  /** 下一步：完整的命令或动作。 */
  readonly next: readonly string[];
};

/** 失败有两种：后端给出的报错，带错误码；或者没有拿到后端的响应外壳。 */
export type CallError = ErrorBody | Unreachable;

export type CallResult<D> = Result<Reply<D>, CallError>;

/** 响应的正文，按状态码分开的几种。 */
type BodyOf<R> = R extends { json(): Promise<infer B> } ? B : never;
/** 成功的外壳里的 data。 */
type OkData<B> = B extends { readonly ok: true; readonly data: infer D } ? D : never;
/** 一个接口成功时的 data，由后端路由的类型推出。 */
export type DataOf<R> = OkData<BodyOf<R>>;

export type ClientOptions = {
  /**
   * 后端的地址，例如 http://127.0.0.1:4731。
   * 写成函数时，每次发请求前现取。Node 入口用它找后端，后端换了端口也能跟上。
   */
  readonly baseUrl: string | (() => string | Promise<string>);
  /** 哪个客户端在调用。和版本一起写进 X-Ploop-Client，例如 cli/2.0.0。 */
  readonly client: "cli" | "web";
  /** AI 会话的标识，取得到时才传，见第一期约定第 22 条。 */
  readonly session?: string;
  /** 每次请求的时限，毫秒。不写就不限。 */
  readonly timeoutMs?: number;
  /** 默认用全局的 fetch。 */
  readonly fetch?: Fetch;
  /**
   * 没有拿到外壳时要不要重发。count 是这一次调用第几次没拿到。
   * Node 入口借它拉起后端，返回 true 就重发。重发时沿用同一个请求编号。
   */
  readonly onUnreachable?: (failure: Unreachable, count: number) => boolean | Promise<boolean>;
  /** 后端忙、要等一会儿再重发时告诉调用的一方。命令行据此打印一行说明。 */
  readonly onBusy?: (error: ErrorBody, waitMs: number) => void;
  /** 时钟和等待，测试时换成假的。 */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** 生成请求编号，测试时换成假的。 */
  readonly newKey?: () => string;
};

export type CallOptions = {
  /** 这一次调用里每次请求的时限，毫秒，优先于 ClientOptions 的。长轮询要比等待的秒数长。 */
  readonly timeoutMs?: number;
  /** 调用的一方取消时用。取消时照原样抛出，不当成连不上。 */
  readonly signal?: AbortSignal;
};

export type Client = {
  /**
   * 调一次接口。send 用 api 发出一个请求，这里读出外壳，解包成结果。
   * 后端忙时按 Retry-After 重发，最多等六十秒。写请求带请求编号，重发时沿用。
   */
  call<R>(send: (api: Api) => Promise<R>, options?: CallOptions): Promise<CallResult<DataOf<R>>>;
  /**
   * 发一个不套外壳的请求，例如附件的 HEAD 和 GET，见「05 接口」第四节。
   * path 从 /api/v1 写起。响应原样交回，由调用的一方看状态码、读响应体。请求头和 call 的相同。
   */
  raw(path: string, init?: RequestInit, options?: CallOptions): Promise<RawResult>;
};

/** raw 的结果：拿到的响应，或者没拿到响应的原因。 */
export type RawResult = Result<Response, Unreachable>;

/** 不改数据的方法，和后端的安全检查相同。其余的方法都带请求编号。 */
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** 失败是不是没有拿到外壳。不是的话，就是后端给出的报错，带错误码。 */
export function isUnreachable(error: CallError): error is Unreachable {
  return "unreachable" in error;
}

/** 一次调用的请求编号。第一次发写请求时生成，重发时沿用，见约定 0002 第 2 条。 */
type Pending = { key: string | undefined };

/** 发一次请求拿到的外壳和响应头。 */
type Received = { readonly envelope: ApiEnvelope; readonly headers: Headers };

/** fetch 的第一个参数写成地址。Hono 的客户端传的是字符串。 */
function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** 合并几个取消信号。一个都没有时不传。 */
function anySignal(signals: readonly (AbortSignal | null | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((signal): signal is AbortSignal => signal instanceof AbortSignal);
  return present.length <= 1 ? present[0] : AbortSignal.any(present);
}

export function createClient(options: ClientOptions): Client {
  const fetchOf: Fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const newKey = options.newKey ?? (() => crypto.randomUUID());
  const clientValue = `${options.client}/${packageJson.version}`;

  /** fetch 抛出的错误。调用的一方取消时照原样抛出，其余的按原因归类。 */
  function failed(error: unknown, callOptions: CallOptions): Result<never, Unreachable> {
    if (callOptions.signal?.aborted || isAbort(error)) throw error;
    return err(unreachableOf(error));
  }

  /** 发一次请求，读出外壳。send 只能发一个请求，多发或不发都是写法的错误。 */
  async function exchange(
    send: (api: Api) => Promise<unknown>,
    pending: Pending,
    callOptions: CallOptions,
  ): Promise<Result<Received, Unreachable>> {
    const baseUrl = typeof options.baseUrl === "string" ? options.baseUrl : await options.baseUrl();
    const timeoutMs = callOptions.timeoutMs ?? options.timeoutMs;
    const timeout = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
    const state: { sent: number; response?: Response; failure?: { readonly error: unknown } } = {
      sent: 0,
    };
    const fetchOnce: typeof fetch = async (input, init) => {
      state.sent += 1;
      if (state.sent > 1) throw new Error("一次调用只能发一个请求。");
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = new Headers(init?.headers);
      headers.set(clientHeader, clientValue);
      if (options.session) headers.set(sessionHeader, options.session);
      if (!safeMethods.has(method)) {
        pending.key ??= newKey();
        headers.set(idempotencyHeader, pending.key);
      }
      const signal = anySignal([init?.signal, callOptions.signal, timeout]);
      try {
        state.response = await fetchOf(urlOf(input), {
          ...init,
          method,
          headers,
          ...(signal === undefined ? {} : { signal }),
        });
        return state.response;
      } catch (error) {
        state.failure = { error };
        throw error;
      }
    };
    try {
      await send(hc<AppType>(baseUrl, { fetch: fetchOnce }));
    } catch (error) {
      if (state.failure?.error !== error) throw error;
    }
    if (state.failure !== undefined) return failed(state.failure.error, callOptions);
    if (state.response === undefined) throw new Error("send 没有发出请求。");
    let body: string;
    try {
      body = await state.response.text();
    } catch (error) {
      return failed(error, callOptions);
    }
    const envelope = parseEnvelope(state.response.status, body);
    if (!envelope.ok) return envelope;
    return ok({ envelope: envelope.value, headers: state.response.headers });
  }

  async function call<R>(
    send: (api: Api) => Promise<R>,
    callOptions: CallOptions = {},
  ): Promise<CallResult<DataOf<R>>> {
    const pending: Pending = { key: undefined };
    let unreachable = 0;
    let busySince: number | undefined;
    for (;;) {
      const received = await exchange(send, pending, callOptions);
      if (!received.ok) {
        unreachable += 1;
        if (await options.onUnreachable?.(received.error, unreachable)) continue;
        return received;
      }
      const { envelope, headers } = received.value;
      if (envelope.ok) {
        const { data, warnings, next } = envelope;
        // data 的类型由后端的路由给出，外壳的定义不查 data 的内容。
        return ok({ data: data as DataOf<R>, warnings, next });
      }
      if (envelope.error.code === "BUSY") {
        busySince ??= now();
        const waitMs = busyWaitMs(busySince, now(), headers.get(retryAfterHeader));
        if (waitMs !== undefined) {
          options.onBusy?.(envelope.error, waitMs);
          await sleep(waitMs);
          callOptions.signal?.throwIfAborted();
          continue;
        }
      }
      return err(envelope.error);
    }
  }

  async function raw(
    path: string,
    init: RequestInit = {},
    callOptions: CallOptions = {},
  ): Promise<RawResult> {
    const method = (init.method ?? "GET").toUpperCase();
    const key = safeMethods.has(method) ? undefined : newKey();
    for (let count = 1; ; count += 1) {
      const baseUrl =
        typeof options.baseUrl === "string" ? options.baseUrl : await options.baseUrl();
      const headers = new Headers(init.headers);
      headers.set(clientHeader, clientValue);
      if (options.session) headers.set(sessionHeader, options.session);
      if (key !== undefined) headers.set(idempotencyHeader, key);
      const timeoutMs = callOptions.timeoutMs ?? options.timeoutMs;
      const timeout = timeoutMs === undefined ? undefined : AbortSignal.timeout(timeoutMs);
      const signal = anySignal([init.signal, callOptions.signal, timeout]);
      try {
        const response = await fetchOf(`${baseUrl}${path}`, {
          ...init,
          method,
          headers,
          ...(signal === undefined ? {} : { signal }),
        });
        return ok(response);
      } catch (error) {
        if (callOptions.signal?.aborted || isAbort(error)) throw error;
        const failure = unreachableOf(error);
        if (await options.onUnreachable?.(failure, count)) continue;
        return err(failure);
      }
    }
  }

  return { call, raw };
}
