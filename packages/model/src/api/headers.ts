// 请求头和响应头的名字，见「05 接口」第三节。后端按它们检查和回应，客户端按它们发出和读取。

/** 客户端和版本，例如 cli/2.0.0。会改数据的请求必须带，见「05 接口」第二节。 */
export const clientHeader = "X-Ploop-Client";

/** AI 会话的标识，命令行能取到时才带。冲突的报错里写明是哪个会话。 */
export const sessionHeader = "X-Ploop-Session";

/** 请求编号：每个写请求生成一个，只在重发这个请求时沿用，见约定 0002 第 2 条。 */
export const idempotencyHeader = "Idempotency-Key";

/** 对象的修改计数，对不上返回 CONFLICT。 */
export const ifMatchHeader = "If-Match";

/** 响应头：BUSY 带的建议等待秒数，客户端照它重发，最多等六十秒。 */
export const retryAfterHeader = "Retry-After";
