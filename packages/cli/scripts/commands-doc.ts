// 重新生成 docs/命令参考.md。在仓库根目录运行 pnpm --filter @product-loop/cli commands-doc。
import { writeFileSync } from "node:fs";
import { commandEntries, renderCommandReference } from "../src/command-reference.ts";

const file = new URL("../../../docs/命令参考.md", import.meta.url);
writeFileSync(file, renderCommandReference(commandEntries()));
