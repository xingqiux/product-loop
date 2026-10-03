// 把后端打成一个 ES 模块文件，JS 依赖全部打进去；better-sqlite3 的原生文件和迁移文件夹复制到同一个目录。
// 打完以后 dist/ 就是一个完整的运行目录，复制到别处（没有 node_modules）也能跑。
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'tsdown';

const require = createRequire(import.meta.url);
const betterSqlite3Dir = dirname(require.resolve('better-sqlite3/package.json'));
const nativeFile = `${process.platform}-${process.arch}.node`;

export default defineConfig({
  entry: { 'ploop-backend': 'src/main.ts' },
  platform: 'node',
  target: 'node24',
  format: 'esm',
  fixedExtension: true, // 输出 .mjs，运行目录里不需要 package.json 的 "type": "module"
  dts: false,
  deps: {
    // tsdown 默认把 package.json 的 dependencies 当成外部依赖，不打进去；这里要求全部打进去
    alwaysBundle: [/^(hono|@hono\/node-server|better-sqlite3|drizzle-orm)(\/|$)/],
    // 只允许这几个包进包；多出别的包时构建失败，防止无意中打进去
    onlyBundle: ['hono', '@hono/node-server', 'better-sqlite3', 'drizzle-orm'],
    // 输出只准引入 Node 自带的模块；引入任何别的包时构建失败（只查 import，不查 require）
    onlyImport: [],
  },
  copy: [{ from: join(betterSqlite3Dir, 'prebuilds', nativeFile) }, { from: 'drizzle' }],
});
