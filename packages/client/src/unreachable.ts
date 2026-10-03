// 没有拿到后端的响应外壳时的结果，见「01 架构」第八节。
// 这几种情况没有错误码，由调用的一方决定怎么办。例如连接被拒绝，Node 入口就拉起后端再重发。
// Node 的 fetch 把原因写在 cause.code 里。浏览器不给出原因，连不上时一律是 network。

/** 没有拿到响应外壳的原因。 */
export type UnreachableReason =
  /** 连接被拒绝：端口上没有程序在监听，通常是后端没开。 */
  | "refused"
  /** 等响应超过了时限。 */
  | "timeout"
  /** 别的网络错误，例如连接被重置。 */
  | "network"
  /** 收到了响应，却不是响应外壳。端口上可能是别的程序。 */
  | "badResponse";

export type Unreachable = {
  readonly unreachable: UnreachableReason;
  /** 原始的报错，或者响应正文的开头。写进日志和报错，用来排查。 */
  readonly detail: string;
  /** 收到的 HTTP 状态。只有 badResponse 有。 */
  readonly status?: number;
};

/** Node 的 fetch 超时的几种错误码。 */
const timeoutCodes = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** 报错里写的错误码。Node 的 fetch 写在 cause 上，连接失败时 cause 可能是 AggregateError。 */
function codeOf(error: unknown): string | undefined {
  for (const item of [error instanceof Error ? error.cause : undefined, error]) {
    if (typeof item === "object" && item !== null && "code" in item) {
      if (typeof item.code === "string") return item.code;
    }
  }
  return undefined;
}

/** 报错的原文。有 cause 时取 cause 的，它写得更具体，例如 connect ECONNREFUSED 127.0.0.1:4731。 */
function detailOf(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && cause.message !== "") return cause.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

/** fetch 抛出的错误属于哪一种。取消不在其中，调用的一方取消时照原样抛出。 */
export function unreachableOf(error: unknown): Unreachable {
  const detail = detailOf(error);
  if (error instanceof Error && error.name === "TimeoutError") {
    return { unreachable: "timeout", detail };
  }
  const code = codeOf(error);
  if (code === "ECONNREFUSED") return { unreachable: "refused", detail };
  if (code !== undefined && timeoutCodes.has(code)) return { unreachable: "timeout", detail };
  return { unreachable: "network", detail };
}

/** 是不是调用的一方取消了请求。取消不算连不上，不重发。 */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/** 响应不是外壳。正文只留开头，够排查就行。 */
export function badResponse(status: number, body: string): Unreachable {
  return { unreachable: "badResponse", status, detail: body.slice(0, 200) };
}
