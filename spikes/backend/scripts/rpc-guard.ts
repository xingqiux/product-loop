// 用 node --import 预先加载：客户端运行期间，一旦要加载包 A（packages/backend）里的任何文件就报错。
// 用来证明包 B 在运行时只依赖 hono/client，没有把后端的代码带进来。
import { registerHooks } from 'node:module';

const packages = new Set<string>();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.includes('/packages/backend/')) {
      throw new Error(`客户端在运行时引入了后端的代码：${specifier} -> ${result.url}`);
    }
    if (!/^(\.|\/|node:|file:)/.test(specifier)) packages.add(specifier);
    return result;
  },
});

process.on('exit', () => {
  console.error(`[rpc-guard] 运行时加载的包：${[...packages].join('、') || '无'}`);
});
