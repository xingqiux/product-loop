import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  addRef,
  type BlobHash,
  type BlobRef,
  type BlobStore,
  blobGraceMs,
  blobPath,
  gcBlobs,
  hasBlob,
  openBlob,
  parseBlobHash,
  putBlob,
  removeRef,
} from "./blobs.ts";
import { blobRefs, blobs } from "./schema/index.ts";
import { openTempDatabase, tempHome } from "./testing.ts";

const day = 24 * 60 * 60 * 1000;
const now = new Date("2026-09-28T08:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * day);

const meta = { contentType: "text/plain", source: "cli/2.0.0 rounds/v2-检查-1/img/a.txt" };

async function tempStore(maxBytes?: number): Promise<BlobStore> {
  const paths = tempHome();
  const { db } = await openTempDatabase(paths);
  const store = { db, dir: paths.dirs.blobs };
  return maxBytes === undefined ? store : { ...store, maxBytes };
}

function hashOf(content: string | Uint8Array): BlobHash {
  const hash = parseBlobHash(createHash("sha256").update(content).digest("hex"));
  if (!hash.ok) throw new Error("算出来的哈希写法不对");
  return hash.value;
}

/** 存一段文字，出错就让测试失败。 */
async function put(store: BlobStore, content: string, at: Date = now) {
  const result = await putBlob(store, Buffer.from(content), hashOf(content), meta, at);
  if (!result.ok) throw new Error(`存不进去：${result.error.kind}`);
  return result.value;
}

/** 附件库里的全部文件，路径相对于附件库。 */
function filesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/** 库里登记的附件。 */
const rows = (store: BlobStore) => store.db.select().from(blobs).all();

/** 附件在附件库里的相对路径，两级目录是哈希的前四位。 */
const shardPath = (hash: BlobHash) => join(hash.slice(0, 2), hash.slice(2, 4), hash);

/** 在附件库里直接放一个文件，并把修改时间改成 mtime。 */
function plantFile(path: string, content: string, mtime: Date): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  utimesSync(path, mtime, mtime);
}

const pageRef = (hash: BlobHash, purpose = "img"): BlobRef => ({
  hash,
  referrerKind: "page",
  referrerId: "12",
  purpose,
});

describe("附件的哈希", () => {
  it("六十四位小写十六进制才收", () => {
    const hash = "0123456789abcdef".repeat(4);
    expect(parseBlobHash(hash)).toEqual({ ok: true, value: hash });
  });

  it.each([
    ["空的哈希", ""],
    ["大写的哈希", "AB".repeat(32)],
    ["少一位的哈希", "a".repeat(63)],
    ["多一位的哈希", "a".repeat(65)],
    ["不是十六进制的哈希", "g".repeat(64)],
    ["往上走的路径", "../../etc/passwd"],
    ["带斜杠的路径", `${"a".repeat(31)}/${"a".repeat(32)}`],
    ["开头带空格的哈希", ` ${"a".repeat(63)}`],
    ["末尾带换行的哈希", `${"a".repeat(64)}\n`],
  ])("拒绝%s", (_, text) => {
    expect(parseBlobHash(text)).toEqual({ ok: false, error: { kind: "badHash" } });
  });

  it("文件放在哈希前四位的两级目录下", () => {
    const hash = hashOf("甲");
    expect(blobPath("/h/blobs", hash)).toBe(
      `/h/blobs/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`,
    );
  });

  it("绕过核对传进来的坏哈希，拼路径时直接报错，不碰文件", async () => {
    const store = await tempStore();
    const bad = "../../../outside" as BlobHash;
    expect(() => blobPath(store.dir, bad)).toThrow("附件的哈希不是六十四位小写十六进制");
    expect(() => hasBlob(store, bad)).toThrow("附件的哈希不是六十四位小写十六进制");
    await expect(openBlob(store, bad)).rejects.toThrow("附件的哈希不是六十四位小写十六进制");
    await expect(putBlob(store, Buffer.from("x"), bad, meta)).rejects.toThrow(
      "附件的哈希不是六十四位小写十六进制",
    );
    expect(readdirSync(store.dir)).toEqual([]);
    expect(existsSync(join(store.dir, "..", "outside"))).toBe(false);
  });
});

