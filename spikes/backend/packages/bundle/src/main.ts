// 一个小后端：Hono + better-sqlite3 + Drizzle。打包后和原生文件、迁移文件夹放在同一个运行目录里：
//   <运行目录>/ploop-backend.mjs
//   <运行目录>/<平台>-<芯片>.node      better-sqlite3 的原生文件，例如 darwin-arm64.node
//   <运行目录>/drizzle/                drizzle-kit 生成的迁移
// 数据库放在 SPIKE_DATA_DIR（默认就是运行目录）。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import Database from 'better-sqlite3';
import { asc } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import { queueItems } from './schema.ts';

const here = dirname(fileURLToPath(import.meta.url));
const nativeBinding = join(here, `${process.platform}-${process.arch}.node`);
const dbFile = join(process.env.SPIKE_DATA_DIR ?? here, 'spike.db');

// 不写 nativeBinding 时，better-sqlite3 到它自己的包目录（node_modules/better-sqlite3/prebuilds/）里找原生文件；
// 打包以后没有这个目录，所以明确指向运行目录里的那一份。
const sqlite = new Database(dbFile, { nativeBinding });
sqlite.pragma('journal_mode = WAL');
const db = drizzle({ client: sqlite });
migrate(db, { migrationsFolder: join(here, 'drizzle') });

const app = new Hono()
  .get('/health', (c) =>
    c.json({
      ok: true,
      node: process.version,
      sqlite: sqlite.prepare('select sqlite_version()').pluck().get() as string,
      journalMode: sqlite.pragma('journal_mode', { simple: true }) as string,
      nativeBinding,
      dbFile,
      cwd: process.cwd(),
    }),
  )
  .post('/queue', async (c) => {
    const { title } = await c.req.json<{ title: string }>();
    const row = db.insert(queueItems).values({ title }).returning().get();
    return c.json(row, 201);
  })
  .get('/queue', (c) => c.json(db.select().from(queueItems).orderBy(asc(queueItems.id)).all()));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT ?? 0) }, (info) => {
  console.log(JSON.stringify({ event: 'listening', port: info.port }));
});

process.on('SIGTERM', () => {
  server.close();
  sqlite.close();
  process.exit(0);
});
