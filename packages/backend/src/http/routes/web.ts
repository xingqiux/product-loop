import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { Readable } from "node:stream";
import { errorBody, renderCopy } from "@product-loop/model";
import { type Context, Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import type { AppDeps } from "../deps.ts";
import { failure } from "../respond.ts";

// 工作台的静态文件，见第二期计划第 5 步和「06 工作台」第一节。
// 文件从运行目录的 web/ 读。认得的文件原样返回，不认得的地址都回到工作台的首页，由工作台的路由处理。
// 地址像文件（带扩展名）却找不到时返回 NOT_FOUND，不拿首页冒充脚本或样式。
// 带哈希的构建产物放在 assets/ 下，可以长期缓存；首页每次都重新取，换了版本马上生效。

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const immutable = "public, max-age=31536000, immutable";
const revalidate = "no-cache";

/** 地址对应的文件。解码失败、跑出目录、不是文件的都算没有。 */
function fileOf(dir: string, path: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return undefined;
  }
  const file = normalize(join(dir, decoded));
  if (!file.startsWith(dir.endsWith(sep) ? dir : `${dir}${sep}`)) return undefined;
  try {
    return statSync(file).isFile() ? file : undefined;
  } catch {
    return undefined;
  }
}

function send(c: Context, file: string, cache: string): Response {
  const type = contentTypes[extname(file)] ?? "application/octet-stream";
  const headers = { "Content-Type": type, "Cache-Control": cache };
  if (c.req.method === "HEAD") return c.body(null, 200, headers);
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream<Uint8Array>;
  return c.body(body, 200, headers);
}

export function webRoutes(deps: AppDeps) {
  const dir = normalize(deps.webDir);
  const serve = (c: Context) => {
    const path = c.req.path;
    if (path === "/api" || path.startsWith("/api/")) return c.notFound();
    const file = path === "/" ? undefined : fileOf(dir, path);
    if (file !== undefined) {
      return send(c, file, path.startsWith("/assets/") ? immutable : revalidate);
    }
    if (extname(path) !== "") return c.notFound();
    const index = fileOf(dir, "/index.html");
    if (index === undefined) {
      const text = httpCopy.webMissing;
      const issue = { message: renderCopy(text.message, { dir }), hint: renderCopy(text.hint) };
      return failure(c, errorBody("NOT_FOUND", [issue]));
    }
    return send(c, index, revalidate);
  };
  return new Hono().get("*", serve);
}
