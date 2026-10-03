import { Readable } from "node:stream";
import {
  blobCacheControl,
  blobInfoSchema,
  clientHeader,
  type ErrorBody,
  err,
  errorBody,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { Hono } from "hono";
import { httpCopy } from "../../copy/http.ts";
import {
  type BlobHash,
  openBlob,
  type PutBlobError,
  parseBlobHash,
  putBlob,
} from "../../store/blobs.ts";
import type { AppDeps } from "../deps.ts";
import { failure, reply } from "../respond.ts";

// 附件的接口，见「05 接口」第四节和第七节，存放见「03 数据模型」第六节。
// 这三个接口的请求体或响应体是原始字节，成功时不套响应外壳：
// - HEAD 只有响应头，命令行上传前用它问有没有。Hono 把 HEAD 交给 GET 的处理函数，再去掉响应体。
// - GET 的响应体是文件本身，带类型和长度。内容按哈希存放，写好不改，可以长期缓存。
// - PUT 的请求体是文件本身，边写边算哈希，对不上返回 BAD_REQUEST，不留下文件。
//   单个附件的上限是五十兆，由附件库边写边数，不受页面数据五兆的限制。
// 失败时照常返回外壳里的 error。HEAD 的响应没有响应体，只看状态码。

/** 路径里的哈希。写法不对时返回 BAD_REQUEST，不拿它去找文件。 */
function hashOf(text: string): Result<BlobHash, ErrorBody<"BAD_REQUEST">> {
  const parsed = parseBlobHash(text);
  if (parsed.ok) return ok(parsed.value);
  const copy = httpCopy.blob.hash;
  const issue = { message: renderCopy(copy.message, { text }), hint: renderCopy(copy.hint) };
  return err(errorBody("BAD_REQUEST", [{ ...issue, where: text }]));
}

/** 附件库拒绝这次上传的原因，写成 BAD_REQUEST。 */
function putError(error: PutBlobError, hash: BlobHash, type: string): ErrorBody<"BAD_REQUEST"> {
  const text = httpCopy.blob;
  const issue = (message: string, hint: string, where: string) =>
    errorBody("BAD_REQUEST", [{ message, hint, where }]);
  switch (error.kind) {
    case "hashMismatch":
      return issue(
        renderCopy(text.mismatch.message, { actual: error.actual }),
        renderCopy(text.mismatch.hint),
        hash,
      );
    case "badContentType":
      return issue(
        renderCopy(text.contentType.message, { value: type }),
        renderCopy(text.contentType.hint),
        "Content-Type",
      );
    case "tooLarge":
      return issue(
        renderCopy(text.tooLarge.message, { limit: `${error.limit / 1024 / 1024} MB` }),
        renderCopy(text.tooLarge.hint),
        hash,
      );
  }
}

export function blobRoutes(deps: AppDeps) {
  const store = { db: deps.db, dir: deps.paths.dirs.blobs };
  return (
    new Hono()
      /** 下载一个附件，工作台显示图和 ploop reply show 用。HEAD 也到这里，命令行上传前用。 */
      .get("/blobs/:hash", async (c) => {
        const hash = hashOf(c.req.param("hash"));
        if (!hash.ok) return failure(c, hash.error);
        const opened = await openBlob(store, hash.value);
        if (!opened.ok) {
          const text = httpCopy.blob.notFound;
          const issue = { message: renderCopy(text.message), hint: renderCopy(text.hint) };
          return failure(c, errorBody("NOT_FOUND", [{ ...issue, where: hash.value }]));
        }
        const { blob, stream } = opened.value;
        c.header("Content-Type", blob.contentType);
        c.header("Content-Length", String(blob.size));
        c.header("Cache-Control", blobCacheControl);
        c.header("ETag", `"${blob.hash}"`);
        // 附件里有旧页面的快照。直接打开时也不许它跑脚本、不算后端自己的页面。
        c.header("Content-Security-Policy", "sandbox");
        if (c.req.method === "HEAD") {
          stream.destroy();
          return c.body(null, 200);
        }
        return c.body(Readable.toWeb(stream) as ReadableStream<Uint8Array>, 200);
      })
      /** 上传一个附件，请求体是文件的原始字节。命令行和工作台贴图用。 */
      .put("/blobs/:hash", async (c) => {
        const hash = hashOf(c.req.param("hash"));
        if (!hash.ok) return failure(c, hash.error);
        const type = c.req.header("Content-Type");
        // 最早的来源记客户端，安全检查已确认写请求都带着它。
        const meta = { contentType: type, source: c.req.header(clientHeader) ?? "" };
        const body = c.req.raw.body ?? new Uint8Array();
        const result = await putBlob(store, body, hash.value, meta, deps.now());
        if (!result.ok) return failure(c, putError(result.error, hash.value, type ?? ""));
        const { blob, stored } = result.value;
        const info = {
          hash: blob.hash,
          contentType: blob.contentType,
          size: blob.size,
          width: blob.width,
          height: blob.height,
          stored,
        };
        // 新存下的返回 201，已有完整的一份时返回 200。
        if (stored) return reply(c, 201, blobInfoSchema, info);
        return reply(c, 200, blobInfoSchema, info);
      })
  );
}
