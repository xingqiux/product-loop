import { describe, expect, it } from "vitest";
import { tarEnd, tarFileHeader, tarPadding } from "./tar.ts";

// tar 的头：扩展头写路径，长度按字节算；普通头的校验和按规定算。

const text = (bytes: Uint8Array, start: number, length: number) =>
  Buffer.from(bytes.subarray(start, start + length))
    .toString("utf8")
    .replace(/\0.*$/su, "");

describe("tar 的头", () => {
  it("扩展头里写完整的中文路径，记录的长度按字节算", () => {
    const path = "walk/2026-09-20/看板.json";
    const header = tarFileHeader(path, 5);
    expect(header.byteLength).toBe(512 * 3);
    const size = Number.parseInt(text(header, 124, 12), 8);
    const record = Buffer.from(header.subarray(512, 512 + size)).toString("utf8");
    expect(record).toBe(`${size} path=${path}\n`);
    expect(Buffer.byteLength(record)).toBe(size);
    expect(text(header, 1024, 100)).toBe("file");
    expect(Number.parseInt(text(header, 1024 + 124, 12), 8)).toBe(5);
  });

  it("校验和等于头里各字节之和，校验和一格按空格算", () => {
    const header = tarFileHeader("a.txt", 3).subarray(1024);
    const stored = Number.parseInt(text(header, 148, 8), 8);
    const copy = Uint8Array.from(header);
    copy.fill(0x20, 148, 156);
    expect(copy.reduce((sum, byte) => sum + byte, 0)).toBe(stored);
  });

  it("补齐到 512 的整数倍，结尾两个全 0 的块", () => {
    expect(tarPadding(5).byteLength).toBe(507);
    expect(tarPadding(512).byteLength).toBe(0);
    expect(tarEnd().every((byte) => byte === 0)).toBe(true);
  });
});
