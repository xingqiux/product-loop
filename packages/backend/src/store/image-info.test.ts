import { describe, expect, it } from "vitest";
import { readImageInfo } from "./image-info.ts";

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const u32 = (n: number) => [...u16(Math.floor(n / 0x10000)), ...u16(n % 0x10000)];

/** PNG 的签名加 IHDR 块，校验码不看，填 0。 */
const pngHead = (width: number, height: number) =>
  Buffer.from([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...u32(13),
    ...Buffer.from("IHDR", "latin1"),
    ...u32(width),
    ...u32(height),
    ...[8, 6, 0, 0, 0],
    ...u32(0),
  ]);

/** JPEG 的一段：FF、标记、段长（含段长自己的两个字节）、内容。 */
const segment = (marker: number, payload: readonly number[]) => [
  0xff,
  marker,
  ...u16(payload.length + 2),
  ...payload,
];

/** 帧头：精度 8，接着高和宽，再是三个颜色分量。 */
const frame = (marker: number, width: number, height: number) =>
  segment(marker, [8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);

const soi = [0xff, 0xd8];
const jfif = segment(0xe0, [...Buffer.from("JFIF\0", "latin1"), 1, 1, 0, 0, 72, 0, 72, 0, 0]);

const gifHead = (version: string, width: number, height: number) =>
  Buffer.from([
    ...Buffer.from(version, "latin1"),
    width & 0xff,
    width >> 8,
    height & 0xff,
    height >> 8,
  ]);

describe("从文件头读图片信息", () => {
  it("PNG 从 IHDR 读宽和高", () => {
    expect(readImageInfo(pngHead(1440, 900))).toEqual({
      contentType: "image/png",
      width: 1440,
      height: 900,
    });
  });

  it("PNG 的文件头不全，或者宽是 0 时，认得出类型，宽高为空", () => {
    const expected = { contentType: "image/png", width: null, height: null };
    expect(readImageInfo(pngHead(1440, 900).subarray(0, 20))).toEqual(expected);
    expect(readImageInfo(pngHead(0, 900))).toEqual(expected);
  });

  it("JPEG 跳过前面的元数据段找到帧头，元数据有几十 KB 也能找到", () => {
    const exif = segment(0xe1, new Array<number>(60_000).fill(0));
    const quant = segment(0xdb, new Array<number>(65).fill(1));
    const head = Buffer.from([...soi, ...jfif, ...exif, ...quant, ...frame(0xc0, 1920, 1080)]);
    expect(readImageInfo(head)).toEqual({ contentType: "image/jpeg", width: 1920, height: 1080 });
  });

  it("JPEG 的渐进式帧头也认，哈夫曼表的段不当成帧头", () => {
    const huffman = segment(0xc4, new Array<number>(20).fill(0));
    const head = Buffer.from([...soi, ...huffman, ...frame(0xc2, 800, 600)]);
    expect(readImageInfo(head)).toEqual({ contentType: "image/jpeg", width: 800, height: 600 });
  });

  it("JPEG 标记前面多出的 FF 跳过", () => {
    const head = Buffer.from([...soi, ...jfif, 0xff, 0xff, ...frame(0xc0, 300, 170)]);
    expect(readImageInfo(head)).toEqual({ contentType: "image/jpeg", width: 300, height: 170 });
  });

  it.each<[string, number[]]>([
    ["图像数据开始前没有帧头", [...soi, ...jfif, ...segment(0xda, [1, 1, 0, 0, 0x3f, 0])]],
    ["帧头被截断", [...soi, ...jfif, ...frame(0xc0, 300, 170).slice(0, 6)]],
    ["段的开头不是 FF", [...soi, ...jfif, 0x00, 0xe0, 0x00, 0x10]],
  ])("JPEG %s时，认得出类型，宽高为空", (_, bytes) => {
    expect(readImageInfo(Buffer.from(bytes))).toEqual({
      contentType: "image/jpeg",
      width: null,
      height: null,
    });
  });

  it.each(["GIF87a", "GIF89a"])("%s 读宽和高，低位在前", (version) => {
    expect(readImageInfo(gifHead(version, 500, 260))).toEqual({
      contentType: "image/gif",
      width: 500,
      height: 260,
    });
  });

  it.each<[string, Buffer]>([
    ["空的", Buffer.alloc(0)],
    ["文字", Buffer.from("<!doctype html><title>x</title>")],
    ["不认识的 GIF 版本", gifHead("GIF88a", 500, 260)],
    ["只有 PNG 签名的前半", pngHead(1, 1).subarray(0, 4)],
  ])("%s不是图片，返回 undefined", (_, head) => {
    expect(readImageInfo(head)).toBeUndefined();
  });
});