describe("上传附件", () => {
  it("先写临时文件，写到一半时正式位置没有文件，核对完哈希才改名", async () => {
    const store = await tempStore();
    const content = "第一段，第二段";
    const hash = hashOf(content);
    let firstWritten!: () => void;
    const written = new Promise<void>((resolve) => {
      firstWritten = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    async function* body() {
      yield Buffer.from("第一段，");
      firstWritten();
      await gate;
      yield Buffer.from("第二段");
    }

    const putting = putBlob(store, body(), hash, meta, now);
    await written;
    const [temp] = filesIn(store.dir);
    expect(filesIn(store.dir)).toEqual([expect.stringMatching(/^tmp\/[0-9a-f-]{36}\.part$/)]);
    expect(readFileSync(join(store.dir, temp ?? "")).toString()).toBe("第一段，");
    expect(hasBlob(store, hash)).toBe(false);
    expect(rows(store)).toEqual([]);

    release();
    const result = await putting;
    expect(result).toEqual({
      ok: true,
      value: {
        stored: true,
        blob: {
          hash,
          contentType: "text/plain",
          size: Buffer.byteLength(content),
          width: null,
          height: null,
          createdAt: now,
          firstSource: meta.source,
        },
      },
    });
    expect(filesIn(store.dir)).toEqual([shardPath(hash)]);
    expect(readFileSync(blobPath(store.dir, hash)).toString()).toBe(content);
    expect(hasBlob(store, hash)).toBe(true);
  });

  it("哈希对不上时拒绝，临时文件删掉，库里没有记录", async () => {
    const store = await tempStore();
    const claimed = hashOf("说好的内容");
    const result = await putBlob(store, Buffer.from("实际的内容"), claimed, meta);
    expect(result).toEqual({
      ok: false,
      error: { kind: "hashMismatch", expected: claimed, actual: hashOf("实际的内容") },
    });
    expect(filesIn(store.dir)).toEqual([]);
    expect(rows(store)).toEqual([]);
    expect(hasBlob(store, claimed)).toBe(false);
  });

  it("读输入时出错（上传中断），原样抛出，什么都不留下", async () => {
    const store = await tempStore();
    async function* body() {
      yield Buffer.from("写了一半");
      throw new Error("连接断了");
    }
    await expect(putBlob(store, body(), hashOf("写了一半，又写完了"), meta)).rejects.toThrow(
      "连接断了",
    );
    expect(filesIn(store.dir)).toEqual([]);
    expect(rows(store)).toEqual([]);
  });

  it("超过上限时拒绝并停止读输入，不留文件；正好到上限的照收", async () => {
    const store = await tempStore(10);
    let reads = 0;
    let closed = false;
    async function* endless() {
      try {
        for (;;) {
          reads += 1;
          yield Buffer.from("1234");
        }
      } finally {
        closed = true;
      }
    }
    const result = await putBlob(store, endless(), hashOf("随便"), meta);
    expect(result).toEqual({ ok: false, error: { kind: "tooLarge", limit: 10 } });
    expect(reads).toBe(3);
    expect(closed).toBe(true);
    expect(filesIn(store.dir)).toEqual([]);

    const tenBytes = "0123456789";
    expect((await put(store, tenBytes)).blob.size).toBe(10);
  });

  it("Buffer、Node 的流、网页的流都能传", async () => {
    const store = await tempStore();
    const parts = ["甲乙", "丙丁", "戊"].map((text) => Buffer.from(text));
    const content = Buffer.concat(parts);
    const hash = hashOf(content);
    const web = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(new Uint8Array(part));
        controller.close();
      },
    });
    for (const body of [content, Readable.from(parts), web]) {
      rmSync(blobPath(store.dir, hash), { force: true });
      const result = await putBlob(store, body, hash, meta);
      expect(result.ok && result.value.stored).toBe(true);
      expect(readFileSync(blobPath(store.dir, hash))).toEqual(content);
    }
  });

  it("同一份内容传两次只存一份，第二次不重写文件，类型和最早的来源照旧", async () => {
    const store = await tempStore();
    const first = await put(store, "同一张图", daysAgo(1));
    const path = blobPath(store.dir, first.blob.hash);
    const before = statSync(path);

    const again = await putBlob(
      store,
      Buffer.from("同一张图"),
      first.blob.hash,
      { contentType: "image/png", source: "web/2.0.0" },
      now,
    );
    // 还没有引用，所以存下的时间改成这一次，见 gc 的测试。
    const expected = { ...first.blob, createdAt: now };
    expect(again).toEqual({ ok: true, value: { stored: false, blob: expected } });
    expect(statSync(path).ino).toBe(before.ino);
    expect(statSync(path).mtimeMs).toBe(before.mtimeMs);
    expect(filesIn(store.dir)).toEqual([shardPath(first.blob.hash)]);
    expect(rows(store)).toEqual([expected]);
  });

  it("两个相同的上传同时进行，也只存一份", async () => {
    const store = await tempStore();
    const hash = hashOf("同时传");
    const results = await Promise.all(
      [1, 2, 3].map(() => putBlob(store, Buffer.from("同时传"), hash, meta, now)),
    );
    expect(results.map((result) => result.ok && result.value.stored).sort()).toEqual([
      false,
      false,
      true,
    ]);
    expect(filesIn(store.dir)).toEqual([shardPath(hash)]);
    expect(rows(store)).toHaveLength(1);
  });

  it("认得出的图片，类型以文件头为准，并记下宽和高", async () => {
    const store = await tempStore();
    const u32 = (n: number) => [n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    const png = Buffer.from([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...u32(13),
      ...Buffer.from("IHDR", "latin1"),
      ...u32(1440),
      ...u32(900),
      ...[8, 6, 0, 0, 0],
      ...u32(0),
    ]);
    const result = await putBlob(store, png, hashOf(png), {
      contentType: "image/jpeg",
      source: "x",
    });
    expect(result.ok && result.value.blob).toMatchObject({
      contentType: "image/png",
      width: 1440,
      height: 900,
    });
  });

  it.each([
    ["只留 type/subtype，转成小写", "Text/Plain; charset=UTF-8", "text/plain"],
    ["没带时记 application/octet-stream", undefined, "application/octet-stream"],
    ["空的也算没带", " ", "application/octet-stream"],
  ])("其余的类型照上传时带的记：%s", async (_, contentType, stored) => {
    const store = await tempStore();
    const result = await putBlob(store, Buffer.from("文字"), hashOf("文字"), {
      contentType,
      source: "x",
    });
    expect(result.ok && result.value.blob).toMatchObject({
      contentType: stored,
      width: null,
      height: null,
    });
  });

  it.each(["not a type", "image/", "/png", "image/png/x", "图片/png"])(
    "类型写成 %j 时拒绝，不读输入，不留文件",
    async (contentType) => {
      const store = await tempStore();
      let read = false;
      async function* body() {
        read = true;
        yield Buffer.from("x");
      }
      const result = await putBlob(store, body(), hashOf("x"), { contentType, source: "x" });
      expect(result).toEqual({ ok: false, error: { kind: "badContentType" } });
      expect(read).toBe(false);
      expect(readdirSync(store.dir)).toEqual([]);
    },
  );
});

