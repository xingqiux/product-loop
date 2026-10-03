import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import { archiveManifestName, err, ok, type Result } from "@product-loop/model";
import type { ArchiveEntry } from "./schema/index.ts";

// 迁移的归档包，见「08 版本与迁移」第四节的安全规定第 1 条。
// 命令行把项目里产品循环的全部文件打成一个 tar.gz，第一个文件是清单 .ploop-manifest.json，
// 写着每个文件的路径、字节数和 SHA-256。后端边收边算整个包的哈希，存进 archives/，
// 再读一遍包，逐个核对清单。包不受请求体五兆的上限，见「05 接口」第二节。
// 路径一律写在 PAX 扩展头里，中文和长路径都不用截断。

/** 清单在包里的文件名。 */
export const manifestName = archiveManifestName;

export type ReceivedArchive = {
  readonly file: string;
  readonly sha256: string;
  readonly bytes: number;
};

/** 收下包：写到临时文件，边写边算哈希，和请求里的对上了再改名。 */
export async function receiveArchive(
  dir: string,
  name: string,
  body: AsyncIterable<Uint8Array>,
  expected: string,
): Promise<Result<ReceivedArchive, { readonly kind: "hashMismatch"; readonly actual: string }>> {
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `${name}.partial`);
  const hash = createHash("sha256");
  let bytes = 0;
  const handle = await open(temp, "w");
  try {
    for await (const chunk of body) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      await handle.write(chunk);
    }
  } finally {
    await handle.close();
  }
  const actual = hash.digest("hex");
  if (actual !== expected) {
    await rm(temp, { force: true });
    return err({ kind: "hashMismatch", actual });
  }
  await rename(temp, join(dir, name));
  return ok({ file: name, sha256: actual, bytes });
}

/** 包里的文件：清单写的，和实际读到的。 */
export type ArchiveContents = {
  /** 清单。没有清单或清单写坏时为空。 */
  readonly manifest: readonly ArchiveEntry[] | undefined;
  /** 实际读到的文件，清单本身除外。 */
  readonly files: readonly ArchiveEntry[];
};

/** 按顺序读解压以后的字节。 */
class Reader {
  private readonly chunks: Buffer[] = [];
  private buffered = 0;
  private readonly source: AsyncIterator<Buffer>;
  private done = false;

  constructor(source: AsyncIterable<Buffer>) {
    this.source = source[Symbol.asyncIterator]();
  }

  private async fill(n: number): Promise<boolean> {
    while (this.buffered < n && !this.done) {
      const next = await this.source.next();
      if (next.done === true) this.done = true;
      else {
        this.chunks.push(next.value);
        this.buffered += next.value.byteLength;
      }
    }
    return this.buffered >= n;
  }

  /** 读 n 个字节。不够时返回 undefined。 */
  async take(n: number): Promise<Buffer | undefined> {
    if (!(await this.fill(n))) return undefined;
    const all = Buffer.concat(this.chunks);
    this.chunks.length = 0;
    this.chunks.push(all.subarray(n));
    this.buffered = all.byteLength - n;
    return all.subarray(0, n);
  }

  /** 一段一段交出 n 个字节，不整块留在内存里。 */
  async stream(n: number, each: (chunk: Buffer) => void): Promise<boolean> {
    let left = n;
    while (left > 0) {
      if (this.buffered === 0 && !(await this.fill(1))) return false;
      const head = this.chunks.shift() as Buffer;
      const used = head.subarray(0, left);
      each(used);
      left -= used.byteLength;
      this.buffered -= used.byteLength;
      if (used.byteLength < head.byteLength) this.chunks.unshift(head.subarray(used.byteLength));
    }
    return true;
  }
}

const block = 512;
const padding = (size: number) => (block - (size % block)) % block;
const field = (header: Buffer, start: number, length: number) =>
  header
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/su, "");

