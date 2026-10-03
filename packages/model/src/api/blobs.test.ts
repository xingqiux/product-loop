import { describe, expect, it } from "vitest";
import { blobHashPattern, blobInfoSchema } from "./blobs.ts";

// 附件的接口：哈希的写法，和上传的结果。

const hash = "3b1f".repeat(16);

describe("附件的哈希", () => {
  it("只收六十四位小写十六进制", () => {
    expect(blobHashPattern.test(hash)).toBe(true);
    for (const text of [hash.toUpperCase(), hash.slice(1), `${hash}0`, "../etc/passwd"]) {
      expect(blobHashPattern.test(text)).toBe(false);
    }
  });
});

describe("上传的结果", () => {
  const info = {
    hash,
    contentType: "image/png",
    size: 12,
    width: 640,
    height: 480,
    stored: true,
  };

  it("写哈希、类型、字节数、宽高，和这次有没有写文件", () => {
    expect(blobInfoSchema.parse(info)).toEqual(info);
    expect(blobInfoSchema.parse({ ...info, width: null, height: null }).width).toBeNull();
  });

  it("哈希写错、多出字段，都拒绝", () => {
    expect(blobInfoSchema.safeParse({ ...info, hash: "abc" }).success).toBe(false);
    expect(blobInfoSchema.safeParse({ ...info, createdAt: "2026-09-28" }).success).toBe(false);
  });
});
