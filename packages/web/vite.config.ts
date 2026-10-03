// 工作台的构建，见「02 技术选型」第十节。
// 构建结果默认放进 dist/，scripts/build.ts 用 PLOOP_WEB_OUT 指到运行目录的 web/。
// 开发时 vite 把 /api 转给本机的后端，端口由 PLOOP_PORT 给，默认和后端相同。
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const src = fileURLToPath(new URL("src", import.meta.url));
const require = createRequire(import.meta.url);

// 字体用 SIL Open Font License，随软件分发时要附上许可文本，见「02 技术选型」第十一节。
const fonts = ["inter", "noto-sans-sc", "jetbrains-mono"];

function fontLicenses(): Plugin {
  return {
    name: "font-licenses",
    generateBundle() {
      for (const font of fonts) {
        const license = require.resolve(`@fontsource-variable/${font}/LICENSE`);
        this.emitFile({
          type: "asset",
          fileName: `licenses/${font}.txt`,
          source: readFileSync(license, "utf8"),
        });
      }
    },
  };
}

const backend = `http://127.0.0.1:${process.env.PLOOP_PORT ?? "4731"}`;

export default defineConfig({
  plugins: [
    // 路由插件排在 react() 前面：它先生成 routeTree.gen.ts，再把每个路由的组件拆成单独的块。
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    fontLicenses(),
  ],
  resolve: { alias: { "@": src } },
  // 写死一个空的 PostCSS 配置，免得 Vite 往上找别处的配置文件。
  css: { postcss: {} },
  build: {
    outDir: process.env.PLOOP_WEB_OUT ?? "dist",
    emptyOutDir: true,
    // 共用定义整个打进来，主脚本约六百千字节。工作台从本机加载，体积的要求见第 23 步。
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      // 后端只收自己页面发来的写请求，开发时把来源改成后端的地址。
      "/api": {
        target: backend,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (request) => {
            if (request.getHeader("origin") !== undefined) request.setHeader("origin", backend);
          });
        },
      },
    },
  },
});
