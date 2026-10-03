import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    // 路由插件必须排在 react() 前面：它先生成 src/routeTree.gen.ts，并把每个路由的组件拆成单独的块。
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  // 写死一个空的 PostCSS 配置，免得 Vite 往上找到仓库根目录的配置文件（这个文件夹要自成一体）。
  css: { postcss: {} },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' },
})
