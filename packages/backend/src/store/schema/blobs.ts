import { defineEnum, type KeyOf } from "@product-loop/model";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { enumCheck, enumText } from "./enum.ts";

// 附件和附件引用，字段见「03 数据模型」第二节。文件本身按哈希放在 blobs/ 下，见 store/blobs.ts。

declare const blobHashBrand: unique symbol;

/**
 * 附件的哈希：内容的 SHA-256，写成六十四位小写十六进制。
 * 哈希也是文件名，所以只由 parseBlobHash 核对后产生。别处的字符串不能直接拿来用。
 */
export type BlobHash = string & { readonly [blobHashBrand]: true };

/**
 * 引用附件的对象。取值是「03 数据模型」第二节里带图或文件的几种。
 * 迁移时旧的截图和事实文件挂在阶段上，见「08 版本与迁移」第五节。
 */
export const blobReferrerKind = defineEnum({
  page: "页面",
  draft: "草稿",
  replyLine: "回复的一行",
  useStep: "使用步骤",
  screen: "屏",
  round: "阶段",
});
export type BlobReferrerKind = KeyOf<typeof blobReferrerKind>;

/** 附件：一个文件，按内容的哈希存放。同一份内容只有一行。 */
export const blobs = sqliteTable("blobs", {
  hash: text().$type<BlobHash>().primaryKey(),
  /** 类型，只记 type/subtype，例如 image/png。认得出的图片以文件头为准。 */
  contentType: text().notNull(),
  /** 字节数。 */
  size: integer().notNull(),
  /** 图片的宽和高，单位是像素。不是图片或读不出来时为空。 */
  width: integer(),
  height: integer(),
  /** 存下的时间，gc 的七天从这里算。没有引用的附件再次上传时，改成那一次的时间。 */
  createdAt: integer({ mode: "timestamp_ms" }).notNull(),
  /** 最早的来源：第一次上传时写的，例如客户端和文件路径。再次上传不改。 */
  firstSource: text().notNull(),
});

/**
 * 附件引用：谁用到了这个附件。有引用的附件 gc 不删。
 * 引用和引用它的数据在同一个事务里写入，见「03 数据模型」第六节。
 */
export const blobRefs = sqliteTable(
  "blob_refs",
  {
    blobHash: text()
      .$type<BlobHash>()
      .notNull()
      .references(() => blobs.hash),
    referrerKind: enumText(blobReferrerKind).notNull(),
    /** 引用者的编号。页面、轮次这类整数编号也写成文字。 */
    referrerId: text().notNull(),
    /** 用途，由引用的一方写一个英文短词，例如 img、snapshot。 */
    purpose: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.referrerKind, t.referrerId, t.purpose, t.blobHash] }),
    // gc 按附件查有没有引用。
    index("blob_refs_blob_hash").on(t.blobHash),
    enumCheck(t.referrerKind, blobReferrerKind),
  ],
);
