import { readFileSync } from "node:fs";
import { stage } from "@product-loop/model";
import { hc, type InferRequestType } from "hono/client";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { AppType } from "../../index.ts";
import { dataOf, errorOf, testApp } from "../testing.ts";

// 页面数据的 JSON Schema，见「05 接口」第一节。接口给出的要和第 21 步的快照逐字相同。
// 快照在 model 的 page/__snapshots__/stages.test.ts.snap，由 Vitest 按它的格式写成。
// 这里把接口给出的 JSON 按同样的格式写出来，和快照里那一段比。

const snapshotFile = new URL(
  "../../../../model/src/page/__snapshots__/stages.test.ts.snap",
  import.meta.url,
);

/** 快照文件里的每一段，按测试的名字取。反引号、反斜杠和 ${ 在文件里多转义了一层。 */
function snapshots(): ReadonlyMap<string, string> {
  const text = readFileSync(snapshotFile, "utf8");
  const entries = [...text.matchAll(/^exports\[`(.+?)`\] = `\n([\s\S]*?)\n`;$/gmu)];
  return new Map(
    entries.map(([, name = "", body = ""]) => [name, body.replace(/\\(`|\\|\$\{)/gu, "$1")]),
  );
}

/**
 * 按 Vitest 快照的格式写出 JSON：键按字典序，每项后面带逗号，缩进两格，文字不转义。
 * JSON Schema 里只有对象、数组、文字、数字和布尔值，只写这几种。
 */
function pretty(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((item) => `${inner}${pretty(item, inner)},\n`).join("");
    return `[\n${items}${indent}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(record).sort();
    if (keys.length === 0) return "{}";
    const items = keys.map((key) => `${inner}"${key}": ${pretty(record[key], inner)},\n`).join("");
    return `{\n${items}${indent}}`;
  }
  return typeof value === "string" ? `"${value}"` : String(value);
}

describe("GET /schema/page", () => {
  it.each(stage.keys.map((key) => stage.label(key)))(
    "%s阶段：和第 21 步的快照逐字相同",
    async (label) => {
      const t = await testApp();
      const res = await t.request("GET", `/api/v1/schema/page?stage=${encodeURIComponent(label)}`);
      expect(res.status).toBe(200);
      const expected = snapshots().get(`${label}阶段的 JSON Schema > 导出的样子 1`);
      expect(expected).toBeDefined();
      expect(pretty(dataOf(res))).toBe(expected);
    },
  );

  it("阶段写英文键或者没写，返回 BAD_REQUEST，位置写 stage", async () => {
    const t = await testApp();
    for (const path of ["/api/v1/schema/page?stage=check", "/api/v1/schema/page"]) {
      const res = await t.request("GET", path);
      expect(res.status).toBe(400);
      expect(errorOf(res).where).toBe("stage");
    }
  });

  it("类型化客户端里，阶段写中文", () => {
    const client = hc<AppType>("http://127.0.0.1:4731");
    type Stage = InferRequestType<typeof client.api.v1.schema.page.$get>["query"]["stage"];
    expectTypeOf<Stage>().toEqualTypeOf<"构思" | "使用" | "检查" | "落地" | "提升">();
  });
});
