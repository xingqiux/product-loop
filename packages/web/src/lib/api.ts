// 工作台调接口，见「06 工作台」第九节。用和命令行同一个类型化客户端，后端就是打开这一页的地址。
// 查询的函数拿到成功的外壳就交回数据、警告和下一步，失败时抛出 ApiError，由 TanStack Query 接住。
import {
  type Api,
  type CallError,
  createClient,
  type DataOf,
  isUnreachable,
  type Reply,
} from "@product-loop/client";

let leaving = false;

/**
 * 页面要关掉了：这以后发的请求带 keepalive，页面关掉以后也能发完。草稿用它交最后一次。
 * 页面从往返缓存里回来时再关上。keepalive 的请求体不能太大，所以平时不带。
 */
export function markLeaving(value: boolean): void {
  leaving = value;
}

const client = createClient({
  baseUrl: () => window.location.origin,
  client: "web",
  fetch: (url, init) => globalThis.fetch(url, leaving ? { ...init, keepalive: true } : init),
});

/** 连不上本机服务时页面上写的话，一律这一句。 */
export const serviceLost = "连不上本机服务";

/** 接口调用失败：后端的报错，或者连不上后端。 */
class ApiError extends Error {
  readonly error: CallError;

  constructor(error: CallError) {
    // 连不上时没有后端的话可引，不把 network 这样的英文码交给页面。
    super(isUnreachable(error) ? serviceLost : error.message);
    this.name = "ApiError";
    this.error = error;
  }

  /** 是不是连不上后端。连不上时顶上一行已经说明，页面里不再重复。 */
  get unreachable(): boolean {
    return isUnreachable(this.error);
  }
}

/** 是不是连不上本机服务。 */
export function isServiceLost(error: unknown): boolean {
  return error instanceof ApiError && error.unreachable;
}

/**
 * 读不到时页面上怎么写：连不上本机服务只写一句，不带英文码；后端报了错就写它的原因，只写一遍。
 * 后端自己出错时的原话带「后端」，用户看的是本机服务。
 */
export function failureOf(error: unknown): {
  readonly lost: boolean;
  readonly reason: string | undefined;
} {
  if (!(error instanceof ApiError)) return { lost: false, reason: undefined };
  if (isUnreachable(error.error)) return { lost: true, reason: undefined };
  const internal = error.error.code === "INTERNAL";
  return { lost: false, reason: internal ? "本机服务内部出错" : error.message };
}

/** 后端报错的错误码，例如 CONFLICT、PAGE_GONE。连不上后端，或者不是接口的报错时为空。 */
export function errorCodeOf(error: unknown): string | undefined {
  if (!(error instanceof ApiError) || isUnreachable(error.error)) return undefined;
  return error.error.code;
}

/** 调一次接口，交回整个成功的外壳。 */
export async function load<R>(
  send: (api: Api) => Promise<R>,
  signal?: AbortSignal,
): Promise<Reply<DataOf<R>>> {
  const result = await client.call(send, signal === undefined ? {} : { signal });
  if (!result.ok) throw new ApiError(result.error);
  return result.value;
}

/** 后端说找不到：项目、阶段或页不存在。 */
export function isNotFound(error: unknown): boolean {
  return errorCodeOf(error) === "NOT_FOUND";
}

/**
 * 查询失败以后要不要再试。只有连不上后端才重试，最多三次；后端明确说了不行（找不到、写法不对），
 * 再问也是同一个答案，马上把出错的样子显示出来，不让用户等重试的几秒。
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  return error instanceof ApiError && error.unreachable && failureCount < 3;
}
