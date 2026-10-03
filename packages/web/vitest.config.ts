// 工作台的单元测试不经过 vite.config.ts 的插件：不生成路由树，也不处理样式。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("src", import.meta.url)) } },
  test: { name: "web" },
});
