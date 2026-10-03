import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { streamEventNames, streamEventOf } from "./events.ts";

/** 后端源码里记事件时写的全部种类。 */
function kindsInBackend(): string[] {
  const root = new URL("../../../backend/src/", import.meta.url).pathname;
  const kinds = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".ts") && !entry.name.includes(".test.")) {
        for (const m of readFileSync(path, "utf8").matchAll(/kind: "([a-zA-Z]+\.[a-zA-Z]+)"/gu)) {
          if (m[1] !== undefined) kinds.add(m[1]);
        }
      }
    }
  };
  walk(root);
  return [...kinds].sort();
}

describe("事件流按前缀归类", () => {
  it("和事件流同名的种类原样发", () => {
    for (const name of streamEventNames) expect(streamEventOf(name)).toBe(name);
  });

  it("同一类对象的细分种类归到一个事件", () => {
    expect(streamEventOf("decision.voided")).toBe("decision.changed");
    expect(streamEventOf("queue.moved")).toBe("queue.changed");
    expect(streamEventOf("skillIssue.updated")).toBe("issue.changed");
    expect(streamEventOf("root.added")).toBe("project.changed");
  });

  it("后端记的每一种事件都有去处", () => {
    const kinds = kindsInBackend();
    expect(kinds.length).toBeGreaterThan(20);
    expect(kinds.filter((kind) => streamEventOf(kind) === undefined)).toEqual([]);
  });

  it("认不出的种类不发", () => {
    expect(streamEventOf("unknown.thing")).toBeUndefined();
    expect(streamEventOf("")).toBeUndefined();
  });
});
