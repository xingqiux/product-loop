// 第三项：tsdown 把一个小后端（Hono + better-sqlite3 + Drizzle）打成一个 ES 模块文件，
// 原生文件复制到旁边，用 better-sqlite3 的 nativeBinding 选项加载；复制到没有 node_modules 的临时目录里运行。
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { bin, ROOT, Report, run, startServer } from './lib/util.ts';

const r = new Report('三、tsdown 打包的后端用 nativeBinding 加载原生文件');
const pkgDir = join(ROOT, 'packages/bundle');
const dist = join(pkgDir, 'dist');
const bundleName = 'ploop-backend.mjs';
const nativeFile = `${process.platform}-${process.arch}.node`;
const keep = process.env.KEEP_RUN_DIR === '1';

r.section('版本');
const readVersion = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
const version = (name: string) => readVersion(join(pkgDir, 'node_modules', name, 'package.json'));
// pnpm 把 tsdown 自己的依赖放在它真实路径的旁边
const tsdownReal = realpathSync(join(pkgDir, 'node_modules', 'tsdown'));
r.evidence(
  [
    `tsdown ${version('tsdown')}（rolldown ${readVersion(join(tsdownReal, '..', 'rolldown', 'package.json'))}）`,
    `better-sqlite3 ${version('better-sqlite3')}，drizzle-orm ${version('drizzle-orm')}，drizzle-kit ${version('drizzle-kit')}`,
    `hono ${version('hono')}，@hono/node-server ${version('@hono/node-server')}，node ${process.version}`,
  ].join('\n'),
);

r.section('构建：tsdown（配置见 packages/bundle/tsdown.config.ts）');
const build = run(bin('tsdown', pkgDir), [], { cwd: pkgDir });
r.evidence(build.output.split('\n').filter((l) => /dist\/|files|Build|error|warn/i.test(l)).join('\n'));
r.check('tsdown 构建成功（deps.onlyBundle 和 deps.onlyImport 的检查都在构建时做了）', build.code === 0, build.output);

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
const files = build.code === 0 ? listFiles(dist) : [];
r.evidence(
  `dist/（就是运行目录）：\n${files.map((f) => `  ${f}  ${(statSync(join(dist, f)).size / 1024).toFixed(1)} KB`).join('\n')}`,
);
const jsFiles = files.filter((f) => /\.(m?js|cjs)$/.test(f));
r.check(
  `只有一个 JS 文件 ${bundleName}，旁边是 ${nativeFile} 和 drizzle/ 迁移`,
  jsFiles.length === 1 && jsFiles[0] === bundleName && files.includes(nativeFile) && files.includes(join('drizzle', 'meta', '_journal.json')),
);

