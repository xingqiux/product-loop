// 第一项：Hono 的类型化客户端跨包使用。
// 包 A（packages/backend）导出 Hono 应用和 AppType；包 B（packages/client）只引入类型，用 hc<AppType> 调接口。
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { bin, ROOT, Report, run, startServer } from './lib/util.ts';

const r = new Report('一、Hono 的类型化客户端跨包使用');
const tsc = bin('tsc');
const guard = join(ROOT, 'scripts', 'rpc-guard.ts');

r.section('版本');
const version = (dir: string, name: string) =>
  (JSON.parse(readFileSync(join(ROOT, dir, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version;
r.evidence(
  [
    `hono ${version('packages/backend', 'hono')}`,
    `@hono/node-server ${version('packages/backend', '@hono/node-server')}`,
    `@hono/zod-validator ${version('packages/backend', '@hono/zod-validator')}`,
    `zod ${version('packages/backend', 'zod')}`,
    `typescript ${run(tsc, ['--version']).stdout.trim()}`,
    `node ${process.version}`,
  ].join('\n'),
);

r.section('包 B 怎样拿到包 A 的类型');
const clientPkg = JSON.parse(readFileSync(join(ROOT, 'packages/client/package.json'), 'utf8'));
r.evidence(
  [
    `packages/client/package.json 的 dependencies：${JSON.stringify(clientPkg.dependencies)}`,
    `packages/client/package.json 的 devDependencies：${JSON.stringify(clientPkg.devDependencies)}`,
    `packages/client/src/index.ts：${readFileSync(join(ROOT, 'packages/client/src/index.ts'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('import'))
      .join('  ')}`,
  ].join('\n'),
);

r.section('类型检查（tsc --noEmit）');
const a = run(tsc, ['--noEmit', '-p', 'packages/backend']);
r.check('包 A 通过 tsc --noEmit', a.code === 0, a.output);
const b = run(tsc, ['--noEmit', '-p', 'packages/client']);
r.check('包 B 通过 tsc --noEmit（含 src/type-assertions.ts 的 7 条精确类型断言）', b.code === 0, b.output);

r.section('故意写错（packages/client/type-errors/wrong-usage.ts）');
const e = run(tsc, ['--noEmit', '-p', 'packages/client/tsconfig.type-errors.json']);
r.evidence(e.output);
const expected: [string, RegExp][] = [
  ['阶段取值不对', /wrong-usage\.ts\(7,\d+\): error TS2322: Type '"评审"' is not assignable/],
  ['漏了路径参数', /wrong-usage\.ts\(10,\d+\): error TS2345[\s\S]*?Property 'param' is missing/],
  ['读了响应里没有的字段', /wrong-usage\.ts\(16,\d+\): error TS2551: Property 'roundId' does not exist/],
  ['调了没有的接口', /wrong-usage\.ts\(20,\d+\): error TS2339: Property '\$delete' does not exist/],
];
const errorCount = (e.output.match(/: error TS\d+:/g) ?? []).length;
for (const [name, re] of expected) r.check(`tsc 拦下：${name}`, re.test(e.output));
r.check(`tsc 以非零退出码结束，且正好 4 处错误（实际 ${errorCount} 处，退出码 ${e.code}）`, e.code !== 0 && errorCount === 4);

r.section('运行时：拉起包 A，用包 B 调接口');
const server = await startServer(process.execPath, ['packages/backend/src/serve.ts'], { env: { PORT: '0' } });
const baseUrl = `http://127.0.0.1:${server.port}`;
const demo = run(process.execPath, ['--import', guard, 'packages/client/src/demo.ts', baseUrl]);
await server.stop();
r.check('包 B 的演示脚本正常结束', demo.code === 0, demo.output);

type DemoOut = {
  health: { status: number; body: { ok: boolean; data: { status: string; apiVersion: number } } };
  started: { status: number; body: { ok: boolean; data: { round: string; stage: string; taken: string[] }; next: string[] } };
  rejected: { status: number; body: { ok: boolean; error: { code: string; issues: { path: string; message: string }[] } } };
};
let out: DemoOut | undefined;
try {
  out = JSON.parse(demo.stdout.trim().split('\n').at(-1) ?? '') as DemoOut;
} catch {
  // 下面的检查会失败并打印输出
}
if (out) {
  r.evidence(
    [
      `后端：${baseUrl}（node packages/backend/src/serve.ts，Node 直接运行 .ts）`,
      `GET  /api/v1/health             -> ${out.health.status} ${JSON.stringify(out.health.body)}`,
      `POST /api/v1/projects/p1/rounds -> ${out.started.status} ${JSON.stringify(out.started.body)}`,
      `POST /api/v1/projects/p1/rounds（stage 写成 "评审"，take 写成 ["12"]）`,
      `                                -> ${out.rejected.status} ${JSON.stringify(out.rejected.body)}`,
      demo.stderr.trim(),
    ].join('\n'),
  );
}
r.check('GET /health 返回 200 和 {ok:true, data.status:"正常"}', out?.health.status === 200 && out.health.body.data.status === '正常');
r.check(
  'POST /projects/:pid/rounds 返回 201 和带类型的数据',
  out?.started.status === 201 && out.started.body.data.round === 'v1-检查-1' && out.started.body.data.taken.join() === 'Q12,Q15',
);
r.check(
  '不合法的请求被 Zod 拦下，返回 400 和中文的校验信息',
  out?.rejected.status === 400 &&
    out.rejected.body.error.code === 'BAD_REQUEST' &&
    out.rejected.body.error.issues.some((i) => i.path === 'stage' && /[一-鿿]/.test(i.message)),
);
r.check('客户端运行期间没有加载包 A 的任何文件（rpc-guard）', demo.code === 0 && /运行时加载的包：hono\/client$/m.test(demo.stderr));

// 对照：守卫确实能发现「运行时引入后端」，上面那条才有意义
const neg = run(process.execPath, ['--import', guard, '--input-type=module', '-e', "await import('@spike/backend')"], {
  cwd: join(ROOT, 'packages/client'),
});
r.check('对照：在包 B 里真的 import 包 A 时，守卫会报错', neg.code !== 0 && neg.output.includes('客户端在运行时引入了后端的代码'));

r.section('延伸：浏览器一侧（将来的 packages/web）怎样拿 AppType');
// 包 B 从源码拿 AppType 时，包 A 的源码按包 B 的配置一起检查。浏览器的配置没有 Node 的类型，就会在后端的源码里报错。
const webSrc = run(tsc, ['--noEmit', '-p', 'packages/client/tsconfig.web-src.json']);
r.evidence(`$ tsc --noEmit -p packages/client/tsconfig.web-src.json\n${webSrc.output}`);
r.check(
  '对照：浏览器的配置（lib 有 dom，没有 Node 的类型）从源码拿 AppType，tsc 在包 A 的源码里报错',
  webSrc.code !== 0 && /packages\/backend\/src\/\S+: error TS2591: Cannot find name 'process'/.test(webSrc.output),
);
rmSync(join(ROOT, 'packages/backend/dist/types'), { recursive: true, force: true });
const emit = run(tsc, ['-p', 'packages/backend/tsconfig.types.json']);
const appDts = join(ROOT, 'packages/backend/dist/types/app.d.ts');
r.check(
  '包 A 用 tsc 7 出类型声明到 dist/types/（要明确写 rootDir）',
  emit.code === 0 && existsSync(appDts),
  emit.output,
);
if (existsSync(appDts)) {
  const dts = readFileSync(appDts, 'utf8');
  const imports = [...new Set([...dts.matchAll(/import\("([^"]+)"\)/g)].map((m) => m[1]))];
  r.evidence(`dist/types/app.d.ts：${(dts.length / 1024).toFixed(1)} KB，引用的模块只有 ${imports.join('、')}`);
}
const webDts = run(tsc, ['--noEmit', '-p', 'packages/client/tsconfig.web-dts.json']);
r.check('浏览器的配置改从 .d.ts 拿 AppType：通过 tsc，7 条类型断言照样成立', webDts.code === 0, webDts.output);

r.finish();
