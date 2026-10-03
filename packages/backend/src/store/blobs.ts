import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, type ReadStream, renameSync, rmSync, statSync } from "node:fs";
import { type FileHandle, mkdir, open, readdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "@product-loop/model";
import { and, eq, lt, notExists, sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { imageHeadBytes, readImageInfo } from "./image-info.ts";
import { type BlobHash, type BlobReferrerKind, blobRefs, blobs } from "./schema/index.ts";

// 附件库，见「03 数据模型」第四节和第六节。文件放在 blobs/ab/cd/<哈希>，ab 和 cd 是哈希的前四位。
// blobs 表登记每个附件，blob_refs 表记谁在用它。
// 上传先写同一个磁盘上的临时文件，边写边算哈希，核对上了再改名到正式位置。
// 改名和登记在同一段同步的代码里，不让出执行权，所以不会和别的上传或 gc 交错。

export type { BlobHash } from "./schema/index.ts";

type BlobRecord = typeof blobs.$inferSelect;

export type BlobStore = {
  readonly db: Db;
  /** 集中存储的 blobs/ 目录，见 homePaths。 */
  readonly dir: string;
  /** 单个附件的字节数上限。不写时是五十兆，见「05 接口」第二节。 */
  readonly maxBytes?: number;
};

/** 没有引用的附件保留七天，免得删掉刚上传、还没被引用的，见「03 数据模型」第六节。 */
export const blobGraceMs = 7 * 24 * 60 * 60 * 1000;

const defaultMaxBytes = 50 * 1024 * 1024;

/** 没带类型，文件头也认不出来时，类型记成这个。 */
const unknownType = "application/octet-stream";

const hashPattern = /^[0-9a-f]{64}$/;
const shardPattern = /^[0-9a-f]{2}$/;
/** 类型只认 type/subtype，写法按 RFC 6838。 */
const mediaTypePattern = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;

/** 核对哈希的写法。接口路径和页面数据里的哈希都先经过这里，再拿去找文件。 */
export function parseBlobHash(text: string): Result<BlobHash, { readonly kind: "badHash" }> {
  return hashPattern.test(text) ? ok(text as BlobHash) : err({ kind: "badHash" });
}

/** 附件文件的位置。哈希的写法不对时直接报错，不会拼出指到别处的路径。 */
export function blobPath(dir: string, hash: BlobHash): string {
  if (!hashPattern.test(hash)) {
    throw new Error(`附件的哈希不是六十四位小写十六进制：${JSON.stringify(hash)}`);
  }
  return join(dir, hash.slice(0, 2), hash.slice(2, 4), hash);
}

/** 临时文件放在附件库里面，和正式位置在同一个磁盘上，改名才是原子的。 */
const tempDir = (dir: string): string => join(dir, "tmp");

/** 上传的内容：整块的字节，或者一段一段读的流。Node 的流和网页的流都算后者。 */
export type BlobBody = Uint8Array | AsyncIterable<Uint8Array>;

export type BlobMeta = {
  /** 上传时带的类型，例如 Content-Type 请求头。参数不记，认得出的图片以文件头为准。 */
  readonly contentType?: string | undefined;
  /** 这一份从哪里来，记作最早的来源，例如 `cli/2.0.0 rounds/v2-检查-1/img/a.png`。 */
  readonly source: string;
};

export type PutBlobError =
  | { readonly kind: "badContentType" }
  | { readonly kind: "tooLarge"; readonly limit: number }
  | { readonly kind: "hashMismatch"; readonly expected: BlobHash; readonly actual: string };

export type PutBlobResult = {
  readonly blob: BlobRecord;
  /** 这次写了文件。已有完整的一份时是 false，文件不动。 */
  readonly stored: boolean;
};

/**
 * 存一个附件。内容先写进 blobs/tmp/ 下的临时文件，边写边算哈希。哈希对上了才改名到正式位置。
 * 哈希不符、类型写错、超过上限时返回错误。读输入时出错照原样抛出。这几种情况都不留下文件。
 * 已有完整的一份时不重写文件，返回已有的记录。没有引用的，重新计七天。
 */
export async function putBlob(
  store: BlobStore,
  body: BlobBody,
  expected: BlobHash,
  meta: BlobMeta,
  now: Date = new Date(),
): Promise<Result<PutBlobResult, PutBlobError>> {
  const target = blobPath(store.dir, expected);
  const declared = parseContentType(meta.contentType);
  if (!declared.ok) return declared;
  await mkdir(tempDir(store.dir), { recursive: true });
  const temp = join(tempDir(store.dir), `${randomUUID()}.part`);
  try {
    const written = await writeTemp(temp, body, store.maxBytes ?? defaultMaxBytes);
    if (!written.ok) return written;
    const { hash: actual, size, head } = written.value;
    if (actual !== expected) return err({ kind: "hashMismatch", expected, actual });

    // 从这里到返回都是同步的。
    const found = findBlob(store.db, expected);
    if (found !== undefined && fileIntact(target, found)) {
      return ok({ blob: renew(store.db, found, now), stored: false });
    }
    mkdirSync(dirname(target), { recursive: true });
    renameSync(temp, target);
    if (found !== undefined) {
      // 库里有记录，文件却不见了或大小不对。用这次的内容补上文件，记录里只改字节数。
      const fixed = store.db
        .update(blobs)
        .set({ size })
        .where(eq(blobs.hash, expected))
        .returning()
        .get();
      return ok({ blob: renew(store.db, fixed ?? found, now), stored: true });
    }
    const image = readImageInfo(head);
    const blob = store.db
      .insert(blobs)
      .values({
        hash: expected,
        contentType: image?.contentType ?? declared.value ?? unknownType,
        size,
        width: image?.width ?? null,
        height: image?.height ?? null,
        createdAt: now,
        firstSource: meta.source,
      })
      .returning()
      .get();
    return ok({ blob, stored: true });
  } finally {
    // 已经改名走的，这里什么都不删。
    await rm(temp, { force: true });
  }
}

/** 附件是否已有完整的一份：库里有记录，文件也在，大小和记录的一样。 */
export function hasBlob(store: BlobStore, hash: BlobHash): boolean {
  const path = blobPath(store.dir, hash);
  const blob = findBlob(store.db, hash);
  return blob !== undefined && fileIntact(path, blob);
}

export type OpenedBlob = {
  readonly blob: BlobRecord;
  /** 文件的内容。读完或者 destroy() 以后文件自动关掉。 */
  readonly stream: ReadStream;
};

/** 打开附件读内容。库里没有记录、文件不在、大小对不上，都返回 notFound。 */
export async function openBlob(
  store: BlobStore,
  hash: BlobHash,
): Promise<Result<OpenedBlob, { readonly kind: "notFound" }>> {
  const path = blobPath(store.dir, hash);
  const blob = findBlob(store.db, hash);
  if (blob === undefined) return err({ kind: "notFound" });
  const file = await openExisting(path);
  if (file === undefined) return err({ kind: "notFound" });
  const stats = await file.stat();
  if (!stats.isFile() || stats.size !== blob.size) {
    await file.close();
    return err({ kind: "notFound" });
  }
  return ok({ blob, stream: file.createReadStream() });
}

export type BlobRef = {
  readonly hash: BlobHash;
  readonly referrerKind: BlobReferrerKind;
  readonly referrerId: string;
  readonly purpose: string;
};

/**
 * 记一条引用。要和引用它的数据在同一个事务里写，所以 db 也可以是事务。
 * 附件没有登记时返回 notFound。同一条引用已经有了就不再记，返回 false。
 */
export function addRef(db: Db, ref: BlobRef): Result<boolean, { readonly kind: "notFound" }> {
  if (findBlob(db, ref.hash) === undefined) return err({ kind: "notFound" });
  const { changes } = db
    .insert(blobRefs)
    .values({
      blobHash: ref.hash,
      referrerKind: ref.referrerKind,
      referrerId: ref.referrerId,
      purpose: ref.purpose,
    })
    .onConflictDoNothing()
    .run();
  return ok(changes > 0);
}

/** 删一条引用，删掉了返回 true。附件本身留给 gc。 */
export function removeRef(db: Db, ref: BlobRef): boolean {
  const { changes } = db
    .delete(blobRefs)
    .where(
      and(
        eq(blobRefs.blobHash, ref.hash),
        eq(blobRefs.referrerKind, ref.referrerKind),
        eq(blobRefs.referrerId, ref.referrerId),
        eq(blobRefs.purpose, ref.purpose),
      ),
    )
    .run();
  return changes > 0;
}

export type GcResult = {
  /** 删掉的附件，按哈希排序，含库里没有登记的文件。 */
  readonly removed: readonly BlobHash[];
  /** 腾出的字节数，含临时文件。 */
  readonly bytes: number;
  /** 删掉的临时文件个数。上传中断时会留下临时文件。 */
  readonly tempFiles: number;
};

/**
 * 删掉没有引用、存下超过七天的附件，正好七天的留着。
 * 库里没有登记的文件和上传中断留下的临时文件，按文件的修改时间同样算七天。
 * 恢复旧的快照以后，会有库里没有登记的文件，见「03 数据模型」第七节。
 * 文件名不是哈希的文件不动，例如访达留下的 .DS_Store。
 */
export async function gcBlobs(store: BlobStore, now: Date): Promise<GcResult> {
  const cutoff = now.getTime() - blobGraceMs;
  const removed = new Map<BlobHash, number>();

  // 删记录和删文件在同一段同步的代码里。
  const expired = store.db
    .delete(blobs)
    .where(and(lt(blobs.createdAt, new Date(cutoff)), unreferenced(store.db)))
    .returning({ hash: blobs.hash, size: blobs.size })
    .all();
  for (const { hash, size } of expired) {
    rmSync(blobPath(store.dir, hash), { force: true });
    removed.set(hash, size);
  }

  for (const hash of await listBlobFiles(store.dir)) {
    // 查库、看时间、删文件在同一段同步的代码里，不会删掉刚登记的附件。
    if (findBlob(store.db, hash) !== undefined) continue;
    const size = removeIfOlder(blobPath(store.dir, hash), cutoff);
    if (size !== undefined) removed.set(hash, size);
  }

  let tempFiles = 0;
  let bytes = 0;
  for (const name of await listNames(tempDir(store.dir))) {
    const size = removeIfOlder(join(tempDir(store.dir), name), cutoff);
    if (size === undefined) continue;
    tempFiles += 1;
    bytes += size;
  }
  for (const size of removed.values()) bytes += size;
  return { removed: [...removed.keys()].sort(), bytes, tempFiles };
}

function findBlob(db: Db, hash: BlobHash): BlobRecord | undefined {
  return db.select().from(blobs).where(eq(blobs.hash, hash)).get();
}

/** 这个附件没有任何引用。 */
function unreferenced(db: Db) {
  return notExists(
    db.select({ one: sql`1` }).from(blobRefs).where(eq(blobRefs.blobHash, blobs.hash)),
  );
}

/**
 * 没有引用的附件再次上传时，重新计七天。
 * 再次上传说明马上要用，不能刚传完就被 gc 删掉。有引用的不改。
 */
function renew(db: Db, blob: BlobRecord, now: Date): BlobRecord {
  const renewed = db
    .update(blobs)
    .set({ createdAt: now })
    .where(and(eq(blobs.hash, blob.hash), unreferenced(db)))
    .returning()
    .get();
  return renewed ?? blob;
}

function fileIntact(path: string, blob: BlobRecord): boolean {
  const stats = statSync(path, { throwIfNoEntry: false });
  return stats?.isFile() === true && stats.size === blob.size;
}

/** 类型只留 type/subtype，转成小写。没带时是 undefined。 */
function parseContentType(
  value: string | undefined,
): Result<string | undefined, { readonly kind: "badContentType" }> {
  if (value === undefined || value.trim() === "") return ok(undefined);
  const essence = (value.split(";")[0] ?? "").trim().toLowerCase();
  return mediaTypePattern.test(essence) ? ok(essence) : err({ kind: "badContentType" });
}

type Written = {
  readonly hash: string;
  readonly size: number;
  /** 文件开头的一段，读图片信息用。 */
  readonly head: Buffer;
};

/** 边写边算哈希。超过上限时停下，不再读输入。 */
async function writeTemp(
  path: string,
  body: BlobBody,
  maxBytes: number,
): Promise<Result<Written, { readonly kind: "tooLarge"; readonly limit: number }>> {
  const file = await open(path, "wx");
  try {
    const digest = createHash("sha256");
    const head: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of body instanceof Uint8Array ? [body] : body) {
      if (size + chunk.byteLength > maxBytes) return err({ kind: "tooLarge", limit: maxBytes });
      if (size < imageHeadBytes) head.push(chunk.subarray(0, imageHeadBytes - size));
      size += chunk.byteLength;
      digest.update(chunk);
      await writeAll(file, chunk);
    }
    // 改名之前先把内容同步到磁盘。断电以后，正式位置上不会是一个没写完的文件。
    await file.datasync();
    return ok({ hash: digest.digest("hex"), size, head: Buffer.concat(head) });
  } finally {
    await file.close();
  }
}

/** 一次写不完时接着写。 */
async function writeAll(file: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const { bytesWritten } = await file.write(chunk, offset);
    offset += bytesWritten;
  }
}

/** 文件的修改时间早于界线就删掉，返回它的字节数。不是文件或者还不到七天的不动。 */
function removeIfOlder(path: string, cutoff: number): number | undefined {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isFile() || stats.mtimeMs >= cutoff) return undefined;
  rmSync(path, { force: true });
  return stats.size;
}

/** 附件库里放对了位置的文件：文件名是哈希，两级目录是哈希的前四位。 */
async function listBlobFiles(dir: string): Promise<BlobHash[]> {
  const hashes: BlobHash[] = [];
  for (const first of await listNames(dir)) {
    if (!shardPattern.test(first)) continue;
    for (const second of await listNames(join(dir, first))) {
      if (!shardPattern.test(second)) continue;
      for (const name of await listNames(join(dir, first, second))) {
        const hash = parseBlobHash(name);
        if (hash.ok && name.startsWith(first + second)) hashes.push(hash.value);
      }
    }
  }
  return hashes;
}

/** 目录里的名字。目录不在，或者不是目录时，当作空的。 */
async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function openExisting(path: string): Promise<FileHandle | undefined> {
  try {
    return await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