describe("附件不完整时，重新上传补上", () => {
  it("库里有记录、文件却不见了：当作没有，重新上传补回文件，记录照旧", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "会丢的文件", daysAgo(1));
    addRef(store.db, pageRef(blob.hash));
    rmSync(blobPath(store.dir, blob.hash));
    expect(hasBlob(store, blob.hash)).toBe(false);
    expect(await openBlob(store, blob.hash)).toEqual({ ok: false, error: { kind: "notFound" } });

    const again = await putBlob(store, Buffer.from("会丢的文件"), blob.hash, {
      contentType: "image/png",
      source: "web/2.0.0",
    });
    expect(again).toEqual({ ok: true, value: { stored: true, blob } });
    expect(readFileSync(blobPath(store.dir, blob.hash)).toString()).toBe("会丢的文件");
    expect(hasBlob(store, blob.hash)).toBe(true);
  });

  it("文件被改坏，大小和记录对不上：当作没有，重新上传覆盖", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "会被截断的文件");
    truncateSync(blobPath(store.dir, blob.hash), 3);
    expect(hasBlob(store, blob.hash)).toBe(false);
    expect(await openBlob(store, blob.hash)).toEqual({ ok: false, error: { kind: "notFound" } });

    const again = await putBlob(store, Buffer.from("会被截断的文件"), blob.hash, meta);
    expect(again.ok && again.value.stored).toBe(true);
    expect(readFileSync(blobPath(store.dir, blob.hash)).toString()).toBe("会被截断的文件");
  });

  it("文件在、库里没有记录（恢复旧快照以后）：重新上传时登记", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "快照以后传的", daysAgo(3));
    store.db.delete(blobs).where(eq(blobs.hash, blob.hash)).run();
    expect(hasBlob(store, blob.hash)).toBe(false);

    const again = await putBlob(store, Buffer.from("快照以后传的"), blob.hash, meta, now);
    expect(again).toEqual({ ok: true, value: { stored: true, blob: { ...blob, createdAt: now } } });
    expect(hasBlob(store, blob.hash)).toBe(true);
  });
});

