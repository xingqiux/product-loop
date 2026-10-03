// 开发时直接用 Node 的类型剥离运行：node src/serve.ts。端口写 0 时由系统分配。
import { serve } from '@hono/node-server';
import { app } from './app.ts';

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 4731) }, (info) => {
  console.log(JSON.stringify({ event: 'listening', port: info.port }));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
