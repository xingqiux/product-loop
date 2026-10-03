import { type ErrorCode, errorBody, errorCodeInfo, type Issue } from "@product-loop/model";

// 测试用的假后端和假时钟，只给测试用。
// 响应照后端 http/respond.ts 的写法：成功时 {ok, data, warnings, next}，失败时 {ok, error}。
// HTTP 状态按错误码表取，BUSY 带 Retry-After。
// 客户端连测试也不引后端的代码，见 biome.json 里客户端的那条规则，所以这里自己拼响应。

/** 假后端收到的一个请求。 */
export type Received = {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
};

/** 假后端的一步：给出一个响应，或者像 fetch 那样抛出错误。 */
export type Step = Response | Error | ((request: Received) => Response | Promise<Response>);

/** 按顺序走一遍 steps 的假 fetch，记下收到的每个请求。步数用完时报错。 */
export function fakeFetch(...steps: Step[]) {
  const received: Received[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const request: Received = {
      method: init.method ?? "GET",
      url,
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? init.body : undefined,
      signal: init.signal ?? undefined,
    };
    received.push(request);
    const step = steps[received.length - 1];
    if (step === undefined) throw new Error(`假后端只准备了 ${steps.length} 个响应。`);
    if (step instanceof Error) throw step;
    return step instanceof Response ? step : step(request);
  };
  return { fetch, received };
}

function json(body: unknown, status: number, headers: Readonly<Record<string, string>> = {}) {
  const all = { "Content-Type": "application/json", ...headers };
  return new Response(JSON.stringify(body), { status, headers: all });
}

type Extras = {
  readonly status?: number;
  readonly warnings?: readonly Issue[];
  readonly next?: readonly string[];
};

/** 成功的响应，状态默认 200。 */
export function okResponse(data: unknown, extras: Extras = {}): Response {
  const body = { ok: true, data, warnings: extras.warnings ?? [], next: extras.next ?? [] };
  return json(body, extras.status ?? 200);
}

/** 失败的响应。HTTP 状态按错误码表取，多于一条时带 issues 和 total。 */
export function errorResponse(
  code: ErrorCode,
  issues: readonly [Issue, ...Issue[]],
  headers: Readonly<Record<string, string>> = {},
): Response {
  return json({ ok: false, error: errorBody(code, issues) }, errorCodeInfo(code).http, headers);
}

/** 后端忙时的那一条报错。 */
export const busyIssue: Issue = {
  message: "后端正在迁移或恢复数据，暂时不能写入。",
  hint: "稍后重跑这条命令。",
};

/** 后端忙：BUSY 和 Retry-After。不传 retryAfter 时不带这个响应头。 */
export function busyResponse(retryAfter?: string): Response {
  const headers: Record<string, string> =
    retryAfter === undefined ? {} : { "Retry-After": retryAfter };
  return errorResponse("BUSY", [busyIssue], headers);
}

/** 假时钟：sleep 不真的等，只把时间往后拨，并记下每次等了多久。 */
export function fakeClock(start = 0) {
  let time = start;
  const waits: number[] = [];
  return {
    now: () => time,
    sleep: async (ms: number) => {
      waits.push(ms);
      time += ms;
    },
    waits,
  };
}