describe("读附件", () => {
  it("返回内容、类型和字节数", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "要读的内容");
    const opened = await openBlob(store, blob.hash);
    if (!opened.ok) throw new Error("打不开");
    expect(opened.value.blob).toEqual(blob);
    expect((await buffer(opened.value.stream)).toString()).toBe("要读的内容");
    expect(opened.value.stream.closed).toBe(true);
  });

  it("没有这个附件时返回 notFound", async () => {
    const store = await tempStore();
    expect(await openBlob(store, hashOf("没传过"))).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    expect(hasBlob(store, hashOf("没传过"))).toBe(false);
  });
});

describe("附件引用", () => {
  it("引用要指向已登记的附件，同一条引用只记一次", async () => {
    const store = await tempStore();
    expect(addRef(store.db, pageRef(hashOf("没传过")))).toEqual({
      ok: false,
      error: { kind: "notFound" },
    });
    const { blob } = await put(store, "被引用的图");
    expect(addRef(store.db, pageRef(blob.hash))).toEqual({ ok: true, value: true });
    expect(addRef(store.db, pageRef(blob.hash))).toEqual({ ok: true, value: false });
    expect(store.db.select().from(blobRefs).all()).toEqual([
      { blobHash: blob.hash, referrerKind: "page", referrerId: "12", purpose: "img" },
    ]);
  });

  it("和引用它的数据在同一个事务里写，事务撤回时引用也撤回", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "事务里引用的图");
    expect(() =>
      store.db.transaction(
        (tx) => {
          expect(addRef(tx, pageRef(blob.hash))).toEqual({ ok: true, value: true });
          throw new Error("写页面失败");
        },
        { behavior: "immediate" },
      ),
    ).toThrow("写页面失败");
    expect(store.db.select().from(blobRefs).all()).toEqual([]);
  });

  it("removeRef 只删指定的一条", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "两种用途的图");
    addRef(store.db, pageRef(blob.hash, "img"));
    addRef(store.db, pageRef(blob.hash, "snapshot"));
    expect(removeRef(store.db, pageRef(blob.hash, "img"))).toBe(true);
    expect(removeRef(store.db, pageRef(blob.hash, "img"))).toBe(false);
    expect(store.db.select({ purpose: blobRefs.purpose }).from(blobRefs).all()).toEqual([
      { purpose: "snapshot" },
    ]);
  });
});

