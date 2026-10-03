// 依次运行三项验证，最后按项打印通过或不通过。任何一项不通过，退出码为 1。
// 用法：node scripts/verify.ts（或 pnpm verify）。每一项也能单独跑，见汇总里的命令。
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/util.ts';

if (!existsSync(join(ROOT, 'node_modules')) || !existsSync(join(ROOT, 'packages/bundle/node_modules'))) {
  console.error('还没有安装依赖。先在 spikes/backend 里运行：npx -y pnpm@11.27.1 install');
  process.exit(1);
}

const items = [
  { no: '一', title: 'Hono 的类型化客户端跨包使用', file: 'verify-rpc.ts' },
  { no: '二', title: 'commander 的中文帮助对齐', file: 'verify-cli.ts' },
  { no: '三', title: 'tsdown 打包的后端用 nativeBinding 加载原生文件', file: 'verify-bundle.ts' },
];

const results = items.map((item) => {
  const started = performance.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', item.file)], { cwd: ROOT, stdio: 'inherit' });
  return { ...item, pass: r.status === 0, seconds: (performance.now() - started) / 1000 };
});

console.log(`\n${'='.repeat(8)} 汇总 ${'='.repeat(8)}`);
for (const r of results) {
  console.log(`  [${r.pass ? '通过' : '不通过'}] ${r.no}、${r.title}（${r.seconds.toFixed(1)} 秒；单独重跑：node scripts/${r.file}）`);
}
const allPass = results.every((r) => r.pass);
console.log(allPass ? '\n三项全部通过。' : '\n有不通过的项，往上翻看它的输出。');
process.exit(allPass ? 0 : 1);