/** PAX 扩展头里的 path。每条记录写成「长度 键=值\n」，长度按字节算，含它自己。 */
function paxPath(data: Buffer): string | undefined {
  let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at);
    if (space === -1) return undefined;
    const length = Number(data.subarray(at, space).toString("utf8"));
    if (!Number.isSafeInteger(length) || length <= 0) return undefined;
    const record = data.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (record.slice(0, equals) === "path") return record.slice(equals + 1);
    at += length;
  }
  return undefined;
}

/** 读一遍 tar.gz，算出每个文件的字节数和哈希，取出清单。包写坏时抛出。 */
export async function readArchive(path: string): Promise<ArchiveContents> {
  // 读文件出错时交给解压的流，下面的循环随之抛出。
  const source = createReadStream(path);
  const gunzip = createGunzip();
  source.on("error", (error) => gunzip.destroy(error));
  const reader = new Reader(source.pipe(gunzip));
  const files: ArchiveEntry[] = [];
  let manifest: readonly ArchiveEntry[] | undefined;
  let pending: string | undefined;
  for (;;) {
    const header = await reader.take(block);
    if (header === undefined || header.every((byte) => byte === 0)) break;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156] ?? 0);
    if (type === "x") {
      const data = await reader.take(size + padding(size));
      pending = data === undefined ? undefined : paxPath(data.subarray(0, size));
      continue;
    }
    const prefix = field(header, 345, 155);
    const name =
      pending ?? (prefix === "" ? field(header, 0, 100) : `${prefix}/${field(header, 0, 100)}`);
    pending = undefined;
    if (type !== "0" && type !== "\0") {
      await reader.take(size + padding(size));
      continue;
    }
    if (name === manifestName) {
      const data = await reader.take(size + padding(size));
      manifest = parseManifest(data?.subarray(0, size));
      continue;
    }
    const hash = createHash("sha256");
    const complete = await reader.stream(size, (chunk) => hash.update(chunk));
    if (!complete) throw new Error(`归档包在 ${name} 处截断了。`);
    await reader.take(padding(size));
    files.push({ path: name, size, sha256: hash.digest("hex") });
  }
  return { manifest, files };
}

function parseManifest(data: Buffer | undefined): readonly ArchiveEntry[] | undefined {
  if (data === undefined) return undefined;
  try {
    const value: unknown = JSON.parse(data.toString("utf8"));
    if (!Array.isArray(value)) return undefined;
    const entries = value.filter(
      (entry): entry is ArchiveEntry =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ArchiveEntry).path === "string" &&
        typeof (entry as ArchiveEntry).size === "number" &&
        typeof (entry as ArchiveEntry).sha256 === "string",
    );
    return entries.length === value.length ? entries : undefined;
  } catch {
    return undefined;
  }
}

/** 清单和包里的文件对不上的地方。 */
export type ArchiveMismatch =
  | { readonly kind: "noManifest" }
  | { readonly kind: "missing" | "extra" | "changed"; readonly path: string };

/** 逐个核对：清单里的每个文件都在包里，字节数和哈希相同，包里没有清单以外的文件。 */
export function checkArchive(contents: ArchiveContents): ArchiveMismatch[] {
  const { manifest, files } = contents;
  if (manifest === undefined) return [{ kind: "noManifest" }];
  const actual = new Map(files.map((entry) => [entry.path, entry]));
  const listed = new Set(manifest.map((entry) => entry.path));
  const issues: ArchiveMismatch[] = [];
  for (const entry of manifest) {
    const found = actual.get(entry.path);
    if (found === undefined) issues.push({ kind: "missing", path: entry.path });
    else if (found.size !== entry.size || found.sha256 !== entry.sha256) {
      issues.push({ kind: "changed", path: entry.path });
    }
  }
  for (const entry of files) {
    if (!listed.has(entry.path)) issues.push({ kind: "extra", path: entry.path });
  }
  return issues;
}
