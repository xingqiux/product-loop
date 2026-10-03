import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureHome, homePaths } from "./home.ts";
import { tempDir } from "./testing.ts";

describe("集中存储的目录", () => {
  it("数据库在 data/ 下，config.json 在根上", () => {
    const paths = homePaths("/h");
    expect(paths.database).toBe("/h/data/ploop.db");
    expect(paths.config).toBe("/h/config.json");
    expect(paths.dirs.backups).toBe("/h/backups");
  });

  it("ensureHome 建好每个目录，再运行一次也不出错，不建 config.json", () => {
    const paths = homePaths(join(tempDir("ploop-ensure-"), "home"));
    ensureHome(paths);
    ensureHome(paths);
    for (const dir of Object.values(paths.dirs)) {
      expect(statSync(dir).isDirectory()).toBe(true);
    }
    expect(Object.keys(paths.dirs)).toEqual([
      "data",
      "blobs",
      "backups",
      "archives",
      "exports",
      "run",
      "logs",
      "app",
    ]);
    expect(existsSync(paths.config)).toBe(false);
  });
});
