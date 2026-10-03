import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { allEnums } from "./names.ts";
import { terms } from "./terms.ts";
import { renderTermsDoc } from "./terms-doc.ts";

const file = new URL("../../../docs/术语对照.md", import.meta.url);

describe("docs/术语对照.md", () => {
  it("和 terms.ts、names.ts 生成的结果逐字相同", () => {
    const hint = "改了术语或名称表以后，运行 pnpm --filter @product-loop/model terms-doc 重新生成";
    expect(readFileSync(file, "utf8"), hint).toBe(renderTermsDoc());
  });

  it("每个术语、每个名称表的每个取值都写进去了", () => {
    const doc = renderTermsDoc();
    for (const t of terms) expect(doc).toContain(`| ${t.term} | \`${t.code}\` |`);
    for (const [name, def] of Object.entries(allEnums)) {
      expect(doc).toContain(`### \`${name}\``);
      for (const [key, label] of Object.entries(def.table)) {
        expect(doc).toContain(`| ${label} | \`${key}\` |`);
      }
    }
  });
});
