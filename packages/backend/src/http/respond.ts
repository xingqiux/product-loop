import {
  type ApiErr,
  type ErrorBody,
  type ErrorCode,
  type ErrorCodeInfo,
  errorCodeInfo,
  type Issue,
  type Result,
  retryAfterHeader,
} from "@product-loop/model";
import type { Context, TypedResponse } from "hono";
import type { JSONParsed } from "hono/utils/types";
import { z } from "zod";

// 内核的结果在这里变成响应，外壳见「05 接口」第一节，错误码和 HTTP 状态见第九节。
// 成功时 {ok: true, data, warnings, next}，data 用接口的定义编码，枚举由英文键换回中文。
// 失败时 {ok: false, error}，HTTP 状态按错误码表取，两者一一对应。

/** 成功时的状态：取数据和改数据 200，登记出新的东西 201，接受了要稍后做完的请求 202。 */
type SuccessStatus = 200 | 201 | 202;

/** BUSY 带的 Retry-After，秒。每日快照通常在一秒内做完。 */
export const retryAfterSeconds = 1;

/**
 * 一个错误码的响应。按错误码逐个展开，状态码和错误码一一对应。
 * 类型化客户端按状态码收窄以后，就知道 error.code 是哪一个。
 */
export type ErrResponse<C extends ErrorCode> = C extends ErrorCode
  ? Response & TypedResponse<JSONParsed<ApiErr<C>>, ErrorCodeInfo<C>["http"], "json">
  : never;

/** 失败的响应。BUSY 另带 Retry-After，客户端照它自动重试。 */
export function failure<C extends ErrorCode>(c: Context, error: ErrorBody<C>): ErrResponse<C> {
  const info: ErrorCodeInfo = errorCodeInfo(error.code);
  if ("retryAfter" in info) c.header(retryAfterHeader, String(retryAfterSeconds));
  const body: ApiErr<C> = { ok: false, error };
  // 状态码按错误码取，c.json 只知道它是错误码表里的某一个，这里按错误码展开。
  return c.json(body, info.http) as unknown as ErrResponse<C>;
}

/** 响应外壳里和数据并列的两样。 */
type Extras = {
  readonly warnings?: readonly Issue[];
  /** 下一步：完整的命令或动作。 */
  readonly next?: readonly string[];
};

/** 成功的响应。数据先用接口的定义编码：枚举换成中文，并按定义再查一遍。 */
export function reply<S extends SuccessStatus, T extends z.ZodType>(
  c: Context,
  status: S,
  schema: T,
  value: z.output<T>,
  extras: Extras = {},
) {
  const body = {
    ok: true as const,
    data: z.encode(schema, value),
    warnings: extras.warnings ?? [],
    next: extras.next ?? [],
  };
  return c.json(body, status);
}

/** 内核的结果变成响应：成功时按定义编码，失败时按错误码取 HTTP 状态。 */
export function respond<S extends SuccessStatus, T extends z.ZodType, C extends ErrorCode>(
  c: Context,
  result: Result<z.output<T>, ErrorBody<C>>,
  status: S,
  schema: T,
) {
  return result.ok ? reply(c, status, schema, result.value) : failure(c, result.error);
}
