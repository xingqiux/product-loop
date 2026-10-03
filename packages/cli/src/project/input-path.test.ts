import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { locateInput } from "./input-path.ts";
import { tempRoot } from "./testing.ts";

describe("命令里写的文件路径", () => {
  const setup = () => {
    const root = tempRoot();
    const cache = join(root, ".product-loop");
    mkdirSync(join(cache, "rounds", "v1-检查-1"), { recursive: true });
    writeFileSync(join(cache, "rounds", "v1-检查-1", "page.json"), "{}");
    return { root, cache };
  };

  it("当前目录里有就用当前目录的，没有再找项目缓存", async () => {
    const { root, cache } = setup();
    const inCache = join(cache, "rounds", "v1-检查-1", "page.json");
    expect(await locateInput(root, cache, "rounds/v1-检查-1/page.json")).toEqual({
      path: inCache,
      tried: [join(root, "rounds/v1-检查-1/page.json"), inCache],
    });
    writeFileSync(join(root, "page.json"), "{}");
    expect((await locateInput(root, cache, "page.json")).path).toBe(join(root, "page.json"));
  });

  it("都找不到时，交回相对当前目录的那个，并写出试过的两个位置", async () => {
    const { root, cache } = setup();
    const located = await locateInput(root, cache, "rounds/v9-检查-9/page.json");
    expect(located.path).toBe(join(root, "rounds/v9-检查-9/page.json"));
    expect(located.tried).toEqual([located.path, join(cache, "rounds/v9-检查-9/page.json")]);
  });

  it("绝对路径和没有项目缓存时，只有一个位置", async () => {
    const { root, cache } = setup();
    expect((await locateInput(root, cache, join(root, "x.json"))).tried).toEqual([
      join(root, "x.json"),
    ]);
    expect((await locateInput(root, undefined, "x.json")).tried).toEqual([join(root, "x.json")]);
  });
});
