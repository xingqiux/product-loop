import { type ApiEnvelope, apiEnvelopeSchema, err, ok, type Result } from "@product-loop/model";
import { badResponse, type Unreachable } from "./unreachable.ts";

// 读出响应外壳，见「05 接口」第一节。外壳用共用定义校验，错误码只能是错误码表里的那几个。
// 读正文时出的错由调用的一方处理，这里只判断读到的是不是外壳。

/** 把读到的正文解析成外壳。不是 JSON、不合外壳的定义，都算没有拿到外壳。 */
export function parseEnvelope(status: number, body: string): Result<ApiEnvelope, Unreachable> {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return err(badResponse(status, body));
  }
  const envelope = apiEnvelopeSchema.safeParse(json);
  return envelope.success ? ok(envelope.data) : err(badResponse(status, body));
}
