// 后端忙时的重发，见「01 架构」第七、八节和「05 接口」第九节。
// 后端在迁移数据结构、导入旧数据、从快照恢复时，对写请求返回 BUSY 和 Retry-After。
// 客户端照 Retry-After 等一会儿再重发，从第一次收到 BUSY 算起，一共最多等六十秒。

/** 后端忙时一共最多等多久，毫秒。 */
export const busyLimitMs = 60_000;

/** 响应没带 Retry-After，或者写得不对时，等一秒。和后端给的默认值相同。 */
const fallbackWaitMs = 1_000;

/** 每次至少等这么久。Retry-After 写 0 或者日期已过时，也不连着重发。 */
const minWaitMs = 100;

/**
 * HTTP 日期以 GMT 结尾，见 RFC 9110 第 5.6.7 节。
 * Date.parse 很宽松，会把 1.5 当成日期，所以先看结尾。
 */
const httpDate = /GMT$/u;

/** Retry-After 要等的毫秒数。可以写秒数，也可以写 HTTP 日期，见 RFC 9110 第 10.2.3 节。 */
export function retryAfterMs(value: string | null, now: number): number {
  const text = value?.trim() ?? "";
  if (/^\d+$/u.test(text)) return Math.max(Number(text) * 1_000, minWaitMs);
  const at = httpDate.test(text) ? Date.parse(text) : Number.NaN;
  if (Number.isNaN(at)) return fallbackWaitMs;
  return Math.max(at - now, minWaitMs);
}

/**
 * 这一次收到 BUSY 以后等多久再重发。since 是第一次收到 BUSY 的时间。
 * 六十秒用完时返回 undefined，不再重发。最后一次只等到六十秒为止。
 */
export function busyWaitMs(
  since: number,
  now: number,
  retryAfter: string | null,
): number | undefined {
  const left = since + busyLimitMs - now;
  if (left <= 0) return undefined;
  return Math.min(retryAfterMs(retryAfter, now), left);
}
