import { z } from "zod";

// 附件的接口，见「05 接口」第四节和第七节，存放见「03 数据模型」第六节。
// HEAD /blobs/:hash 问有没有，PUT 上传原始字节，GET 下载原始字节。
// 这三个接口成功时不用响应外壳：HEAD 只有响应头，GET 的响应体是文件本身。
// PUT 的请求体是文件本身，响应照常用外壳，data 是下面的 blobInfoSchema。
// 失败时三个接口都返回外壳里的 error。HEAD 的响应没有响应体，只看状态码。

/** 附件的哈希：内容的 SHA-256，写成六十四位小写十六进制。 */
export const blobHashPattern = /^[0-9a-f]{64}$/u;

/** 附件的下载可以长期缓存：内容按哈希存放，写好不改，见「03 数据模型」第六节。 */
export const blobCacheControl = "public, max-age=31536000, immutable";

/** PUT /blobs/:hash 的结果：附件库里登记的这一份。 */
export const blobInfoSchema = z.strictObject({
  hash: z.string().regex(blobHashPattern),
  /** 类型，只记 type/subtype。认得出的图片以文件头为准。 */
  contentType: z.string().min(1),
  /** 字节数。 */
  size: z.int().min(0),
  /** 图片的宽和高，单位是像素。不是图片或读不出来时为空。 */
  width: z.int().min(1).nullable(),
  height: z.int().min(1).nullable(),
  /** 这次写了文件。已有完整的一份时是 false，文件不动。 */
  stored: z.boolean(),
});
