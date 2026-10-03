import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Db } from "../db.ts";
import { openTempDatabase, sqliteError, tempHome } from "../testing.ts";
import { type BlobHash, type BlobReferrerKind, blobRefs, blobs } from "./blobs.ts";

const at = new Date("2026-09-28T08:00:00Z");
const hash = "ab".repeat(32) as BlobHash;

const blob = {
  hash,
  contentType: "image/png",
  size: 3,
  createdAt: at,
  firstSource: "cli/test",
};

const ref = (referrerKind: BlobReferrerKind = "page") => ({
  blobHash: hash,
  referrerKind,
  referrerId: "12",
  purpose: "img",
});

async function openDb(): Promise<Db> {
  return (await openTempDatabase(tempHome())).db;
}

describe("附件表和附件引用表", () => {
  it("引用要指向登记过的附件，有引用的附件删不掉", async () => {
    const db = await openDb();
    expect(sqliteError(() => db.insert(blobRefs).values(ref()).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
    db.insert(blobs).values(blob).run();
    db.insert(blobRefs).values(ref()).run();
    expect(sqliteError(() => db.delete(blobs).where(eq(blobs.hash, hash)).run())).toBe(
      "FOREIGN KEY constraint failed",
    );
  });

  it("同一个引用者按同一个用途引用同一个附件，只有一行", async () => {
    const db = await openDb();
    db.insert(blobs).values(blob).run();
    db.insert(blobRefs).values(ref()).run();
    db.insert(blobRefs)
      .values({ ...ref(), purpose: "snapshot" })
      .run();
    expect(sqliteError(() => db.insert(blobRefs).values(ref()).run())).toBe(
      "UNIQUE constraint failed: blob_refs.referrer_kind, blob_refs.referrer_id, blob_refs.purpose, blob_refs.blob_hash",
    );
  });

  it.each(["页面", "pages"])("引用者的种类写成 %s 时被检查约束拒绝", async (bad) => {
    const db = await openDb();
    db.insert(blobs).values(blob).run();
    expect(
      sqliteError(() =>
        db
          .insert(blobRefs)
          .values(ref(bad as BlobReferrerKind))
          .run(),
      ),
    ).toBe("CHECK constraint failed: blob_refs_referrer_kind_enum");
  });
});
