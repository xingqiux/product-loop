import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { tarEnd, tarFileHeader, tarPadding } from "@product-loop/model";
import { manifestName } from "./archives.ts";

// 测试用的归档包：按给的文件拼成 tar.gz，第一个文件是清单。只给测试用。

export type ArchiveFile = { readonly path: string; readonly data: Uint8Array | string };

const bytesOf = (data: Uint8Array | string) =>
  typeof data === "string" ? new TextEncoder().encode(data) : data;

export const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** 拼一个包。manifest 不写时按 files 生成，写了就用写的，测试据此造出对不上的清单。 */
export function makeArchive(
  files: readonly ArchiveFile[],
  manifest?: readonly { path: string; size: number; sha256: string }[],
): Buffer {
  const list =
    manifest ??
    files.map(({ path, data }) => {
      const bytes = bytesOf(data);
      return { path, size: bytes.byteLength, sha256: sha256(bytes) };
    });
  const entries = [{ path: manifestName, data: JSON.stringify(list) }, ...files];
  const parts: Uint8Array[] = [];
  for (const { path, data } of entries) {
    const bytes = bytesOf(data);
    parts.push(tarFileHeader(path, bytes.byteLength), bytes, tarPadding(bytes.byteLength));
  }
  parts.push(tarEnd());
  return gzipSync(Buffer.concat(parts));
}
