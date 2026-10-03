// 存成 JSON 文本的列用这里的类型，例如事件的改动内容、请求编号记下的结果。
// Drizzle 的 json 模式在写入时转成 JSON 文本，读出时再转回来。

/**
 * 能存成 JSON 再原样读回来的值。Date、Map 这类对象不在其中，时间写成字符串或毫秒数。
 * 对象的属性可以是 undefined，存的时候略去，读回来时这个属性不在。
 */
export type Json = null | boolean | number | string | readonly Json[] | JsonObject;

export type JsonObject = { readonly [key: string]: Json | undefined };
