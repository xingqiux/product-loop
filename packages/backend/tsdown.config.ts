// 把后端打成一个 ES 模块文件 backend.mjs，见「02 技术选型」第十五节和第一期计划第 15 步。
// JS 依赖全部打进去。better-sqlite3 的原生文件和迁移文件夹 drizzle/ 复制到同一个目录。
// 输出目录和构建号由根目录的 scripts/build.ts 经环境变量给出，命令行的包也打进同一个构建号。
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);
const betterSqlite3Dir = dirname(require.resolve("better-sqlite3/package.json"));
const nativeFile = `${process.platform}-${process.arch}.node`;
const outDir = process.env.PLOOP_APP_DIR ?? "dist/app";

export default defineConfig({
  entry: { backend: "src/main.ts" },
  platform: "node",
  target: "node24",
  format: "esm",
  // 输出 .mjs，运行目录里不需要 package.json 的 "type": "module"。
  fixedExtension: true,
  dts: false,
  outDir,
  clean: false,
  define: { PLOOP_BUILD: JSON.stringify(process.env.PLOOP_BUILD ?? "dev") },
  deps: {
    // 默认把 dependencies 当外部依赖，这里要求全部打进去。
    alwaysBundle: [/./u],
    // 输出只准引入 Node 自带的模块，引入别的包时构建失败。
    onlyImport: [],
  },
  copy: [
    { from: join(betterSqlite3Dir, "prebuilds", nativeFile), to: outDir },
    { from: "drizzle", to: outDir },
  ],
});
