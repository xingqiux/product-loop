// 重新生成 docs/术语对照.md。在仓库根目录运行 pnpm --filter @product-loop/model terms-doc。
import { writeFileSync } from "node:fs";
import { renderTermsDoc } from "../src/terms-doc.ts";

const file = new URL("../../../docs/术语对照.md", import.meta.url);
writeFileSync(file, renderTermsDoc());
