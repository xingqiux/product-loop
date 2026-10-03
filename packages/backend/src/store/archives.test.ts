import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeArchive, sha256 } from "./archive-testing.ts";
import { checkArchive, readArchive, receiveArchive } from "./archives.ts";
import { tempDir } from "./testing.ts";

// 归档包：收包时核对整个包的哈希，读包时逐个核对清单，见「08 版本与迁移」第四节。

const files = [
  { path: "主线.md", data: "# 主线\n" },
  {
    path: `walk/2026-09-20/${"很长的文件名".repeat(12)}.json`,
    data: '{"stage":"think"}',
  },
  { path: "walk/2026-09-20/shot.png", data: new Uint8Array([1, 2, 3, 0, 255]) },
];

async function* chunks(data: Buffer) {
  for (let at = 0; at < data.byteLength; at += 7) yield data.subarray(at, at + 7);
}

describe("归档包", () => {
  it("收下的包哈希对上，读出的每个文件和清单相同，中文长路径不截断", async () => {
    const dir = tempDir("ploop-archive-");
    const archive = makeArchive(files);
    const received = await receiveArchive(dir, "app.tar.gz", chunks(archive), sha256(archive));
    expect(received).toEqual({
      ok: true,
      value: { file: "app.tar.gz", sha256: sha256(archive), bytes: archive.byteLength },
    });
    const contents = await readArchive(join(dir, "app.tar.gz"));
    expect(contents.files.map((entry) => entry.path)).toEqual(files.map((file) => file.path));
    expect(checkArchive(contents)).toEqual([]);
  });

  it("包的哈希对不上时不留文件", async () => {
    const dir = tempDir("ploop-archive-");
    const archive = makeArchive(files);
    const received = await receiveArchive(dir, "app.tar.gz", chunks(archive), "0".repeat(64));
    expect(received.ok).toBe(false);
    await expect(readArchive(join(dir, "app.tar.gz"))).rejects.toThrow();
  });

  it("清单和文件对不上时逐个列出：少了、多了、改了", async () => {
    const dir = tempDir("ploop-archive-");
    const listed = [
      { path: "主线.md", size: 1, sha256: "a".repeat(64) },
      { path: "决定.md", size: 1, sha256: "b".repeat(64) },
    ];
    const archive = makeArchive(files.slice(0, 2), listed);
    writeFileSync(join(dir, "bad.tar.gz"), archive);
    const issues = checkArchive(await readArchive(join(dir, "bad.tar.gz")));
    expect(issues).toEqual([
      { kind: "changed", path: "主线.md" },
      { kind: "missing", path: "决定.md" },
      { kind: "extra", path: files[1]?.path },
    ]);
  });
});
