// 重新生成 docs/维护说明.md 里的规则表，表前后的文字不动。
// 在仓库根目录运行 pnpm --filter @product-loop/model rules-doc。
import { readFileSync, writeFileSync } from "node:fs";
import { backendRules } from "../src/rules/backend.ts";
import { renderRuleTables, tablesEnd, tablesStart, withRuleTables } from "../src/rules/doc.ts";
import { allRules, pendingRules } from "../src/rules/registry.ts";

const file = new URL("../../../docs/维护说明.md", import.meta.url);
const updated = withRuleTables(
  readFileSync(file, "utf8"),
  renderRuleTables(allRules(), backendRules(), pendingRules),
);
if (updated === undefined) {
  console.error(`维护说明里要各有一行 ${tablesStart} 和 ${tablesEnd}，前一行在前。`);
  process.exit(1);
}
writeFileSync(file, updated);
