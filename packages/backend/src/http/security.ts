import {
  clientHeader,
  errorBody,
  type Issue,
  idempotencyHeader,
  renderCopy,
} from "@product-loop/model";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { httpCopy } from "../copy/http.ts";
import { failure } from "./respond.ts";

// 安全检查，见「05 接口」第二节。后端只监听 127.0.0.1，外部机器连不上。
// 本机的网页仍可能被恶意网站利用去访问它，所以每个请求都先过这里的几项检查。
// 后端不设登录和令牌，这一点记在「12 风险」里。
// 请求头的名字在共用定义里，客户端按同一份发出，见 model 的 api/headers.ts。

/** 请求体的上限：页面数据单份不超过五兆。附件的上传按自己的上限，归档包的接口以后另写。 */
export const bodyLimitBytes = 5 * 1024 * 1024;

/** 不改数据的方法。其余的方法都当作会改数据。 */
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

/** 会改数据的请求：GET、HEAD、OPTIONS 以外的方法。 */
export function isWriteMethod(method: string): boolean {
  return !safeMethods.has(method);
}

/** 后端自己的两个主机名，和端口拼起来就是请求头 Host 允许的值。 */
const hostNames = ["127.0.0.1", "localhost"];

function rejected(c: Context, issue: Issue): Response {
  return failure(c, errorBody("BAD_REQUEST", [issue]));
}

/**
 * Host 必须是 127.0.0.1:<端口> 或 localhost:<端口>，防止 DNS 重绑定。
 * 恶意网站把自己的域名解析到 127.0.0.1 时，浏览器发来的 Host 仍是那个域名。
 */
export function checkHost(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("Host");
    const allowed = hostNames.map((name) => `${name}:${port()}`);
    if (host !== undefined && allowed.includes(host.toLowerCase())) return next();
    const text = httpCopy.security;
    return rejected(c, {
      message:
        host === undefined ? renderCopy(text.hostMissing) : renderCopy(text.host.message, { host }),
      hint: renderCopy(text.host.hint, { port: port() }),
      where: "Host",
    });
  };
}

/**
 * 带 Origin 的请求，Origin 必须是后端自己的地址。
 * 别的网站发来的请求和预检都在这里拦下，后端也不回应跨站的预检。
 */
export function checkOrigin(port: () => number): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin");
    const own = hostNames.map((name) => `http://${name}:${port()}`);
    if (origin !== undefined && !own.includes(origin.toLowerCase())) {
      const text = httpCopy.security.origin;
      return rejected(c, {
        message: renderCopy(text.message, { origin }),
        hint: renderCopy(text.hint, { port: port() }),
        where: "Origin",
      });
    }
    await next();
  };
}

/**
 * 会改数据的请求必须带 X-Ploop-Client。浏览器跨站发带自定义请求头的请求，要先发预检。
 * 预检已被 checkOrigin 拦下，所以别的网站发不出这类请求。
 * 带了 Idempotency-Key 的，值不能是空的。
 */
export const checkClient: MiddlewareHandler = async (c, next) => {
  if (isWriteMethod(c.req.method)) {
    if (!c.req.header(clientHeader)) {
      const text = httpCopy.security.client;
      const hint = renderCopy(text.hint);
      return rejected(c, { message: renderCopy(text.message), hint, where: clientHeader });
    }
    if (c.req.header(idempotencyHeader) === "") {
      const text = httpCopy.security.idempotencyKey;
      const hint = renderCopy(text.hint);
      return rejected(c, { message: renderCopy(text.message), hint, where: idempotencyHeader });
    }
  }
  await next();
};

/** 上传附件的路径前缀。附件库边写边数，超过五十兆就停，见 store/blobs.ts。 */
const blobPrefix = "/api/v1/blobs/";

/** 迁移的归档包。它不受上限，见「05 接口」第二节。 */
const archivePattern = /^\/api\/v1\/projects\/[^/]+\/legacy\/archive$/u;

/** 请求体超过上限时拒绝。带 Content-Length 的只看它，不带的边读边数。上传附件和归档包不在这里查。 */
export const limitBody: MiddlewareHandler = (c, next) => {
  if (c.req.method === "PUT" && c.req.path.startsWith(blobPrefix)) return next();
  if (c.req.method === "POST" && archivePattern.test(c.req.path)) return next();
  return limitPageBody(c, next);
};

const limitPageBody: MiddlewareHandler = bodyLimit({
  maxSize: bodyLimitBytes,
  onError: (c) => {
    const text = httpCopy.security.bodyTooLarge;
    return rejected(c, {
      message: renderCopy(text.message, { limit: `${bodyLimitBytes / 1024 / 1024} MB` }),
      hint: renderCopy(text.hint),
    });
  },
});