const code = build.code === 0 ? readFileSync(join(dist, bundleName), 'utf8') : '';
const imported = [
  ...[...code.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*["']([^"']+)["']/gm)].map((m) => m[1]),
  ...[...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
];
const required = [...code.matchAll(/\b__require\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
const outside = [...imported, ...required].filter((s): s is string => !!s && !isBuiltin(s));
r.evidence(
  `静态引入：${[...new Set(imported)].join('、')}\n` +
    `CJS 的 require（rolldown 换成了 createRequire(import.meta.url) 得到的 __require）：${[...new Set(required)].join('、')}`,
);
r.check('打出的文件只引入 Node 自带的模块（import 和 require 都查了）', code !== '' && outside.length === 0, outside.join('\n'));

r.section('运行：复制到临时目录，没有 node_modules');
const runDir = mkdtempSync(join(tmpdir(), 'ploop-spike-run-'));
cpSync(dist, runDir, { recursive: true });
const ancestorsWithNodeModules: string[] = [];
for (let d = runDir; ; d = dirname(d)) {
  if (existsSync(join(d, 'node_modules'))) ancestorsWithNodeModules.push(d);
  if (dirname(d) === d) break;
}
r.evidence(`运行目录：${runDir}\n${listFiles(runDir).map((f) => `  ${f}`).join('\n')}`);
r.check('运行目录和它的每一级上级目录都没有 node_modules', ancestorsWithNodeModules.length === 0, ancestorsWithNodeModules.join('\n'));

// 环境里去掉 NODE_PATH，防止从全局路径找到包
const env = { PORT: '0', NODE_PATH: '' };
type Health = { ok: boolean; sqlite: string; journalMode: string; nativeBinding: string; dbFile: string; cwd: string };
type Row = { id: number; title: string; createdAt: string };
let health: Health | undefined;
let rows: Row[] = [];
let rowsAfterRestart: Row[] = [];
try {
  const first = await startServer(process.execPath, [join(runDir, bundleName)], { cwd: runDir, env });
  const base = `http://127.0.0.1:${first.port}`;
  health = (await (await fetch(`${base}/health`)).json()) as Health;
  for (const title of ['设置页的保存按钮在窄屏被挡住', '队列看板的等待行和列里的卡重复']) {
    await fetch(`${base}/queue`, { method: 'POST', body: JSON.stringify({ title }), headers: { 'content-type': 'application/json' } });
  }
  rows = (await (await fetch(`${base}/queue`)).json()) as Row[];
  await first.stop();
  r.evidence(
    [
      `$ cd ${runDir} && node ${bundleName}`,
      `GET  /health -> ${JSON.stringify(health)}`,
      `POST /queue ×2，GET /queue -> ${JSON.stringify(rows)}`,
    ].join('\n'),
  );

  // 换一个当前目录再起一次：路径都从 import.meta.url 算，和当前目录无关；迁移不会重复执行，数据还在
  const second = await startServer(process.execPath, [join(runDir, bundleName)], { cwd: '/', env });
  rowsAfterRestart = (await (await fetch(`http://127.0.0.1:${second.port}/queue`)).json()) as Row[];
  await second.stop();
  r.evidence(`$ cd / && node ${join(runDir, bundleName)}\nGET  /queue -> ${rowsAfterRestart.length} 行`);
} catch (error) {
  r.evidence(String(error));
}
// macOS 的 /var 是 /private/var 的链接，import.meta.url 给的是真实路径
r.check(
  `better-sqlite3 从运行目录里的 ${nativeFile} 加载，SQLite 可用（预写日志模式）`,
  health?.ok === true &&
    health.nativeBinding === join(realpathSync(runDir), nativeFile) &&
    health.journalMode === 'wal' &&
    /^3\.\d+\.\d+$/.test(health.sqlite),
);
r.check(
  'Drizzle 按 drizzle/ 里的迁移建表，插入和查询都正常',
  rows.length === 2 && rows[0]?.title === '设置页的保存按钮在窄屏被挡住' && typeof rows[1]?.createdAt === 'string',
);
r.check('从另一个当前目录重启：迁移不重复执行，数据还在', rowsAfterRestart.length === 2);

r.section('对照：运行目录里没有原生文件');
const noNative = mkdtempSync(join(tmpdir(), 'ploop-spike-nonative-'));
cpSync(dist, noNative, { recursive: true });
rmSync(join(noNative, nativeFile));
const neg = run(process.execPath, [join(noNative, bundleName)], { cwd: noNative, env, timeoutMs: 15_000 });
const negLines = neg.stderr.split('\n');
r.evidence(
  [
    `$ node ${bundleName}（删掉 ${nativeFile} 以后）`,
    negLines.find((l) => l.startsWith('Error:')) ?? neg.stderr.trim(),
    negLines.find((l) => /at getBinding/.test(l))?.trim() ?? '',
    `（退出码 ${neg.code}）`,
  ].join('\n'),
);
r.check(
  '没有原生文件就启动失败，报错来自 nativeBinding 那条路径（说明没有从别处找到 better-sqlite3）',
  neg.code !== 0 &&
    neg.code !== -1 &&
    neg.stderr.includes(`Cannot find module '${join(realpathSync(noNative), nativeFile)}'`) &&
    neg.stderr.includes('at getBinding'),
);

if (keep) console.log(`\n保留了运行目录：${runDir}、${noNative}`);
else for (const d of [runDir, noNative]) rmSync(d, { recursive: true, force: true });
console.log(`\n（dist/ 在 ${relative(process.cwd(), dist) || dist}，可以直接 node dist/${bundleName} 运行）`);

r.finish();
