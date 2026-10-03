import { describe, expect, it } from "vitest";
import {
  type ChangedFile,
  isDependencyFile,
  measureDiff,
  type ReviewThreshold,
} from "./threshold.ts";

// 评审界线（决定 173）：不超过六十行、三个文件，并且不改数据格式、不加依赖。数字取 config.json 的默认值。

const threshold: ReviewThreshold = {
  lines: 60,
  files: 3,
  dataFormatPaths: ["packages/backend/drizzle/**", "**/*.schema.json"],
};

const file = (path: string, added: number, deleted = 0, root = "/work/app"): ChangedFile => ({
  root,
  path,
  added,
  deleted,
});

describe("评审界线", () => {
  it("六十行、三个文件以内，不改数据格式、不加依赖，可以跳过评审", () => {
    const diff = measureDiff(
      [file("src/a.ts", 30, 10), file("src/b.ts", 15), file("src/c.ts", 0, 5)],
      threshold,
    );
    expect(diff).toEqual({
      lines: 60,
      files: 3,
      dependencyFiles: [],
      dataFormatFiles: [],
      maxLines: 60,
      maxFiles: 3,
      within: true,
    });
  });

  it("行数按增加和删除相加，六十一行就超过了", () => {
    expect(measureDiff([file("src/a.ts", 31, 30)], threshold)).toMatchObject({
      lines: 61,
      within: false,
    });
  });

  it("四个文件就超过了。几个根目录的文件合在一起算", () => {
    const diff = measureDiff(
      [
        file("src/a.ts", 1),
        file("src/b.ts", 1),
        file("src/c.ts", 1),
        file("src/a.ts", 1, 0, "/work/app-review"),
      ],
      threshold,
    );
    expect(diff).toMatchObject({ lines: 4, files: 4, within: false });
  });

  it("同一个根目录的同一个文件交了两次，只算一次", () => {
    expect(measureDiff([file("src/a.ts", 5), file("src/a.ts", 5)], threshold)).toMatchObject({
      lines: 5,
      files: 1,
      within: true,
    });
  });

  it("改了依赖清单或锁文件，一行也算加了依赖", () => {
    const diff = measureDiff([file("packages/cli/package.json", 1)], threshold);
    expect(diff).toMatchObject({
      dependencyFiles: ["/work/app/packages/cli/package.json"],
      within: false,
    });
  });

  it("改动命中数据格式的路径，就算改了数据格式", () => {
    const diff = measureDiff(
      [file("packages/backend/drizzle/0008_land.sql", 3), file("design/page.schema.json", 1)],
      threshold,
    );
    expect(diff).toMatchObject({
      dataFormatFiles: [
        "/work/app/packages/backend/drizzle/0008_land.sql",
        "/work/app/design/page.schema.json",
      ],
      within: false,
    });
  });

  it("没配数据格式的路径时，不算改数据格式", () => {
    const none = { ...threshold, dataFormatPaths: [] };
    expect(measureDiff([file("packages/backend/drizzle/0008_land.sql", 3)], none).within).toBe(
      true,
    );
  });

  it("界线改了以后按新的数字算", () => {
    const loose = { ...threshold, lines: 100, files: 5 };
    expect(measureDiff([file("src/a.ts", 90)], loose)).toMatchObject({
      maxLines: 100,
      maxFiles: 5,
      within: true,
    });
  });

  it.each([
    ["package.json", true],
    ["pnpm-lock.yaml", true],
    ["services/api/go.sum", true],
    ["requirements-dev.txt", true],
    ["Cargo.lock", true],
    ["src/package.ts", false],
    ["docs/requirements.md", false],
  ])("%s 是不是依赖清单或锁文件：%s", (path, expected) => {
    expect(isDependencyFile(path)).toBe(expected);
  });
});