describe("gc", () => {
  it("宽限是七天", () => {
    expect(blobGraceMs).toBe(7 * day);
  });

  it("只删没有引用、超过七天的附件；正好七天的、七天内的、有引用的都留着", async () => {
    const store = await tempStore();
    const old = await put(store, "八天前的", daysAgo(8));
    const justOver = await put(store, "七天多一毫秒的", new Date(daysAgo(7).getTime() - 1));
    const exactly = await put(store, "正好七天的", daysAgo(7));
    const young = await put(store, "六天前的", daysAgo(6));
    const used = await put(store, "一个月前、有引用的", daysAgo(30));
    addRef(store.db, pageRef(used.blob.hash));

    const result = await gcBlobs(store, now);
    const gone = [old.blob, justOver.blob];
    expect(result).toEqual({
      removed: gone.map((blob) => blob.hash).sort(),
      bytes: gone.reduce((sum, blob) => sum + blob.size, 0),
      tempFiles: 0,
    });
    const kept = [exactly.blob, young.blob, used.blob];
    expect(filesIn(store.dir)).toEqual(kept.map((blob) => shardPath(blob.hash)).sort());
    expect(
      rows(store)
        .map((blob) => blob.hash)
        .sort(),
    ).toEqual(kept.map((blob) => blob.hash).sort());
  });

  it("引用删掉以后，过了七天的附件在下一次 gc 时删掉", async () => {
    const store = await tempStore();
    const { blob } = await put(store, "曾经有引用的", daysAgo(30));
    addRef(store.db, pageRef(blob.hash));
    expect((await gcBlobs(store, now)).removed).toEqual([]);

    removeRef(store.db, pageRef(blob.hash));
    expect((await gcBlobs(store, now)).removed).toEqual([blob.hash]);
    expect(hasBlob(store, blob.hash)).toBe(false);
    expect(filesIn(store.dir)).toEqual([]);
  });

  it("没有引用的附件再次上传时重新计七天，有引用的不改", async () => {
    const store = await tempStore();
    const loose = await put(store, "十天前传过、没有引用的", daysAgo(10));
    const used = await put(store, "十天前传过、有引用的", daysAgo(10));
    addRef(store.db, pageRef(used.blob.hash));

    expect((await put(store, "十天前传过、没有引用的", now)).blob.createdAt).toEqual(now);
    expect((await put(store, "十天前传过、有引用的", now)).blob.createdAt).toEqual(daysAgo(10));
    expect((await gcBlobs(store, now)).removed).toEqual([]);
    const later = new Date(now.getTime() + 7 * day + 1);
    expect((await gcBlobs(store, later)).removed).toEqual([loose.blob.hash]);
  });

  it("库里没有登记的文件按修改时间算七天，不是附件的文件不动", async () => {
    const store = await tempStore();
    const stale = hashOf("恢复快照以后多出来的旧文件");
    const fresh = hashOf("恢复快照以后多出来的新文件");
    const misplaced = hashOf("放错目录的文件");
    plantFile(blobPath(store.dir, stale), "恢复快照以后多出来的旧文件", daysAgo(8));
    plantFile(blobPath(store.dir, fresh), "恢复快照以后多出来的新文件", daysAgo(1));
    const wrongDir = join(store.dir, "00", "00", misplaced);
    plantFile(wrongDir, "放错目录的文件", daysAgo(30));
    plantFile(join(store.dir, ".DS_Store"), "访达的文件", daysAgo(30));
    plantFile(join(dirname(blobPath(store.dir, fresh)), ".DS_Store"), "访达的文件", daysAgo(30));

    const result = await gcBlobs(store, now);
    expect(result).toEqual({
      removed: [stale],
      bytes: Buffer.byteLength("恢复快照以后多出来的旧文件"),
      tempFiles: 0,
    });
    expect(existsSync(blobPath(store.dir, stale))).toBe(false);
    expect(existsSync(blobPath(store.dir, fresh))).toBe(true);
    expect(existsSync(wrongDir)).toBe(true);
    expect(filesIn(store.dir).filter((file) => file.endsWith(".DS_Store"))).toHaveLength(2);
  });

  it("上传中断留下的临时文件，超过七天的删掉，七天内的留着", async () => {
    const store = await tempStore();
    expect(await gcBlobs(store, now)).toEqual({ removed: [], bytes: 0, tempFiles: 0 });
    plantFile(join(store.dir, "tmp", "stale.part"), "八天前断掉的", daysAgo(8));
    plantFile(join(store.dir, "tmp", "fresh.part"), "正在传的", now);

    expect(await gcBlobs(store, now)).toEqual({
      removed: [],
      bytes: Buffer.byteLength("八天前断掉的"),
      tempFiles: 1,
    });
    expect(filesIn(store.dir)).toEqual(["tmp/fresh.part"]);
  });
});
