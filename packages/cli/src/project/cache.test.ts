import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderDecisionDoc } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { writeDecisionDoc, writeProjectCache, writeProjectIdentity } from "./cache.ts";
import { readProjectIdentity } from "./identity.ts";
import { identity, tempRoot } from "./testing.ts";

describe("建项目缓存", () => {
  it("写好的 project.json 读得回来，旁边有 README.md", async () => {
    const root = tempRoot();
    const dir = await writeProjectCache(root, identity);
    expect(dir).toBe(join(root, ".product-loop"));
    expect(await readProjectIdentity(join(dir, "project.json"))).toEqual({
      ok: true,
      value: identity,
    });
    expect(readFileSync(join(dir, "README.md"), "utf8")).toContain("project.json");
  });

  it("主线的基准一起写进去", async () => {
    const root = tempRoot();
    const mainlineBase = { revision: 3, hash: "a".repeat(64) };
    const dir = await writeProjectCache(root, { ...identity, mainlineBase });
    expect(JSON.parse(readFileSync(join(dir, "project.json"), "utf8"))).toEqual({
      ...identity,
      mainlineBase,
    });
  });

  it("身份不合定义时不写，抛出程序的错误", async () => {
    const root = tempRoot();
    await expect(writeProjectCache(root, { ...identity, projectId: "App" })).rejects.toThrow();
    expect(existsSync(join(root, ".product-loop", "project.json"))).toBe(false);
  });
});

describe("只改 project.json", () => {
  it("写进新的基准，不动 README.md", async () => {
    const root = tempRoot();
    const dir = await writeProjectCache(root, identity);
    writeFileSync(join(dir, "README.md"), "手改过");
    const mainlineBase = { revision: 2, hash: "b".repeat(64) };
    await writeProjectIdentity(root, { ...identity, mainlineBase });
    expect(JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).mainlineBase).toEqual(
      mainlineBase,
    );
    expect(readFileSync(join(dir, "README.md"), "utf8")).toBe("手改过");
  });
});

describe("重写决定.md", () => {
  it("按传进来的决定整份重写，原来的内容不留", async () => {
    const root = tempRoot();
    const dir = join(root, ".product-loop");
    mkdirSync(dir);
    writeFileSync(join(dir, "决定.md"), "手写的一行\n");
    const decisions = [
      {
        id: 1,
        kind: "decision" as const,
        decision: "队列看板默认按阶段分列",
        reason: "用户按阶段找事",
        case: "v1-构思-1 第 3 行",
        date: "2026-09-28",
        status: "active" as const,
      },
    ];
    const file = await writeDecisionDoc(root, decisions);
    expect(file).toBe(join(dir, "决定.md"));
    expect(readFileSync(file, "utf8")).toBe(renderDecisionDoc(decisions));
  });
});
