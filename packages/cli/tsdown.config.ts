// 把命令行打成一个 ES 模块文件 ploop.mjs，见「02 技术选型」第十五节和第一期计划第 15 步。
// 命令行没有原生模块，依赖全部打进去。它和后端的 backend.mjs 放在同一个目录，
// 拉起后端时找入口旁边的 backend.mjs，见 connect.ts 的 backendEntry。
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { ploop: "src/main.ts" },
  platform: "node",
  target: "node24",
  format: "esm",
  fixedExtension: true,
  dts: false,
  outDir: process.env.PLOOP_APP_DIR ?? "dist/app",
  clean: false,
  define: { PLOOP_BUILD: JSON.stringify(process.env.PLOOP_BUILD ?? "dev") },
  deps: {
    alwaysBundle: [/./u],
    onlyImport: [],
  },
});
